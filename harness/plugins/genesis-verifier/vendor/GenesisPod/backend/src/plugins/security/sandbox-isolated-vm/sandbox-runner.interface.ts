/**
 * Sandbox runner 抽象（v5.1 R0.5 PR-10）
 *
 * 生产环境注入 isolated-vm 实现；spec 用 InMemorySandboxRunner（直接跑 fn 但模拟 timeout）
 */

export interface SandboxOptions {
  /** wall-clock timeout 毫秒（强制中断） */
  readonly timeoutMs: number;
  /** 内存上限 MB（生产环境 isolated-vm 强制；mock 仅记录） */
  readonly memoryLimitMb?: number;
}

export interface SandboxResult<T> {
  readonly success: boolean;
  readonly result?: T;
  readonly error?: string;
  readonly timedOut?: boolean;
  readonly memoryExceeded?: boolean;
}

export interface ISandboxRunner {
  /**
   * 在沙箱内执行 fn；fn 不能 access 外部 closure / require / process
   * （生产 isolated-vm 强制；mock 仅做 timeout race）
   */
  run<T>(fn: () => Promise<T>, opts: SandboxOptions): Promise<SandboxResult<T>>;
}

/**
 * 测试用 in-memory sandbox：直接跑 fn 但加 timeout race
 * 不模拟内存限制（isolated-vm 真实实现才能限内存）
 */
export class InMemorySandboxRunner implements ISandboxRunner {
  async run<T>(
    fn: () => Promise<T>,
    opts: SandboxOptions,
  ): Promise<SandboxResult<T>> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("sandbox-timeout"));
          }, opts.timeoutMs);
          (timer as { unref?: () => void }).unref?.();
        }),
      ]);
      return { success: true, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "sandbox-timeout") {
        return { success: false, timedOut: true, error: msg };
      }
      return { success: false, error: msg };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
