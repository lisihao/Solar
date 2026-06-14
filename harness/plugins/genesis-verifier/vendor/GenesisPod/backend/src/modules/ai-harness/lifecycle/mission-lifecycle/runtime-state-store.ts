/**
 * MissionRuntimeStateStore — Harness 无状态化的核心组件
 *
 * 把 TeamsMissionOrchestrator 的 4 个内存 Map 外置到 Redis（CacheService 抽象层），
 * 让 harness 实例可水平扩展、跨 pod 接管 mission。
 *
 * 配套 podId + heartbeat 机制实现"任何 harness 实例可接管任何 mission"
 * （对标 Anthropic Managed Agents 的无状态 harness 设计）。
 *
 * 失败容忍：所有写入失败仅记 warn，不抛异常 —— mission 主流程不能因为 cache
 * 抖动而被打断。读取失败返回 undefined 由调用方决定降级（通常回退到 in-memory）。
 *
 * ★ 职责边界（RB4 双心跳契约）：
 *   - Redis heartbeat（claimOrBeat / getHeartbeat）= **活性探测**（in-flight presence）：
 *     标识"哪个 pod 正在跑该 mission"，供跨 pod 接管用，TTL 90s 快速判活。
 *   - **不作孤儿回收依据**：回收（markFailed）只由 MissionLivenessGuard 基于
 *     DB heartbeatAt 触发，Redis 心跳的存在/缺失不触发任何回收逻辑。
 *   - 如未来有人想让 Redis 参与回收判定，必须先更新 MissionLivenessGuard 的
 *     回收契约测试（src/modules/ai-harness/lifecycle/mission-lifecycle/__tests__/
 *     liveness-reclaim-contract.spec.ts），否则测试会失败阻止合入。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { hostname } from "os";
import { CacheService } from "@/common/cache/cache.service";
import {
  MissionExecutionState,
  OrchestratorPhase,
} from "../../teams/orchestrator/orchestrator.interface";
import type { MissionInput } from "../../agents/abstractions/mission.types";

/**
 * 序列化后的 MissionExecutionState（Map 转 entries 数组以便 JSON 化）
 */
interface SerializedMissionState {
  missionId: string;
  phase: OrchestratorPhase;
  workflowState?: unknown;
  resourceUsage: unknown;
  completedSteps: string[];
  currentSteps: string[];
  failedSteps: string[];
  reviewResults: unknown[];
  intermediateOutputsEntries: Array<[string, unknown]>;
  deliverables: unknown[];
}

/**
 * 心跳记录 —— 标识当前哪个 pod 持有这个 mission
 */
export interface MissionHeartbeat {
  podId: string;
  lastBeatAt: number;
  startedAt: number;
}

/** TTL 常量（秒） */
const STATE_TTL_SECONDS = 24 * 3600; // 24h，足够最长 mission 生命周期
const HEARTBEAT_TTL_SECONDS = 90; // 90s，调用方需 < 90s 续期一次
export const HEARTBEAT_INTERVAL_MS = 30_000; // 30s 续期

/** Key 前缀 —— 统一加 mission:rt: 命名空间 */
const PREFIX_STATE = "mission:rt:state:";
const PREFIX_INPUT = "mission:rt:input:";
const PREFIX_TRACE = "mission:rt:trace:";
const PREFIX_KERNEL = "mission:rt:kernel:";
const PREFIX_HEARTBEAT = "mission:rt:hb:";

@Injectable()
export class MissionRuntimeStateStore {
  private readonly logger = new Logger(MissionRuntimeStateStore.name);
  private readonly podId: string;

