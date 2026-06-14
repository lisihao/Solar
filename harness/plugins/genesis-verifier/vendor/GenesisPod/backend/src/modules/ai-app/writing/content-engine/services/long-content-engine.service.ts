/**
 * 长内容引擎服务 - Facade
 * Long Content Engine Service
 *
 * 整合所有长内容处理服务，提供统一的 API
 */

import { Injectable, Logger } from "@nestjs/common";
import { TaskGranularityService } from "./task-granularity.service";
import { ContinuationProtocolService } from "./continuation-protocol.service";
import { SlidingWindowContextService } from "./sliding-window-context.service";
import { QualityMonitorService } from "./quality-monitor.service";
import {
  GranularityLevel,
  TaskEstimate,
  TaskDecomposition,
  DecompositionValidation,
  GranularityPromptOptions,
  ContinuationState,
  ContinuationConfig,
  ContinuationPromptOptions,
  DEFAULT_CONTINUATION_CONFIG,
  WorkingMemoryContext,
  SlidingWindowConfig,
  QualityMetrics,
  QualityTrend,
  InterventionRecommendation,
  QualityDashboard,
  QualityMonitorConfig,
  ExpectedOutput,
} from "../interfaces";

/**
 * 项目配置
 */
export interface LongContentProjectConfig {
  projectId: string;
  projectTitle: string;
  projectDescription: string;
  totalTasks: number;
  granularityLevel: GranularityLevel;
  expectedWordsPerTask: number;
  slidingWindowConfig?: SlidingWindowConfig;
  qualityConfig?: QualityMonitorConfig;
  continuationConfig?: ContinuationConfig;
}

/**
 * 任务执行上下文
 */
export interface TaskExecutionContext {
  /** 工作记忆上下文 */
  workingMemory: WorkingMemoryContext;
  /** 粒度约束 Prompt */
  granularityPrompt: string;
  /** 质量提醒 Prompt（如果需要） */
  qualityReminder: string;
  /** 当前质量趋势 */
  qualityTrend?: QualityTrend;
}

/**
 * 任务完成结果
 */
export interface TaskCompletionResult {
  /** 是否需要续写 */
  needsContinuation: boolean;
  /** 续写状态（如果需要续写） */
  continuationState?: ContinuationState;
  /** 质量指标 */
  qualityMetrics: QualityMetrics;
  /** 质量趋势 */
  qualityTrend: QualityTrend;
  /** 干预建议（如果有） */
  intervention?: InterventionRecommendation;
  /** 最终内容（如果完成） */
  finalContent?: string;
}

@Injectable()
export class LongContentEngineService {
  private readonly logger = new Logger(LongContentEngineService.name);

  /** 项目配置存储 */
  private projectConfigs = new Map<string, LongContentProjectConfig>();

  constructor(
    private readonly granularityService: TaskGranularityService,
    private readonly continuationService: ContinuationProtocolService,
    private readonly slidingWindowService: SlidingWindowContextService,
    private readonly qualityService: QualityMonitorService,
  ) {}

  // ============ 项目管理 ============

  /**
   * 初始化长内容项目
   */
  async initProject(config: LongContentProjectConfig): Promise<void> {
    this.logger.log(`Initializing long content project: ${config.projectId}`);

    // 存储配置
    this.projectConfigs.set(config.projectId, config);

    // 初始化滑动窗口上下文
    this.slidingWindowService.initProject(config.projectId, {
      title: config.projectTitle,
      description: config.projectDescription,
      totalTasks: config.totalTasks,
    });

    // 初始化质量监控
    this.qualityService.initProject(config.projectId, {
      title: config.projectTitle,
      totalTasks: config.totalTasks,
    });

    this.logger.log(`Project initialized: ${config.projectId}`);
  }

  /**
   * 清理项目
   */
  clearProject(projectId: string): void {
    this.projectConfigs.delete(projectId);
    this.slidingWindowService.clearProject(projectId);
    this.qualityService.clearProject(projectId);
    this.logger.log(`Project cleared: ${projectId}`);
  }

  /**
   * 更新项目总任务数
   * 当实际任务数与初始预估不同时调用
   */
  updateTotalTasks(projectId: string, totalTasks: number): void {
    const config = this.projectConfigs.get(projectId);
    if (config) {
      config.totalTasks = totalTasks;
    }
    this.qualityService.updateTotalTasks(projectId, totalTasks);
    this.logger.log(
      `Updated totalTasks for project ${projectId}: ${totalTasks}`,
    );
  }

