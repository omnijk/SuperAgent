### 1.流式输出调用模型的过程

- 后端调用streamText
- AI SDK通过model中的配置，给模型厂商发送HTTP POST ，包含stream:true字段
- 厂商服务器生成token，通过sse传过来
- sdk在node端边收，边解析sse

### 2.大模型本身没有记忆，他能记住你说了啥，是因为你每次都把完整的对话历史传给他了