  constructor(@Optional() private readonly cache?: CacheService) {
    // podId 优先用 Railway/K8s 注入的 HOSTNAME，本地开发用 hostname()+随机后缀
    // 注意：HOSTNAME 可能是空字符串 → 用 trim 判断而非 ?? (?? 把 "" 当真值)
    const envHost = process.env.HOSTNAME?.trim();
    this.podId =
      envHost && envHost.length > 0
        ? envHost
        : `${hostname()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!this.cache) {
      this.logger.warn(
        "CacheService not injected — MissionRuntimeStateStore in no-op mode (single-instance fallback)",
      );
    } else {
      this.logger.log(
        `MissionRuntimeStateStore initialized, podId=${this.podId}`,
      );
    }
  }

  getPodId(): string {
    return this.podId;
  }

  // ==================== State ====================

  async setState(
    missionId: string,
    state: MissionExecutionState,
  ): Promise<void> {
    if (!this.cache) return;
    await this.cache.set(
      PREFIX_STATE + missionId,
      this.serialize(state),
      STATE_TTL_SECONDS,
    );
  }

  async getState(
    missionId: string,
  ): Promise<MissionExecutionState | undefined> {
    if (!this.cache) return undefined;
    const raw = await this.cache.get<SerializedMissionState>(
      PREFIX_STATE + missionId,
    );
    return raw ? this.deserialize(raw) : undefined;
  }

  async deleteState(missionId: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.del(PREFIX_STATE + missionId);
  }

  // ==================== Original Input ====================

  async setInput(missionId: string, input: MissionInput): Promise<void> {
    if (!this.cache) return;
    await this.cache.set(PREFIX_INPUT + missionId, input, STATE_TTL_SECONDS);
  }

  async getInput(missionId: string): Promise<MissionInput | undefined> {
    if (!this.cache) return undefined;
    return this.cache.get<MissionInput>(PREFIX_INPUT + missionId);
  }

  // ==================== Trace ID ====================

  async setTraceId(missionId: string, traceId: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.set(PREFIX_TRACE + missionId, traceId, STATE_TTL_SECONDS);
  }

  async getTraceId(missionId: string): Promise<string | undefined> {
    if (!this.cache) return undefined;
    return this.cache.get<string>(PREFIX_TRACE + missionId);
  }

  async deleteTraceId(missionId: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.del(PREFIX_TRACE + missionId);
  }

  // ==================== Kernel Process ID ====================

  async setKernelProcessId(
    missionId: string,
    processId: string,
  ): Promise<void> {
    if (!this.cache) return;
    await this.cache.set(
      PREFIX_KERNEL + missionId,
      processId,
      STATE_TTL_SECONDS,
    );
  }

  async getKernelProcessId(missionId: string): Promise<string | undefined> {
    if (!this.cache) return undefined;
    return this.cache.get<string>(PREFIX_KERNEL + missionId);
  }

  async deleteKernelProcessId(missionId: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.del(PREFIX_KERNEL + missionId);
  }

  // ==================== Heartbeat / Ownership ====================

  /**
   * 当前 pod 占有 mission：写入 heartbeat。
   * 不做 NX 校验 —— mission 是否真孤儿由 RecoveryService 基于 lastBeatAt + DB status 判断
   * （NX 在 cache-manager 抽象层不可靠，且 mission status 在 DB 是最终真相源）。
   */
  async claimOrBeat(missionId: string): Promise<void> {
    if (!this.cache) return;
    const existing = await this.cache.get<MissionHeartbeat>(
      PREFIX_HEARTBEAT + missionId,
    );
    const beat: MissionHeartbeat = {
      podId: this.podId,
      lastBeatAt: Date.now(),
      startedAt: existing?.startedAt ?? Date.now(),
    };
    await this.cache.set(
      PREFIX_HEARTBEAT + missionId,
      beat,
      HEARTBEAT_TTL_SECONDS,
    );
  }

  async getHeartbeat(missionId: string): Promise<MissionHeartbeat | undefined> {
    if (!this.cache) return undefined;
    return this.cache.get<MissionHeartbeat>(PREFIX_HEARTBEAT + missionId);
  }

  async releaseHeartbeat(missionId: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.del(PREFIX_HEARTBEAT + missionId);
  }

  // ==================== Cleanup ====================

  /** mission 终态时一次性清掉全部 runtime key */
  async clearAll(missionId: string): Promise<void> {
    if (!this.cache) return;
    await Promise.all([
      this.cache.del(PREFIX_STATE + missionId),
      this.cache.del(PREFIX_INPUT + missionId),
      this.cache.del(PREFIX_TRACE + missionId),
      this.cache.del(PREFIX_KERNEL + missionId),
      this.cache.del(PREFIX_HEARTBEAT + missionId),
    ]);
  }

  // ==================== Serialization ====================

  /**
   * MissionExecutionState 含 `intermediateOutputs: Map<string, unknown>`，
   * JSON.stringify 会把 Map 序列化成 {} —— 必须显式转 entries 数组。
   */
  private serialize(state: MissionExecutionState): SerializedMissionState {
    return {
      missionId: state.missionId,
      phase: state.phase,
      workflowState: state.workflowState,
      resourceUsage: state.resourceUsage,
      completedSteps: state.completedSteps,
      currentSteps: state.currentSteps,
      failedSteps: state.failedSteps,
      reviewResults: state.reviewResults,
      intermediateOutputsEntries: Array.from(
        state.intermediateOutputs.entries(),
      ),
      deliverables: state.deliverables,
    };
  }

  private deserialize(raw: SerializedMissionState): MissionExecutionState {
    return {
      missionId: raw.missionId,
      phase: raw.phase,
      workflowState:
        raw.workflowState as MissionExecutionState["workflowState"],
      resourceUsage:
        raw.resourceUsage as MissionExecutionState["resourceUsage"],
      completedSteps: raw.completedSteps,
      currentSteps: raw.currentSteps,
      failedSteps: raw.failedSteps,
      reviewResults:
        raw.reviewResults as MissionExecutionState["reviewResults"],
      intermediateOutputs: new Map(raw.intermediateOutputsEntries ?? []),
      deliverables: raw.deliverables as MissionExecutionState["deliverables"],
    };
  }
}
