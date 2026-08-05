import { jsonSchema } from 'ai';
import {MCPClient,MockMCPClient} from './mcp-client'

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  isConcurrencySafe?: boolean;
  isReadOnly?: boolean;
  maxResultChars?: number;
  execute: (input: any) => Promise<unknown>;
}

const DEFAULT_MAX_RESULT_CHARS = 3000;

// 工具注册表类型
// 1.集中注册工具
// 2.按照名称查找工具
// 3.批量获取工具
// 4.转换格式为AI SDK
export class ToolRegistry {
	// 私有属性，键值对类型
  private tools = new Map<string, ToolDefinition>();

  // 三个状态变量构成一把读写锁
  // 读：多个人可以同时读书，互不干扰
  // 写：同一时间只能有一人在写
  // 当前是否有独占锁持有者，是否有人在整理图书
  private exclusiveLock=false;
  // 当前共享锁持有数，现在有几个人在读书
  private concurrentCount = 0;
  // 阻塞等待状态中的reslove函数，有几个排队等候的人
  // 数组中的每一个元素都是函数，函数的参数和返回值都为空
  private waitQueue:Array<()=>void>=[];

  // ...tools把传入的多个参数手机到一个数组中
  // 可以让调用方一次性注册多个工具
  register(...tools: ToolDefinition[]): void {
    for (const tool of tools) {
      // set函数用于向map中添加或者更新键值对
      this.tools.set(tool.name, tool);
    }
  }

  // 根据工具的名字拿到对应的值（工具定义）
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    // Array.from静态方法：用于将迭代器转换成真正的数组
    return Array.from(this.tools.values());
  }

  // 获取共享锁
  // 只要没人独占就能拿，多个只读工具可以同时持有
  private async acquireConcurrent():Promise<void>{
    while(this.exclusiveLock){
      // 只要有人在进行写操作，就一直循环等待
      // 把它的唤醒按钮加在队列中，等待按钮被按下
      await new Promise<void>(r=>this.waitQueue.push(r));
    }
    // 读者人数+1
    this.concurrentCount++;
  }

  // 释放写锁
  private releaseConcurrent(): void {
    this.concurrentCount--;
    if (this.concurrentCount === 0) this.drainQueue();
  }

  // 获取独占锁：必须等所有共享锁释放、且没人持独占
  private async acquireExclusive(): Promise<void> {
    while (this.exclusiveLock || this.concurrentCount > 0) {
      await new Promise<void>(r => this.waitQueue.push(r));
    }
    this.exclusiveLock = true;
  }
  
  private releaseExclusive(): void {
    this.exclusiveLock = false;
    this.drainQueue();
  }

  // 锁释放时把等待队列全唤醒，让它们重新去抢锁
  private drainQueue(): void {
    // 所有的在等待中的队列都取出来
    // 所有的可以一起抢，如果是读抢到了就可以多个一起，如果是写，就直接独占
    const waiting = this.waitQueue.splice(0);
    // 醒过啦了之后，直接执行之前的while(exclusiveLock)
    // → false（没人写）→ 退出循环 → concurrentCount++（抢到了！）
    for (const resolve of waiting) resolve();
  }

  // toAISDKFormat转换格式为SDK
  toAISDKFormat(): Record<string, any> {
    const result: Record<string, any> = {};
    // map的解构遍历
    for (const [name, tool] of this.tools) {
      // 最大字符数限制
      const maxChars = tool.maxResultChars;
      // 原始的执行函数
      const executeFn = tool.execute;
      const isSafe = tool.isConcurrencySafe === true;
      const registry = this;

      result[name] = {
        description: tool.description,
        // as any类型断言，以绕过类型检查
        inputSchema: jsonSchema(tool.parameters as any),
        // 一个异步执行函数
        execute: async (input: any) => {
          if (isSafe) {
            await registry.acquireConcurrent();
            console.log(`  [并发] ${name} 获取共享锁`);
          } else {
            await registry.acquireExclusive();
            console.log(`  [串行] ${name} 获取独占锁，等待其他工具完成`);
          }
          try {
            const raw = await executeFn(input);
            const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
            return truncateResult(text, maxChars);
          } finally {
            // 不管成功还是抛异常，锁都要释放
            // 否则整个registry就锁死了
            if (isSafe) {
              registry.releaseConcurrent();
            } else {
              registry.releaseExclusive();
            }
          }
        },
      };
    }
    return result;
  }

  // 添加方法用于连接mcp server，自动注册到resigter里
  private mcpClients: Array<MCPClient | MockMCPClient> = [];

  async registerMCPServer(
    serverName: string,
    client: MCPClient | MockMCPClient,
  ): Promise<string[]> {
    await client.connect();
    this.mcpClients.push(client);

    const tools = await client.listTools();
    const registered: string[] = [];

    for (const tool of tools) {
      // 命名空间隔离，防止工具命名冲突
      const prefixedName = `mcp__${serverName}__${tool.name}`;
      if (this.tools.has(prefixedName)) continue;

      const toolClient = client;
      const originalName = tool.name;

      this.register({
        name: prefixedName,
        // 加上前缀给自己看的，便于调试
        description: `[MCP:${serverName}] ${tool.description}`,
        parameters: tool.inputSchema as Record<string, unknown>,
        isConcurrencySafe: true,
        isReadOnly: true,
        maxResultChars: 3000,
        execute: async (input: any) => {
          // 闭包，使用了外层作用域的变量
          // callTool传递参数，发请求，等响应结果并且解析
          return toolClient.callTool(originalName, input);
        },
      });

      registered.push(prefixedName);
    }

    return registered;
  }

  async closeAllMCP(): Promise<void> {
    for (const client of this.mcpClients) {
      await client.close();
    }
    this.mcpClients = [];
  }

}

// 智能截断长文本：对用户比较友好
// 最大字符数参数有默认值
export function truncateResult(text: string, maxChars: number = DEFAULT_MAX_RESULT_CHARS): string {
  // 没有超过限制，直接输出
  if (text.length <= maxChars) return text;

  // 保留开头的字符数，为最大长度的0.6
  // 尾部保留0.4
  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = maxChars - headSize;
  const head = text.slice(0, headSize);
  const tail = text.slice(-tailSize);
  // 计算被省略的字符数
  const dropped = text.length - headSize - tailSize;

  return `${head}\n\n... [省略 ${dropped} 字符] ...\n\n${tail}`;
}
