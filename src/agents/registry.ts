import type { SubAgentRun, SubAgentConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

export class SubAgentRegistry {
  // runs记录所有正在运行的子代理
  private runs = new Map<string, SubAgentRun>();
  private config: SubAgentConfig;
  private idCounter = 0;

  constructor(config?: Partial<SubAgentConfig>) {
    // 传入的新配置会覆盖默认的
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // 为子代理生成唯一id
  generateId(): string {
    return `sub-${++this.idCounter}-${Date.now().toString(36).slice(-4)}`;
  }

  // 现在能不能生成新的子代理（传入现在的嵌套深度）
  canSpawn(currentDepth: number): { ok: boolean; reason?: string } {
    if (currentDepth >= this.config.maxSpawnDepth) {
      return { ok: false, reason: `已达最大嵌套深度 ${this.config.maxSpawnDepth}` };
    }

    const activeCount = this.getActiveRuns().length;
    if (activeCount >= this.config.maxConcurrent) {
      return { ok: false, reason: `已达最大并发数 ${this.config.maxConcurrent}，等待现有任务完成` };
    }

    return { ok: true };
  }

  // 注册一个新的子代理
  register(run: SubAgentRun): void {
    this.runs.set(run.id, run);
  }

  // 标记某个子代理完成
  complete(id: string, result: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.status = 'completed';
    run.result = result;
    run.finishedAt = new Date().toISOString();
  }

  // 标记某个子代理失败
  fail(id: string, error: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    run.status = 'error';
    run.error = error;
    run.finishedAt = new Date().toISOString();
  }

  // 查询单个子代理
  get(id: string): SubAgentRun | undefined {
    return this.runs.get(id);
  }

  // 获取所有正在运行的子代理
  getActiveRuns(): SubAgentRun[] {
    return Array.from(this.runs.values()).filter(r => r.status === 'running');
  }

  // 获取所有子代理记录
  getAllRuns(): SubAgentRun[] {
    return Array.from(this.runs.values());
  }

  getConfig(): SubAgentConfig {
    return this.config;
  }
}
