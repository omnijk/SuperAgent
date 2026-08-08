export type HookAction = 'allow' | 'block' | 'modify';
// allow（放行）、block（拦截，只在 pre hook 有效）、modify（放行但修改输入/输出）

// 在工具调用前后插入自定义逻辑
// 钩子的返回结果
export interface HookResult {
  action: HookAction;      // 要执行的动作（继续/中断等）
  reason?: string;         // 原因说明
  modifiedInput?: unknown; // 修改后的输入
  modifiedOutput?: unknown;// 修改后的输出
}

// 前置和后置钩子
export type PreToolHook = (toolName: string, input: unknown) => HookResult | Promise<HookResult>;
export type PostToolHook = (toolName: string, input: unknown, output: unknown) => HookResult | Promise<HookResult>;

export class HookPipeline {
  // 管道管理器，维护两个钩子队列
  private preHooks: Array<{ name: string; fn: PreToolHook }> = [];
  private postHooks: Array<{ name: string; fn: PostToolHook }> = [];

  // 注册钩子并加入队列
  registerPre(name: string, fn: PreToolHook): void {
    this.preHooks.push({ name, fn });
  }

  registerPost(name: string, fn: PostToolHook): void {
    this.postHooks.push({ name, fn });
  }

  // 链式调用处理所有前置钩子
  async runPre(toolName: string, input: unknown): Promise<HookResult> {
    let currentInput = input;
    // 对于队列中的每一个hook，进行安全检查
    // 决定要不要拦截，如果拦截了，就打印输出
    for (const hook of this.preHooks) {
      try {
        const result = await hook.fn(toolName, currentInput);
        if (result.action === 'block') {
          console.log(`  [hook:${hook.name}] 拦截 ${toolName}: ${result.reason}`);
          return result;
        }
        if (result.action === 'modify' && result.modifiedInput !== undefined) {
          currentInput = result.modifiedInput;
          // 更新 currentInput，让下一个钩子拿到修改后的数据
        }
      } catch (err) {
        // 单个钩子报错，不影响其他的
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [hook:${hook.name}] pre 异常: ${msg}`);
      }
    }
    return { action: 'allow' };
  }

  // 后置钩子不支持 block，负责"怎么做完的结果"，通常只需要加工，不需要阻止返回
  async runPost(toolName: string, input: unknown, output: unknown): Promise<HookResult> {
    let currentOutput = output;
    for (const hook of this.postHooks) {
      try {
        const result = await hook.fn(toolName, input, currentOutput);
        if (result.action === 'modify' && result.modifiedOutput !== undefined) {
          currentOutput = result.modifiedOutput;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [hook:${hook.name}] post 异常: ${msg}`);
      }
    }
    return { action: 'allow', modifiedOutput: currentOutput };
  }

    list(): { pre: string[]; post: string[] } {
    return {
      pre: this.preHooks.map(h => h.name),
      post: this.postHooks.map(h => h.name),
    };
  }
}
