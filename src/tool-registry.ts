import { jsonSchema } from 'ai';

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

export class ToolRegistry {
	// 私有属性，键值对类型
  private tools = new Map<string, ToolDefinition>();

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

  toAISDKFormat(): Record<string, any> {
    const result: Record<string, any> = {};
    // map的解构遍历
    for (const [name, tool] of this.tools) {
      // 最大字符数限制
      const maxChars = tool.maxResultChars;
      // 原始的执行函数
      const executeFn = tool.execute;
      result[name] = {
        description: tool.description,
        // as any类型断言，以绕过类型检查
        inputSchema: jsonSchema(tool.parameters as any),
        execute: async (input: any) => {
          const raw = await executeFn(input);
          const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
          return truncateResult(text, maxChars);
        },
      };
    }
    return result;
  }
}

export function truncateResult(text: string, maxChars: number = DEFAULT_MAX_RESULT_CHARS): string {
  if (text.length <= maxChars) return text;

  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = maxChars - headSize;
  const head = text.slice(0, headSize);
  const tail = text.slice(-tailSize);
  const dropped = text.length - headSize - tailSize;

  return `${head}\n\n... [省略 ${dropped} 字符] ...\n\n${tail}`;
}
