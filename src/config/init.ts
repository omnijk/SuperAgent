import { createInterface } from 'node:readline';
import fs from 'node:fs';
import { CONFIG_FILE } from './loader.js';

export async function runInit() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => {
      console.log(q);
      rl.question('  > ', resolve);
    });

  console.log('\n  Super Agent 初始化向导\n');

  if (fs.existsSync(CONFIG_FILE)) {
    const overwrite = await ask(`  ${CONFIG_FILE} 已存在，覆盖? (y/N): `);
    if (overwrite.toLowerCase() !== 'y') {
      console.log('  已取消\n');
      rl.close();
      return;
    }
  }

  // ── 模型选择 ──────────────────────────
  console.log('  选择模型:\n');
  console.log('    1. qwen-plus-latest   (推荐，均衡)');
  console.log('    2. qwen-turbo-latest  (快速，便宜)');
  console.log('    3. qwen-max-latest    (最强，贵)\n');
  const modelChoice = (await ask('  模型 [1]: ')) || '1';
  const models: Record<string, string> = {
    '1': 'qwen-plus-latest',
    '2': 'qwen-turbo-latest',
    '3': 'qwen-max-latest',
  };
  const modelName = models[modelChoice] || 'qwen-plus-latest';

  // ── API Key ──────────────────────────
  const apiKey = await ask('\n  DashScope API Key (留空则从环境变量 DASHSCOPE_API_KEY 读取): ');

  // ── 飞书 Channel ──────────────────────────
  const enableFeishu = (await ask('\n  启用飞书 Channel? (y/N): ')).toLowerCase() === 'y';
  let feishuAppId = '';
  let feishuAppSecret = '';
  if (enableFeishu) {
    feishuAppId = await ask('  飞书 App ID: ');
    feishuAppSecret = await ask('  飞书 App Secret: ');
  }

  // ── Sub-Agent ──────────────────────────
  const concurrentStr = await ask('\n  子 Agent 最大并发数 [3]: ');
  const maxConcurrent = parseInt(concurrentStr) || 3;

  // ── 生成配置 ──────────────────────────
  const config = {
    version: '1.0',
    model: {
      provider: 'dashscope',
      name: modelName,
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: apiKey || '${DASHSCOPE_API_KEY}',
    },
    plugins: [
      { name: 'supabase', enabled: false, config: {} },
    ],
    channels: {
      feishu: {
        enabled: enableFeishu,
        appId: enableFeishu ? feishuAppId : '${FEISHU_APP_ID}',
        appSecret: enableFeishu ? feishuAppSecret : '${FEISHU_APP_SECRET}',
        port: 3000,
      },
    },
    agents: {
      maxSpawnDepth: 1,
      maxConcurrent,
      defaultTimeout: 60000,
    },
    security: {
      defaultRole: 'developer',
      auditLog: true,
      bashTimestamp: true,
    },
    memory: { dataDir: '.' },
    rag: { enabled: true, docsDir: 'docs' },
    cron: { enabled: true, dataDir: '.' },
    session: { id: 'default' },
    usage: { trackingFile: '.usage/today.jsonl' },
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log(`\n  ✓ ${CONFIG_FILE} 已生成`);

  // 生成 .env
  const envLines: string[] = [];
  if (apiKey) {
    envLines.push(`DASHSCOPE_API_KEY=${apiKey}`);
  }
  if (enableFeishu && feishuAppId) {
    envLines.push(`FEISHU_APP_ID=${feishuAppId}`);
    envLines.push(`FEISHU_APP_SECRET=${feishuAppSecret}`);
  }
  if (envLines.length > 0) {
    fs.writeFileSync('.env', envLines.join('\n') + '\n');
    console.log('  ✓ .env 已生成');
  }

  console.log('\n  启动 Agent: pnpm start\n');
  rl.close();
}
