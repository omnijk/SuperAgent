import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';

const SESSION_DIR = '.sessions';


export interface SessionEntry {
  type: 'message';
  timestamp: string;
  message: ModelMessage;
}

// seeion存储管理类，用于管理和持久化与AI的对话历史记录
export class SessionStore {
  // 会话文件存放位置
  private dir: string;
  private sessionId: string;

  // 初始化绘画id。并创建存放目录
  constructor(sessionId: string = 'default') {
    this.sessionId = sessionId;
    this.dir = SESSION_DIR;
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  // 计算完整的文件路径，例如：./sessions/default.jsonl
  private get filePath(): string {
    return join(this.dir, `${this.sessionId}.jsonl`);
  }

  // 把一条消息追加写入JSONL文件，每条消息待时间戳
  append(message: ModelMessage): void {
    const entry: SessionEntry = {
      type: 'message',
      // 存储时间戳，并转换格式
      timestamp: new Date().toISOString(),
      message,
    };
    // 将entry写入文件
    appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  appendAll(messages: ModelMessage[]): void {
    for (const msg of messages) {
      this.append(msg);
    }
  }

  // 加载会话
  load(): ModelMessage[] {
    // 如果会话存在就读取内容
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, 'utf-8').trim();
    if (!content) return [];

    const messages: ModelMessage[] = [];
    // 解析处理消息，吧正常的加入结果中
    // 解析失败的直接跳过，不影响其他行
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry: SessionEntry = JSON.parse(line);
        if (entry.type === 'message') {
          messages.push(entry.message);
        }
      } catch { /* skip malformed lines */ }
    }
    return messages;
  }

  exists(): boolean {
    return existsSync(this.filePath);
  }
}