  /**
   * 获取项目配置
   */
  getProjectConfig(projectId: string): LongContentProjectConfig | undefined {
    return this.projectConfigs.get(projectId);
  }

  // ============ 任务分解 ============

  /**
   * 预估任务规模
   */
  async estimateTaskScale(
    userRequirement: string,
    options?: {
      existingContent?: string;
      totalTargetWords?: number;
      preferredGranularity?: GranularityLevel;
    },
  ): Promise<TaskEstimate> {
    return this.granularityService.estimateTaskScale(userRequirement, options);
  }

  /**
   * 构建粒度约束 Prompt
   */
  buildGranularityConstraintPrompt(
    projectId: string,
    options?: GranularityPromptOptions,
  ): string {
    const config = this.projectConfigs.get(projectId);
    if (!config) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const constraint = this.granularityService.buildDefaultConstraint(
      config.granularityLevel,
      {
        expectedTotalTasks: config.totalTasks,
        maxOutputPerTask: config.expectedWordsPerTask * 2,
      },
    );

    return this.granularityService.buildGranularityConstraintPrompt(
      constraint,
      options,
    );
  }

  /**
   * 验证任务分解
   */
  validateTaskDecomposition(
    projectId: string,
    tasks: TaskDecomposition[],
  ): DecompositionValidation {
    const config = this.projectConfigs.get(projectId);
    if (!config) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const constraint = this.granularityService.buildDefaultConstraint(
      config.granularityLevel,
      {
        expectedTotalTasks: config.totalTasks,
        maxOutputPerTask: config.expectedWordsPerTask * 2,
      },
    );

    return this.granularityService.validateDecomposition(tasks, constraint);
  }

  // ============ 任务执行 ============

  /**
   * 构建任务执行上下文
   */
  async buildTaskExecutionContext(
    projectId: string,
    taskId: string,
    currentTaskContent: string,
    options?: {
      relevantQuery?: string;
    },
  ): Promise<TaskExecutionContext> {
    const config = this.projectConfigs.get(projectId);
    if (!config) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // 构建工作记忆
    const workingMemory = await this.slidingWindowService.buildWorkingMemory(
      projectId,
      taskId,
      currentTaskContent,
      {
        config: config.slidingWindowConfig,
        relevantQuery: options?.relevantQuery,
      },
    );

    // 构建粒度约束 Prompt
    const granularityPrompt = this.buildGranularityConstraintPrompt(projectId);

    // 获取质量趋势和提醒
    let qualityReminder = "";
    let qualityTrend: QualityTrend | undefined;

    try {
      const dashboard = this.qualityService.getDashboard(projectId);
      qualityTrend = dashboard.quality.trend;
      qualityReminder =
        this.qualityService.buildQualityReminderPrompt(qualityTrend);
    } catch {
      // 项目可能刚初始化，没有质量数据
    }

    return {
      workingMemory,
      granularityPrompt,
      qualityReminder,
      qualityTrend,
    };
  }

