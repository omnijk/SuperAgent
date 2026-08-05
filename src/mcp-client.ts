// spawn用于创建一个新的进程
import { spawn, type ChildProcess } from 'node:child_process';
// 从可读流中创建一个接口，能够按行读取数据
import { createInterface, type Interface } from 'node:readline';

// 用于告诉客户端工具长什么样，也就是给Agent看
interface MCPTool {
  name: string;
  description: string;
  // 输入参数的Schema定义
  inputSchema: Record<string, unknown>;
}

// 工具调用结果长什么样，内容是什么，有没有错误
interface MCPCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

// MCP 协议的客户端封装
export class MCPClient {
  // mcp server子进程
  private process: ChildProcess | null = null;
  // 逐行读取器
  private rl: Interface | null = null;
  // 请求id计数器
  private requestId = 0;
  // 存储所有已经发送但是还未收到响应的请求，键是id，值是promise的resolve、reject函数
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  // 服务器名称
  private serverName: string;

  // 接受启动命令command，命令参数args，可选的环境变量
  constructor(private command: string, private args: string[], private env?: Record<string, string>) {
    // 从参数中提取出来服务器名称，但是有一个默认值mcp-server
    this.serverName = args[args.length - 1]?.replace(/^@.*\//, '') || 'mcp-server';
  }

  // 建立连接
  async connect(): Promise<void> {

    // 启动一个mcp server作为子进程，通过管道和她通信
    this.process = spawn(this.command, this.args, {
      // 三个管道stdin,stdout,stderr
      stdio: ['pipe', 'pipe', 'pipe'],
      // 合并环境变量
      env: { ...process.env, ...this.env },
      shell: true,
    });

    this.process.on('error', (err) => {
      console.error(`  [MCP] 进程启动失败: ${err.message}`);
    });

    // 丢弃stderr输出
    this.process.stderr?.on('data', () => {});

    this.rl = createInterface({ input: this.process.stdout! });
    this.rl.on('line', (line) => {
      try {
        // 尝试解析为JSON
        const msg = JSON.parse(line);
        // msg是响应回来的json对象
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          // 检查id存在并且再pending中
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          // 如果失败了就reject，否则就reslove
          if (msg.error) {
            p.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            p.resolve(msg.result);
          }
        }
      } catch { /* ignore non-JSON lines */ }
    });

    // mcp握手阶段，告诉server，我是谁，用什么版本协议，做什么
    // 使用awsit，客户端会等待server的响应
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'super-agent', version: '0.5.0' },
    });

    // 这是一个通知，不需要响应，标志握手阶段的结束
    this.process.stdin!.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n');
  }

  // 核心通信机制，实现了JSON-RPC请求的发送和响应
  private send(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // 每次调用这个函数就会自增的id，用于匹配请求和响应，因为请求和响应是异步的
      const id = ++this.requestId;
      // 设置15秒如果没有响应，自动超时
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 15000);

      // 吧peomise的回调函数注册到pending。等待connect()中的line来调用
      // 注意清除了计时器id
      this.pending.set(id, {
        resolve: (v: any) => { clearTimeout(timeout); resolve(v); },
        reject: (e: Error) => { clearTimeout(timeout); reject(e); },
      });

      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      this.process!.stdin!.write(msg + '\n');
    });
  }

  // 向server请求所有的工具列表
  // async异步函数，函数的返回值一定是promise类型的
  async listTools(): Promise<MCPTool[]> {
    const result = await this.send('tools/list', {});
    return result.tools || [];
  }

  // 调用指定的工具，传递参数，返回执行结果
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result: MCPCallResult = await this.send('tools/call', { name, arguments: args });
    const texts = (result.content || [])
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text!);
    return texts.join('\n') || '(无返回内容)';
  }

  // 关闭连接，结束逐行读取器，杀掉子进程
  async close(): Promise<void> {
    if (this.rl) this.rl.close();
    if (this.process) this.process.kill();
  }
}

// mock版本，模拟client，不连接server，直接返回硬编码数据
export class MockMCPClient {
  // 模拟连接成功
  async connect(): Promise<void> {}

  // 返回工具列表
  async listTools(): Promise<MCPTool[]> {
    return [
      {
        name: 'list_issues',
        description: '列出 GitHub 仓库的 Issues',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: '仓库所有者' },
            repo: { type: 'string', description: '仓库名称' },
          },
          required: ['owner', 'repo'],
        },
      },
      {
        name: 'search_repositories',
        description: '搜索 GitHub 仓库',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_file_contents',
        description: '获取仓库中文件的内容',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: '仓库所有者' },
            repo: { type: 'string', description: '仓库名称' },
            path: { type: 'string', description: '文件路径' },
          },
          required: ['owner', 'repo', 'path'],
        },
      },
    ];
  }

  // 根据工具名称，返回工具调用结果
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'list_issues':
        return JSON.stringify([
          { number: 42, title: '支持 MCP 协议接入', state: 'open', labels: ['enhancement'] },
          { number: 41, title: '循环检测阈值可配置化', state: 'open', labels: ['feature'] },
          { number: 39, title: 'Token 预算用完后的优雅降级', state: 'closed', labels: ['bug'] },
        ], null, 2);
      case 'search_repositories':
        return JSON.stringify([
          { full_name: 'anthropics/anthropic-sdk-python', stars: 2800, description: 'Anthropic Python SDK' },
          { full_name: 'vercel/ai', stars: 12000, description: 'AI SDK for TypeScript' },
          { full_name: 'modelcontextprotocol/servers', stars: 5600, description: 'MCP Servers' },
        ], null, 2);
      case 'get_file_contents':
        return `# README\n\nThis is a mock file content for ${args.owner}/${args.repo}/${args.path}`;
      default:
        return `未知工具: ${name}`;
    }
  }

  async close(): Promise<void> {}
}
