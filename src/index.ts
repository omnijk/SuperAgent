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
import { dreamCommands } from './commands/dream.js';
import { SkillLoader } from './skills/loader.js';
import { createSkillCommands } from './commands/skill.js';
import { PluginManager } from './plugins/manager.js';
import { supabasePlugin } from './plugins/supabase-plugin.js';
import { createPluginCommands } from './commands/plugin.js';
import type { PluginDefinition } from './plugins/types.js';
import { ChannelGateway } from './channels/gateway.js';
import { FeishuChannel } from './channels/feishu.js';
import { createChannelCommands } from './commands/channel.js';
import { HookPipeline } from './security/hooks.js';
import { classifyBashCommand } from './security/bash-classifier.js';
import { createSecurityCommands } from './commands/security.js';

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

// ── Memory ────────────────────────────────
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

// ── Skills ────────────────────────────────
const skillLoader = new SkillLoader('.');
const loadedSkills = skillLoader.load();
const activeSkills = new Set<string>();

// ── Plugins ────────────────────────────────
const pluginManager = new PluginManager(registry);
const availablePlugins = new Map<string, PluginDefinition>([
  ['supabase', supabasePlugin],
]);

const hookPipeline = new HookPipeline();

hookPipeline.registerPre('audit-log', (toolName, input) => {
  if (toolName === 'write_file' || toolName === 'edit_file') {
    const path = (input as any)?.path || 'unknown';
    console.log(`  [audit] 文件写入操作: ${toolName} → ${path}`);
  }
  return { action: 'allow' };
});

hookPipeline.registerPost('bash-timestamp', (toolName, _input, output) => {
  if (toolName === 'bash') {
    const timestamp = new Date().toISOString();
    return { action: 'modify', modifiedOutput: `[${timestamp}]\n${output}` };
  }
  return { action: 'allow' };
});

registry.setHookPipeline(hookPipeline);

// ── Prompt Builder ────────────────────────────────
const builder = new PromptBuilder()
  .pipe('coreRules', coreRules())
  .pipe('toolGuide', toolGuide())
  .pipe('deferredTools', deferredTools())
  .pipe('memoryContext', memoryContext(memoryStore))
  .pipe('ragContext', ragContext(vectorStore))
  .pipe('skillContext', () => skillLoader.buildPromptSection(activeSkills))
  .pipe('sessionContext', sessionContext());

// ── Channel Gateway ────────────────────────────────
const gateway = new ChannelGateway({
  model,
  registry,
  buildSystem: () => builder.build(makePromptCtx()),
});

const FEISHU_PORT = Number(process.env.FEISHU_PORT || '3000');
const feishuChannel = new FeishuChannel({
  appId: process.env.FEISHU_APP_ID || '',
  appSecret: process.env.FEISHU_APP_SECRET || '',
  port: FEISHU_PORT,
});
gateway.register(feishuChannel);

// ── Commands ────────────────────────────────
const dispatch = createDispatcher([
  ...debugCommands,
  ...contextCommands,
  ...memoryCommands,
  ...ragCommands,
  ...dreamCommands,
  ...createSkillCommands(skillLoader, activeSkills),
  ...createPluginCommands(pluginManager, availablePlugins),
  ...createChannelCommands(gateway),
  ...createSecurityCommands(registry, hookPipeline),
]);

function makePromptCtx(): PromptContext {
  return {
    toolCount: registry.getActiveTools().length,
    deferredToolSummary: registry.getDeferredToolSummary(),
    sessionMessageCount: 0,
    sessionId: 'default',
  };
}

async function main() {
  await connectMCP();

  // 加载插件
  console.log('  加载插件...');
  for (const [name, def] of availablePlugins) {
    try {
      const tools = await pluginManager.load(def);
      console.log(`  ✓ ${name} — ${tools.length} 个工具`);
    } catch {
      console.log(`  ✗ ${name} — 加载失败`);
    }
  }

  // 启动 Channel
  console.log('  启动 Channel...');
  await gateway.startAll();

  const store = new SessionStore('default');
  let messages: ModelMessage[] = [];
  const timestamps = new Map<number, number>();
  const tracker = new UsageTracker('.usage/today.jsonl');

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  function ask() {
    rl.question('\nYou: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'exit') {
        console.log('Bye!');
        await gateway.stopAll();
        await pluginManager.unloadAll();
        rl.close();
        return;
      }

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

  console.log('Super Agent v0.16 — Channel (type "exit" to quit)');
  console.log('快捷命令：');
  console.log('  /channel         — 查看通道状态');
  console.log('  /plugin          — 查看插件');
  console.log('  /skill           — 查看 skills');
  console.log('  /memory          — 查看记忆');
  console.log('  /context         — context 占用矩阵');
  console.log('');
  console.log(`  Dashboard: http://localhost:${FEISHU_PORT}`);
  console.log('  打开浏览器发送测试消息，或在终端直接对话');
  console.log('');

  if (loadedSkills.length > 0) {
    console.log(`  发现 ${loadedSkills.length} 个 skill`);
  }

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
      }
      console.log(`  知识库就绪，共 ${vectorStore.size()} 个片段\n`);
    }
  }

  const role = registry.getRole();
  const toolCount = registry.getActiveTools().length;
  const hooks = hookPipeline.list();

  console.log(`  当前角色: ${role}，可用工具: ${toolCount} 个`);
  console.log(`  Hook: ${hooks.pre.length} 个 pre + ${hooks.post.length} 个 post`);


  ask();
}

main().catch(console.error);