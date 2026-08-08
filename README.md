# SuperAgent

SuperAgent 是一个用 TypeScript 编写的智能体（Agent）CLI 工具。它把模型、工具、RAG 知识库、记忆、定时任务、飞书渠道、子 Agent 和插件等能力整合到一个命令行程序中，通过 `super-agent.config.json` 集中配置，一条命令即可启动。

## 功能特性

- 配置驱动：模型、插件、渠道、子 Agent、安全 Hook、Cron 等参数集中在一个 JSON 配置文件中，启动时自动校验并合并默认值
- 环境变量替换：配置中可用 `${DASHSCOPE_API_KEY}` 引用 `.env` 或系统环境变量，敏感信息不写入配置文件
- 交互式初始化：`pnpm run init` 引导生成配置文件和 `.env`
- 模型接入：默认 DashScope（通义千问），兼容 OpenAI API 协议；未配置 API Key 时自动使用 Mock 模型
- 工具系统：内置文件、Shell、搜索、Web 等工具，支持动态注册与安全 Hook
- RAG 知识库：自动索引 `docs/` 下的 Markdown 文档，使用 SQLite 向量存储
- 记忆与会话：跨会话记忆、会话持久化、Token 用量统计
- 定时任务：内置 Cron 调度器，可通过对话或 `/cron` 命令管理
- 子 Agent：支持深度受限、并发受限的子任务派发
- 渠道接入：飞书机器人（可选，`enabled: false` 时完全不初始化）
- 插件与技能：按配置启用插件，支持技能目录加载

## 技术栈

- TypeScript、Node.js、pnpm
- Vercel AI SDK（`ai` + `@ai-sdk/openai`）
- Zod（配置校验）
- SQLite（better-sqlite3 + sqlite-vec）
- Hono / @hono/node-server（飞书 Webhook）
- Croner（定时任务）

## 环境要求

- Node.js 20+
- pnpm 9+
- 可选：DashScope API Key、飞书应用凭据

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 交互式初始化
pnpm run init

# 3. 启动
pnpm start
```

启动后进入交互式命令行，输入 `exit` 退出。

## 安装依赖

```bash
pnpm install
```

## 初始化

```bash
pnpm run init
```

包括模型选择、DashScope API Key、是否启用飞书、子 Agent 并发数。完成后生成两个文件：

- `super-agent.config.json`：程序配置，可提交到 Git
- `.env`：敏感环境变量，已被 `.gitignore` 忽略

## 启动

```bash
pnpm start        # 启动 Agent
pnpm run dev      # 开发模式（文件变更自动重启）
```

启动时会按配置完成初始化：加载工具与插件、启动 Channel、加载 Cron、导入 RAG 文档，然后进入交互式对话。

## 配置说明

### 加载流程

`src/config/loader.ts` 按以下顺序加载配置：

1. 读取 `super-agent.config.json`
2. 替换 `${ENV_VAR}` 环境变量引用
3. 使用 Zod 校验，输出错误字段路径
4. 合并默认值

未找到配置文件时使用全默认配置；JSON 解析失败或校验失败会直接退出并打印原因。

### 示例配置

```json
{
  "version": "1.0",
  "model": {
    "provider": "dashscope",
    "name": "qwen-plus-latest",
    "baseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "apiKey": "${DASHSCOPE_API_KEY}"
  },
  "plugins": [
    { "name": "supabase", "enabled": false, "config": {} }
  ],
  "channels": {
    "feishu": {
      "enabled": false,
      "appId": "${FEISHU_APP_ID}",
      "appSecret": "${FEISHU_APP_SECRET}",
      "port": 3000
    }
  },
  "agents": {
    "maxSpawnDepth": 1,
    "maxConcurrent": 3,
    "defaultTimeout": 60000
  },
  "security": {
    "defaultRole": "developer",
    "auditLog": true,
    "bashTimestamp": true
  },
  "memory": { "dataDir": "." },
  "rag": { "enabled": true, "docsDir": "docs" },
  "cron": { "enabled": true, "dataDir": "." },
  "session": { "id": "default" },
  "usage": { "trackingFile": ".usage/today.jsonl" }
}
```

### 完整配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `model.provider` | `dashscope` | 模型提供商：`dashscope` / `openai` / `custom` |
| `model.name` | `qwen-plus-latest` | 模型名 |
| `model.baseURL` | DashScope 兼容地址 | API 地址 |
| `model.apiKey` | 空字符串 | API Key，建议用 `${DASHSCOPE_API_KEY}` 引用环境变量 |
| `plugins[]` | `[]` | 插件列表，`name` 必填，`enabled` 默认 `true` |
| `channels.feishu.enabled` | `false` | 是否启用飞书 Channel |
| `channels.feishu.appId` | 空字符串 | 飞书 App ID |
| `channels.feishu.appSecret` | 空字符串 | 飞书 App Secret |
| `channels.feishu.port` | `3000` | 飞书 HTTP 服务端口 |
| `agents.maxSpawnDepth` | `1` | 子 Agent 最大嵌套深度（0-5） |
| `agents.maxConcurrent` | `3` | 子 Agent 最大并发数（1-10） |
| `agents.defaultTimeout` | `60000` | 子任务默认超时（毫秒） |
| `security.defaultRole` | `developer` | 默认角色 |
| `security.auditLog` | `true` | 是否记录文件写入审计日志 |
| `security.bashTimestamp` | `true` | bash 输出是否追加时间戳 |
| `memory.dataDir` | `.` | 记忆数据目录 |
| `rag.enabled` | `true` | 是否启用 RAG 知识库 |
| `rag.docsDir` | `docs` | 知识库文档目录 |
| `cron.enabled` | `true` | 是否启用定时任务 |
| `cron.dataDir` | `.` | Cron 数据目录 |
| `session.id` | `default` | 会话 ID |
| `usage.trackingFile` | `.usage/today.jsonl` | Token 用量记录文件 |


## 环境变量

| 变量 | 说明 | 是否必需 |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` | DashScope API Key | 否，缺失时使用 Mock 模型 |
| `FEISHU_APP_ID` | 飞书 App ID | 启用飞书时必需 |
| `FEISHU_APP_SECRET` | 飞书 App Secret | 启用飞书时必需 |

