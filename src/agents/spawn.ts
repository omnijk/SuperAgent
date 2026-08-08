import { type ModelMessage, streamText } from 'ai';
import type { ToolRegistry } from '../tools/registry.js';
import type { SubAgentRegistry } from './registry.js';
import type { SpawnRequest } from './types.js';

// 定义了子代理运行所需的一切资源
export interface SpawnContext {
  model: any;                    // AI 模型
  registry: ToolRegistry;        // 工具注册表
  agentRegistry: SubAgentRegistry; // 子代理注册表
  buildSystem: () => string;     // 构建系统提示词的函数
  currentDepth: number;          // 当前嵌套深度
}

// 子代理不能使用 spawn_agent 这个工具
const EXCLUDED_TOOLS = new Set(['spawn_agent']);

const AGENT_COLORS = [
  '\x1b[36m',  // cyan
  '\x1b[33m',  // yellow
  '\x1b[35m',  // magenta
  '\x1b[32m',  // green
  '\x1b[34m',  // blue
];
const RESET = '\x1b[0m';

// 生成带颜色的标签
function agentTag(index: number, runId: string): string {
  const color = AGENT_COLORS[index % AGENT_COLORS.length];
  return `${color}[Agent-${index + 1}:${runId}]${RESET}`;
}

// 核心：创建一个子agent，运行一个特定的子任务，并返回结果
export async function spawnAgent(
  request: SpawnRequest,   // 子代理的请求（包含任务描述）
  ctx: SpawnContext,        // 上下文环境（模型、工具、注册表等）
  index = 0,                // 子代理的序号（用于日志着色）
): Promise<string>           {
  // 返回子代理的执行结果
  const { ok, reason } = ctx.agentRegistry.canSpawn(ctx.currentDepth);
  if (!ok) return `[spawn] 拒绝: ${reason}`;

  // 创建运行记录对象，并写在注册表中
  const runId = ctx.agentRegistry.generateId();
  const tag = agentTag(index, runId);
  const run = {
    id: runId,
    task: request.task,
    status: 'running' as const,
    depth: ctx.currentDepth + 1,
    startedAt: new Date().toISOString(),
  };
  ctx.agentRegistry.register(run);

  const timeout = request.timeout || 60000;  // 默认 60 秒超时
  const maxSteps = 30;                        // 最多 30 步
  const ac = new AbortController();           // 用于取消请求
  console.log(`  ${tag} 启动: ${request.task.slice(0, 50)}`);
  // 关键：独立的 messages 数组 = 独立的上下文窗口，代表拿不到父亲的上下文信息
  const messages: ModelMessage[] = [
    { role: 'user', content: request.task },
  ];
  try {
    const system = ctx.buildSystem() +
      '\n\n[子 Agent 模式] 你是一个被派出去执行具体任务的子 Agent。直接完成任务并输出结论，保持简洁。' +
      '\n当你需要同时获取多个独立信息时（比如读多个文件、搜多个关键词），尽可能在一次回复中并行调用多个工具，不要一个个串行调。';

    // toAISDKFormatUnlocked 绕过父 Agent 的读写锁；排除 spawn_agent 防递归
    const tools = ctx.registry.toAISDKFormatUnlocked(EXCLUDED_TOOLS);
    const timer = setTimeout(() => ac.abort(), timeout);

    try {
      let step = 0;
      while (step < maxSteps) {
        step++;
        const isLastStep = step === maxSteps;
        console.log(`  ${tag} Step ${step}/${maxSteps}${isLastStep ? ' (总结)' : ''}`);
        
        // 现在是最后一步了，强制让它生成结论
        if (isLastStep) {
          messages.push({ role: 'user', content: '你已经收集了足够的信息。请直接输出文字总结，不要再调用任何工具。' });
        }
        const result = streamText({
          model: ctx.model, system,
          tools,
          toolChoice: isLastStep ? 'none' : 'auto',// 最后一步不能调工具
          messages,
          maxRetries: 0, abortSignal: ac.signal,
          providerOptions: { openai: { parallelToolCalls: true } },
          onError: () => {},
        });
        let hasToolCall = false;
        for await (const part of result.fullStream) {
          if (part.type === 'tool-call') {
            hasToolCall = true;
            const argsPreview = JSON.stringify(part.input).slice(0, 80);
            console.log(`  ${tag} 调用 ${part.toolName}(${argsPreview})`);
          }
        }
        const response = await result.response;
        messages.push(...response.messages);
        if (!hasToolCall) break; // 没有工具调用 → 任务完成
      }
    } finally {
      clearTimeout(timer);
    }

    // 提取最后一条 assistant 消息作为结果
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    let result = '(无输出)';
    if (lastAssistant) {
      if (typeof lastAssistant.content === 'string') {
        result = lastAssistant.content;
      } else if (Array.isArray(lastAssistant.content)) {
        result = lastAssistant.content
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('') || '(无输出)';
      }
    }

    ctx.agentRegistry.complete(runId, result);
    console.log(`  ${tag} 完成 ✓ (${result.length} 字符)`);
    return result;
  } catch (err: any) {
    const isAbort = err.name === 'AbortError' || ac.signal.aborted;
    const errorMsg = isAbort ? `执行超时 (${timeout / 1000}s)` : (err.message || String(err));
    ctx.agentRegistry.fail(runId, errorMsg);
    console.log(`  ${tag} ${isAbort ? '超时' : '失败'} ✗: ${errorMsg}`);
    if (isAbort) {
      const partial = [...messages].reverse().find(m => m.role === 'assistant');
      if (partial) {
        const text = typeof partial.content === 'string' ? partial.content
          : Array.isArray(partial.content)
            ? partial.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
            : '';
        if (text) return `[部分结果] ${text}`;
      }
    }
    return `[sub-agent 执行失败] ${errorMsg}`;
  }
}

export async function spawnParallel(
  requests: SpawnRequest[],
  ctx: SpawnContext,
): Promise<Array<{ task: string; result: string }>> {
  console.log(`\n  ┌─ 派发 ${requests.length} 个子 Agent 并行执行 ─┐`);
  // 这里用了promiseall,当其中一个执行失败的时候
  // 拿不到结果的
  // 好消息是做了try-catch处理异常，不会出错的
  const results = await Promise.all(
    // 并行执行
    requests.map(async (req, i) => {
      const result = await spawnAgent(req, ctx, i);
      return { task: req.task, result };
    })
  );
  console.log(`  └─ 全部完成 (${results.length}/${requests.length}) ─┘\n`);
  return results;
}
