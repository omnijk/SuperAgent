import type { ModelMessage } from 'ai';
import type { ToolRegistry } from '../tools/registry.js';
import type { PromptBuilder, PromptContext } from '../context/prompt-builder.js';
import type { UsageTracker } from '../usage/tracker.js';
import type { SessionStore } from '../session/store.js';
import type { MemoryStore } from '../memory/store.ts';

export interface CommandContext {
  // 消息
  messages: ModelMessage[];
  timestamps: Map<number, number>;
  registry: ToolRegistry;
  // 构造提示词
  builder: PromptBuilder;
  // 用量追踪
  tracker: UsageTracker;
  // 会话存储
  sessionStore: SessionStore;
  model: any;
  makePromptCtx: () => PromptContext;
  ask: () => void;
  memoryStore?: MemoryStore;
  [key: string]: any;
}

// 所有的命令处理器都要遵循的函数类型
// 接受的参数是命令或者上下文管理器，返回值有3种
export type CommandHandler = (cmd: string, ctx: CommandContext) => boolean | 'async';

// 工厂函数
// 接受一堆处理器，返回一个新的处理器（能处理的处理器）
export function createDispatcher(handlers: CommandHandler[]): CommandHandler {
  return (cmd, ctx) => {
    for (const h of handlers) {
      const result = h(cmd, ctx);
      if (result) return result;
    }
    return false;
  };
}
