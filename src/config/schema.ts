// 配置文件只表达和默认值不一样的意图
import { z } from 'zod';

// AI 模型配置（提供商、模型名、API地址、密钥）
export const ModelConfigSchema = z.object({
  provider: z.enum(['dashscope', 'openai', 'custom']).default('dashscope'),
  name: z.string().default('qwen-plus-latest'),
  baseURL: z.string().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  apiKey: z.string().default(''),
});

// 插件配置（名称、启用状态、自定义参数）
export const PluginConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.any()).default({}),
});

// 飞书渠道接入配置（App ID/Secret、端口号）
export const FeishuChannelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  appId: z.string().default(''),
  appSecret: z.string().default(''),
  port: z.number().default(3000),
});

// 渠道总配置（目前只包含飞书）
export const ChannelConfigSchema = z.object({
  feishu: FeishuChannelConfigSchema.default({}),
});

// 智能体运行参数（最大递归深度、并发数、超时时间）
export const AgentConfigSchema = z.object({
  maxSpawnDepth: z.number().min(0).max(5).default(1),
  maxConcurrent: z.number().min(1).max(10).default(3),
  defaultTimeout: z.number().default(60000),
});

// 安全与审计配置（默认角色、日志开关、bash时间戳）
export const SecurityConfigSchema = z.object({
  defaultRole: z.string().default('developer'),
  auditLog: z.boolean().default(true),
  bashTimestamp: z.boolean().default(true),
});

// 记忆存储路径
export const MemoryConfigSchema = z.object({
  dataDir: z.string().default('.'),
});

// RAG（检索增强生成）配置（是否启用、文档目录）
export const RagConfigSchema = z.object({
  enabled: z.boolean().default(true),
  docsDir: z.string().default('docs'),
});

// 定时任务配置（是否启用、数据目录）
export const CronConfigSchema = z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().default('.'),
});

export const SessionConfigSchema = z.object({
  id: z.string().default('default'),
});

export const UsageConfigSchema = z.object({
  trackingFile: z.string().default('.usage/today.jsonl'),
});

export const SuperAgentConfigSchema = z.object({
  version: z.string().default('1.0'),
  model: ModelConfigSchema.default({
    provider: 'dashscope',
    name: 'qwen-plus-latest',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
  }),
  plugins: z.array(PluginConfigSchema).default([]),
  channels: ChannelConfigSchema.default({
    feishu: {
      enabled: false,
      appId: '',
      appSecret: '',
      port: 3000,
    },
  }),
  agents: AgentConfigSchema.default({
    maxSpawnDepth: 1,
    maxConcurrent: 3,
    defaultTimeout: 60000,
  }),
  security: SecurityConfigSchema.default({
    defaultRole: 'developer',
    auditLog: true,
    bashTimestamp: true,
  }),
  memory: MemoryConfigSchema.default({
    dataDir: '.',
  }),
  rag: RagConfigSchema.default({
    enabled: true,
    docsDir: 'docs',
  }),
  cron: CronConfigSchema.default({
    enabled: true,
    dataDir: '.',
  }),
  session: SessionConfigSchema.default({
    id: 'default',
  }),
  usage: UsageConfigSchema.default({
    trackingFile: '.usage/today.jsonl',
  }),
});

export type SuperAgentConfig = z.infer<typeof SuperAgentConfigSchema>;
