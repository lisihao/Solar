/**
 * ConcurrencyLimiter — 通用并发信号量
 *
 * 沉淀自 TI leader-planning.service.ts:105-140 的 outline 队列实现，提取为
 * 与具体业务无关的通用工具。
 *
 * 用途：
 *   - LLM reasoning 模型的限流（Doubao reasoning 上限并发 3）
 *   - 高 IO 任务的限流（embedding 批量 / search 并发）
 *   - 防 rate limit 雪崩
 *
 * 设计：
 *   - acquire() 返回 Promise<release>，使用方拿到 release 后必须调用一次释放
 *   - 队列 FIFO，不同 priority 通过单独构造多个 limiter 实现
 *   - 不依赖外部状态，纯内存 — 单进程内有效
 *
 * 用法（推荐 try/finally 释放）：
 *
 *   const limiter = new ConcurrencyLimiter(3);
 *   const release = await limiter.acquire();
 *   try {
 *     await doExpensiveCall();
 *   } finally {
 *     release();
 *   }
 *
 * 或便捷封装：
 *   const result = await limiter.run(async () => doExpensiveCall());
 */

export class ConcurrencyLimiter {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(public readonly maxConcurrent: number) {
    if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) {
      throw new Error(
        `ConcurrencyLimiter: maxConcurrent must be >= 1, got ${maxConcurrent}`,
      );
    }
  }

  /**
   * 获取一个执行槽。返回 release 函数 — 调用方必须调用一次以释放。
   */
  acquire(): Promise<() => void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        // 队首被释放唤醒：直接返回 release 而不增加 running（前驱不减让位）
        resolve(this.makeRelease());
      });
    });
  }

  /**
   * 便捷封装：自动 acquire + 执行 + 释放（即使抛错也释放）。
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * 当前正在执行的任务数（含已 acquire 但未 release）。
   */
  get activeCount(): number {
    return this.running;
  }

  /**
   * 队列中等待的任务数。
   */
  get pendingCount(): number {
    return this.queue.length;
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return; // 幂等：重复 release 无害
      released = true;
      const next = this.queue.shift();
      if (next) {
        // 队首唤醒，无需减 running（前驱直接让位）
        next();
      } else {
        this.running--;
      }
    };
  }
}
