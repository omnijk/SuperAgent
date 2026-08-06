import { readFileSync,existsSync } from 'node:fs';
import { extname,join, resolve } from 'node:path';
// resolve:将相对路径转换成绝对路径
// join拼接路径片段
import type { ToolDefinition } from './registry.js';
// type关键字，仅导入类型，不导入实际代码
// 用于启动一个node内置的http server
import { createServer, type Server } from 'node:http';

let previewServer: Server | null = null;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.tsx': 'application/javascript; charset=utf-8',
  '.ts': 'application/javascript; charset=utf-8',
  '.jsx': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

export const startPreviewTool: ToolDefinition = {
  name: 'start_preview',
  description: '启动 app/ 目录的预览服务器，让浏览器能访问生成的网页应用。生成应用文件后必须立即调用此工具',
  parameters: {
    type: 'object',
    properties: {
      port: { type: 'number', description: '端口号，默认 8080' },
    },
    required: [],
    additionalProperties: false,
  },
  isConcurrencySafe: false,
  isReadOnly: false,
  execute: async ({ port = 8080 }: { port?: number } = {}) => {
    const root = resolve('app');
    if (!existsSync(root)) return '错误：app/ 目录不存在，请先用 write_file 生成应用文件';

    if (previewServer) return `预览服务器已在运行 → http://localhost:${port}`;

    previewServer = createServer((req, res) => {
      const urlPath = (req.url?.split('?')[0] || '/').replace(/\/$/, '/index.html');
      const filePath = join(root, urlPath === '/' ? '/index.html' : urlPath);
      try {
        if (!filePath.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
        const content = readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    return new Promise<string>((resolve, reject) => {
      previewServer!.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') resolve(`端口 ${port} 已被占用，预览可能已经在跑了`);
        else reject(err);
      });
      previewServer!.listen(port, () => {
        resolve(`✓ 预览服务器已启动 → http://localhost:${port}（点击 Sandbox 的 Preview 标签查看）`);
      });
    });
  },
};








// 抓取网页知识，模拟的，保证没有联网也可以拿到知识
const MOCK_PAGES: Record<string, string> = {
  'https://esm.sh': `esm.sh - 一个免费的 ES module CDN...`,
  'https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling': `AI SDK Core - Tools and Tool Calling
工具是模型可以决定调用的函数。一个工具由三部分组成：
- description：告诉模型何时使用这个工具
- inputSchema：通过 Zod 或 JSON Schema 定义参数
- execute：实际在服务端运行的函数...`,
  // ... 更多预定义页面
};

export const fetchUrlTool: ToolDefinition = {
  name: 'fetch_url',
  description: '抓取指定 URL 的网页内容并转换为纯文本（自动剥离 HTML 标签）',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '完整 URL，必须以 http:// 或 https:// 开头' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,    // 只读、可并发——抓多个 URL 时直接并行
  isReadOnly: true,
  maxResultChars: 1500,        
  // 网页通常很长，截断兜底，不然会浪费很多token
  execute: async ({ url }: { url: string }) => {
    for (const key of Object.keys(MOCK_PAGES)) {
      if (url.startsWith(key)) return MOCK_PAGES[key];
    }
    try {
      // 发送http请求到目标网址
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 SuperAgent' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return `请求失败：HTTP ${res.status}`;
      // 获取html内容，处理之后返回
      const html = await res.text();
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || '页面无文本内容';
    } catch (err: any) {
      return `抓取失败：${err.message}`;
    }
  },
};
