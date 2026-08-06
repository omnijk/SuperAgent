import { execSync } from 'node:child_process';
import type { ToolDefinition } from './registry.js';

// bash工具
export const bashTool: ToolDefinition = {
  name: 'bash',
  description: '执行 shell 命令并返回输出。适合运行脚本、检查环境、执行构建等操作',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的 shell 命令' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  // bash命令可能由副作用，默认串行
  // 实际生产环境更细，会把cat等等设置为并行
  isConcurrencySafe: false,
  isReadOnly: false,
  maxResultChars: 3000,
  execute: async ({ command }) => {
    // 先检测环境是否支持 child_process
    try {
      execSync('echo test', { stdio: 'ignore' });
    } catch {
      return `[bash 不可用] 当前环境不支持 shell 命令。本地终端运行可使用。`;
    }

    try {
      const output = execSync(command, {
        // 输出的编码模式
        encoding: 'utf-8',
        timeout: 10000,  // 10 秒超时
        // 防止模型跑一个while循环卡死
        // 最大输出大小
        maxBuffer: 1024 * 1024,
      });
      return output || '(命令执行成功，无输出)';
    } catch (err: any) {
      return `命令执行失败 (exit ${err.status || 1}):\n${err.stderr || err.message}`;
    }
  },
};