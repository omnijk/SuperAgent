import type { ModelMessage } from 'ai';
import { textToolResultOutput, toolResultOutputToText } from './tool-result-output.js';

// ── Layer 1: Token Estimation ────────────────────────
// 估算使用的tokens
// 精确基准+粗估增量
// 每次调用SDK的usage.inputTokens 精确值校准（updateFromAPI）
// 中间新增的消息使用char/4补上，中文的话，加上1.2x安全系数
export class TokenTracker {
  // 上次API返回的精准token数
  private lastPreciseCount = 0;
	// 待估算的差值
  private pendingChars = 0;

	// 使用返回的精确值做校准
  updateFromAPI(promptTokens: number): void {
    this.lastPreciseCount = promptTokens;
    this.pendingChars = 0;
  }

	// 记录新消息
  addMessage(message: ModelMessage): void {
    this.pendingChars += countMessageChars(message);
  }

  addMessages(messages: ModelMessage[]): void {
    for (const message of messages) {
      this.addMessage(message);
    }
  }

  // 替换旧的工具结果时，只记录前后的字符差  
  replaceMessages(before: ModelMessage[], after: ModelMessage[]): void {
    this.pendingChars += countMessagesChars(after) - countMessagesChars(before);
  }

	// 获取当前的token数
  get estimatedTokens(): number {
    return Math.max(0, this.lastPreciseCount + Math.ceil(this.pendingChars / 4));
  }

	// 超过上下文窗口的75%，触发压缩
  get status(): { tokens: number; percent: number; needsAction: boolean } {
    const tokens = this.estimatedTokens;
    const percent = Math.round((tokens / CONTEXT_WINDOW) * 100);
    return {
      tokens,
      percent,
      needsAction: percent >= 75,
    };
  }
}

const CONTEXT_WINDOW = 200_000;

function countMessageChars(message: ModelMessage): number {
  let chars = 0;
  if (typeof message.content === 'string') {
    return message.content.length;
  }
  if (!Array.isArray(message.content)) return chars;

  for (const part of message.content) {
    if ('text' in part && typeof part.text === 'string') {
      chars += part.text.length;
    } else if ('output' in part) {
      chars += toolResultOutputToText(part.output).length;
    } else if ('input' in part) {
      chars += JSON.stringify(part.input)?.length ?? 0;
    }
  }
  return chars;
}

function countMessagesChars(messages: ModelMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    chars += countMessageChars(message);
  }
  return chars;
}

export function estimateMessageTokens(messages: ModelMessage[]): number {
  const chars = countMessagesChars(messages);
  // 4 chars per token, with 1.2x safety factor for Chinese
  return Math.ceil((chars / 4) * 1.2);
}

// ── Layer 2: Dynamic Tool Result Truncation ──────────

interface TruncationConfig {
  maxSingleResult: number;
  contextBudgetChars: number;
}

const DEFAULT_TRUNCATION: TruncationConfig = {
  maxSingleResult: Math.floor(CONTEXT_WINDOW * 0.5 * 2),   // 50% of window, 2 chars/token
  contextBudgetChars: Math.floor(CONTEXT_WINDOW * 0.75 * 4), // 75% of window, 4 chars/token
};

export function truncateToolResults(
	// 输入是消息列表和配置参数
	// 输出是处理后的消息列表、被截断的工具结果数，被压缩的工具结果数
  messages: ModelMessage[],
  config: TruncationConfig = DEFAULT_TRUNCATION,
): { messages: ModelMessage[]; truncated: number; compacted: number } {
  let truncated = 0;
  let compacted = 0;

  // Pass 1: single-result truncation (Head/Tail 60/40)
	// 单条截断，超过50%的工具结果做分割
  let result = messages.map(msg => {
		// 只处理工具角色的消息
    if (msg.role !== 'tool' || !Array.isArray(msg.content)) return msg;

    const newContent = msg.content.map((part: any) => {
			// 将消息转换成字符串格式，判断是否超过限制，没超过直接返回，不截断
      if (!part.output) return part;
      const outputText = toolResultOutputToText(part.output);
      if (outputText.length <= config.maxSingleResult) return part;

      truncated++;
      const maxChars = config.maxSingleResult;
			// 截取前面的60%或者后面的40%
      const headSize = Math.floor(maxChars * 0.6);
      const tailSize = Math.floor(maxChars * 0.4);
      const head = outputText.slice(0, headSize);
      const tail = outputText.slice(-tailSize);

			// 最后返回截断之后的结果，只修改输出的部分
      return {
        ...part,
        output: textToolResultOutput(`${head}\n\n[truncated: ${outputText.length} → ${maxChars} chars]\n\n${tail}`),
      };
    });

    return { ...msg, content: newContent };
  });

  // Pass 2: total budget enforcement — compact oldest tool results first
  // 总量预算——如果总字符数还超 75%，从最老的 tool result 开始清理
	let totalChars = result.reduce((sum, msg) => {
    if (typeof msg.content === 'string') return sum + msg.content.length;
    if (Array.isArray(msg.content)) {
      return sum + (msg.content as any[]).reduce((s, p) =>
        s + (p.output ? toolResultOutputToText(p.output).length : (p.text as string)?.length || 0), 0);
    }
    return sum;
  }, 0);

	// 总字符数超过限制，就执行压缩，从最旧的工具列表开始
	// 替换为占位符，暂时移除模型的视野
	// 只压到预算范围内，不过都牺牲信息
  if (totalChars > config.contextBudgetChars) {
    for (let i = 0; i < result.length && totalChars > config.contextBudgetChars; i++) {
      const msg = result[i];
      if (msg.role !== 'tool' || !Array.isArray(msg.content)) continue;
      const toolName = ((msg.content as any[])[0])?.toolName || 'unknown';
      const oldSize = (msg.content as any[]).reduce((s: number, p: any) =>
        s + (p.output ? toolResultOutputToText(p.output).length : 0), 0);
      result[i] = {
        ...msg,
        content: (msg.content as any[]).map((p: any) => ({
          ...p,
          output: textToolResultOutput(`[compacted: ${toolName} output removed to free context]`),
        })),
      };
      totalChars -= oldSize;
      compacted++;
    }
  }

  return { messages: result, truncated, compacted };
}

