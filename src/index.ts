import 'dotenv/config';
import {  type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createMockModel } from './mock-model';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { ToolRegistry,ToolDefinition } from './tool-registry.js';
import { allTools } from './tools.js';
import { agentLoop,type BudgetState } from './agent-loop';
import { MCPClient, MockMCPClient } from './mcp-client.js';


const qwen = createOpenAI({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY,
});

// 工具注册类的实例
const registry=new ToolRegistry();
// 传入一个工具数组，让它能够同时调用多个工具
registry.register(...allTools);
await connectMCP();
console.log(`已注册${registry.getAll().length}个工具`)
// 输出工具的元数据定义
for(const tool of registry.getAll()){
  const flags=[
    tool.isConcurrencySafe?"可并发":"串行",
    tool.isReadOnly?"只读":"读写"
  ].join(",");
  console.log(`${tool.name}:(${flags})`);
}

// model变量的类型是AI SDK的统一接口
// Provider 模式，接口统一切换模型方便
const model = process.env.DASHSCOPE_API_KEY
  ? qwen.chat('qwen-plus-latest')
  : createMockModel();

const r1=createInterface({
  // 输入流：绑定在键盘
  input:process.stdin,
  // 输出流：绑定在终端
  output:process.stdout
});

const messages:ModelMessage[]=[];
//  预算由调用方持有，跨轮持续累计——agentLoop 只负责消费它
// budget声明在模块顶层，跨多轮agent提问持续累积
const budget: BudgetState = { used: 0, limit: 50000 };

const SYSTEM=`你是 Super Agent，一个能读代码、抓网页、生成项目的 AI 助手。
你有这些工具可用：read_file, write_file, list_directory, edit_file, glob, grep, bash, fetch_url, start_preview, get_weather, calculator。

针对常见任务的执行策略：

1. 用户让你"分析项目"或"找代码"时：
   先 list_directory 看结构 → grep 定位关键内容 → 必要时 read_file 看细节 → 最后给出归纳总结。

2. 用户给你 URL 时：
   用 fetch_url 抓取（多 URL 可以并行），再综合总结。

3. 用户让你"做一个网页应用 / 待办应用 / 任意 web demo"时（必须实际调用工具，不要只描述）：

   **重要的项目约定（不要自己重写 bootstrap）**：
   - app/index.html 已经预置在模板里，固定用 import maps 引 React + Babel Standalone 实时编译 TSX
   - app/index.html 固定加载 ./App.tsx 作为入口、固定引用 ./styles.css 作为样式
   - 你**禁止**写入或修改 app/index.html（它已经能正确工作）

   **你需要做的事**：
   - 用 write_file 至少生成这三个文件：
     1. app/styles.css — 应用样式
     2. app/App.tsx — **必须**用 \`import { createRoot } from 'react-dom/client'\` 把组件渲染到 \`document.getElementById('root')\`
     3. app/Button.tsx 或其他组件 .tsx — 可被 App.tsx import
   - .tsx 之间用相对路径 import：\`import { Button } from './Button.tsx'\`（必须带 .tsx 后缀）
   - React 用 \`import React, { useState } from 'react'\`，不要从其他源导入
   - 文件全部写完后**立即**调用 start_preview 启动预览服务器（这一步绝对不能省）
   - 最后用一段简短文本告诉用户：生成了哪些文件 + 预览地址

回答简洁直接，独立的工具调用尽量并行执行。`

// 延迟加载之后的工具搜索函数,工具名精确匹配
const toolSearchTool: ToolDefinition = {
  name: 'tool_search',
  description: '获取延迟工具的完整定义。传入工具名（从系统提示的延迟工具列表中选取），返回该工具的完整参数 Schema',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '工具名，如 "mcp__github__list_issues"。支持逗号分隔多个工具名' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ query }: { query: string }) => {
    const results = registry.searchTools(query);
    if (results.length === 0) return `没有找到匹配 "${query}" 的工具`;
    return results.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  },
};

