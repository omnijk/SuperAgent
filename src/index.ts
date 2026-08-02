import 'dotenv/config';
import { generateText, type ModelMessage, stepCountIs, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createMockModel } from './mock-model';
import { createInterface } from 'node:readline';
import { weatherTool, calculatorTool } from './tools/utility-tools';
import { agentLoop,type BudgetState } from './agent-loop';

const tools = { get_weather: weatherTool, calculator: calculatorTool };

const qwen = createOpenAI({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY,
});

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
const budget: BudgetState = { used: 0, limit: 15000 };

const SYSTEM=`你是 Super Agent，一个有工具调用能力的 AI 助手。
需要时主动使用工具获取信息，不要编造数据。`

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
    await agentLoop(model, tools, messages, SYSTEM,budget);
    
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
console.log('Super Agent v0.3 — Fuses (type "exit" to quit)\n');
console.log('试试输入："测试死循环"、"测试重试"、"测试预算" 看三层防护效果\n');
ask();
