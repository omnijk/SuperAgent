// 存储一些回复内容，对象，键值对的形式存储在对象中
const RESPONSES: Record<string, string> = {
  default: '你好！我是模拟模型。填了 DASHSCOPE_API_KEY 后会自动切换到真实的 Qwen。',
  greeting: '你好！虽然是模拟的，但流式输出的效果和真实 API 一致 :)',
  name: '你刚才告诉我了呀！我能"记住"是因为代码把对话历史传给了我。',
  intro: '我是通义千问（模拟版），在本地模拟回复，机制和真实 API 完全一致。',
};

// 根据用户的输入内容，选择合适的一条预设回复
// 参数类型： any[]接受任意形式的元素组成的数组，返回一个string类型的字符串
function pickResponse(prompt: any[]): string {
  // 筛选，只保留用户消息
  const userMsgs = (prompt || []).filter((m: any) => m.role === 'user');
  // 提取最后一条消息的文本内容
  const last = userMsgs[userMsgs.length - 1];
  // 遍历数组每一个字符，提取text，转换成小写
  const text = (last?.content || []).map((c: any) => c.text || '').join('').toLowerCase();
  if (text.includes('介绍你自己') || text.includes('你是谁')) return RESPONSES.intro;
  if (text.includes('你好') || text.includes('hello')) return RESPONSES.greeting;
  if (text.includes('叫什么') || text.includes('记住')) return RESPONSES.name;
  return RESPONSES.default;
}

// 模拟输入输出token
const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

// 模拟流式输出
// 创建一个带30延迟的流式数据源
// ReadableStream代表一个可以逐步读取的数据源
// next是start内部定义的递归函数
// // 使用实例
// const stream = createDelayedStream(['你好', '我', '是', 'AI'], 50);

// // 消费者可以像这样读取流
// const reader = stream.getReader();
// reader.read().then(({ value }) => console.log(value)); // 50ms后输出 "你好"
// reader.read().then(({ value }) => console.log(value)); // 100ms后输出 "我"
function createDelayedStream(chunks: any[], delayMs = 30): ReadableStream {
  return new ReadableStream({
    start(controller) {
      let i = 0;
      function next() {
        if (i < chunks.length) {
          // 向流中推入一个数据块
          controller.enqueue(chunks[i++]);
          setTimeout(next, delayMs);
        } else {
          // 关闭流
          controller.close();
        }
      }
      next();
    },
  });
}

// 返回一个模拟的模型对象
export function createMockModel() {
  return {
    // as const定义它是字面量类型，不是普通的字符串，后面不能再修改了
    specificationVersion: 'v2' as const,
    provider: 'mock',
    modelId: 'mock-model',
    // gettre访问器属性，访问它的时候会执行后面的函数，返回一个promise对象
    get supportedUrls() { return Promise.resolve({}); },

    // 模拟模型中用来生成回复的核心函数，从传入的参数里结构出prompt对象
    async doGenerate({ prompt }: any) {
      return {
        content: [{ type: 'text', text: pickResponse(prompt) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: USAGE,
        warnings: [],
      };
    },

    // 模拟逐字输出效果
    async doStream({ prompt }: any) {
      const text = pickResponse(prompt);
      // 定义固定id
      const id = 'text-1';
      // chunks数组包含逐字的数据数组
      const chunks = [
        { type: 'text-start', id },
        ...text.split('').map((char: string) => ({ type: 'text-delta', id, delta: char })),
        { type: 'text-end', id },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
      ];
      // 返回的对象包含一个属性stream，每30ms推送一个数据块的刻度流
      return { stream: createDelayedStream(chunks, 30) };
    },
  };
}