registry.register(toolSearchTool);



async function connectMCP() {
  const githubToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

  let canSpawn = true;
  // MCPClient 需要使用 spawn 启动子进程
  // 判断一下环境是否支持
  try {
    const { execSync } = await import('node:child_process');
    execSync('echo test', { stdio: 'ignore' });
  } catch {
    canSpawn = false;
  }

  if (githubToken && canSpawn) {
    console.log('\n连接 GitHub MCP Server...');
    try {
      const client = new MCPClient(
        // 使用npx命令安装并运行github mcp server
        'npx.cmd', ['-y', '@modelcontextprotocol/server-github'],
        { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
        // Run npx outside the project so local devEngines cannot block npm.
        tmpdir(),
      );
      // 注册server工具
      const tools = await registry.registerMCPServer('github', client);
      console.log(`  已注册 ${tools.length} 个 MCP 工具`);
      return;
    } catch (err) {
      console.log(`  MCP 连接失败: ${err instanceof Error ? err.message : err}`);
      console.log('  降级为 Mock MCP...');
    }
  }

  if (!githubToken) {
    console.log('\n未配置 GITHUB_PERSONAL_ACCESS_TOKEN，使用 Mock MCP');
  }

  const mockClient = new MockMCPClient();
  const tools = await registry.registerMCPServer('github', mockClient);
  console.log(`  已注册 ${tools.length} 个 Mock MCP 工具`);
}

function ask(){
  // question会在终端显示提示文字
  r1.question('\nYou：',async(input)=>{
    // 处理输入消息
    const trimmed=input.trim();
    // 判断终止条件
    if(!trimmed||trimmed==='exit'){
      console.log('Bye!')
      r1.close();
      return;
    }

    // 加入消息列表
    messages.push({role:"user",content:trimmed})

    // 使用自己定义的agent loop
    await agentLoop(model, registry,messages, SYSTEM,budget);
    
    // SDK版本
    // // 调用streamText时候，SDK发出一个stream的请求
    // // 不是等待全部输出完，而是每生成几个token，就通过sse推送一个事件
    // // 之前传递的是单挑消息，模型没有记忆，现在把历史对话都带上，模型相当于有了记忆
    // const result=streamText({
    //   model,
    //   system: SYSTEM,
    //   tools,
    //   messages,
    //   // 最多进行5次循环
    //   stopWhen:stepCountIs(5),
    // })
    // ;

    // process.stdout.write('Assistant：');
    // let fullResponse='';

    // for await(const part of result.fullStream){
    //   switch (part.type){
    //     case 'text-delta':
    //       process.stdout.write(part.text);
    //       fullResponse+=part.text;
    //       break;
    //     case 'tool-call':
    //       console.log(`\n  [调用工具: ${part.toolName}(${JSON.stringify(part.input)})]`);
    //       break;
    //     case 'tool-result':
    //       console.log(`  [工具返回: ${JSON.stringify(part.output)}]`);
    //       break;
    //   }
    // }
    // console.log();//换行

    // messages.push({role:"assistant",content:fullResponse})
    // // 递归调用自己，形成循环
    ask();
  })
}

function main(){
  console.log('Super Agent v0.3 — Fuses (type "exit" to quit)\n');
  console.log('试试输入："测试死循环"、"测试重试"、"测试预算" 看三层防护效果\n');

  const allCount = registry.getAll().length;
  const activeTools = registry.getActiveTools();
  const estimate = registry.countTokenEstimate();
  const deferredSummary=registry.getDeferredToolSummary();
  console.log(`\n=== 工具统计 ===`);
  console.log(`  全部工具: ${allCount} 个`);
  console.log(`  活跃工具: ${activeTools.length} 个`);
  console.log(`  延迟工具: ${allCount - activeTools.length} 个`);
  console.log(`  Token 估算: ~${estimate.active} (活跃) + ~${estimate.deferred} (延迟，不占 prompt)`);
  console.log(deferredSummary);

  ask();
}

main()

