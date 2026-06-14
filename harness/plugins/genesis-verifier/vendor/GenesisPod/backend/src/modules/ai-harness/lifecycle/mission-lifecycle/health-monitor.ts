/**
 * MissionHealthMonitor — 通用任务健康检测算法
 *
 * 沉淀自：ai-app/{app}/services/monitoring/research-mission-health.service.ts
 * 剥离对具体 DB 表的耦合，业务侧通过提供 fetcher / handler 注入。
 *
 * 用途：
 *   - 定时扫描 running mission，识别"无活动 > 阈值"的卡死任务
 *   - 区分"长任务正常运行"vs"真卡死"（看 lastActivityTime 而非 startedAt）
 *   - 触发 onTimeout 回调让业务侧 markFailed / 重启
 *
 * 业务侧职责：
 *   1. 实现 fetchRunningMissions —— 返回当前所有 running mission 元信息
 *   2. 实现 onTimeout —— 收到回调后业务侧执行 markFailed 等清理
 *   3. 用 Nest @Cron 或 setInterval 触发 runOnce()
 *
 * 设计：纯算法，无 IO。HealthMonitor.runOnce 内部不会主动写库。
 */

import { Injectable, Logger } from "@nestjs/common";

export interface MissionHealthSnapshot {
  missionId: string;
  userId?: string;
  status: string; // 业务侧的 status enum 字符串
  startedAt: Date;
  /** 最近一次活动时间（task 完成 / 事件 emit 等），缺失则 fallback 到 startedAt */
  lastActivityAt?: Date;
  /** 业务侧自定义元数据（用于 onTimeout 判断需要清理什么） */
  meta?: Record<string, unknown>;
}

export interface HealthCheckConfig {
  /** mission 启动后多久无活动算超时（默认 30 min）*/
  staleThresholdMs?: number;
  /** mission 总最大执行时长（默认 4h，超过强制超时即使有活动）*/
  maxWallTimeMs?: number;
  /** 是否仅在 status 命中 includeStatuses 时检查 */
  includeStatuses?: string[];
}

const DEFAULT_CONFIG: Required<HealthCheckConfig> = {
  staleThresholdMs: 30 * 60 * 1000,
  maxWallTimeMs: 4 * 60 * 60 * 1000,
  includeStatuses: ["running", "executing"],
};

export interface HealthVerdict {
  missionId: string;
  reason: "stale" | "wall-time-exceeded";
  ageMs: number;
  inactiveMs: number;
  snapshot: MissionHealthSnapshot;
}

export interface HealthCheckResult {
  totalChecked: number;
  unhealthyCount: number;
  verdicts: HealthVerdict[];
  timestamp: Date;
}

export interface MissionHealthMonitorOptions {
  /** 业务侧提供：返回当前所有需检查的 mission */
  fetchRunningMissions: () => Promise<MissionHealthSnapshot[]>;
  /** 检测到不健康时回调（业务侧执行 markFailed 等）*/
  onTimeout: (verdict: HealthVerdict) => Promise<void>;
  /** 健康检查行为参数 */
  config?: HealthCheckConfig;
}

@Injectable()
export class MissionHealthMonitor {
  private readonly log = new Logger(MissionHealthMonitor.name);
  private readonly config: Required<HealthCheckConfig>;
  private isRunning = false;

  constructor(private readonly opts: MissionHealthMonitorOptions) {
    this.config = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) };
  }

  /**
   * 单次健康检查 —— 业务侧用 @Cron 或 setInterval 触发。
   * 重入保护：上一次未完成时直接 skip。
   */
  async runOnce(): Promise<HealthCheckResult> {
    if (this.isRunning) {
      this.log.debug("[health] previous run still active, skipping");
      return {
        totalChecked: 0,
        unhealthyCount: 0,
        verdicts: [],
        timestamp: new Date(),
      };
    }
    this.isRunning = true;
    try {
      const missions = await this.opts.fetchRunningMissions();
      const verdicts: HealthVerdict[] = [];
      const now = Date.now();

      for (const m of missions) {
        if (!this.config.includeStatuses.includes(m.status)) continue;
        const v = this.evaluate(m, now);
        if (v) verdicts.push(v);
      }

      // 通知业务侧（顺序，单个失败不影响其他）
      for (const v of verdicts) {
        try {
          await this.opts.onTimeout(v);
        } catch (err) {
          this.log.warn(
            `[health] onTimeout callback failed for ${v.missionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return {
        totalChecked: missions.length,
        unhealthyCount: verdicts.length,
        verdicts,
        timestamp: new Date(),
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 单 mission 健康判断（纯函数，可单独测）。
   */
  evaluate(
    mission: MissionHealthSnapshot,
    now: number = Date.now(),
  ): HealthVerdict | null {
    const ageMs = now - mission.startedAt.getTime();
    const lastActivity =
      mission.lastActivityAt?.getTime() ?? mission.startedAt.getTime();
    const inactiveMs = now - lastActivity;

    if (ageMs > this.config.maxWallTimeMs) {
      return {
        missionId: mission.missionId,
        reason: "wall-time-exceeded",
        ageMs,
        inactiveMs,
        snapshot: mission,
      };
    }
    if (inactiveMs > this.config.staleThresholdMs) {
      return {
        missionId: mission.missionId,
        reason: "stale",
        ageMs,
        inactiveMs,
        snapshot: mission,
      };
    }
    return null;
  }
}
