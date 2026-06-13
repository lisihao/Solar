/**
 * Research Realtime Adapter
 *
 * 将 AI Research 的实时事件需求适配到 AI Engine RealtimeModule
 * 提供统一的进度追踪和事件发射能力
 *
 * ★ 优雅降级：如果 Engine Realtime 服务不可用，静默忽略操作
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { AgentFacade } from "@/modules/ai-harness/facade";
import type {
  RoomConfig,
  EngineEvent,
} from "@/modules/ai-harness/facade";
import { ResearchEventType } from "./research-event-emitter.service";

/**
 * 研究任务阶段定义
 */
const RESEARCH_PHASES = [
  { id: "planning", name: "Leader 规划", weight: 0.1 },
  { id: "researching", name: "维度研究", weight: 0.6 },
  { id: "reviewing", name: "质量审查", weight: 0.15 },
  { id: "synthesizing", name: "报告撰写", weight: 0.15 },
];

/**
 * 快速研究阶段定义
 */
const QUICK_RESEARCH_PHASES = [
  { id: "planning", name: "Leader 规划", weight: 0.15 },
  { id: "researching", name: "维度研究", weight: 0.7 },
  { id: "synthesizing", name: "报告撰写", weight: 0.15 },
];

/**
 * 订阅注册表项
 */
interface SubscriptionEntry {
  subscriptionId: string;
  entityId: string;
  entityType: "topic" | "mission";
  unsubscribe: () => void;
  createdAt: Date;
}

