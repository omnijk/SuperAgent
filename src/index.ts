import 'dotenv/config';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createMockModel } from './mock-model';

const qwen = createOpenAI({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY,
});

// model变量的类型是AI SDK的统一接口
// Provider 模式，接口统一切换模型方便
const model = process.env.DASHSCOPE_API_KEY
  ? qwen.chat('qwen-plus-latest')
  : createMockModel();

async function main() {
  const { text } = await generateText({
    model,
    prompt: '你好',
  });

  console.log(text);
}

main();
