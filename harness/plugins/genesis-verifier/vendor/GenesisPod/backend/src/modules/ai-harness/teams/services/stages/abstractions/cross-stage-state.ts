/**
 * CrossStageState — 跨 stage 副作用容器（v5.1 §3.2 / §3.4 P0-F）
 *
 * 用途：
 *   非 stateful role 的 stage 间数据传递（如 consumer 的 s4PatchFailures /
 *   s4PatchRound / outlinePlan）。stage primitive 在执行期写入；后续 primitive +
 *   accountability hook 读取。
 *
 * 设计：
 *   - generic key-value store
 *   - append() 用于 accumulator（如 patchFailures）
 *   - 序列化通过 toJSON() / fromJSON()（IMissionStore 持久化用）
 *   - business-agnostic：harness 不知道 key 含义；ai-app hook 自己用业务前缀
 *     例：consumer.s4PatchFailures（业务前缀避免冲突）
 *
 * 持久化：
 *   crashed mission resume 时由 IMissionStore.getCrossStageState() 重建
 */

export class CrossStageState {
  private readonly store: Map<string, unknown>;

  constructor(initial: Record<string, unknown> = {}) {
    this.store = new Map(Object.entries(initial));
  }

  /** 单值写入；覆盖之前的值 */
  set<T>(key: string, value: T): void {
    this.store.set(key, value);
  }

  /** 读取；不存在返回 undefined */
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  /** accumulator：append item to array (key 不存在则初始化为 []) */
  append<T>(key: string, item: T): void {
    const arr = (this.store.get(key) as T[] | undefined) ?? [];
    arr.push(item);
    this.store.set(key, arr);
  }

  /** counter：incr by delta (default 1) */
  incr(key: string, delta = 1): number {
    const current = (this.store.get(key) as number | undefined) ?? 0;
    const next = current + delta;
    this.store.set(key, next);
    return next;
  }

  /** key 是否存在 */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /** 删除 key */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** 列出所有 key（按字母序）*/
  keys(): string[] {
    return Array.from(this.store.keys()).sort();
  }

  /** 序列化为可持久化的 plain object */
  toJSON(): Record<string, unknown> {
    return Object.fromEntries(this.store);
  }

  /** 从持久化数据构造（IMissionStore.getCrossStageState 后调用）*/
  static fromJSON(data: Record<string, unknown>): CrossStageState {
    return new CrossStageState(data);
  }

  /** 浅 clone（测试 / fork 场景）*/
  clone(): CrossStageState {
    return CrossStageState.fromJSON(this.toJSON());
  }
}
