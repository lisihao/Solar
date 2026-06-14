/**
 * LifecycleHookBridge — harness/lifecycle + memory hook 桥接器（v5.1 R0.5 PR-6）
 *
 * 设计理念：
 * - 不改 ai-harness/teams/orchestrator 大文件（avoid risk to long-running mission flow）
 * - 提供高层 API：fireMissionStart / fireMissionEnd / fireMemoryWrite / fireMemoryRead
 * - ai-app 或 harness service 主动调 bridge → bridge 内部 fire HookBus
 * - 双轨：HookBus 未注入时 bridge 是 no-op（旧代码不改也不报错）
 * - terminal 默认 no-op（mission/memory hook 是观察型，不参与 terminal）
 *
 * 用法：
 *   const bridge = new LifecycleHookBridge();
 *   bridge.setHookBus(bus);  // PluginCoreModule.onApplicationBootstrap
 *   await bridge.fireMissionStart({ missionId, missionContext });
 *   await bridge.fireMemoryWrite({ key, value, memoryType });
 */
import type { HookBus } from "../hook-bus";
import { CORE_HOOKS, type HookId } from "../abstractions/hooks";
import type {
  MissionStartPayload,
  MissionEndPayload,
  MemoryWritePayload,
  MemoryReadPayload,
  HookMeta,
} from "../abstractions/hook-payloads";

export interface FireMissionStartArgs {
  readonly missionId: string;
  /** harness MissionContext 业务类型不透明引用 */
  readonly missionContext: unknown;
  readonly meta?: HookMeta;
}

export interface FireMissionEndArgs {
  readonly missionId: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly result?: unknown;
  readonly error?: unknown;
  readonly meta?: HookMeta;
}

export interface FireMemoryWriteArgs {
  readonly key: string;
  readonly value: unknown;
  readonly memoryType?: string;
  readonly meta?: HookMeta;
}

export interface FireMemoryReadArgs {
  readonly key: string;
  readonly memoryType?: string;
  readonly meta?: HookMeta;
}

export class LifecycleHookBridge {
  private hookBus: HookBus | undefined;

  /** 启动期 PluginCoreModule.onApplicationBootstrap 调用 */
  setHookBus(bus: HookBus | undefined): void {
    this.hookBus = bus;
  }

  /** ai-app / harness 主动通知 mission 已启动 */
  async fireMissionStart(args: FireMissionStartArgs): Promise<void> {
    if (!this.hookBus) return; // 双轨：未注入时 no-op
    const payload: MissionStartPayload = {
      __version: 1,
      missionId: args.missionId,
      missionContext: this.toJsonSafe(args.missionContext),
      startedAt: Date.now(),
      meta: args.meta ?? { missionId: args.missionId, timestamp: Date.now() },
    };
    await this.fireSafe(CORE_HOOKS.MISSION_START, payload);
  }

  async fireMissionEnd(args: FireMissionEndArgs): Promise<void> {
    if (!this.hookBus) return;
    const payload: MissionEndPayload = {
      __version: 1,
      missionId: args.missionId,
      status: args.status,
      completedAt: Date.now(),
      result: this.toJsonSafe(args.result),
      error: this.toJsonSafe(args.error),
      meta: args.meta ?? { missionId: args.missionId, timestamp: Date.now() },
    };
    await this.fireSafe(CORE_HOOKS.MISSION_END, payload);
  }

  async fireMemoryWrite(args: FireMemoryWriteArgs): Promise<void> {
    if (!this.hookBus) return;
    const payload: MemoryWritePayload = {
      __version: 1,
      key: args.key,
      value: this.toJsonSafe(args.value),
      memoryType: args.memoryType,
      meta: args.meta ?? { timestamp: Date.now() },
    };
    await this.fireSafe(CORE_HOOKS.MEMORY_WRITE, payload);
  }

  async fireMemoryRead(args: FireMemoryReadArgs): Promise<void> {
    if (!this.hookBus) return;
    const payload: MemoryReadPayload = {
      __version: 1,
      key: args.key,
      memoryType: args.memoryType,
      meta: args.meta ?? { timestamp: Date.now() },
    };
    await this.fireSafe(CORE_HOOKS.MEMORY_READ, payload);
  }

  /** 通用 fire（terminal no-op，让 plugin 纯观察）+ 异常吞掉避免影响调用方主流程 */
  private async fireSafe(hookId: HookId, payload: unknown): Promise<void> {
    if (!this.hookBus) return;
    try {
      await this.hookBus.fire(hookId, payload, async () => undefined);
    } catch {
      // 此处吞异常：mission/memory hook 是观察型，plugin 异常不应阻塞调用方主流程
      // HookBus.runWithSupervisor 已经记录 plugin 错误到 supervisor，supervisor
      // 累计达阈值会熔断该 plugin
    }
  }

  private toJsonSafe(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== "object") return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return undefined;
    }
  }
}
