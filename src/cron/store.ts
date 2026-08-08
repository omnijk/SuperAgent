import fs from 'node:fs';
import type { CronJobConfig, RunLog } from './types.js';

// 任务配置和日志存储的文件名分别是深恶
// 使用json，因为jsonl只有在新增的时候是高效的，对于增删改并不高效，没有很好的效果
// 使用json全量的目前也完全够用
const JOBS_FILE = '.cron/jobs.json';
const LOGS_FILE = '.cron/logs.jsonl';

// 对任务的持久化存储
export class CronStore {
  constructor(private baseDir: string = '.') {}

  private get jobsPath() { return `${this.baseDir}/${JOBS_FILE}`; }
  private get logsPath() { return `${this.baseDir}/${LOGS_FILE}`; }

  // 路径首先准备好，不存在就创建
  init(): void {
    const dir = `${this.baseDir}/.cron`;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // 加载任务配置
  loadJobs(): CronJobConfig[] {
    if (!fs.existsSync(this.jobsPath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(this.jobsPath, 'utf-8'));
      return data.jobs || [];
    } catch {
      return [];
    }
  }

  // 保存任务配置
  saveJobs(jobs: CronJobConfig[]): void {
    // 执行初始化函数，保证任务存在
    this.init();
    fs.writeFileSync(this.jobsPath, JSON.stringify({ jobs }, null, 2));
  }

  // 追加一条运行日志
  appendLog(log: RunLog): void {
    this.init();
    fs.appendFileSync(this.logsPath, JSON.stringify(log) + '\n');
  }

  // 获取最近的运行日志，下面是最近10条
  getRecentLogs(jobId?: string, limit = 10): RunLog[] {
    if (!fs.existsSync(this.logsPath)) return [];
    const lines = fs.readFileSync(this.logsPath, 'utf-8')
      .split('\n')
      .filter(Boolean);

    let logs: RunLog[] = lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean) as RunLog[];

    if (jobId) logs = logs.filter(l => l.jobId === jobId);
    return logs.slice(-limit);
  }
}