环境变量可写入项目根目录的 `.env`，或直接设置在系统环境中。

## 使用

启动后进入交互式命令行，内置命令如下：

| 命令 | 说明 |
| --- | --- |
| `/role` | 查看当前角色 |
| `/role owner` | 切换角色（`owner` / `collaborator` / `guest`） |
| `/hooks` | 查看 Hook 管线（pre / post） |
| `/cron` / `/cron list` | 查看定时任务列表 |
| `/cron logs` | 查看最近执行记录 |
| `/agents` | 查看子 Agent 运行记录 |
| `/memory` | 查看记忆列表 |
| `/memory search <关键词>` | 搜索记忆（等价 `搜记忆 <关键词>`） |
| `/lint` | 检查记忆库健康问题 |
| `/dream` | 启动记忆整理任务 |
| `/rag` | 查看知识库片段与来源 |
| `ingest <路径>` | 导入文档到知识库 |
| `/context` | 查看上下文快照（系统提示、工具、记忆等） |
| `/usage` | 查看 Token 用量统计 |
| `/skill` / `/skill list` | 查看可用技能 |
| `/skill load <name>` | 激活技能 |
| `/skill unload <name>` | 卸载技能 |
| `/<skill-name>` | 直接激活并执行技能，例如 `/code-review` |
| `/plugin` / `/plugin list` | 查看插件状态 |
| `/plugin load <name>` | 加载插件 |
| `/plugin unload <name>` | 卸载插件 |
| `/channel` / `/channel list` | 查看已注册 Channel |
| `status` | 查看消息数、Token 和记忆数 |
| `sim` | 模拟注入长对话历史（等价 `模拟长对话`） |
| `defend` | 手动执行上下文防线（等价 `执行防线`） |
| `/cache on` / `/cache off` | 开启/关闭 Mock 模型 cache 模拟 |
| `exit` | 退出并清理 Channel、Cron 和插件资源 |

大多数命令也支持不带 `/` 的别名，部分还支持中文别名，例如 `memory`、`rag`、`dream`、`搜记忆`。输入非命令内容时，会作为普通对话消息发送给模型。

## 飞书接入

在 `super-agent.config.json` 中启用飞书，并在 `.env` 中配置应用凭据：

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "${FEISHU_APP_ID}",
      "appSecret": "${FEISHU_APP_SECRET}",
      "port": 3000
    }
  }
}
```

```bash
FEISHU_APP_ID=cli_xxxx
FEISHU_APP_SECRET=xxxx
```

## 部署上线

1. 在服务器安装 Node.js 20+ 和 pnpm
2. 上传项目代码并安装依赖：

```bash
pnpm install
```

3. 初始化或准备配置文件：

```bash
pnpm run init
```

4. 启动服务：

```bash
pnpm start
```

5. 使用 pm2 保持进程常驻：

```bash
pnpm add -g pm2
pm2 start pnpm --name super-agent -- start
pm2 save
pm2 startup
```

注意：`start` 脚本依赖 `tsx`（位于 devDependencies），生产环境请完整执行 `pnpm install`，不要使用 `--prod` 只安装生产依赖。

## 常见问题

- 配置文件校验失败：根据打印的字段路径修正 `super-agent.config.json`；不确定时可删除该字段，让它使用默认值。
- 出现 `环境变量 xxx 未设置，保留原值`：确认 `.env` 存在，或系统环境变量已正确设置。
- 飞书端口被占用：修改 `channels.feishu.port`，或把 `channels.feishu.enabled` 设为 `false` 禁用飞书。
- `better-sqlite3` 安装失败：需要 C++ 构建工具链，且 pnpm 需允许构建脚本（例如执行 `pnpm approve-builds`）。
- 更换模型：修改 `model.name`（如 `qwen-max-latest`），或配置 `model.baseURL` 指向其他 OpenAI 兼容服务。

## License

ISC
