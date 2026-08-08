import type { ModelMessage } from 'ai';
import type { ChannelDefinition, IncomingMessage, OutgoingMessage } from './type';
import type { ToolRegistry } from '../tools/registry.js';
import { agentLoop } from '../agents/loop.js';

// agent和其他平台之间的消息交互都要通过Gateway
// 模型拿到消息和工具注册表和构建提示词的函数
interface GatewayOptions {
  model: any;
  registry: ToolRegistry;
  buildSystem: () => string;
}

export class ChannelGateway {
  // 存储所有已经注册的channels和对应的实例
  private channels = new Map<string, ChannelDefinition>();
  // 存储对话
  private sessions = new Map<string, ModelMessage[]>();
  private options: GatewayOptions;


  // 初始化配置
  constructor(options: GatewayOptions) {
    this.options = options;
  }

  // 注册通道，并加入到channels中，并给他注册监听器（如果来消息了就调用handleIncoming函数）
  register(channel: ChannelDefinition): void {
    this.channels.set(channel.name, channel);

    channel.onMessage?.((msg: IncomingMessage) => {
      this.handleIncoming(channel.name, msg);
    });
  }

  // 管理所有通道的所有生命周期，批量启动和停止所有通道
  async startAll(): Promise<void> {
    for (const [name, ch] of this.channels) {
      try {
        await ch.start();
        console.log(`  [gateway] ✓ ${name} 已启动`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [gateway] ✗ ${name} 启动失败: ${msg}`);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const [, ch] of this.channels) {
      await ch.stop();
    }
  }

  // 接受通道名和消息
  private async handleIncoming(channelName: string, msg: IncomingMessage): Promise<void> {
    // 生成会话唯一标识，不同的平台会话名字不会重复
    const sessionKey = `${channelName}:${msg.senderId}`;
    console.log(`\n  [${channelName}] ${msg.senderName}: ${msg.text}`);

    // 没有会话历史就创建，存在messages里面
    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, []);
    }
    const messages = this.sessions.get(sessionKey)!;

    // 把收到的消息转换好格式之后，发给AI，构建提示词，调用AI
    const userMsg: ModelMessage = { role: 'user', content: msg.text };
    messages.push(userMsg);

    const system = this.options.buildSystem();
    await agentLoop(this.options.model, this.options.registry, messages, system);

    // 从 messages 里取最后一条 assistant 消息作为回复
    const lastMsg = messages[messages.length - 1];
    let replyText = '';
    if (lastMsg && lastMsg.role === 'assistant') {
      // 如果最后一条消息是assistant，并且是字符串类型，直接就是回复文本
      const content = lastMsg.content;
      if (typeof content === 'string') {
        replyText = content;
      } else if (Array.isArray(content)) {
        // 如果是数组格式，就筛选出文本拼起来，因为有可能额AI返回多模态的内容
        // 兼容不同的消息格式
        replyText = content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('');
      }
    }

    // 把AI的回复发给用户
    if (replyText) {
      const channel = this.channels.get(channelName);
      if (channel) {
        await channel.send({
          channelId: msg.channelId,
          recipientId: msg.senderId,
          text: replyText,
        });
        console.log(`  [${channelName}] → ${replyText.slice(0, 80)}${replyText.length > 80 ? '...' : ''}`);
      }
    }
  }

  // 通道列表查询办法
  list(): Array<{ name: string; description: string }> {
    return Array.from(this.channels.values()).map(ch => ({
      name: ch.name,
      description: ch.description,
    }));
  }
}
