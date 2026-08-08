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
import { agentLoop } from './agents/loop.js';
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
import { CronService } from './cron/service.js';
import { createCronTool } from './tools/corn-tools.js';
import { createCronCommands } from './commands/cron.js';
import { SubAgentRegistry } from './agents/registry.js';
import { createSpawnTool } from './tools/spawn-tools.js';
import { createAgentCommands } from './commands/agent.js';
import type { SpawnContext } from './agents/spawn.js';
import { loadConfig } from './config/loader.js';
import { SuperAgentConfigSchema, type SuperAgentConfig } from './config/schema.js';

// 在 createModel 函数之前添加这行
const config = loadConfig();
function createModel(cfg: SuperAgentConfig['model']) {
  if (!cfg.apiKey) return createMockModel();
  const provider = createOpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  return provider.chat(cfg.name);
}
const model = createModel(config.model);


// ── Registry ────────────────────────────────
const registry = new ToolRegistry();
registry.register(...allTools);
registry.register(createToolSearchTool(registry));

// ── Memory ────────────────────────────────
const memoryStore = new MemoryStore('.');
memoryStore.init();
registry.register(createMemoryTool(memoryStore));

// ── RAG ────────────────────────────────
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

// 之前
// hookPipeline.registerPre('audit-log', (toolName, input) => {
//   if (toolName === 'write_file' || toolName === 'edit_file') {
//     const path = (input as any)?.path || 'unknown';
//     console.log(`  [audit] 文件写入操作: ${toolName} → ${path}`);
//   }
//   return { action: 'allow' };
// });

// hookPipeline.registerPost('bash-timestamp', (toolName, _input, output) => {
//   if (toolName === 'bash') {
//     const timestamp = new Date().toISOString();
//     return { action: 'modify', modifiedOutput: `[${timestamp}]\n${output}` };
//   }
//   return { action: 'allow' };
// });

// 现在
if (config.security.auditLog) {
  hookPipeline.registerPre('audit-log', (toolName, input) => {
    if (toolName === 'write_file' || toolName === 'edit_file') {
      const path = (input as any)?.path || 'unknown';
      console.log(`  [audit] 文件写入操作: ${toolName} → ${path}`);
    }
    return { action: 'allow' };
  });
}
if (config.security.bashTimestamp) {
  hookPipeline.registerPost('bash-timestamp', (toolName, _input, output) => {
    if (toolName === 'bash') {
      const timestamp = new Date().toISOString();
      return { action: 'modify', modifiedOutput: `[${timestamp}]\n${output}` };
    }
    return { action: 'allow' };
  });
}

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

// 之前
// const FEISHU_PORT = Number(process.env.FEISHU_PORT || '3000');
// const feishuChannel = new FeishuChannel({
//   appId: process.env.FEISHU_APP_ID || '',
//   appSecret: process.env.FEISHU_APP_SECRET || '',
//   port: FEISHU_PORT,
// });
// gateway.register(feishuChannel);

// 现在
if (config.channels.feishu.enabled) {
  const feishuChannel = new FeishuChannel({
    appId: config.channels.feishu.appId,
    appSecret: config.channels.feishu.appSecret,
    port: config.channels.feishu.port,
  });
  gateway.register(feishuChannel);
}


// ── Cron Service ────────────────────────────────
// 之前
const cronService = new CronService('.');
registry.register(createCronTool(cronService));


// ── Sub-Agent ────────────────────────────────
// 之前
// const agentRegistry = new SubAgentRegistry({ maxSpawnDepth: 1, maxConcurrent: 3 });

// 现在
const agentRegistry = new SubAgentRegistry({
  maxSpawnDepth: config.agents.maxSpawnDepth,
  maxConcurrent: config.agents.maxConcurrent,
});

function getSpawnCtx(): SpawnContext {
  return {
    model,
    registry,
    agentRegistry,
    buildSystem: () => builder.build(makePromptCtx()),
    currentDepth: 0,
  };
}

registry.register(createSpawnTool(agentRegistry, getSpawnCtx));

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
  ...createCronCommands(cronService),
  ...createAgentCommands(agentRegistry),
]);

function makePromptCtx(): PromptContext {
  return {
    toolCount: registry.getActiveTools().length,
    deferredToolSummary: registry.getDeferredToolSummary(),
    sessionMessageCount: 0,
    sessionId: 'default',
  };
}

