/**
 * Mission State Manager
 *
 * 统一管理 Mission 执行过程中的并发控制状态
 *
 * ★ 重构后：作为 AI Engine ExecutionStateManager 的薄包装器
 *   - 保持原有接口不变（StateStats, 方法签名）
 *   - 委托给 ExecutionStateManager 执行
 */

import { Injectable, Logger } from "@nestjs/common";
import { StateCategory } from "@/modules/ai-harness/lifecycle/supervisor/process-supervisor.service";
import type { ExecutionStateStats } from "@/modules/ai-harness/lifecycle/supervisor/process-supervisor.service";
import { AgentFacade } from "@/modules/ai-harness/facade/domain/agent.facade";

/**
 * 状态统计信息 (保持原有接口)
 * @deprecated 推荐直接使用 ExecutionStateStats
 */
export interface StateStats {
  executingTasks: number;
  executingMissions: number;
  revisingTasks: number;
  oldestTaskAge: number | null;
  oldestMissionAge: number | null;
  oldestRevisionAge: number | null;
}

/**
 * Mission 状态管理器
 *
 * 提供 Mission 专用的状态管理能力
 * 内部委托给 AI Engine 的 ExecutionStateManager
 */
@Injectable()
export class MissionStateManager {
  private readonly logger = new Logger(MissionStateManager.name);

  constructor(private readonly agentFacade: AgentFacade) {
    this.logger.log(
      "[MissionStateManager] Initialized (delegating to ExecutionStateManager via AgentFacade)",
    );
  }

  // ==================== 任务执行状态 ====================

  /**
   * 标记任务开始执行
   */
  startTask(taskId: string, description?: string): boolean {
    return (
      this.agentFacade.execStateManager?.startTask(taskId, description) ?? false
    );
  }

  /**
   * 标记任务执行完成
   */
  finishTask(taskId: string): void {
    this.agentFacade.execStateManager?.finishTask(taskId);
  }

  /**
   * 检查任务是否正在执行
   */
  isTaskExecuting(taskId: string): boolean {
    return this.agentFacade.execStateManager?.isTaskExecuting(taskId) ?? false;
  }

  // ==================== Mission 执行状态 ====================

  /**
   * 标记 Mission 开始执行 executeNextTasks
   */
  startMissionExecution(missionId: string, description?: string): boolean {
    return (
      this.agentFacade.execStateManager?.startWorkflow(
        missionId,
        description,
      ) ?? false
    );
  }

  /**
   * 标记 Mission 执行完成
   */
  finishMissionExecution(missionId: string): void {
    this.agentFacade.execStateManager?.finishWorkflow(missionId);
  }

  /**
   * 检查 Mission 是否正在执行
   */
  isMissionExecuting(missionId: string): boolean {
    return (
      this.agentFacade.execStateManager?.isWorkflowExecuting(missionId) ?? false
    );
  }

  // ==================== 任务修订状态 ====================

  /**
   * 标记任务开始修订
   */
  startRevision(taskId: string, description?: string): boolean {
    return (
      this.agentFacade.execStateManager?.startRevision(taskId, description) ??
      false
    );
  }

  /**
   * 标记任务修订完成
   */
  finishRevision(taskId: string): void {
    this.agentFacade.execStateManager?.finishRevision(taskId);
  }

  /**
   * 检查任务是否正在修订
   */
  isRevisionInProgress(taskId: string): boolean {
    return (
      this.agentFacade.execStateManager?.isRevisionInProgress(taskId) ?? false
    );
  }

  // ==================== 统计和调试 ====================

  /**
   * 获取状态统计信息
   * 转换为原有的 StateStats 格式
   */
  getStats(): StateStats {
    const stats = this.agentFacade.execStateManager?.getStats();

    if (!stats) {
      return {
        executingTasks: 0,
        executingMissions: 0,
        revisingTasks: 0,
        oldestTaskAge: null,
        oldestMissionAge: null,
        oldestRevisionAge: null,
      };
    }

    return {
      executingTasks: stats.activeCounts[StateCategory.TASK] || 0,
      executingMissions: stats.activeCounts[StateCategory.WORKFLOW] || 0,
      revisingTasks: stats.activeCounts[StateCategory.REVISION] || 0,
      oldestTaskAge: stats.oldestAges[StateCategory.TASK] ?? null,
      oldestMissionAge: stats.oldestAges[StateCategory.WORKFLOW] ?? null,
      oldestRevisionAge: stats.oldestAges[StateCategory.REVISION] ?? null,
    };
  }

  /**
   * 获取所有正在执行的任务 ID
   */
  getExecutingTaskIds(): string[] {
    return this.agentFacade.execStateManager?.getExecutingTaskIds() ?? [];
  }

  /**
   * 获取所有正在执行的 Mission ID
   */
  getExecutingMissionIds(): string[] {
    return this.agentFacade.execStateManager?.getExecutingMissionIds() ?? [];
  }

  /**
   * 获取所有正在修订的任务 ID
   */
  getRevisingTaskIds(): string[] {
    return this.agentFacade.execStateManager?.getRevisingTaskIds() ?? [];
  }

  // ==================== 清理方法 ====================

  /**
   * 强制清理所有状态（用于测试或紧急情况）
   */
  forceCleanAll(): void {
    this.agentFacade.execStateManager?.forceCleanAll();
  }

  /**
   * 手动触发清理（用于 admin 操作）
   */
  triggerCleanup(): { before: StateStats; after: StateStats } {
    const emptyStats: StateStats = {
      executingTasks: 0,
      executingMissions: 0,
      revisingTasks: 0,
      oldestTaskAge: null,
      oldestMissionAge: null,
      oldestRevisionAge: null,
    };

    const result = this.agentFacade.execStateManager?.triggerCleanup();
    if (!result) {
      return { before: emptyStats, after: emptyStats };
    }

    // 转换为 StateStats 格式
    const convertStats = (stats: ExecutionStateStats): StateStats => ({
      executingTasks: stats.activeCounts[StateCategory.TASK] || 0,
      executingMissions: stats.activeCounts[StateCategory.WORKFLOW] || 0,
      revisingTasks: stats.activeCounts[StateCategory.REVISION] || 0,
      oldestTaskAge: stats.oldestAges[StateCategory.TASK] ?? null,
      oldestMissionAge: stats.oldestAges[StateCategory.WORKFLOW] ?? null,
      oldestRevisionAge: stats.oldestAges[StateCategory.REVISION] ?? null,
    });

    return {
      before: convertStats(result.before),
      after: convertStats(result.after),
    };
  }
}
