// 入站消息
export interface IncomingMessage {
  // 渠道，发送者唯一标识，发送者显示名称，内容，
  channelId: string;
  // 会话标识：飞书里是 chat_id，Telegram 里是 chat.id
  senderId: string;
  senderName: string;
  text: string;
  raw?: unknown;  //raw?: 原始消息对象（可选），保留平台特定信息
}

// 出战消息，定义向外发送消息的结构
export interface OutgoingMessage {
  // 目标渠道、接收者id，要发送的内容
  channelId: string;
  recipientId: string;
  text: string;
}

// 所有通道消息必须实现的行为
export interface ChannelDefinition {
  name: string;
  description: string;

  // 生命周期行为，控制通道的连接与断开
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  send(message: OutgoingMessage): Promise<void>;

  // 用于监听入栈消息
  onMessage?: (handler: (msg: IncomingMessage) => void) => void;
}
