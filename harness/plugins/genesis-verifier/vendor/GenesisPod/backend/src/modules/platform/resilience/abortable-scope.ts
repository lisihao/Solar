/**
 * AbortableScope — AbortSignal listener 生命周期统一抽象
 *
 * 背景（2026-05-05 d5c3a3092 修了 3 处 listener leak 但散点）：
 *   AbortSignal.addEventListener("abort", fn, {once:true}) 表面看安全，但
 *   abort 永不触发时 listener 永驻 → mission 数十次 + N 个 agent 共享 signal
 *   → 累积超过 30 触发 MaxListenersExceededWarning → event loop 退化 →
 *   cron / scheduler 卡死 → mission 永远 active。
 *
 * 用法（替代散点 addEventListener / removeEventListener 配对）：
 *
 *   const scope = new AbortableScope();
 *   scope.add(externalSignal, () => myAbortController.abort());
 *   try {
 *     // ... 业务逻辑
 *   } finally {
 *     scope.dispose();  // 自动 remove 所有 listener
 *   }
 *
 * 或 await using（Node 20+ explicit resource management）：
 *
 *   await using scope = new AbortableScope();
 *   scope.add(signal, () => { ... });
 *   // 自动 dispose
 *
 * 优点：
 *   - 所有 listener 集中管理，不漏 cleanup
 *   - 调用方只需关心业务逻辑，不需 manual remove
 *   - 配合 ESLint rule `no-naked-abort-listener` 强制使用（禁止 raw addEventListener）
 */

export class AbortableScope {
  private readonly entries: Array<{
    signal: AbortSignal;
    listener: () => void;
  }> = [];
  private disposed = false;

  /**
   * 注册 abort listener。listener 在 signal abort 时触发；
   * dispose 时自动 remove 所有未触发的 listener。
   *
   * @returns cleanup 函数，可手动调用提前 remove 单个 listener
   */
  add(signal: AbortSignal, listener: () => void): () => void {
    if (this.disposed) {
      throw new Error("AbortableScope is already disposed");
    }
    if (signal.aborted) {
      // 已 abort：立即触发 listener 但不注册（避免无谓 add+remove）
      try {
        listener();
      } catch {
        /* listener 异常不影响 caller */
      }
      return () => undefined;
    }
    signal.addEventListener("abort", listener, { once: true });
    const entry = { signal, listener };
    this.entries.push(entry);
    return () => {
      try {
        signal.removeEventListener("abort", listener);
      } catch {
        /* signal 已 detach，忽略 */
      }
      const idx = this.entries.indexOf(entry);
      if (idx >= 0) this.entries.splice(idx, 1);
    };
  }

  /**
   * 释放所有 listener。多次调用幂等。
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { signal, listener } of this.entries) {
      try {
        signal.removeEventListener("abort", listener);
      } catch {
        /* signal 已 detach，忽略 */
      }
    }
    this.entries.length = 0;
  }

  /** Symbol.dispose 支持 — Node 20+ explicit resource management */
  [Symbol.dispose]?(): void {
    this.dispose();
  }

  get size(): number {
    return this.entries.length;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
