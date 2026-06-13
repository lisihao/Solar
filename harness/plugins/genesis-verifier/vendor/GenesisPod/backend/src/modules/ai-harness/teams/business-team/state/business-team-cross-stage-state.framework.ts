/**
 * BusinessAgentTeam — Cross-Stage State Framework Base
 *
 * Typed wrapper base on top of the harness {@link CrossStageState} key-value
 * container. Business teams subclass and expose **typed** getter/setter views
 * over the inner store, replacing ad-hoc SessionEntry fields like
 * `lastPlan` / `lastResearcherResults` / `s4PatchFailures` / `inheritedX`.
 *
 * 2026-05-24 (P4) 抽取自 ai-app 业务侧 cross-stage-state:
 *   - ai-app/playground/services/mission/workflow/playground-cross-stage-state.ts  @migrated-from
 *
 * 设计目标（idempotent refactor — 外部行为完全保留）：
 *   - subclass getter/setter 语法与原 field 一致（`entry.crossState.lastFoo = X`），
 *     hook closures 内的 mechanical sed 替换即可；
 *   - 内部 sync in-memory Map（从 Z5 CrossStageState 继承），0 引入 async I/O；
 *   - **{@link CrossStageState} 是底座**，业务子类在其之上暴露 typed 字段视图；
 *   - 序列化由底座 {@link CrossStageState#toJSON} / {@link CrossStageState.fromJSON}
 *     提供，subclass `fromJSON` 只需把还原后的 inner 传回 super constructor。
 *
 * 业务侧扩展模板：
 * ```ts
 * export class MyCrossStageState extends BusinessTeamCrossStageStateFramework {
 *   get lastFoo(): Foo | undefined {
 *     return this.read<Foo>("lastFoo");
 *   }
 *   set lastFoo(v: Foo | undefined) {
 *     this.write("lastFoo", v);
 *   }
 *   // ...其它 typed 字段
 *   static fromJSON(data: Record<string, unknown>): MyCrossStageState {
 *     return new MyCrossStageState(CrossStageState.fromJSON(data));
 *   }
 * }
 * ```
 */

// ★ 不走 facade barrel：facade/index.ts 会 re-export 本 framework
//   (构成循环加载)。直接从 source 导入打破循环。
import { CrossStageState } from "../../services/stages/abstractions/cross-stage-state";

export class BusinessTeamCrossStageStateFramework {
  /**
   * 底座 key-value store；subclass 通过 {@link read} / {@link write} /
   * {@link append} / {@link incr} 暴露 typed 视图。
   */
  protected readonly inner: CrossStageState;

  constructor(initial?: CrossStageState) {
    this.inner = initial ?? new CrossStageState();
  }

  /** typed 读 helper — subclass 在 typed getter 内部转发 */
  protected read<T>(key: string): T | undefined {
    return this.inner.get<T>(key);
  }

  /** typed 写 helper — subclass 在 typed setter 内部转发 */
  protected write<T>(key: string, value: T): void {
    this.inner.set(key, value);
  }

  /** accumulator: append to array; subclass 暴露在 typed accumulator getter 上 */
  protected append<T>(key: string, item: T): void {
    this.inner.append(key, item);
  }

  /** counter: incr by delta */
  protected incr(key: string, delta = 1): number {
    return this.inner.incr(key, delta);
  }

  /** key 是否存在（subclass 可直接转发或封装语义判断） */
  has(key: string): boolean {
    return this.inner.has(key);
  }

  /** 序列化为可持久化的 plain object（IMissionStore 持久化 / checkpoint 用） */
  toJSON(): Record<string, unknown> {
    return this.inner.toJSON();
  }
}