@Injectable()
export class ResearchRealtimeAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResearchRealtimeAdapter.name);
  /** ★ 是否启用实时推送（Engine 服务可用时为 true） */
  private readonly isEnabled: boolean;
  /** ★ 订阅注册表：防止内存泄漏 */
  private readonly subscriptionRegistry = new Map<string, SubscriptionEntry>();
  /** 订阅最大存活时间：1 小时 */
  private readonly SUBSCRIPTION_TTL_MS = 60 * 60 * 1000;
  /** 清理间隔：10 分钟 */
  private cleanupIntervalId?: NodeJS.Timeout;

  constructor(@Optional() private readonly agentFacade?: AgentFacade) {
    // ★ 检查 Engine 服务是否可用
    this.isEnabled = !!(
      agentFacade?.realtimeEmitter && agentFacade?.realtimeProgress
    );
  }

  onModuleInit() {
    if (this.isEnabled) {
      this.logger.log(
        "ResearchRealtimeAdapter initialized - using AI Engine RealtimeModule",
      );
      // ★ 启动定期清理任务
      this.startCleanupTask();
    } else {
      this.logger.warn(
        "ResearchRealtimeAdapter running in DEGRADED mode - Engine Realtime services not available",
      );
    }
  }

  /**
   * 启动定期清理过期订阅的任务
   */
  private startCleanupTask(): void {
    this.cleanupIntervalId = setInterval(
      () => {
        this.cleanupStaleSubscriptions();
      },
      10 * 60 * 1000,
    ).unref(); // 每 10 分钟
  }

  /**
   * 清理过期订阅
   */
  private cleanupStaleSubscriptions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, entry] of this.subscriptionRegistry) {
      if (now - entry.createdAt.getTime() > this.SUBSCRIPTION_TTL_MS) {
        entry.unsubscribe();
        this.subscriptionRegistry.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(
        `Cleaned up ${cleaned} stale subscriptions, remaining: ${this.subscriptionRegistry.size}`,
      );
    }
  }

  /**
   * 模块销毁时清理所有订阅
   */
  onModuleDestroy(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }

    // 清理所有订阅
    for (const entry of this.subscriptionRegistry.values()) {
      entry.unsubscribe();
    }
    this.subscriptionRegistry.clear();
    this.logger.debug("All subscriptions cleaned up on module destroy");
  }

  /**
   * 创建专题房间配置
   */
  private createTopicRoomConfig(topicId: string): RoomConfig {
    return {
      roomId: `research:topic:${topicId}`,
      roomType: "topic",
      entityId: topicId,
    };
  }

  /**
   * 创建任务房间配置
   */
  private createMissionRoomConfig(missionId: string): RoomConfig {
    return {
      roomId: `research:mission:${missionId}`,
      roomType: "mission",
      entityId: missionId,
    };
  }

  // ==================== 进度追踪 ====================

  /**
   * 启动任务进度追踪
   */
  startMissionTracking(
    topicId: string,
    missionId: string,
    isQuickMode: boolean = false,
  ): void {
    if (!this.isEnabled || !this.agentFacade?.realtimeProgress) return; // ★ 优雅降级

    const phases = isQuickMode ? QUICK_RESEARCH_PHASES : RESEARCH_PHASES;
    const roomConfig = this.createMissionRoomConfig(missionId);

    this.agentFacade?.realtimeProgress?.create({
      id: missionId,
      type: "research_mission",
      name: `研究任务 ${missionId}`,
      roomConfig,
      phases,
      metadata: { topicId, isQuickMode },
    });

    this.agentFacade?.realtimeProgress?.start(missionId);
    this.logger.debug(
      `Started tracking mission ${missionId} with ${phases.length} phases`,
    );
  }

  /**
   * 开始阶段
   */
  startPhase(missionId: string, phaseId: string, message?: string): void {
    if (!this.isEnabled || !this.agentFacade?.realtimeProgress) return; // ★ 优雅降级
    this.agentFacade?.realtimeProgress?.startPhase(missionId, phaseId, message);
  }

  /**
   * 更新阶段进度
   * @returns 当前总体进度
   */
  updatePhaseProgress(
    missionId: string,
    phaseId: string,
    progress: number,
    message?: string,
  ): number {
    if (!this.isEnabled || !this.agentFacade?.realtimeProgress) return 0; // ★ 优雅降级

    this.agentFacade?.realtimeProgress?.updatePhaseProgress(
      missionId,
      phaseId,
      progress,
      message,
    );
    const progressEvent =
      this.agentFacade?.realtimeProgress?.getProgress(missionId);
    return progressEvent?.progress ?? 0;
  }

  /**
   * 完成阶段
   */
  completePhase(missionId: string, phaseId: string, message?: string): void {
    if (!this.isEnabled || !this.agentFacade?.realtimeProgress) return; // ★ 优雅降级
    this.agentFacade?.realtimeProgress?.completePhase(
      missionId,
      phaseId,
      message,
    );
  }

  /**
   * 获取当前进度
   */
  getMissionProgress(missionId: string): number {
    if (!this.isEnabled || !this.agentFacade?.realtimeProgress) return 0; // ★ 优雅降级
    const progress = this.agentFacade?.realtimeProgress?.getProgress(missionId);
    return progress?.progress ?? 0;
  }

  /**
   * 完成任务追踪
   */
  completeMissionTracking(missionId: string, message?: string): void {
    if (!this.isEnabled || !this.agentFacade?.realtimeProgress) return; // ★ 优雅降级
    this.agentFacade?.realtimeProgress?.complete(missionId, message);
    this.logger.debug(`Completed tracking for mission ${missionId}`);
  }

  /**
   * 任务失败
   */
  failMissionTracking(missionId: string, error: string): void {
    if (!this.isEnabled || !this.agentFacade?.realtimeProgress) return; // ★ 优雅降级
    this.agentFacade?.realtimeProgress?.fail(missionId, error);
    this.logger.debug(`Failed tracking for mission ${missionId}: ${error}`);
  }

  // ==================== 事件发射 ====================

  /**
   * 创建引擎事件
   */
  private createEvent<T>(
    type: string,
    payload: T,
    topicId?: string,
    missionId?: string,
  ): EngineEvent<T> {
    return {
      type,
      payload,
      metadata: {
        timestamp: new Date(),
        source: "research",
        correlationId: missionId,
        sessionId: topicId,
      },
    };
  }

  /**
   * 发送事件到专题房间
   */
  emitToTopic<T>(topicId: string, eventType: string, data: T): void {
    if (!this.isEnabled || !this.agentFacade?.realtimeEmitter) return; // ★ 优雅降级
    const roomConfig = this.createTopicRoomConfig(topicId);
    const event = this.createEvent(eventType, data, topicId);
    this.agentFacade?.realtimeEmitter?.emitToRoom(roomConfig, event);
  }

  /**
   * 发送事件到任务房间
   */
  emitToMission<T>(missionId: string, eventType: string, data: T): void {
    if (!this.isEnabled || !this.agentFacade?.realtimeEmitter) return; // ★ 优雅降级
    const roomConfig = this.createMissionRoomConfig(missionId);
    const event = this.createEvent(eventType, data, undefined, missionId);
    this.agentFacade?.realtimeEmitter?.emitToRoom(roomConfig, event);
  }

  /**
   * 同时发送到专题和任务房间
   */
  emitToBoth<T>(
    topicId: string,
    missionId: string,
    eventType: string,
    data: T,
  ): void {
    if (!this.isEnabled) return; // ★ 优雅降级
    this.emitToTopic(topicId, eventType, data);
    this.emitToMission(missionId, eventType, data);
  }

  // ==================== 便捷方法 ====================

  /**
   * 发送任务开始事件
   */
  emitMissionStarted(
    topicId: string,
    missionId: string,
    leaderModel?: string,
    isQuickMode: boolean = false,
  ): void {
    this.startMissionTracking(topicId, missionId, isQuickMode);
    this.startPhase(missionId, "planning", "Leader 开始规划");

    this.emitToBoth(topicId, missionId, ResearchEventType.MISSION_STARTED, {
      missionId,
      leaderModel,
      message: "研究任务已启动，Leader 正在分析...",
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 发送进度更新事件（带进度追踪）
   */
  emitMissionProgress(
    topicId: string,
    missionId: string,
    phase: string,
    phaseProgress: number,
    message: string,
    extras?: Record<string, unknown>,
  ): void {
    const overall = this.updatePhaseProgress(
      missionId,
      phase,
      phaseProgress,
      message,
    );

    this.emitToBoth(topicId, missionId, ResearchEventType.MISSION_PROGRESS, {
      missionId,
      phase,
      phaseProgress,
      progress: overall,
      message,
      timestamp: new Date().toISOString(),
      ...extras,
    });
  }

  /**
   * 发送任务完成事件
   */
  emitMissionCompleted(
    topicId: string,
    missionId: string,
    stats: {
      completedTasks: number;
      totalTasks: number;
      totalWords?: number;
    },
  ): void {
    this.completeMissionTracking(missionId, "研究完成");

    this.emitToBoth(topicId, missionId, ResearchEventType.MISSION_COMPLETED, {
      missionId,
      ...stats,
      message: `研究完成，共完成 ${stats.completedTasks} 个任务`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 发送任务失败事件
   */
  emitMissionFailed(topicId: string, missionId: string, error: string): void {
    this.failMissionTracking(missionId, error);

    this.emitToBoth(topicId, missionId, ResearchEventType.MISSION_FAILED, {
      missionId,
      error,
      message: `研究失败: ${error}`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 发送维度研究进度事件
   */
  emitDimensionProgress(
    topicId: string,
    missionId: string,
    dimensionName: string,
    progress: number,
    currentStep: string,
  ): void {
    const overall = this.updatePhaseProgress(
      missionId,
      "researching",
      progress,
      currentStep,
    );

    this.emitToBoth(
      topicId,
      missionId,
      ResearchEventType.DIMENSION_RESEARCH_PROGRESS,
      {
        dimensionName,
        progress,
        currentStep,
        overallProgress: overall,
        message: `「${dimensionName}」研究进度 ${progress}%`,
        timestamp: new Date().toISOString(),
      },
    );
  }

  /**
   * 发送 Agent 工作状态事件
   */
  emitAgentWorking(
    topicId: string,
    missionId: string,
    agentData: {
      agentId: string;
      agentName: string;
      agentRole: string;
      status: "working" | "completed" | "failed";
      taskDescription?: string;
      progress?: number;
      modelId?: string;
    },
  ): void {
    this.emitToBoth(topicId, missionId, ResearchEventType.AGENT_WORKING, {
      ...agentData,
      timestamp: new Date().toISOString(),
    });
  }

  // ==================== 订阅管理 ====================

  /**
   * 生成唯一订阅 ID
   */
  private generateSubscriptionId(
    entityType: "topic" | "mission",
    entityId: string,
  ): string {
    return `${entityType}:${entityId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 订阅专题事件
   * ★ 使用订阅注册表防止内存泄漏
   * @returns 取消订阅函数
   */
  subscribeToTopic(
    topicId: string,
    callback: (eventType: string, data: unknown) => void,
  ): () => void {
    // ★ 优雅降级：如果服务不可用，返回空操作
    if (!this.isEnabled || !this.agentFacade?.realtimeEmitter) {
      return () => {};
    }

    const subscriptionId = this.generateSubscriptionId("topic", topicId);

    // 订阅所有研究相关事件
    const unsubscribers = Object.values(ResearchEventType).map((eventType) =>
      this.agentFacade?.realtimeEmitter?.subscribe(
        eventType,
        (event: EngineEvent) => {
          // 检查事件是否属于该专题
          if (event.metadata?.sessionId === topicId) {
            callback(event.type, event.payload);
          }
        },
      ),
    );

    // 创建取消订阅函数
    const unsubscribe = () => {
      unsubscribers.forEach((unsub) => unsub?.());
      this.subscriptionRegistry.delete(subscriptionId);
    };

    // ★ 注册到订阅注册表
    this.subscriptionRegistry.set(subscriptionId, {
      subscriptionId,
      entityId: topicId,
      entityType: "topic",
      unsubscribe,
      createdAt: new Date(),
    });

    this.logger.debug(
      `Subscribed to topic ${topicId}, total subscriptions: ${this.subscriptionRegistry.size}`,
    );

    return unsubscribe;
  }

  /**
   * 订阅任务事件
   * ★ 使用订阅注册表防止内存泄漏
   * @returns 取消订阅函数
   */
  subscribeToMission(
    missionId: string,
    callback: (eventType: string, data: unknown) => void,
  ): () => void {
    // ★ 优雅降级：如果服务不可用，返回空操作
    if (!this.isEnabled || !this.agentFacade?.realtimeEmitter) {
      return () => {};
    }

    const subscriptionId = this.generateSubscriptionId("mission", missionId);

    const unsubscribers = Object.values(ResearchEventType).map((eventType) =>
      this.agentFacade?.realtimeEmitter?.subscribe(
        eventType,
        (event: EngineEvent) => {
          if (event.metadata?.correlationId === missionId) {
            callback(event.type, event.payload);
          }
        },
      ),
    );

    // 创建取消订阅函数
    const unsubscribe = () => {
      unsubscribers.forEach((unsub) => unsub?.());
      this.subscriptionRegistry.delete(subscriptionId);
    };

    // ★ 注册到订阅注册表
    this.subscriptionRegistry.set(subscriptionId, {
      subscriptionId,
      entityId: missionId,
      entityType: "mission",
      unsubscribe,
      createdAt: new Date(),
    });

    this.logger.debug(
      `Subscribed to mission ${missionId}, total subscriptions: ${this.subscriptionRegistry.size}`,
    );

    return unsubscribe;
  }

  /**
   * 获取当前订阅数量（用于监控）
   */
  getSubscriptionCount(): number {
    return this.subscriptionRegistry.size;
  }

  /**
   * 手动取消指定实体的所有订阅
   */
  unsubscribeAll(entityType: "topic" | "mission", entityId: string): void {
    for (const [id, entry] of this.subscriptionRegistry) {
      if (entry.entityType === entityType && entry.entityId === entityId) {
        entry.unsubscribe();
        this.subscriptionRegistry.delete(id);
      }
    }
  }
}
