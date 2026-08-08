// 错误分类，哪些状态码指的重试，哪些直接抛出错误

// --- 错误分类 ---

export function isRetryable(error: unknown): boolean {
	// 传入的如果不是error的实例，直接不重试了，因为后面没办法分析了Error.msg
  if (!(error instanceof Error)) return false;

  const message = error.message || '';

  // HTTP 状态码判断
	// 在错误消息中查找连续的三个数字
  const statusMatch = message.match(/(\d{3})/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1]);
    if ([429, 529, 408].includes(status)) return true;
		// 429限流，529服务器过载，等会再试，408请求超时，网络问题
    if (status >= 500 && status < 600) return true;
		// 客户端错误不可重试
		// 401没权限，404找不到，403禁止访问
    if (status >= 400 && status < 500) return false;
  }

  // 网络错误
  if (message.includes('ECONNRESET') || message.includes('EPIPE')) return true;
  if (message.includes('ETIMEDOUT') || message.includes('timeout')) return true;
  if (message.includes('fetch failed') || message.includes('network')) return true;
  // AI SDK 会把流式错误包装成 NoOutputGeneratedError
  if (message.includes('No output generated')) return true;

  return false;
}

// --- 指数退避 + 随机抖动 ---
//  attempt: number,   // 当前是第几次重试（从1开始）
//   baseMs = 500,      // 基础等待时间，默认500毫秒
//   maxMs = 30000      // 最大等待时间，默认30秒
export function calculateDelay(attempt: number, baseMs = 500, maxMs = 30000): number {
  // 每次重试等待的时间翻倍
  const exponential = baseMs * Math.pow(2, attempt - 1);
	// 取用两者时间的较小值，
  const capped = Math.min(exponential, maxMs);
  const jitterRange = capped * 0.25;
	// 随机抖动，避免请求瀑布，惊群效应
  // 设置一个随机偏移量，让请求分散
  const jittered = capped + (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(jittered));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