  /**
   * 处理任务完成
   */
  async processTaskCompletion(
    projectId: string,
    taskId: string,
    taskTitle: string,
    taskResult: string,
    expected: ExpectedOutput,
  ): Promise<TaskCompletionResult> {
    const config = this.projectConfigs.get(projectId);
    if (!config) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // 1. 检测是否需要续写
    const continuationConfig =
      config.continuationConfig || DEFAULT_CONTINUATION_CONFIG;
    const detectionResult = this.continuationService.detectContinuation(
      taskResult,
      {
        minWords: expected.minWords || config.expectedWordsPerTask,
        hasStructuredEnd: expected.requireStructuredEnd,
      },
      continuationConfig,
    );

    // 2. 如果需要续写
    if (detectionResult.needsContinuation) {
      // 检查是否已有续写状态
      let state = this.continuationService.getState(taskId);

      if (!state) {
        // 初始化续写状态
        state = this.continuationService.initState(taskId, taskResult, {
          totalWords: expected.minWords || config.expectedWordsPerTask,
          maxContinuations: continuationConfig.maxContinuations,
        });
      } else {
        // 更新续写状态
        state = this.continuationService.updateState(
          taskId,
          taskResult,
          detectionResult,
        );
      }

      // 检查是否应该停止续写
      const stopCondition =
        this.continuationService.shouldStopContinuation(state);

      if (!stopCondition.shouldStop) {
        return {
          needsContinuation: true,
          continuationState: state,
          qualityMetrics: await this.qualityService.evaluateTask(
            state.accumulatedResult,
            expected,
            config.qualityConfig,
          ),
          qualityTrend: this.getEmptyTrend(),
        };
      }

      // 续写完成，使用累积结果
      taskResult =
        this.continuationService.getFinalResult(taskId) || taskResult;
      this.continuationService.clearState(taskId);
    }

    // 3. 评估质量
    const qualityMetrics = await this.qualityService.evaluateTask(
      taskResult,
      expected,
      config.qualityConfig,
    );

    // 4. 更新质量趋势
    const qualityTrend = this.qualityService.updateTrend(
      projectId,
      taskId,
      taskTitle,
      qualityMetrics,
      config.qualityConfig,
    );

    // 5. 获取干预建议
    const intervention = this.qualityService.getInterventionRecommendation(
      projectId,
      qualityTrend,
      config.qualityConfig,
    );

    // 6. 应用自动干预
    if (intervention?.autoApply) {
      await this.qualityService.applyIntervention(projectId, intervention);
    }

    // 7. 滑动窗口更新
    await this.slidingWindowService.slideWindow(
      projectId,
      {
        id: taskId,
        title: taskTitle,
        result: taskResult,
      },
      config.slidingWindowConfig,
    );

    return {
      needsContinuation: false,
      qualityMetrics,
      qualityTrend,
      intervention: intervention || undefined,
      finalContent: taskResult,
    };
  }

  /**
   * 构建续写 Prompt
   */
  buildContinuationPrompt(
    taskId: string,
    options: ContinuationPromptOptions,
  ): string {
    const state = this.continuationService.getState(taskId);
    if (!state) {
      throw new Error(`No continuation state found for task: ${taskId}`);
    }

    return this.continuationService.buildContinuationPrompt(state, options);
  }

  // ============ 报告生成 ============

  /**
   * 获取所有完成任务的完整内容（用于最终报告）
   */
  getAllCompletedTaskContents(projectId: string): Array<{
    taskId: string;
    title: string;
    content: string;
  }> {
    return this.slidingWindowService.getAllCompletedTaskContents(projectId);
  }

  /**
   * 获取质量仪表盘
   */
  getQualityDashboard(projectId: string): QualityDashboard {
    return this.qualityService.getDashboard(projectId);
  }

  /**
   * 构建完整报告
   */
  async buildFinalReport(projectId: string): Promise<{
    fullContent: string;
    dashboard: QualityDashboard;
  }> {
    const config = this.projectConfigs.get(projectId);
    if (!config) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // 获取所有任务内容
    const taskContents = this.getAllCompletedTaskContents(projectId);

    // 获取质量仪表盘
    const dashboard = this.getQualityDashboard(projectId);

    // 构建完整报告
    const chapters = taskContents.map((task, index) => {
      const wordCount = task.content.replace(/\s/g, "").length;
      return `## 第${index + 1}章：${task.title}
> 字数：${wordCount} 字

${task.content}`;
    });

    const fullContent = `# ${config.projectTitle}

## 执行总结

| 指标 | 数据 |
|------|------|
| 总任务数 | ${dashboard.progress.completedTasks}/${dashboard.progress.totalTasks} |
| 完成率 | ${dashboard.progress.percentage.toFixed(1)}% |
| 总字数 | ${dashboard.wordStats.totalWords} 字 |
| 平均质量分 | ${dashboard.quality.overallScore.toFixed(1)}/10 |
| 质量趋势 | ${dashboard.quality.trend.trend} |

---

${chapters.join("\n\n---\n\n")}

---

_报告生成时间：${new Date().toLocaleString()}_
`;

    return {
      fullContent,
      dashboard,
    };
  }

  // ============ 私有方法 ============

  /**
   * 获取空趋势
   */
  private getEmptyTrend(): QualityTrend {
    return {
      trend: "stable",
      trendConfidence: 0,
      recentScores: [],
      averageScore: 0,
      scoreStdDev: 0,
      consecutiveDeclines: 0,
      consecutiveBelowThreshold: 0,
      calculatedAt: new Date(),
    };
  }
}
