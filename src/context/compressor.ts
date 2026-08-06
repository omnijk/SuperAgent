import { generateText, type ModelMessage } from 'ai';
import { textToolResultOutput, toolResultOutputToText } from './tool-result-output.js';

/** Estimate token count: ~4 chars per token for mixed Chinese/English. */
// 估算消息的tokens
function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    // 字符串直接增加长度
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      // 数组的话，遍历其中每一个元素
      // 如果是字符，直接增加长度
      // 如果是输出结果，通过调用方法计算
      for (const part of msg.content) {
        if ('text' in part && typeof part.text === 'string') {
          chars += part.text.length;
        } else if ('output' in part) {
          chars += toolResultOutputToText(part.output).length;
        }
      }
    }
  }
  return Math.ceil(chars / 4);  //每4哥字符数一个token
}

// ── Layer 1: Microcompact ────────────────────────────

const CLEARABLE_TOOLS = new Set([
  'read_file', 'bash', 'grep', 'glob', 'list_directory',
  'edit_file', 'write_file',
]);
// 最近3哥工具结果不清理，因为有可能马上就要用
const KEEP_RECENT_TOOL_RESULTS = 3;

// 压缩古老工调用具的结果，
export function microcompact(messages: ModelMessage[]): {
  messages: ModelMessage[];
  cleared: number;
} {
  let cleared = 0;
  const toolResultIndices: number[] = [];

  // 拿到工具调用角色的对话index，存起来
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      toolResultIndices.push(i);
    }
  }

  // 如果不是最近的，又被保留了索引，后面就要展开清理了
  const toClear = toolResultIndices.slice(
    0, Math.max(0, toolResultIndices.length - KEEP_RECENT_TOOL_RESULTS)
  );

  const result = messages.map((msg, idx) => {
    // 遍历每一条消息
    if (!toClear.includes(idx)) return msg;
    if (msg.role !== 'tool' || !Array.isArray(msg.content)) return msg;

    const toolName = (msg.content[0] as any)?.toolName || 'unknown';
    if (!CLEARABLE_TOOLS.has(toolName)) return msg;

    cleared++;
    // 保留消息本身的东西，把消息的content替换
    return {
      ...msg,
      content: msg.content.map((part: any) => ({
        ...part,
        output: textToolResultOutput('[tool result cleared]'),
      })),
    };
  });

  return { messages: result, cleared };
}

// ── Layer 2: LLM Summarization ───────────────────────

// 优秀的压缩上写问提示词，让模型去填，而不是自由发挥
const COMPRESS_PROMPT = `你是一个对话压缩系统。你的任务是把 Agent 和用户之间的对话历史压缩成一份结构化摘要，确保后续对话能够无缝继续。

请严格按照以下模板输出，每个字段都要填写。如果某个字段没有相关内容，写"无"：

## 用户意图
（用户在这次对话中想要完成什么）

## 已完成的操作
（Agent 执行了哪些工具调用、产生了什么结果）

## 关键发现
（读取的文件内容要点、搜索结果、命令输出中的关键信息）

## 当前状态
（对话进行到哪一步了、还有什么没做完）

## 需要保留的细节
（文件路径、变量名、配置值、错误信息等不能丢失的具体内容）

注意事项：
- 用对话中使用的语言（中文或英文）输出
- 文件路径、UUID、版本号等标识符必须原样保留，不要翻译或改写
- 不要写笼统的概述，只保留具体的、可操作的信息
- 总长度控制在 800 字以内`;

// 阈值，超过这个数就触发压缩
const CONTEXT_TOKEN_THRESHOLD = 300;
// 最近的KEEP_RECENT_MESSAGES保留，不被压缩
const KEEP_RECENT_MESSAGES = 6;

// 一次压缩操作的返回值结构
export interface CompactionResult {
  messages: ModelMessage[];  //压缩之后的消息部分
  summary: string;           //被压缩部分的摘要文本
  compressedCount: number;   //被压缩的消息数量
}

// 摘要化压缩的具体实现
export async function summarize(
  model: any,
  messages: ModelMessage[],
  existingSummary?: string,
): Promise<CompactionResult> {
  const tokenEstimate = estimateTokens(messages);
  // 如果用的token小于300，或者消息条数很少，直接不压缩
  if (tokenEstimate < CONTEXT_TOKEN_THRESHOLD || messages.length <= KEEP_RECENT_MESSAGES) {
    return { messages, summary: existingSummary || '', compressedCount: 0 };
  }

  // 决定切分开始的位置，最近的6条不做切分
  const splitIdx = Math.max(0, messages.length - KEEP_RECENT_MESSAGES);

  // Align to user message boundary
  // 从最近的一条用户消息开始，避免压缩了不完整的对话内容，找到真正的切分点
  let alignedIdx = splitIdx;
  while (alignedIdx > 0 && messages[alignedIdx].role !== 'user') {
    alignedIdx--;
  }
  // 如果最后压缩到了第一条消息，不做压缩，这样没意义
  if (alignedIdx === 0) {
    return { messages, summary: existingSummary || '', compressedCount: 0 };
  }

  const toCompress = messages.slice(0, alignedIdx);
  const toKeep = messages.slice(alignedIdx);

  // 把要压缩的消息转换成文本格式，便于LLM后面去做摘要总结
  // 纯字符串：直接拿来用
  // 数组的话，遍历每一条，提取文本或者转成文本拼在一起
  // 去掉空字符串，并用两个换行符切割消息
  // 即转换后回变成清晰的对话文本
  const conversationText = toCompress
    .map(msg => {
      const content = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map(part => 'text' in part
            ? part.text
            : 'output' in part
              ? toolResultOutputToText(part.output)
              : '').join('')
          : '';
      return content ? `**${msg.role}**: ${content}` : '';
    })
    .filter(Boolean)
    .join('\n\n');

  // 如果直接就是空的，没有任何压缩的必要
  if (!conversationText.trim()) {
    return { messages, summary: existingSummary || '', compressedCount: 0 };
  }

  // 构建要发给LLM的要处理的文本
  const userPrompt = existingSummary
    ? `## 已有摘要（上一次压缩的结果）\n\n${existingSummary}\n\n## 需要压缩的新对话\n\n${conversationText}`
    : conversationText;

  try {
    // 提示词发给大模型，拿到压缩之后的摘要
    const { text: summary } = await generateText({
      model,
      system: COMPRESS_PROMPT,
      prompt: userPrompt,
    });

    // 把摘要拼接成user角色的消息，并拼接在一起
    const summaryMessage: ModelMessage = {
      role: 'user',
      content: `[以下是之前对话的压缩摘要]\n\n${summary}\n\n[摘要结束，以下是最近的对话]`,
    };

    const newMessages: ModelMessage[] = [summaryMessage, ...toKeep];

    return {
      messages: newMessages,
      summary,
      compressedCount: toCompress.length,
    };
  } catch (err) {
    // 摘要失败了就暂时不压缩了
    console.error('[Compaction] LLM 摘要失败:', err);
    return { messages, summary: existingSummary || '', compressedCount: 0 };
  }
}

export { estimateTokens };