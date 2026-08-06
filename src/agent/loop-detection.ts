import { createHash } from 'node:crypto';

// --- 类型定义 ---

// 工具调用记录
export interface ToolCallRecord {
  // 名字，哈希（参数名字一样时一致）
  toolName: string;
  argsHash: string;
  resultHash?: string;
	// 调用发生的时间戳
  timestamp: number;
}
// 检测器种类，重复检测、乒乓检测、全局熔断 
export type DetectorKind = 'generic_repeat' | 'ping_pong' | 'global_circuit_breaker';

// 检测结果，正常或者可住了（谁检测出来的，严重程度，重复次数，人类可读结果）
export type DetectionResult =
  | { stuck: false }
  | { stuck: true; level: 'warning' | 'critical'; detector: DetectorKind; count: number; message: string };

// --- 配置 ---

const HISTORY_SIZE = 30;       // 滑动窗口大小
// 只看最近30轮的工具调用有没有出现错误，太早的没有意义
// 5次提醒模型，注入提示消息
const WARNING_THRESHOLD = 5;   // 警告阈值（演示用，生产环境通常是 10）
// 阻断工具调用，强制停止循环
const CRITICAL_THRESHOLD = 8;  // 严重阈值（演示用，生产环境通常是 20）
// 全局熔断
const BREAKER_THRESHOLD = 10;  // 熔断阈值（演示用，生产环境通常是 30）

// --- 指纹计算 ---

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`).join(',')}}`;
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function hashToolCall(toolName: string, params: unknown): string {
  return `${toolName}:${hash(stableStringify(params))}`;
}

export function hashResult(result: unknown): string {
  return hash(stableStringify(result));
}

// --- 滑动窗口 ---

const history: ToolCallRecord[] = [];

export function recordCall(toolName: string, params: unknown): void {
  history.push({
    toolName,
    argsHash: hashToolCall(toolName, params),
    timestamp: Date.now(),
  });
  if (history.length > HISTORY_SIZE) history.shift();
}

export function recordResult(toolName: string, params: unknown, result: unknown): void {
  const argsHash = hashToolCall(toolName, params);
  const resultH = hashResult(result);
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].toolName === toolName && history[i].argsHash === argsHash && !history[i].resultHash) {
      history[i].resultHash = resultH;
      break;
    }
  }
}

export function resetHistory(): void {
  history.length = 0;
}

// --- 检测器 ---

function getNoProgressStreak(toolName: string, argsHash: string): number {
  let streak = 0;
  let lastResultHash: string | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    if (r.toolName !== toolName || r.argsHash !== argsHash) continue;
    if (!r.resultHash) continue;
    if (!lastResultHash) { lastResultHash = r.resultHash; streak = 1; continue; }
    if (r.resultHash !== lastResultHash) break;
    streak++;
  }
  return streak;
}

function getPingPongCount(currentHash: string): number {
  if (history.length < 3) return 0;
  const last = history[history.length - 1];
  let otherHash: string | undefined;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].argsHash !== last.argsHash) { otherHash = history[i].argsHash; break; }
  }
  if (!otherHash) return 0;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const expected = count % 2 === 0 ? last.argsHash : otherHash;
    if (history[i].argsHash !== expected) break;
    count++;
  }
  if (currentHash === otherHash && count >= 2) return count + 1;
  return 0;
}

// --- 主检测函数 ---

export function detect(toolName: string, params: unknown): DetectionResult {
  const argsHash = hashToolCall(toolName, params);
  const noProgress = getNoProgressStreak(toolName, argsHash);

  if (noProgress >= BREAKER_THRESHOLD) {
    return { stuck: true, level: 'critical', detector: 'global_circuit_breaker', count: noProgress,
      message: `[熔断] ${toolName} 已重复 ${noProgress} 次且无进展，强制停止` };
  }

  const pingPong = getPingPongCount(argsHash);
  if (pingPong >= CRITICAL_THRESHOLD) {
    return { stuck: true, level: 'critical', detector: 'ping_pong', count: pingPong,
      message: `[熔断] 检测到乒乓循环（${pingPong} 次交替），强制停止` };
  }
  if (pingPong >= WARNING_THRESHOLD) {
    return { stuck: true, level: 'warning', detector: 'ping_pong', count: pingPong,
      message: `[警告] 检测到乒乓循环（${pingPong} 次交替），建议换个思路` };
  }

  const recentCount = history.filter(h => h.toolName === toolName && h.argsHash === argsHash).length;
  if (recentCount >= CRITICAL_THRESHOLD) {
    return { stuck: true, level: 'critical', detector: 'generic_repeat', count: recentCount,
      message: `[熔断] ${toolName} 相同参数已调用 ${recentCount} 次，强制停止` };
  }
  if (recentCount >= WARNING_THRESHOLD) {
    return { stuck: true, level: 'warning', detector: 'generic_repeat', count: recentCount,
      message: `[警告] ${toolName} 相同参数已调用 ${recentCount} 次，你可能陷入了重复` };
  }

  return { stuck: false };
}
