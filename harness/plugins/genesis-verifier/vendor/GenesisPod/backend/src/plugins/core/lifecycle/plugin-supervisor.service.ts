/**
 * PluginSupervisor — plugin 异常隔离 + circuit breaker（v5.1 §11.8 / standards/19）
 *
 * 设计要点：
 * - plugin 累计错误达阈值 → 熔断（HookBus 跳过该 plugin）
 * - 半开状态：cooldown 后给一次机会
 * - HookBus 通过 IPluginSupervisor 接口调用 onPluginError / isCircuitOpen
 * - 周期 healthCheck（v5.1 P1 unhealthy 计入错误计数）
 *
 * 实现独立于 NestJS（PR-3 后续 PluginCoreModule 把它包成 @Injectable provider）
 */
import type { IPluginSupervisor } from "../hook-bus/hook-bus.service";

export type CircuitState = "closed" | "half-open" | "open";

export interface PluginSupervisorConfig {
  /** 多少次错误触发熔断（默认 5）*/
  readonly failureThreshold?: number;
  /** 熔断到半开的 cooldown 毫秒（默认 30s）*/
  readonly cooldownMs?: number;
}

export interface ISupervisedPlugin {
  readonly id: string;
  healthCheck?(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    message?: string;
  }>;
}

export class PluginSupervisor implements IPluginSupervisor {
  private readonly errorCounts = new Map<string, number>();
  private readonly circuit = new Map<string, CircuitState>();
  private readonly halfOpenTimers = new Map<string, NodeJS.Timeout>();
  private readonly registered = new Map<string, ISupervisedPlugin>();
  private readonly config: Required<PluginSupervisorConfig>;
  private readonly logger: {
    warn: (msg: string, ...meta: unknown[]) => void;
    error: (msg: string, ...meta: unknown[]) => void;
  };
  private readonly onCircuitOpen?: (pluginId: string) => void;

  constructor(
    config: PluginSupervisorConfig = {},
    options: {
      logger?: {
        warn: (msg: string, ...meta: unknown[]) => void;
        error: (msg: string, ...meta: unknown[]) => void;
      };
      /** 熔断时通知 HookBus.unregisterPlugin / 清理资源等 */
      onCircuitOpen?: (pluginId: string) => void;
    } = {},
  ) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      cooldownMs: config.cooldownMs ?? 30_000,
    };
    this.logger = options.logger ?? {
      warn: (msg, ...meta) => {
        // eslint-disable-next-line no-console
        console.warn(msg, ...meta);
      },
      error: (msg, ...meta) => {
        // eslint-disable-next-line no-console
        console.error(msg, ...meta);
      },
    };
    this.onCircuitOpen = options.onCircuitOpen;
  }

  /** 注册 plugin（PluginLoader 实例化后调用，让 supervisor 知道 plugin 存在）*/
  register(plugin: ISupervisedPlugin): void {
    this.registered.set(plugin.id, plugin);
    this.circuit.set(plugin.id, "closed");
    this.errorCounts.set(plugin.id, 0);
  }

  /** 反注册（plugin dispose 时） */
  unregister(pluginId: string): void {
    this.registered.delete(pluginId);
    this.circuit.delete(pluginId);
    this.errorCounts.delete(pluginId);
    const timer = this.halfOpenTimers.get(pluginId);
    if (timer) {
      clearTimeout(timer);
      this.halfOpenTimers.delete(pluginId);
    }
  }

  /** HookBus 调用：plugin 出错时通知 */
  onPluginError(pluginId: string, err: unknown): void {
    const state = this.circuit.get(pluginId);
    // half-open 期再出错 → 立即重新打开熔断器
    if (state === "half-open") {
      this.openCircuit(pluginId);
      return;
    }

    const count = (this.errorCounts.get(pluginId) ?? 0) + 1;
    this.errorCounts.set(pluginId, count);
    this.logger.warn(
      `[PluginSupervisor] plugin ${pluginId} error #${count}/${this.config.failureThreshold}: ${String(err)}`,
    );

    if (count >= this.config.failureThreshold) {
      this.openCircuit(pluginId);
    }
  }

  /** HookBus 调用：判断 plugin 是否被熔断（open 时跳过该 plugin）*/
  isCircuitOpen(pluginId: string): boolean {
    return this.circuit.get(pluginId) === "open";
  }

  /** 测试用：手动打开熔断器 */
  openCircuit(pluginId: string): void {
    if (this.circuit.get(pluginId) === "open") return;
    this.circuit.set(pluginId, "open");
    this.logger.error(`[PluginSupervisor] plugin ${pluginId} circuit OPEN`);
    this.onCircuitOpen?.(pluginId);

    // cooldown 后切到 half-open
    const timer = setTimeout(() => {
      this.tryHalfOpen(pluginId);
    }, this.config.cooldownMs);
    // unref 避免阻塞进程退出
    (timer as { unref?: () => void }).unref?.();
    this.halfOpenTimers.set(pluginId, timer);
  }

  /** 切到 half-open 状态（一次试探） */
  private tryHalfOpen(pluginId: string): void {
    if (this.circuit.get(pluginId) !== "open") return;
    this.circuit.set(pluginId, "half-open");
    this.errorCounts.set(pluginId, 0);
    this.logger.warn(
      `[PluginSupervisor] plugin ${pluginId} circuit HALF-OPEN (probing)`,
    );
  }

  /** 周期 health check（外部由 NestJS @Interval 触发，或测试手动调用）*/
  async runHealthCheck(): Promise<void> {
    for (const [id, plugin] of this.registered) {
      if (this.isCircuitOpen(id)) continue;
      if (!plugin.healthCheck) continue;
      try {
        const h = await plugin.healthCheck();
        if (h.status === "unhealthy") {
          this.onPluginError(id, new Error(h.message ?? "unhealthy"));
        }
      } catch (err) {
        this.onPluginError(id, err);
      }
    }
  }

  /** 测试 / 调试用 */
  describe(): Record<string, { state: CircuitState; errorCount: number }> {
    const out: Record<string, { state: CircuitState; errorCount: number }> = {};
    for (const id of this.registered.keys()) {
      out[id] = {
        state: this.circuit.get(id) ?? "closed",
        errorCount: this.errorCounts.get(id) ?? 0,
      };
    }
    return out;
  }

  /** 测试用：清空状态 */
  clearForTest(): void {
    for (const timer of this.halfOpenTimers.values()) {
      clearTimeout(timer);
    }
    this.halfOpenTimers.clear();
    this.errorCounts.clear();
    this.circuit.clear();
    this.registered.clear();
  }
}
