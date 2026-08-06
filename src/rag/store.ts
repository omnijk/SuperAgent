import type { Chunk } from './chunker.js';

export interface StoredChunk extends Chunk {
  embedding: number[];
  addedAt: number;
}

// 内存中的向量数据库，用来存储文档块及其对应的向量
export class VectorStore {
  private chunks: StoredChunk[] = [];

  // 添加并更新单个向量块
  // 已存在：更新，不存在：新增
  // 就算内容不变，时间戳也要更新，因为可能要根据时间获取最新的一些
  add(chunk: Chunk, embedding: number[]): void {
    const existing = this.chunks.findIndex(c => c.id === chunk.id);
    if (existing >= 0) {
      this.chunks[existing] = { ...chunk, embedding, addedAt: Date.now() };
    } else {
      this.chunks.push({ ...chunk, embedding, addedAt: Date.now() });
    }
  }

  // 批量更新
  addBatch(items: Array<{ chunk: Chunk; embedding: number[] }>): void {
    for (const { chunk, embedding } of items) {
      this.add(chunk, embedding);
    }
  }

  // 返回数组
  getAll(): StoredChunk[] {
    return this.chunks;
  }

  // 获取数量
  size(): number {
    return this.chunks.length;
  }

  // 清空数组
  clear(): void {
    this.chunks = [];
  }

  // 获取文本块的来源，同时保证不重复
  sources(): string[] {
    return [...new Set(this.chunks.map(c => c.source))];
  }
}
