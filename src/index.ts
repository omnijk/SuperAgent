import 'dotenv/config';
import fs from 'node:fs';
import { type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createMockModel } from './mock-model.js';
import { createInterface } from 'node:readline';
import { ToolRegistry } from './tools/registry.js';
import { allTools } from './tools/index.js';
import { createToolSearchTool } from './tools/tool-search.js';
import { createMemoryTool } from './tools/memory-tools.js';
import { createRagTools } from './tools/rag-tools.js';
import { MockMCPClient } from './tools/mcp-client.js';
import { agentLoop } from './agent/loop.js';
import { SessionStore } from './session/store.js';
import {
  PromptBuilder, coreRules, toolGuide, deferredTools, sessionContext,
  type PromptContext,
} from './context/prompt-builder.js';
import { estimateMessageTokens } from './context/defense.js';
import { UsageTracker } from './usage/tracker.js';
import { MemoryStore } from './memory/store.js';
import { memoryContext, ragContext } from './context/prompt-pipes.js';
import { chunkDocument } from './rag/chunker.js';
import { createMockEmbedder, createDashScopeEmbedder, embed } from './rag/embedder.js';
// 本地内存数组存储RAG
// import { VectorStore } from './rag/store.js';
// sqlite存储RAG版
import { SqliteVectorStore } from './rag/sqlite-store.js';
import { createDispatcher, type CommandContext } from './commands/index.js';
import { debugCommands } from './commands/debug.js';
import { contextCommands } from './commands/context.js';
import { memoryCommands } from './commands/memory.js';
import { ragCommands } from './commands/rag.js';

const qwen = createOpenAI({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY,
});

const model = process.env.DASHSCOPE_API_KEY
  ? qwen.chat('qwen-plus-latest')
  : createMockModel();

// ── Registry ────────────────────────────────
const registry = new ToolRegistry();
registry.register(...allTools);
registry.register(createToolSearchTool(registry));

// ── Memory ──────────��─────────────────────
const memoryStore = new MemoryStore('.');
memoryStore.init();
registry.register(createMemoryTool(memoryStore));

// ── RAG ──��─────────────────────────────
// 本地内存数组存储RAG
// const vectorStore = new VectorStore();
// sqlite存储RAG版
const vectorStore = new SqliteVectorStore('knowledge.db');
const embedFn = process.env.DASHSCOPE_API_KEY
  ? createDashScopeEmbedder(process.env.DASHSCOPE_API_KEY)
  : createMockEmbedder();
registry.register(...createRagTools(vectorStore, embedFn));

async function connectMCP() {
  const mockClient = new MockMCPClient();
  const tools = await registry.registerMCPServer('github', mockClient);
  console.log(`  已注册 ${tools.length} 个 Mock MCP 工具`);
}

// ── Commands ���───────────────────────────────
const dispatch = createDispatcher([
  ...debugCommands,
  ...contextCommands,
  ...memoryCommands,
  ...ragCommands,
]);

async function main() {
  await connectMCP();

  const store = new SessionStore('default');
  let messages: ModelMessage[] = [];
  const timestamps = new Map<number, number>();
  const tracker = new UsageTracker('.usage/today.jsonl');

  const builder = new PromptBuilder()
    .pipe('coreRules', coreRules())
    .pipe('toolGuide', toolGuide())
    .pipe('deferredTools', deferredTools())
    .pipe('memoryContext', memoryContext(memoryStore))
    .pipe('ragContext', ragContext(vectorStore))
    .pipe('sessionContext', sessionContext());

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  function makePromptCtx(): PromptContext {
    return {
      toolCount: registry.getActiveTools().length,
      deferredToolSummary: registry.getDeferredToolSummary(),
      sessionMessageCount: messages.length,
      sessionId: 'default',
    };
  }

  function ask() {
    rl.question('\nYou: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'exit') { console.log('Bye!'); rl.close(); return; }

      const ctx: CommandContext = {
        messages, timestamps, registry, builder, tracker,
        sessionStore: store, model, makePromptCtx, ask,
        memoryStore, vectorStore,
      };
      const handled = dispatch(trimmed, ctx);
      if (handled === 'async') return;
      if (handled) { ask(); return; }

      const userMsg: ModelMessage = { role: 'user', content: trimmed };
      messages.push(userMsg);
      timestamps.set(messages.length - 1, Date.now());
      store.append(userMsg);

      const currentSystem = builder.build(makePromptCtx());
      const beforeLen = messages.length;
      await agentLoop(model, registry, messages, currentSystem, tracker);

      const newMessages = messages.slice(beforeLen);
      const now = Date.now();
      for (let i = beforeLen; i < messages.length; i++) timestamps.set(i, now);
      store.appendAll(newMessages);

      console.log(`  [Token] ~${estimateMessageTokens(messages)} tokens`);
      ask();
    });
  }

  console.log('Super Agent v0.12 — RAG (type "exit" to quit)');
  console.log('快捷命令：');
  console.log('  ingest <path>   — 导入文档到知识��');
  console.log('  /rag            — 查看知识库状态');
  console.log('  /memory         — 查看记忆');
  console.log('  /context        — context 占用矩阵');
  console.log('  status          — 当前状态');
  console.log('');

  if (fs.existsSync('docs')) {
    const files = fs.readdirSync('docs').filter(f => f.endsWith('.md'));
    if (files.length > 0) {
      console.log(`  发现 ${files.length} 个文档，自动导入知识库...`);
      for (const f of files) {
        const path = `docs/${f}`;
        const text = fs.readFileSync(path, 'utf-8');
        const chunks = chunkDocument(path, text);
        const embeddings = await embed(embedFn, chunks.map(c => c.text));
        vectorStore.addBatch(chunks.map((c, i) => ({ chunk: c, embedding: embeddings[i] })));
        console.log(`    ${f} → ${chunks.length} 个片段`);
      }
      console.log(`  知识库就绪，共 ${vectorStore.size()} 个片段\n`);
    }
  }

  ask();
}

main().catch(console.error);
