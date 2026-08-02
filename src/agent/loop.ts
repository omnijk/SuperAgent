import { streamText, type ModelMessage } from 'ai';

const MAX_STEPS = 10;

export async function agentLoop(
  model: any,
  tools: any,
  messages: ModelMessage[],
  system: string,
) {
  let step = 0;

  while (step < MAX_STEPS) {
    step++;
    console.log(`\n--- Step ${step} ---`);

    const result = streamText({
      model,
      system,
      tools,
      messages,
      // 不设 stopWhen，每次只跑一步
    });

    let hasToolCall = false;
    let fullText = '';

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          process.stdout.write(part.text);
          fullText += part.text;
          break;

        case 'tool-call':
          hasToolCall = true;
          console.log(`  [调用: ${part.toolName}(${JSON.stringify(part.input)})]`);
          break;

        case 'tool-result':
          console.log(`  [结果: ${JSON.stringify(part.output)}]`);
          break;
      }
    }

    // 拿到这一步的完整结果，追加到消息历史
    // result.response是一个promise，reslove之后包含完整信息，文本回复+工具调用+工具结果
    const stepMessages = await result.response;
    messages.push(...stepMessages.messages);

    // 退出条件：模型没有调用任何工具，说明它认为可以直接回复了
    if (!hasToolCall) {
      if (fullText) console.log();
      break;
    }

    // 还有工具调用 → 继续循环，让模型看到工具结果后继续思考
    console.log('  → 模型还在工作，继续下一步...');
  }

  if (step >= MAX_STEPS) {
    console.log('\n[达到最大步数限制，强制停止]');
  }
}
