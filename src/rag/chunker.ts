export interface Chunk {
  id: string;
  text: string;
  source: string;
  index: number;
  tokenEstimate: number;
}

const TARGET_TOKENS = 256;
const CHARS_PER_TOKEN = 4;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;

// 长文本分块，使用的是递归分块
export function chunkDocument(source: string, text: string): Chunk[] {
  // 两个以上的换行符分块，把文本切割成连续的段落
  const paragraphs = text.split(/\n{2,}/);
  const chunks: Chunk[] = [];
  let current = '';
  let idx = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // 如果追加到当前内容之后超过限制就把原来的加进去+重置+再处理现在的
    if (current.length + trimmed.length + 2 > TARGET_CHARS && current.length > 0) {
      chunks.push(makeChunk(source, current.trim(), idx++));
      current = '';
    }

    // 处理本身超长段落，按句子划分
    if (trimmed.length > TARGET_CHARS) {
      if (current.length > 0) {
        chunks.push(makeChunk(source, current.trim(), idx++));
        current = '';
      }
      const sentences = trimmed.split(/(?<=[。！？.!?])\s*/);
      let sentBuf = '';
      for (const sent of sentences) {
        if (sentBuf.length + sent.length + 1 > TARGET_CHARS && sentBuf.length > 0) {
          chunks.push(makeChunk(source, sentBuf.trim(), idx++));
          sentBuf = '';
        }
        sentBuf += (sentBuf ? ' ' : '') + sent;
      }
      if (sentBuf.trim()) {
        current = sentBuf.trim();
      }
    } else {
      current += (current ? '\n\n' : '') + trimmed;
    }
  }

  if (current.trim()) {
    chunks.push(makeChunk(source, current.trim(), idx++));
  }

  return chunks;
}

// 把文本段包装成结构化的chunk数据
function makeChunk(source: string, text: string, index: number): Chunk {
  return {
    // 唯一标识。如来源+序号，比如 "report.pdf#3"
    id: `${source}#${index}`,
    text,
    source,
    index,
    // 估算的token数量
    tokenEstimate: Math.ceil(text.length / CHARS_PER_TOKEN),
  };
}
