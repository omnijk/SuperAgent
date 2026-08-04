import { readFileSync, writeFileSync, readdirSync, statSync,existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
// resolve:将相对路径转换成绝对路径
// join拼接路径片段
import type { ToolDefinition } from './tool-registry.js';
// type关键字，仅导入类型，不导入实际代码
import { execSync } from 'child_process';

export const weatherTool:ToolDefinition = {
  name: 'get_weather',
  description: '查询指定城市的天气信息',
  parameters:{
    type: 'object',
    properties: {
      city: { type: 'string', description: '城市名称，如"北京"、"上海"' },
    },
    required: ['city'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ city }: { city: string }) => {
    // 先用假数据，后面课程会接真实 API
    const data: Record<string, string> = {
      '北京': '晴，15-25°C，东南风 2 级',
      '上海': '多云，18-22°C，西南风 3 级',
      '深圳': '阵雨，22-28°C，南风 2 级',
    };
    return data[city] || `${city}：暂无数据`;
  },
};

export const calculatorTool:ToolDefinition = {
  name: 'calculator',
  description: '计算数学表达式的结果。当用户提问涉及数学运算时使用',
  parameters:{
    type: 'object',
    properties: {
      expression: { type: 'string', description: '数学表达式，如 "2 + 3 * 4"' },
    },
    required: ['expression'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ expression }: { expression: string }) => {
    try {
      // 生产环境不要用 eval，这里纯粹为了演示
      const result = new Function(`return ${expression}`)();
      return `${expression} = ${result}`;
    } catch {
      return `无法计算: ${expression}`;
    }
  },
};


export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: '读取指定路径的文件内容',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  // 元数据，用于aagent管理，上面的工具基本定义、描述等是给大模型看得
  // 可不可以并发
  isConcurrencySafe: true,
  // 是否是只读的
  isReadOnly: true,
  maxResultChars: 500,  // 演示用，生产环境通常 50000+
  execute: async ({ path }: { path: string }) => {
    return readFileSync(resolve(path), 'utf-8');
  },
};

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: '写入内容到指定文件',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      content: { type: 'string', description: '要写入的内容' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  isConcurrencySafe: false,  // 写操作不能并行
  isReadOnly: false,
  execute: async ({ path, content }: { path: string; content: string }) => {
    writeFileSync(resolve(path), content, 'utf-8');
    return `已写入 ${content.length} 字符到 ${path}`;
  },
};

// 写文件
export const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description: '精确替换文件中的指定内容。用 old_string 定位要替换的文本，用 new_string 替换它。不是全量覆写——只改你指定的部分',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      old_string: { type: 'string', description: '要被替换的原始文本（必须精确匹配）' },
      new_string: { type: 'string', description: '替换后的新文本' },
    },
    required: ['path', 'old_string', 'new_string'],
    additionalProperties: false,
  },
  isConcurrencySafe: false,
  isReadOnly: false,
  execute: async ({ path, old_string, new_string }) => {
    // 转换成相对路径
    const resolved = resolve(path);
    if (!existsSync(resolved)) return `文件不存在: ${path}`;

    // 读写文件内容
    const content = readFileSync(resolved, 'utf-8');
    // 切割字符串，以旧内容作为分隔符
    // 分割得到的段数-1就是旧字符串出现的次数
    const count = content.split(old_string).length - 1;

    // 这两个错误信息是给模型看得，让模型更好得自我纠正，而非模糊得错误信息
    if (count === 0) {
      return `未找到匹配内容。请检查 old_string 是否与文件中的文本完全一致（包括空格和换行）`;
    }
    if (count > 1) {
      return `找到 ${count} 处匹配，请提供更多上下文让 old_string 唯一`;
    }

    const updated = content.replace(old_string, new_string);
    // 把修改之后的内容写进字符串
    writeFileSync(resolved, updated, 'utf-8');
    return `已替换 ${path} 中的内容（${old_string.length} → ${new_string.length} 字符）`;
  },
};


export const listDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  description: '列出指定目录下的文件和子目录',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录路径，默认为当前目录' },
    },
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ path = '.' }: { path?: string }) => {
    const resolved = resolve(path);
    return readdirSync(resolved).map(name => {
      const stat = statSync(join(resolved, name));
      return `${stat.isDirectory() ? '[DIR]' : '[FILE]'} ${name}`;
    }).join('\n');
  },
};

// 按照模式找文件
export const globTool: ToolDefinition = {
  name: 'glob',
  description: '按模式搜索文件。支持 * 和 ** 通配符，如 "src/**/*.ts" 匹配 src 下所有 TypeScript 文件',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '搜索模式，如 "**/*.ts"、"src/*.json"' },
      path: { type: 'string', description: '搜索起始目录，默认当前目录' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ pattern, path = '.' }) => {
    // ... 递归遍历目录，匹配模式 ...
    // 自动跳过 node_modules 和 .git
    // 结果上限 100 条，防止大项目撑爆
  },
};

// 搜内容
export const grepTool: ToolDefinition = {
  name: 'grep',
  description: '在文件中搜索匹配指定模式的内容。返回匹配的行号和内容',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '搜索模式（正则表达式）' },
      path: { type: 'string', description: '搜索路径（文件或目录），默认当前目录' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  maxResultChars: 3000,
  execute: async ({ pattern, path = '.' }) => {
    // ... 递归搜索文件，正则匹配每一行 ...
    // 跳过 node_modules、.git、二进制文件
    // 返回格式：文件名:行号: 匹配内容
    // 上限 50 条匹配
  },
};

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



export const allTools: ToolDefinition[] = [
  bashTool,grepTool,globTool,editFileTool,weatherTool, calculatorTool, readFileTool, writeFileTool, listDirectoryTool,
];