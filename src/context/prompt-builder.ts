export interface PromptContext {
  toolCount: number;  //工具调用次数
  deferredToolSummary: string;   // 延迟工具调用的摘要
  sessionMessageCount: number;   // 绘画消息总数
  sessionId: string;             // 对话唯一标识
}

// PipeFn类型的函数，接受一个PromptContext的参数，要么返回一段文本，要么返回null直接跳过
type PipeFn = (ctx: PromptContext) => string | null;

// 提示词构建器，管道模式动态构建提示词
export class PromptBuilder {
  // 存储所有注册的管道函数
  private pipes: Array<{ name: string; fn: PipeFn }> = [];

  // 注册一个管道函数，返回实例本身，从而支持了链式调用
  pipe(name: string, fn: PipeFn): this {
    this.pipes.push({ name, fn });
    return this;
  }

  // 构建提示词prompt
  // 把之前注册的管道函数全部执行一遍，把他们返回的非空结果拼接成完整的提示词
  build(ctx: PromptContext): string {
    const sections: string[] = [];
    // 把之前注册的管道函数，挨个拿出来执行
    for (const { fn } of this.pipes) {
      const result = fn(ctx);
      if (result !== null) {
        // 把非空结果加入数组
        sections.push(result);
      }
    }
    return sections.join('\n\n');
  }

  // 快速诊断哪些管道是好的
  debug(ctx: PromptContext): void {
    console.log('\n=== Prompt Pipe Debug ===');
    for (const { name, fn } of this.pipes) {
      const result = fn(ctx);
      const status = result !== null
        ? `[ON] ${result.length} chars` : '[OFF]';
      console.log(`  ${name}: ${status}`);
    }
    console.log('========================\n');
  }
}

// 管道函数，每一个都是工厂函数（创建并返回对象）
export function coreRules(): PipeFn {
  return () => `你是 Super Agent，一个有工具调用能力的 AI 助手。
你的行为准则：
- 先读文件再修改，不要凭记忆编辑
- 不要加没被要求的功能
- 工具调用失败时，换一个思路而不是重复同样的操作
- 回答要简洁直接`;
}

export function toolGuide(): PipeFn {
  return (ctx) => {
    if (ctx.toolCount === 0) return null;
    return `你有 ${ctx.toolCount} 个工具可用。需要操作本地文件时使用内置工具，需要访问外部服务时使用 MCP 工具。`;
  };
}

export function deferredTools(): PipeFn {
  return (ctx) => {
    if (!ctx.deferredToolSummary) return null;
    return `如果你需要的工具不在当前列表中，使用 tool_search 工具搜索。${ctx.deferredToolSummary}`;
  };
}

export function sessionContext(): PipeFn {
  return (ctx) => {
    if (ctx.sessionMessageCount === 0) return null;
    return `[会话信息] 当前会话 ${ctx.sessionId}，已有 ${ctx.sessionMessageCount} 条历史消息。`;
  };
}