// ── Layer 3: TTL Pruning ─────────────────────────────

interface TTLConfig {
  softTTLMs: number;
  hardTTLMs: number;
  keepHeadTail: number;
}

const DEFAULT_TTL: TTLConfig = {
  softTTLMs: 5 * 60 * 1000,    // 5 minutes
  hardTTLMs: 10 * 60 * 1000,   // 10 minutes
  keepHeadTail: 1500,           // chars to keep in soft prune
};

export interface PruneResult {
  messages: ModelMessage[];
  softPruned: number;
  hardPruned: number;
}

export function ttlPrune(
  messages: ModelMessage[],
  timestamps: Map<number, number>,
  config: TTLConfig = DEFAULT_TTL,
): PruneResult {
  const now = Date.now();
  let softPruned = 0;
  let hardPruned = 0;

  const result = messages.map((msg, idx) => {
    // Only prune tool results, never user/assistant messages
    if (msg.role !== 'tool' || !Array.isArray(msg.content)) return msg;

    const ts = timestamps.get(idx);
    if (!ts) return msg;

    const age = now - ts;

    // Preserve error experiences — never prune failed tool results
    const outputText = (msg.content as any[])
      .map((p: any) => p.output ? toolResultOutputToText(p.output) : '')
      .join('');
    const isError = /error|失败|不存在|denied|refused|timeout/i.test(outputText);
    if (isError) return msg;

    // Hard clear: replace entire content with placeholder
    if (age >= config.hardTTLMs) {
      hardPruned++;
      const toolName = (msg.content[0] as any)?.toolName || 'unknown';
      return {
        ...msg,
        content: msg.content.map((part: any) => ({
          ...part,
          output: textToolResultOutput(`[tool result expired: ${toolName}]`),
        })),
      };
    }

    // Soft prune: keep head + tail, replace middle
    if (age >= config.softTTLMs) {
      const newContent = msg.content.map((part: any) => {
        if (!part.output) return part;
        const outputText = toolResultOutputToText(part.output);
        if (outputText.length <= config.keepHeadTail * 2) return part;

        softPruned++;
        const head = outputText.slice(0, config.keepHeadTail);
        const tail = outputText.slice(-config.keepHeadTail);
        const removed = outputText.length - config.keepHeadTail * 2;

        return {
          ...part,
          output: textToolResultOutput(`${head}\n\n[soft pruned: ${removed} chars removed, content older than ${Math.round(config.softTTLMs / 60000)}min]\n\n${tail}`),
        };
      });
      return { ...msg, content: newContent };
    }

    return msg;
  });

  return { messages: result, softPruned, hardPruned };
}

// ── Combined Defense ─────────────────────────────────

export interface DefenseResult {
  messages: ModelMessage[];
  tokenEstimate: number;
  truncated: number;
  compacted: number;
  softPruned: number;
  hardPruned: number;
}

export function applyDefense(
  messages: ModelMessage[],
  timestamps: Map<number, number>,
): DefenseResult {
  // Layer 2: truncate oversized tool results
  const trunc = truncateToolResults(messages);
  let result = trunc.messages;

  // Layer 3: TTL prune old tool results
  const prune = ttlPrune(result, timestamps);
  result = prune.messages;

  // Layer 1: estimate final token count
  const tokenEstimate = estimateMessageTokens(result);

  return {
    messages: result,
    tokenEstimate,
    truncated: trunc.truncated,
    compacted: trunc.compacted,
    softPruned: prune.softPruned,
    hardPruned: prune.hardPruned,
  };
}