import 'dotenv/config';
import { generateText, ModelMessage, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createMockModel } from './mock-model';
import { createInterface } from 'node:readline';

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

    // 调用streamText时候，SDK发出一个stream的请求
    // 不是等待全部输出完，而是每生成几个token，就通过sse推送一个事件
    // 之前传递的是单挑消息，模型没有记忆，现在把历史对话都带上，模型相当于有了记忆
    const result=streamText({
      model,
      messages,
    });

    process.stdout.write('Assistant：');
    let fullResponse='';
    for await(const chunk of result.textStream){
    process.stdout.write(chunk);
    fullResponse+=chunk;
    }
    console.log();//换行

    messages.push({role:"assistant",content:fullResponse})
    // 递归调用自己，形成循环
    ask();
  })
}

console.log('Super Agent v0.1 (type "exit" to quit)\n');
ask();
