/**
 * HookBus — onion middleware 引擎（v5.1 §11.3 / standards/19 §五）
 *
 * 关键设计：
 * 1. payload immutability（CRIT-1）：fire 端 Object.freeze + structuredClone
 * 2. replacePayload capability gate（CRIT-1）：唯一合法的 payload 修改路径
 * 3. abort 携带 reason（HIGH-3）：billing/audit plugin 可在 abort 路径仍记录
 * 4. supervisor 隔离：optional plugin 异常跳过；required 异常致命
 * 5. payload version 兼容：plugin 不支持当前 version 时 logger.warn + skip
 * 6. zero-cost fast-path：无 handler 时直接 terminal
 *
 * 注：本服务不依赖 NestJS（PR-3 PluginCoreModule 才用 @Injectable 包装）
 * 这里保持 plain class，便于 PR-2 单测不依赖 NestJS test bed。
 */
import { HookId, HookAbortReason } from "../abstractions/hooks";
import {
  IHookContext,
  IHookContextMeta,
  HookHandler,
  HookAbortError,
  PluginCapabilityError,
} from "../abstractions/hook-context.interface";
import { PluginCapability } from "../abstractions/plugin-capability.types";

/**
 * HookBus 注册项
 */
interface HookEntry<P = unknown> {
  readonly handler: HookHandler<P>;
  readonly priority: number;
  readonly pluginId: string;
  readonly required: boolean;
  /** 该 plugin 持有的 capability（用于 replacePayload gate）*/
  readonly capabilities: ReadonlyArray<PluginCapability>;
  /** 该 plugin 在此 hook 上声明能处理的 payload 版本 */
  readonly supportedPayloadVersions: ReadonlyArray<number> | undefined;
}

/**
 * Plugin supervisor 接口（PR-3 实现，PR-2 用最小桩接入）
 */
export interface IPluginSupervisor {
  onPluginError(pluginId: string, err: unknown): void;
  isCircuitOpen(pluginId: string): boolean;
}

/**
 * HookBus 配置
 */
export interface HookBusConfig {
  /** payload version 不兼容时是否 logger.warn（默认 true）*/
  readonly warnOnVersionMismatch?: boolean;
  /** 触发 hook 的层（trace meta 用）*/
  readonly defaultLayer?: "harness" | "engine";
}

/**
 * HookBus 主类
 */
export class HookBus {
  private readonly handlers = new Map<HookId, HookEntry[]>();
  private readonly supervisor: IPluginSupervisor;
  private readonly config: Required<HookBusConfig>;
  private readonly logger: {
    warn: (msg: string, ...meta: unknown[]) => void;
  };

  constructor(
    supervisor: IPluginSupervisor,
    config: HookBusConfig = {},
    logger?: { warn: (msg: string, ...meta: unknown[]) => void },
  ) {
    this.supervisor = supervisor;
    this.config = {
      warnOnVersionMismatch: config.warnOnVersionMismatch ?? true,
      defaultLayer: config.defaultLayer ?? "harness",
    };
    this.logger = logger ?? {
      warn: (msg, ...meta) => {
        // 默认走 console.warn（生产应注入 NestJS Logger 包装）
        // eslint-disable-next-line no-console
        console.warn(msg, ...meta);
      },
    };
  }

  /**
   * Plugin 注册 hook handler（init 阶段调用）
   *
   * @throws Error 当注册的 hookId 不在 plugin manifest.hooks 时（由 IHookRegistrar 校验，
   *               这里不重复——HookBus.register 是受信内部接口）
   */
  register<P>(
    hookId: HookId,
    handler: HookHandler<P>,
    options: {
      pluginId: string;
      required: boolean;
      capabilities: ReadonlyArray<PluginCapability>;
      priority?: number;
      supportedPayloadVersions?: ReadonlyArray<number>;
    },
  ): void {
    const entries = this.handlers.get(hookId) ?? [];
    const entry: HookEntry = {
      handler: handler as HookHandler<unknown>,
      priority: options.priority ?? 0,
      pluginId: options.pluginId,
      required: options.required,
      capabilities: options.capabilities,
      supportedPayloadVersions: options.supportedPayloadVersions,
    };
    entries.push(entry);
    // 高 priority 在外（先 before、后 after）
    entries.sort((a, b) => b.priority - a.priority);
    this.handlers.set(hookId, entries);
  }

  /**
   * 解除 plugin 在所有 hook 上的注册（PluginSupervisor 熔断或 dispose 调用）
   */
  unregisterPlugin(pluginId: string): void {
    for (const [hookId, entries] of this.handlers) {
      const filtered = entries.filter((e) => e.pluginId !== pluginId);
      if (filtered.length === 0) {
        this.handlers.delete(hookId);
      } else {
        this.handlers.set(hookId, filtered);
      }
    }
  }

