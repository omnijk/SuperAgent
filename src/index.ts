import 'dotenv/config';
import { type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createMockModel } from './mock-model.js';
import { createInterface } from 'node:readline';
import { ToolRegistry, type ToolDefinition } from './tools/registry.js';
import { allTools } from './tools/index.js';
import { MCPClient, MockMCPClient } from './tools/mcp-client.js';
import { agentLoop } from './agent/loop.js';
import { SessionStore } from './session/store.js';
import {
  PromptBuilder, coreRules, toolGuide, deferredTools, sessionContext,
  type PromptContext,
} from './context/prompt-builder.js';
import{textToolResultOutput}from './context/tool-result-output.js'
import {estimateTokens,microcompact,summarize} from './context/compressor.js'

const qwen = createOpenAI({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY,
});

const model = process.env.DASHSCOPE_API_KEY
  ? qwen.chat('qwen-plus-latest')
  : createMockModel();

const registry = new ToolRegistry();
registry.register(...allTools);

// tool_search 元工具
const toolSearchTool: ToolDefinition = {
  name: 'tool_search',
  description: '获取延迟工具的完整定义。传入工具名（从系统提示的延迟工具列表中选取），返回该工具的完整参数 Schema',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '工具名，如 "mcp__github__list_issues"。支持逗号分隔多个' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ query }: { query: string }) => {
    const results = registry.searchTools(query);
    if (results.length === 0) return `没有找到工具: ${query}`;
    return results.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  },
};
registry.register(toolSearchTool);

// 模拟 MCP 工具
function registerSimulatedTools() {
  const simulatedTools: ToolDefinition[] = [
    { name: 'mcp__notion__search_pages', description: '[MCP:notion] 搜索 Notion 页面', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, shouldDefer: true, searchHint: 'notion search pages documents', isConcurrencySafe: true, isReadOnly: true, execute: async ({ query }: any) => JSON.stringify([{ title: `Mock: ${query}`, id: 'page-001' }]) },
    { name: 'mcp__notion__create_page', description: '[MCP:notion] 创建 Notion 页面', parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title'] }, shouldDefer: true, searchHint: 'notion create page document write', isConcurrencySafe: false, isReadOnly: false, execute: async ({ title }: any) => `已创建页面: ${title}` },
    { name: 'mcp__browser__navigate', description: '[MCP:browser] 导航到指定 URL', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, shouldDefer: true, searchHint: 'browser navigate open url webpage', isConcurrencySafe: false, isReadOnly: false, execute: async ({ url }: any) => `已导航到 ${url}` },
    { name: 'mcp__browser__screenshot', description: '[MCP:browser] 对当前页面截图', parameters: { type: 'object', properties: {} }, shouldDefer: true, searchHint: 'browser screenshot capture page', isConcurrencySafe: true, isReadOnly: true, execute: async () => '[screenshot data]' },
    { name: 'mcp__supabase__query', description: '[MCP:supabase] 执行 SQL 查询', parameters: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] }, shouldDefer: true, searchHint: 'supabase database sql query select', isConcurrencySafe: true, isReadOnly: true, execute: async ({ sql }: any) => JSON.stringify([{ id: 1, name: 'mock_row', sql }]) },
    { name: 'mcp__supabase__list_tables', description: '[MCP:supabase] 列出数据库所有表', parameters: { type: 'object', properties: {} }, shouldDefer: true, searchHint: 'supabase database list tables schema', isConcurrencySafe: true, isReadOnly: true, execute: async () => JSON.stringify(['users', 'orders', 'products']) },
  ];
  registry.register(...simulatedTools);
  return simulatedTools.length;
}

