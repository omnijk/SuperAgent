import type { MemoryStore } from '../memory/store.js';
// // 本地内存存储版本
// import type { VectorStore } from '../rag/store.js';
import type { PromptContext } from './prompt-builder.js';
// SQLITE存储向量版本
import type {SqliteVectorStore} from '../rag/sqlite-store.js'

// 上下文提示器工厂，用于生成动态的提示内容，注入AI上下文中

export function memoryContext(memoryStore: MemoryStore): (ctx: PromptContext) => string | null {
  return () => memoryStore.buildPromptSection();
}

// // 本地内存存储版本
// export function ragContext(vectorStore: VectorStore): (ctx: PromptContext) => string | null {
//   return () => {
//     const size = vectorStore.size();
//     if (size === 0) return null;
//     const sources = vectorStore.sources();
//     return `[知识库] 已导入 ${size} 个文档片段（来源: ${sources.join(', ')}）。使用 rag_search 工具搜索知识库。`;
//   };
// }

// SQLITE存储向量版本
export function ragContext(vectorStore: SqliteVectorStore): (ctx: PromptContext) => string | null {
  return () => {
    const size = vectorStore.size();
    if (size === 0) return null;
    const sources = vectorStore.sources();
    return `[知识库] 已导入 ${size} 个文档片段（来源: ${sources.join(', ')}）。使用 rag_search 工具搜索知识库。`;
  };
}