export async function startAgent() {
  await connectMCP();
  console.log('  加载插件...');
  // 之前
  // for (const [name, def] of availablePlugins) {
  //   try { const tools = await pluginManager.load(def); console.log(`  ✓ ${name} — ${tools.length} 个工具`); }
  //   catch { console.log(`  ✗ ${name} — 加载失败`); }
  // }

  // 现在
  for (const pluginCfg of config.plugins) {
    const def = availablePlugins.get(pluginCfg.name);
    if (!def) { console.log(`  ✗ ${pluginCfg.name} — 未知插件`); continue; }
    if (!pluginCfg.enabled) { console.log(`  - ${pluginCfg.name} — 已禁用`); continue; }
    const tools = await pluginManager.load(def);
    console.log(`  ✓ ${pluginCfg.name} — ${tools.length} 个工具`);
  }

  console.log('  启动 Channel...');
  await gateway.startAll();

  // 之前
  // cronService.load();
  // cronService.setExecutor({
  //   runAgentPrompt: async (prompt, timeout) => {
  //     const cronMessages: ModelMessage[] = [{ role: 'user', content: prompt }];
  //     const system = builder.build(makePromptCtx());
  //     await agentLoop(model, registry, cronMessages, system);
  //     const lastMsg = cronMessages[cronMessages.length - 1];
  //     if (!lastMsg) return '(无输出)';
  //     if (typeof lastMsg.content === 'string') return lastMsg.content;
  //     if (Array.isArray(lastMsg.content)) {
  //       return lastMsg.content
  //         .filter((p: any) => p.type === 'text')
  //         .map((p: any) => p.text)
  //         .join('') || '(无输出)';
  //     }
  //     return String(lastMsg.content);
  //   },
  //   notify: (message) => { console.log(`\n${message}`); },
  // });
  // cronService.start();
  // const cronJobs = cronService.list();
  // console.log(`  Cron: ${cronJobs.length} 个任务已加载`);

  // 现在
  if (config.cron.enabled) {
    cronService.load();
    cronService.setExecutor({
      runAgentPrompt: async (prompt, timeout) => {
        const cronMessages: ModelMessage[] = [{ role: 'user', content: prompt }];
        const system = builder.build(makePromptCtx());
        await agentLoop(model, registry, cronMessages, system);
        const lastMsg = cronMessages[cronMessages.length - 1];
        if (!lastMsg) return '(无输出)';
        if (typeof lastMsg.content === 'string') return lastMsg.content;
        if (Array.isArray(lastMsg.content)) {
          return lastMsg.content
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('') || '(无输出)';
        }
        return String(lastMsg.content);
      },
      notify: (message) => { console.log(`\n${message}`); },
    });
    cronService.start();
  }
  const cronJobs = cronService?.list?.() || [];
  console.log(`  Cron: ${cronJobs.length} 个任务已加载`);

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
        if (cronService) cronService.stop();
        await gateway.stopAll();
        await pluginManager.unloadAll();
        rl.close();
        return;
      }
      const ctx: CommandContext = { messages, timestamps, registry, builder, tracker, sessionStore: store, model, makePromptCtx, ask, memoryStore, vectorStore };
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

  const role = registry.getRole();
  const toolCount = registry.getActiveTools().length;
  const hooks = hookPipeline.list();

  console.log('Super Agent v0.18 — Cron 定时任务 (type "exit" to quit)');
  console.log('快捷命令：');
  console.log('  /cron             — 查看定时任务');
  console.log('  /cron logs        — 查看执行记录');
  console.log('  /role [角色]      — 查看/切换角色');
  console.log('  /hooks            — 查看 Hook 管线');
  console.log('');
  console.log(`  当前角色: ${role}，可用工具: ${toolCount} 个`);
  console.log(`  Hook: ${hooks.pre.length} 个 pre + ${hooks.post.length} 个 post`);
  console.log(`  Cron: ${cronJobs.length} 个定时任务`);
  console.log('');
  console.log('  试试：');
  console.log('    让 Agent 创建一个每 30 秒执行的定时任务');
  console.log('    /cron         — 查看当前任务列表');
  console.log('    /cron logs    — 查看执行记录');
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
      }
      console.log(`  知识库就绪，共 ${vectorStore.size()} 个片段\n`);
    }
  }
  ask();
}