/**
 * Hook 上下文接口（v5.1 §11.3 CRIT-1 / standards/19 §七 规则 11 @stable）
 *
 * payload 是 Readonly<P> 强制 immutability（fire 端 Object.freeze + structuredClone）
 * 唯一合法 payload 修改路径：ctx.replacePayload(newPayload)，受 capability gate
 */
import type { HookId, HookAbortReason } from "./hooks";

/**
 * Hook 调用元信息
 */
export interface IHookContextMeta {
  /** plugin id（当前 handler 所属 plugin）*/
  readonly pluginId: string;
  /** 触发 hook 的层（"harness" | "engine"）*/
  readonly layer: "harness" | "engine";
  /** trace correlation id */
  readonly correlationId?: string;
  /** 调用时间戳（毫秒）*/
  readonly timestamp: number;
}

/**
 * Hook handler 调用上下文（v5.1 CRIT-1 强制 immutability）
 */
export interface IHookContext<P = unknown> {
  /** hook id */
  readonly hook: HookId;

  /**
   * Frozen payload（v5.1 CRIT-1）
   * plugin 试图 mutate 触发 TypeError；唯一合法修改路径 replacePayload()
   */
  readonly payload: Readonly<P>;

  /** 调用元信息 */
  readonly meta: IHookContextMeta;

  /**
   * 链式继续：调用下一个 plugin handler；最末位调 terminal
   */
  next(): Promise<unknown>;

  /**
   * 短路 hook 链（cache 命中 / permission deny / rate-limited 等）
   * 必须携带 reason，让 abort-aware plugin（billing/audit）在 abort 路径仍能记录
   *
   * @param reason 见 HookAbortReason
   * @param abortPayload 可选载荷（如 cache-hit 时携带 cached response）
   */
  abort(reason: HookAbortReason, abortPayload?: unknown): never;

  /**
   * 替换 payload 的唯一合法路径（v5.1 CRIT-1）
   *
   * 内核校验调用方持有 write:<payload-domain> capability：
   * - 校验通过：freeze newPayload 传给后续 handler
   * - 校验失败：抛 PluginCapabilityError
   *
   * @throws PluginCapabilityError 未声明对应 write capability 时
   */
  replacePayload(newPayload: P): void;
}

/**
 * Hook handler 函数签名
 */
export type HookHandler<P = unknown> = (
  ctx: IHookContext<P>,
) => Promise<unknown>;

/**
 * Hook abort 异常（CRIT-1 + HIGH-3）
 */
export class HookAbortError extends Error {
  constructor(
    public readonly reason: HookAbortReason,
    public readonly pluginId: string,
    public readonly abortPayload?: unknown,
  ) {
    super(`Hook aborted by plugin ${pluginId}: ${reason}`);
    this.name = "HookAbortError";
  }
}

/**
 * Plugin capability 违规（v5.1 CRIT-1 + standards/19 §九 HIGH）
 */
export class PluginCapabilityError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly missingCapability: string,
    public readonly attemptedAction: string,
  ) {
    super(
      `Plugin ${pluginId} attempted ${attemptedAction} without capability ${missingCapability}`,
    );
    this.name = "PluginCapabilityError";
  }
}

/**
 * Plugin 启动失败（v5.1 §11.8 启动期 fail-fast）
 */
export class PluginBootError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly cause: unknown,
  ) {
    super(`Plugin ${pluginId} boot failed: ${String(cause)}`);
    this.name = "PluginBootError";
  }
}

/**
 * Plugin core 版本不兼容（v5.1 MED-2 fail-fast）
 */
export class PluginIncompatibleCoreError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly requiredRange: string,
    public readonly actualVersion: string,
  ) {
    super(
      `Plugin ${pluginId} requires plugin-core ${requiredRange} but actual is ${actualVersion}`,
    );
    this.name = "PluginIncompatibleCoreError";
  }
}