async function connectMCP() {
  const githubToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

  let canSpawn = true;
  try {
    const { execSync } = await import('node:child_process');
    execSync('echo test', { stdio: 'ignore' });
  } catch {
    canSpawn = false;
  }

  if (githubToken && canSpawn) {
    console.log('\n连接 GitHub MCP Server...');
    try {
      const client = new MCPClient(
        'npx', ['-y', '@modelcontextprotocol/server-github'],
        { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
      );
      const tools = await registry.registerMCPServer('github', client);
      console.log(`  已注册 ${tools.length} 个 MCP 工具`);
      return;
    } catch (err) {
      console.log(`  MCP 连接失败: ${err instanceof Error ? err.message : err}`);
      console.log('  降级为 Mock MCP...');
    }
  }

  if (!githubToken) {
    console.log('\n未配置 GITHUB_PERSONAL_ACCESS_TOKEN，使用 Mock MCP');
  }

  const mockClient = new MockMCPClient();
  const tools = await registry.registerMCPServer('github', mockClient);
  console.log(`  已注册 ${tools.length} 个 Mock MCP 工具`);
}

// 模拟长对话，用于检验上下文压缩效果
function injectFakeHistory(messages: ModelMessage[]) {
  const fakeHistory: ModelMessage[] = [
    { role: 'user', content: '帮我看看当前目录有什么文件' },
    { role: 'assistant', content: [{ type: 'tool-call' as const, toolCallId: 'fake-1', toolName: 'list_directory', input: { path: '.' } }] },
    { role: 'tool', content: [{ type: 'tool-result' as const, toolCallId: 'fake-1', toolName: 'list_directory', output: textToolResultOutput('[FILE] .env\n[DIR] node_modules\n[FILE] package.json\n[FILE] sample-data.txt\n[DIR] src\n[FILE] tsconfig.json') }] },
    { role: 'assistant', content: [{ type: 'text' as const, text: '当前目录有以下文件：.env, package.json, sample-data.txt, tsconfig.json，以及 src 和 node_modules 两个目录。' }] },
    { role: 'user', content: '读一下 package.json' },
    { role: 'assistant', content: [{ type: 'tool-call' as const, toolCallId: 'fake-2', toolName: 'read_file', input: { path: 'package.json' } }] },
    { role: 'tool', content: [{ type: 'tool-result' as const, toolCallId: 'fake-2', toolName: 'read_file', output: textToolResultOutput('{\n  "name": "super-agent-08-compaction",\n  "version": "0.8.0",\n  "type": "module",\n  "scripts": { "start": "tsx src/index.ts" },\n  "dependencies": { "ai": "5.0.98", "@ai-sdk/openai": "2.0.44" }\n}') }] },
    { role: 'assistant', content: [{ type: 'text' as const, text: 'package.json 的内容：项目名 super-agent-08-compaction，版本 0.8.0，依赖 ai 和 @ai-sdk/openai。' }] },
    { role: 'user', content: '读一下 sample-data.txt' },
    { role: 'assistant', content: [{ type: 'tool-call' as const, toolCallId: 'fake-3', toolName: 'read_file', input: { path: 'sample-data.txt' } }] },
    { role: 'tool', content: [{ type: 'tool-result' as const, toolCallId: 'fake-3', toolName: 'read_file', output: textToolResultOutput('Super Agent 工具系统设计文档\n=============================\n\n一、工具注册机制\n每个工具通过 ToolRegistry 统一注册，提供名称、描述、参数 Schema 和执行函数。\n\n二、结果截断策略\nHead/Tail 60/40 分割，保留文件头部和尾部的关键信息。\n\n三、并发控制\n读写锁模式：只读工具共享锁，读写工具独占锁。\n\n四、最佳实践\n1. 工具描述要写"什么时候不该用"比"能干什么"更有价值\n2. 参数描述要具体——"必须是绝对路径"能防一大类错误\n3. 错误信息要对模型友好——模型需要理解为什么失败才能换策略\n4. 结果格式要结构化——JSON 比自然语言更容易被模型准确解析') }] },
    { role: 'assistant', content: [{ type: 'text' as const, text: 'sample-data.txt 是一份工具系统设计文档，包含四个部分：工具注册机制、结果截断策略、并发控制和最佳实践。' }] },
    { role: 'user', content: '帮我搜索一下 src 目录里有哪些 export' },
    { role: 'assistant', content: [{ type: 'tool-call' as const, toolCallId: 'fake-4', toolName: 'grep', input: { pattern: 'export', path: 'src' } }] },
    { role: 'tool', content: [{ type: 'tool-result' as const, toolCallId: 'fake-4', toolName: 'grep', output: textToolResultOutput('src/tools.ts:1: export const weatherTool\nsrc/tools.ts:20: export const calculatorTool\nsrc/tools.ts:40: export const readFileTool\nsrc/tool-registry.ts:4: export interface ToolDefinition\nsrc/tool-registry.ts:18: export class ToolRegistry\nsrc/agent-loop.ts:7: export async function agentLoop\nsrc/session-store.ts:8: export class SessionStore\nsrc/prompt-builder.ts:12: export class PromptBuilder\nsrc/context-compressor.ts:30: export function microcompact\nsrc/context-compressor.ts:80: export async function summarize') }] },
    { role: 'assistant', content: [{ type: 'text' as const, text: 'src 目录里的主要导出：tools.ts 导出了各种工具定义，tool-registry.ts 导出了 ToolRegistry 类，agent-loop.ts 导出了 agentLoop 函数，还有 SessionStore、PromptBuilder、microcompact 和 summarize 等。' }] },
  ];
  messages.push(...fakeHistory);
}

async function main() {
  await connectMCP();
  const simCount = registerSimulatedTools();
  console.log(`  已注册 ${simCount} 个模拟 MCP 工具`);

  // Session 持久化
  const isContinue = process.argv.includes('--continue');
  const sessionId = 'default';
  const store = new SessionStore(sessionId);


   let messages: ModelMessage[] = [];
  if (isContinue && store.exists()) {
    messages = store.load();
    console.log(`[Session] 恢复会话，${messages.length} 条历史消息`);
  } else {
    // 注入模拟历史，演示压缩效果
    injectFakeHistory(messages);
    console.log(`[Session] 新会话（已注入 ${messages.length} 条模拟历史）`);
  }

  let summary = '';

  // ── 压缩演示 ──
  // 三次计算token，用于对比节省了多少token
  const beforeTokens = estimateTokens(messages);
  console.log(`\n[压缩前] ${messages.length} 条消息, ~${beforeTokens} tokens`);

  // Layer 1: Microcompact清理旧工具的结果
  const mc = microcompact(messages);
  messages = mc.messages;
  const afterMCTokens = estimateTokens(messages);
  console.log(`[Layer 1: Microcompact] 清理了 ${mc.cleared} 个工具结果, ~${afterMCTokens} tokens`);

  // Layer 2: LLM Summarization摘要化
  const compResult = await summarize(model, messages, summary);
  messages = compResult.messages;
  summary = compResult.summary;
  const afterSumTokens = estimateTokens(messages);
  if (compResult.compressedCount > 0) {
    console.log(`[Layer 2: Summarization] 压缩了 ${compResult.compressedCount} 条消息, ~${afterSumTokens} tokens`);
    console.log(`[摘要预览] ${summary.slice(0, 150)}...`);
  } else {
    console.log(`[Layer 2: Summarization] 未触发（消息量不够）`);
  }

  console.log(`[压缩后] ${messages.length} 条消息, ~${afterSumTokens} tokens (节省 ${beforeTokens - afterSumTokens} tokens)\n`);

  // Clear injected history for chat — compression demo is done
  messages = [];

  // Prompt Pipe 组装 system prompt
  const builder = new PromptBuilder()
    .pipe('coreRules', coreRules())
    .pipe('toolGuide', toolGuide())
    .pipe('deferredTools', deferredTools())
    .pipe('sessionContext', sessionContext());

  const promptCtx: PromptContext = {
    toolCount: registry.getActiveTools().length,
    deferredToolSummary: registry.getDeferredToolSummary(),
    sessionMessageCount: messages.length,
    sessionId,
  };

  const SYSTEM = builder.build(promptCtx);

  // Debug: 显示 Prompt Pipe 各模块状态
  builder.debug(promptCtx);

  const activeTools = registry.getActiveTools();
  console.log(`活跃工具: ${activeTools.length} 个`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  function ask() {
    rl.question('\nYou: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'exit') {
        console.log('Bye!');
        await registry.closeAllMCP();
        rl.close();
        return;
      }

      const userMsg: ModelMessage = { role: 'user', content: trimmed };
      messages.push(userMsg);
      store.append(userMsg);

      const beforeLen = messages.length;
      await agentLoop(model, registry, messages, SYSTEM);

      // 持久化本轮新增的消息（agent loop 会往 messages 里 push assistant/tool 消息）
      const newMessages = messages.slice(beforeLen);
      store.appendAll(newMessages);

      ask();
    });
  }

  console.log('Super Agent v0.7 — Session + Prompt Pipe (type "exit" to quit)');
  console.log('对话会自动保存。用 pnpm run continue 恢复上次对话。\n');
  ask();
}

main().catch(console.error);
