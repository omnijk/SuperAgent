### 1.流式输出调用模型的过程

- 后端调用streamText
- AI SDK通过model中的配置，给模型厂商发送HTTP POST ，包含stream:true字段
- 厂商服务器生成token，通过sse传过来
- sdk在node端边收，边解析sse

### 2.大模型本身没有记忆，他能记住你说了啥，是因为你每次都把完整的对话历史传给他了


### 3.工具定义

一个工具由三个部分组成
- description：工具作用，用于模型判断什么时候调用它，是给模型看得
- inputSchema：工具接受的参数类型
- execute：实际执行函数
工具的 description 和 inputSchema 里的属性 description，本质上就是在写 prompt。

### 4.SDK自动循环

提供了一个自动多部执行的能力`stopWhen`，模型返回工具调用的时候，SDK自动执行，把结果喂回模型，直至模型不再调用工具为止
- stopWhen: stepCountIs(5), // 最多跑 5 步
- 模型最多可以进行 5 轮"思考→调用工具→拿到结果→继续"的循环。如果 5 步之后模型还在调用工具，强制停止。