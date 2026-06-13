/**
 * 并发控制工具
 *
 * 提供对Promise并发执行的限制，防止资源耗尽
 */

export interface ConcurrencyLimiterOptions {
  concurrency: number;
}

/**
 * 创建一个并发限制器
 * @param concurrency 最大并发数
 * @returns 返回一个limit函数，用于包装异步操作
 */
export function createConcurrencyLimiter(concurrency: number) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      const resolve = queue.shift()!;
      resolve();
    }
  };

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    activeCount++;
    try {
      return await fn();
    } finally {
      next();
    }
  };

  const enqueue = async <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const runTask = () => run(fn).then(resolve).catch(reject);

      if (activeCount < concurrency) {
        void runTask();
      } else {
        queue.push(runTask);
      }
    });
  };

  return enqueue;
}

/**
 * 创建一个 token bucket 速率限制器 (req/s)
 *
 * 与 concurrency limiter 互补：concurrency 限"同时在飞数"，rate limiter 限"每秒发起数"。
 * 4 个并发请求"瞬时同时发起"对外部 API 来说仍是 4 req/秒的 burst，超出 polite pool
 * 上限就被 429。token bucket 强制每秒最多 N 个请求，多余的请求排队等下一个 tick。
 *
 * @param refillRatePerSec 每秒补充的 token 数（= 最大稳定 req/s）
 * @param burstCapacity 桶容量，决定瞬时 burst 上限；默认 = refillRate（即不允许 burst）
 * @returns acquire(signal?) → Promise<void>；成功 resolve 即可发请求
 */
export function createRateLimiter(
  refillRatePerSec: number,
  burstCapacity?: number,
) {
  const capacity = burstCapacity ?? refillRatePerSec;
  let tokens = capacity;
  let lastRefill = Date.now();

  const refill = () => {
    const now = Date.now();
    const elapsedSec = (now - lastRefill) / 1000;
    tokens = Math.min(capacity, tokens + elapsedSec * refillRatePerSec);
    lastRefill = now;
  };

  const acquire = async (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) throw new Error("rate limiter aborted");
    while (true) {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      // wait until next token is available
      const tokensNeeded = 1 - tokens;
      const waitMs = Math.max(
        10,
        Math.ceil((tokensNeeded * 1000) / refillRatePerSec),
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      if (signal?.aborted) throw new Error("rate limiter aborted");
    }
  };

  return { acquire };
}

/**
 * 默认并发限制器实例
 * - API_CONCURRENCY: 外部API调用并发限制 (5)
 * - DB_CONCURRENCY: 数据库批量操作并发限制 (10)
 * - FILE_CONCURRENCY: 文件操作并发限制 (3)
 */
export const ConcurrencyLimits = {
  API: 5,
  DB: 10,
  FILE: 3,
  AI: 3,
} as const;

/**
 * 带并发限制的Promise.all替代
 * @param items 要处理的项目数组
 * @param fn 处理函数
 * @param concurrency 最大并发数
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = ConcurrencyLimits.API,
): Promise<R[]> {
  const limit = createConcurrencyLimiter(concurrency);
  return Promise.all(items.map((item, index) => limit(() => fn(item, index))));
}

/**
 * 带并发限制的Promise.allSettled替代
 * @param items 要处理的项目数组
 * @param fn 处理函数
 * @param concurrency 最大并发数
 */
export async function mapWithConcurrencySettled<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = ConcurrencyLimits.API,
): Promise<PromiseSettledResult<R>[]> {
  const limit = createConcurrencyLimiter(concurrency);
  return Promise.allSettled(
    items.map((item, index) => limit(() => fn(item, index))),
  );
}

/**
 * 批量处理数组，每批次有并发限制
 * @param items 要处理的项目数组
 * @param fn 处理函数
 * @param batchSize 每批次的大小
 * @param concurrency 批次内的并发数
 */
export async function batchProcess<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  batchSize: number = 10,
  concurrency: number = ConcurrencyLimits.API,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await mapWithConcurrency(
      batch,
      (item, batchIndex) => fn(item, i + batchIndex),
      concurrency,
    );
    results.push(...batchResults);
  }
  return results;
}