  /**
   * harness/engine 在关键路径调用（onion middleware）
   *
   * @param hookId 见 CORE_HOOKS / EXTENDED_HOOKS
   * @param payload 业务 payload；fire 端 freeze
   * @param terminal 真正的业务逻辑（如 LLM 调用 / tool 执行）
   * @returns terminal 返回值，或 abort 抛出的异常
   */
  async fire<P, R>(
    hookId: HookId,
    payload: P,
    terminal: () => Promise<R>,
  ): Promise<R> {
    const allEntries = this.handlers.get(hookId) ?? [];
    // 跳过被熔断的 plugin
    const chain = allEntries.filter(
      (e) => !this.supervisor.isCircuitOpen(e.pluginId),
    );

    if (chain.length === 0) {
      // zero-cost fast-path
      return terminal();
    }

    // v5.1 CRIT-1: deep-freeze payload
    let currentPayload: Readonly<P> = this.deepFreeze(structuredClone(payload));

    let i = 0;
    const dispatch = async (): Promise<unknown> => {
      // 跳过 payload version 不兼容的 plugin
      while (i < chain.length) {
        const entry = chain[i];
        if (this.versionCompat(entry, hookId, currentPayload)) {
          break;
        }
        if (this.config.warnOnVersionMismatch) {
          this.logger.warn(
            `[HookBus] Plugin ${entry.pluginId} skipped for ${hookId}: payload version not in supported list`,
          );
        }
        i++;
      }
      if (i >= chain.length) return terminal();

      const entry = chain[i++];
      const ctx: IHookContext<P> = {
        hook: hookId,
        payload: currentPayload,
        meta: this.buildMeta(entry.pluginId),
        next: dispatch,
        abort: (reason: HookAbortReason, abortPayload?: unknown) => {
          throw new HookAbortError(reason, entry.pluginId, abortPayload);
        },
        replacePayload: (newPayload: P) => {
          // CRIT-1: capability gate
          this.assertWriteCapability(entry, hookId);
          currentPayload = this.deepFreeze(structuredClone(newPayload));
        },
      };
      return this.runWithSupervisor(entry, ctx);
    };

    return dispatch() as Promise<R>;
  }

  /**
   * 运行 plugin handler，捕获异常并按 required/optional 决定是否传播
   */
  private async runWithSupervisor(
    entry: HookEntry,
    ctx: IHookContext<unknown>,
  ): Promise<unknown> {
    try {
      return await entry.handler(ctx);
    } catch (err) {
      // 业务级 abort 透传（不算 plugin 错误，让上层 fire 调用方分辨）
      if (err instanceof HookAbortError) {
        throw err;
      }
      // capability 违规直接致命（plugin 行为错误，不应静默 skip）
      if (err instanceof PluginCapabilityError) {
        this.supervisor.onPluginError(entry.pluginId, err);
        throw err;
      }
      // 其他错误：通知 supervisor + 按 required 决定
      this.supervisor.onPluginError(entry.pluginId, err);
      if (entry.required) {
        throw err;
      }
      // optional plugin 异常：跳过到下一个 handler
      return ctx.next();
    }
  }

  /**
   * v5.1 CRIT-1：检查 plugin 是否有权限修改当前 hook 的 payload
   *
   * 命名约定：<hookId> 推断 payload domain
   *   engine.llm.* → write:llm-payload
   *   engine.tool.* → write:tool-payload
   *   harness.memory.* → write:memory
   *   其他 → 默认禁止 replacePayload（必须显式建模）
   */
  private assertWriteCapability(entry: HookEntry, hookId: HookId): void {
    const required = this.requiredWriteCapability(hookId);
    if (!required) {
      throw new PluginCapabilityError(
        entry.pluginId,
        "<unknown-write-capability>",
        `replacePayload on hook ${hookId} (no write capability defined for this hook domain)`,
      );
    }
    if (!entry.capabilities.includes(required)) {
      throw new PluginCapabilityError(
        entry.pluginId,
        required,
        `replacePayload on hook ${hookId}`,
      );
    }
  }

  private requiredWriteCapability(hookId: HookId): PluginCapability | null {
    if (hookId.startsWith("engine.llm.")) return "write:llm-payload";
    if (hookId.startsWith("engine.tool.")) return "write:tool-payload";
    if (hookId.startsWith("harness.memory.")) return "write:memory";
    return null;
  }

  /**
   * payload version 兼容：plugin 是否声明支持当前 payload 的 __version
   */
  private versionCompat(
    entry: HookEntry,
    _hookId: HookId,
    payload: Readonly<unknown>,
  ): boolean {
    if (!entry.supportedPayloadVersions) return true; // 未声明视为全兼容
    const version = (payload as { __version?: number })?.__version;
    if (typeof version !== "number") return true; // payload 无版本字段
    return entry.supportedPayloadVersions.includes(version);
  }

  /**
   * 深度 freeze（防 plugin mutate 嵌套对象）
   */
  private deepFreeze<T>(obj: T): Readonly<T> {
    if (obj === null || typeof obj !== "object") return obj;
    if (Object.isFrozen(obj)) return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj as object)) {
      const value = (obj as Record<string, unknown>)[key];
      if (
        value !== null &&
        typeof value === "object" &&
        !Object.isFrozen(value)
      ) {
        this.deepFreeze(value);
      }
    }
    return obj;
  }

  private buildMeta(pluginId: string): IHookContextMeta {
    return {
      pluginId,
      layer: this.config.defaultLayer,
      timestamp: Date.now(),
    };
  }

  /**
   * 测试 / 调试用：列出当前注册的 hook handler
   */
  describe(): Record<HookId, Array<{ pluginId: string; priority: number }>> {
    const out: Record<
      HookId,
      Array<{ pluginId: string; priority: number }>
    > = {};
    for (const [hookId, entries] of this.handlers) {
      out[hookId] = entries.map((e) => ({
        pluginId: e.pluginId,
        priority: e.priority,
      }));
    }
    return out;
  }

  /** 测试用：清空所有注册（生产不应调用）*/
  clearForTest(): void {
    this.handlers.clear();
  }
}
