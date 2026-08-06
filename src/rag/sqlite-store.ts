import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { Chunk } from './chunker.js';
import type { StoredChunk } from './store.js';
import { embed, type EmbeddingFn } from './embedder.js';
import { mmrSelect, type SearchResult } from './search.js';


export class SqliteVectorStore {
  private db: Database.Database;

  constructor(dbPath: string = 'knowledge.db') {
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);       // 加载向量搜索扩展
    this.createTables();
  }

  private createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        source TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        embedding TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT 'text-embedding-v3',
        updated_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[128]
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text, id UNINDEXED, source UNINDEXED
      );
    `);
  }

//   add(chunk: Chunk, embedding: number[]): void {
//     const now = Date.now();
//     // 三表联动写入
//     this.db.prepare(`INSERT OR REPLACE INTO chunks
//       (id, text, source, chunk_index, embedding, updated_at)
//       VALUES (?, ?, ?, ?, ?, ?)`)
//       .run(chunk.id, chunk.text, chunk.source, chunk.index,
//            JSON.stringify(embedding), now);

//     this.db.prepare(`INSERT OR REPLACE INTO chunks_vec (id, embedding)
//       VALUES (?, ?)`)
//       .run(chunk.id, Buffer.from(new Float32Array(embedding).buffer));

//     this.db.prepare(`INSERT OR REPLACE INTO chunks_fts (id, text, source)
//       VALUES (?, ?, ?)`)
//       .run(chunk.id, chunk.text, chunk.source);
//   }
// 出错！！！！！！！！！！！！！！！！！！！！！！！！！！！！！！！
// SqliteError: UNIQUE constraint failed on chunks_vec primary key
//     at SqliteVectorStore.add (D:\Projects\WEB\SuperAgent\src\rag\sqlite-store.ts:52:8)
//     at <anonymous> (D:\Projects\WEB\SuperAgent\src\rag\sqlite-store.ts:61:54)
//     at sqliteTransaction (D:\Projects\WEB\SuperAgent\node_modules\.pnpm\better-sqlite3@13.0.3\node_modules\better-sqlite3\lib\methods\transaction.js:65:24)
//     at SqliteVectorStore.addBatch (D:\Projects\WEB\SuperAgent\src\rag\sqlite-store.ts:63:5)
//     at main (D:\Projects\WEB\SuperAgent\src\index.ts:156:21)
//     at process.processTicksAndRejections (node:internal/process/task_queues:103:5) {
//   code: 'SQLITE_ERROR'
// }


    add(chunk: Chunk, embedding: number[]): void {
    const now = Date.now();
    
    // 使用事务保证原子性
    const transaction = this.db.transaction(() => {
        // 先删除已存在的记录（三表都要删）
        this.db.prepare('DELETE FROM chunks WHERE id = ?').run(chunk.id);
        this.db.prepare('DELETE FROM chunks_vec WHERE id = ?').run(chunk.id);
        this.db.prepare('DELETE FROM chunks_fts WHERE id = ?').run(chunk.id);
        
        // 再插入新记录
        this.db.prepare(`INSERT INTO chunks
        (id, text, source, chunk_index, embedding, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(chunk.id, chunk.text, chunk.source, chunk.index,
            JSON.stringify(embedding), now);

        this.db.prepare(`INSERT INTO chunks_vec (id, embedding)
        VALUES (?, ?)`)
        .run(chunk.id, Buffer.from(new Float32Array(embedding).buffer));

        this.db.prepare(`INSERT INTO chunks_fts (id, text, source)
        VALUES (?, ?, ?)`)
        .run(chunk.id, chunk.text, chunk.source);
    });

    // 执行事务
    transaction();
    }

  addBatch(items: Array<{ chunk: Chunk; embedding: number[] }>): void {
    const tx = this.db.transaction(() => {
      for (const { chunk, embedding } of items) this.add(chunk, embedding);
    });
    tx();  // 事务批量写入，比逐条快很多
  }

  vectorSearch(queryEmbedding: number[], topK: number): Array<{ chunk: StoredChunk; score: number }> {
    const buf = Buffer.from(new Float32Array(queryEmbedding).buffer);
    const rows = this.db.prepare(`
      SELECT v.id, v.distance, c.text, c.source, c.chunk_index, c.embedding
      FROM chunks_vec v
      JOIN chunks c ON c.id = v.id
      WHERE v.embedding MATCH ?
      ORDER BY v.distance
      LIMIT ?
    `).all(buf, topK) as any[];

    return rows.map(r => ({
      chunk: {
        id: r.id, text: r.text, source: r.source,
        index: r.chunk_index,
        tokenEstimate: Math.ceil(r.text.length / 4),
        embedding: JSON.parse(r.embedding),
        addedAt: 0,
      },
      score: 1 - r.distance,  // cosine distance → similarity
    }));
  }

  keywordSearch(query: string, topK: number): Array<{ chunk: StoredChunk; score: number }> {
    const rows = this.db.prepare(`
      SELECT f.id, bm25(chunks_fts) AS rank, c.text, c.source, c.chunk_index, c.embedding
      FROM chunks_fts f
      JOIN chunks c ON c.id = f.id
      WHERE chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, topK) as any[];

    return rows.map(r => ({
      chunk: {
        id: r.id, text: r.text, source: r.source,
        index: r.chunk_index,
        tokenEstimate: Math.ceil(r.text.length / 4),
        embedding: JSON.parse(r.embedding),
        addedAt: 0,
      },
      score: r.rank < 0 ? -r.rank / (1 - r.rank) : 1 / (1 + r.rank),
    }));
  }

  size(): number {
    return (this.db.prepare('SELECT COUNT(*) as n FROM chunks').get() as any).n;
  }

  clear(): void {
    this.db.exec('DELETE FROM chunks; DELETE FROM chunks_vec; DELETE FROM chunks_fts;');
  }

  sources(): string[] {
    return (this.db.prepare('SELECT DISTINCT source FROM chunks').all() as any[]).map(r => r.source);
  }

  // 混合搜索：直接在 SQLite 层完成向量 + 关键词双路检索
  async hybridSearch(
    embedFn: EmbeddingFn,
    query: string,
    topK: number = 5,
  ): Promise<SearchResult[]> {
    const candidateCount = Math.min(topK * 4, this.size());
    if (candidateCount === 0) return [];

    const [queryVec] = await embed(embedFn, [query]);

    // 路径 1: sqlite-vec 向量搜索
    const vectorResults = this.vectorSearch(queryVec, candidateCount);

    // 路径 2: FTS5 关键词搜索
    const keywordResults = this.keywordSearch(query, candidateCount);

    // 归一化 + 加权合并
    const vecScores = normalizeMinMax(vectorResults.map(r => r.score));
    const kwScores = normalizeMinMax(keywordResults.map(r => r.score));

    const candidates = new Map<string, SearchResult>();
    for (let i = 0; i < vectorResults.length; i++) {
      const id = vectorResults[i].chunk.id;
      candidates.set(id, {
        chunk: vectorResults[i].chunk,
        score: vecScores[i] * 0.7,
        vectorScore: vecScores[i],
        keywordScore: 0,
      });
    }
    for (let i = 0; i < keywordResults.length; i++) {
      const id = keywordResults[i].chunk.id;
      const existing = candidates.get(id);
      if (existing) {
        existing.keywordScore = kwScores[i];
        existing.score += kwScores[i] * 0.3;
      } else {
        candidates.set(id, {
          chunk: keywordResults[i].chunk,
          score: kwScores[i] * 0.3,
          vectorScore: 0,
          keywordScore: kwScores[i],
        });
      }
    }

    const sorted = [...candidates.values()]
      .sort((a, b) => b.score - a.score);

    // MMR deduplication
    return mmrSelect(sorted, topK);
  }
}

function normalizeMinMax(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;
  return scores.map(s => (s - min) / range);
}
