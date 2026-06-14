/**
 * 质量监控服务
 * Quality Monitor Service
 *
 * 核心职责：
 * 1. 评估任务质量
 * 2. 追踪质量趋势
 * 3. 生成干预建议
 * 4. 提供质量仪表盘
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  QualityMetrics,
  QualityTrend,
  TrendDirection,
  InterventionRecommendation,
  InterventionRecord,
  TaskAnomaly,
  QualityDashboard,
  QualityMonitorConfig,
  ExpectedOutput,
  DEFAULT_QUALITY_MONITOR_CONFIG,
} from "../interfaces";
import { hasStructuredEnding } from "../constants";
import { AiChatService } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

/**
 * 项目质量存储
 */
interface ProjectQualityStore {
  projectId: string;
  projectTitle: string;
  totalTasks: number;
  completedTasks: number;
  taskMetrics: Map<string, QualityMetrics>;
  scoreHistory: number[];
  anomalies: TaskAnomaly[];
  interventions: InterventionRecord[];
  wordStats: {
    totalWords: number;
    taskWords: Map<string, number>;
  };
  createdAt: Date;
  lastUpdatedAt: Date;
}

@Injectable()
export class QualityMonitorService {
  private readonly logger = new Logger(QualityMonitorService.name);

  /** 项目质量存储 */
  private projectStores = new Map<string, ProjectQualityStore>();

  /** 干预计数器 */
  private interventionCounter = 0;

  constructor(private readonly aiChatService: AiChatService) {}

  /**
   * 初始化项目质量监控
   */
  initProject(
    projectId: string,
    projectInfo: {
      title: string;
      totalTasks: number;
    },
  ): void {
    const store: ProjectQualityStore = {
      projectId,
      projectTitle: projectInfo.title,
      totalTasks: projectInfo.totalTasks,
      completedTasks: 0,
      taskMetrics: new Map(),
      scoreHistory: [],
      anomalies: [],
      interventions: [],
      wordStats: {
        totalWords: 0,
        taskWords: new Map(),
      },
      createdAt: new Date(),
      lastUpdatedAt: new Date(),
    };

    this.projectStores.set(projectId, store);
    this.logger.log(`Initialized quality monitor for project: ${projectId}`);
  }

  /**
   * 更新项目总任务数
   * 当实际任务数与初始预估不同时调用
   */
  updateTotalTasks(projectId: string, totalTasks: number): void {
    const store = this.projectStores.get(projectId);
    if (!store) {
      this.logger.warn(
        `Cannot update totalTasks: project not found: ${projectId}`,
      );
      return;
    }

    const oldTotal = store.totalTasks;
    store.totalTasks = totalTasks;
    store.lastUpdatedAt = new Date();

    this.logger.log(
      `Updated totalTasks for project ${projectId}: ${oldTotal} -> ${totalTasks}`,
    );
  }

  /**
   * 评估任务质量
   */
  async evaluateTask(
    content: string,
    expected: ExpectedOutput,
    config: QualityMonitorConfig = DEFAULT_QUALITY_MONITOR_CONFIG,
  ): Promise<QualityMetrics> {
    const wordCount = this.countWords(content);
    const hasStructEnd = hasStructuredEnding(content);

    // 计算完成度
    const completionRatio = expected.minWords
      ? Math.min(1, wordCount / expected.minWords)
      : 1;

    // 基础分数
    let overallScore = 5; // 基础分

    // 字数评分
    if (expected.minWords) {
      if (wordCount >= expected.minWords) {
        overallScore += 2;
      } else if (wordCount >= expected.minWords * 0.8) {
        overallScore += 1;
      } else if (wordCount < expected.minWords * 0.5) {
        overallScore -= 2;
      }
    }

    // 结构完整性评分
    if (hasStructEnd) {
      overallScore += 1;
    }

    // 如果启用 AI 评估
    let coherenceScore: number | undefined;
    let relevanceScore: number | undefined;
    let styleConsistency: number | undefined;

    if (config.aiEvaluation.enabled) {
      try {
        const aiScores = await this.aiEvaluate(content, expected);
        coherenceScore = aiScores.coherence;
        relevanceScore = aiScores.relevance;
        styleConsistency = aiScores.style;

        // 将 AI 评分纳入总分
        const aiAverage =
          (coherenceScore + relevanceScore + styleConsistency) / 3;
        overallScore = (overallScore + aiAverage) / 2;
      } catch (error) {
        this.logger.warn(`AI evaluation failed: ${error}`);
      }
    }

    // 确保分数在 0-10 范围内
    overallScore = Math.max(0, Math.min(10, overallScore));

    return {
      wordCount,
      completionRatio,
      hasStructuredEnd: hasStructEnd,
      coherenceScore,
      relevanceScore,
      styleConsistency,
      overallScore,
      evaluatedAt: new Date(),
    };
  }

  /**
   * 更新质量趋势
   */
  updateTrend(
    projectId: string,
    taskId: string,
    taskTitle: string,
    metrics: QualityMetrics,
    config: QualityMonitorConfig = DEFAULT_QUALITY_MONITOR_CONFIG,
  ): QualityTrend {
    const store = this.projectStores.get(projectId);
    if (!store) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // 检查是否是首次记录该任务（修订不重复计数）
    const isNewTask = !store.taskMetrics.has(taskId);
    const previousWordCount = store.wordStats.taskWords.get(taskId) || 0;

    // 存储任务指标（更新或新增）
    store.taskMetrics.set(taskId, metrics);
    store.scoreHistory.push(metrics.overallScore);

    // 只有新任务才增加完成计数
    if (isNewTask) {
      store.completedTasks++;
    }

    // 更新字数统计（替换而非累加）
    store.wordStats.totalWords =
      store.wordStats.totalWords - previousWordCount + metrics.wordCount;
    store.wordStats.taskWords.set(taskId, metrics.wordCount);
    store.lastUpdatedAt = new Date();

    // 检测异常
    this.detectAnomalies(store, taskId, taskTitle, metrics, config);

    // 计算趋势
    const windowSize = config.trendParams.windowSize;
    const recentScores = store.scoreHistory.slice(-windowSize);

    const trend = this.calculateTrend(recentScores, config);

    this.logger.debug(
      `Updated trend for project ${projectId}: ${trend.trend}, score: ${metrics.overallScore}`,
    );

    return trend;
  }

  /**
   * 获取干预建议
   */
  getInterventionRecommendation(
    _projectId: string,
    trend: QualityTrend,
    config: QualityMonitorConfig = DEFAULT_QUALITY_MONITOR_CONFIG,
  ): InterventionRecommendation | null {
    const { thresholds } = config;

    // Level 1: 连续下降
    if (trend.consecutiveDeclines >= thresholds.declineCountForLevel1) {
      return {
        level: 1,
        action: "soft_reminder",
        reason: `连续 ${trend.consecutiveDeclines} 个任务质量下降`,
        details: "在下一个任务 Prompt 中添加质量提醒",
        autoApply: config.autoIntervention.autoApplyLevel1,
        expectedImprovement: "提醒 Agent 注意质量，预期改善 5-10%",
        suggestedAt: new Date(),
      };
    }

    // Level 2: 持续下降
    if (trend.consecutiveDeclines >= thresholds.declineCountForLevel2) {
      return {
        level: 2,
        action: "adjust_temperature",
        actionParams: { creativity: "low", maxTokensIncrease: 500 },
        reason: `连续 ${trend.consecutiveDeclines} 个任务质量持续下降`,
        details:
          "降低 creativity 并增加 max_tokens（通过 TaskProfile 语义参数）",
        autoApply: config.autoIntervention.autoApplyLevel2,
        expectedImprovement: "稳定输出质量，预期改善 10-15%",
        suggestedAt: new Date(),
      };
    }

    // Level 3: 持续低分
    if (trend.consecutiveBelowThreshold >= thresholds.lowScoreCountForLevel3) {
      return {
        level: 3,
        action: "split_task",
        reason: `连续 ${trend.consecutiveBelowThreshold} 个任务低于质量阈值`,
        details: "建议将剩余大任务拆分为更小的子任务",
        autoApply: false,
        expectedImprovement: "通过简化任务提升质量",
        suggestedAt: new Date(),
      };
    }

    // Level 4: 严重恶化
    if (
      trend.trend === "degrading" &&
      trend.consecutiveDeclines >= thresholds.degradingCountForLevel4
    ) {
      return {
        level: 4,
        action: "pause_execution",
        reason: "质量持续恶化，需要人工介入",
        details: "暂停自动执行，生成质量报告，等待用户决策",
        autoApply: false,
        suggestedAt: new Date(),
      };
    }

    return null;
  }

  /**
   * 应用干预
   */
  async applyIntervention(
    projectId: string,
    intervention: InterventionRecommendation,
  ): Promise<InterventionRecord> {
    const store = this.projectStores.get(projectId);
    if (!store) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const record: InterventionRecord = {
      id: `int_${++this.interventionCounter}`,
      projectId,
      timestamp: new Date(),
      level: intervention.level,
      action: intervention.action,
      reason: intervention.reason,
      result: "applied",
    };

    // 根据干预类型执行相应操作
    switch (intervention.action) {
      case "soft_reminder":
        record.resultDetails = "已在下一个任务 Prompt 中添加质量提醒";
        break;

      case "adjust_temperature":
        record.resultDetails = `已调整参数: creativity=${intervention.actionParams?.creativity}`;
        break;

      case "upgrade_model":
        record.resultDetails = "已升级到更强模型";
        break;

      case "pause_execution":
        record.resultDetails = "已暂停执行，等待用户决策";
        break;

      default:
        record.resultDetails = `已执行干预: ${intervention.action}`;
    }

    store.interventions.push(record);

    this.logger.log(
      `Applied intervention: Level ${intervention.level} - ${intervention.action}`,
    );

    return record;
  }

  /**
   * 获取质量仪表盘
   */
  getDashboard(projectId: string): QualityDashboard {
    const store = this.projectStores.get(projectId);
    if (!store) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // 计算趋势
    const recentScores = store.scoreHistory.slice(-10);
    const trend = this.calculateTrend(
      recentScores,
      DEFAULT_QUALITY_MONITOR_CONFIG,
    );

    // 找到最小/最大字数任务
    let minTask: { id: string; title: string; words: number } | null = null;
    let maxTask: { id: string; title: string; words: number } | null = null;
    let minWords = Infinity;
    let maxWords = 0;

    for (const [taskId, words] of store.wordStats.taskWords) {
      if (words < minWords) {
        minWords = words;
        minTask = { id: taskId, title: taskId, words };
      }
      if (words > maxWords) {
        maxWords = words;
        maxTask = { id: taskId, title: taskId, words };
      }
    }

    return {
      projectId: store.projectId,
      projectTitle: store.projectTitle,
      progress: {
        completedTasks: store.completedTasks,
        totalTasks: store.totalTasks,
        percentage: (store.completedTasks / store.totalTasks) * 100,
      },
      quality: {
        overallScore: trend.averageScore,
        trend,
        recentAverage:
          recentScores.reduce((a, b) => a + b, 0) / recentScores.length || 0,
      },
      wordStats: {
        totalWords: store.wordStats.totalWords,
        averagePerTask: store.wordStats.totalWords / store.completedTasks || 0,
        minTask,
        maxTask,
      },
      anomalies: store.anomalies.slice(-10),
      interventions: store.interventions.slice(-10),
      generatedAt: new Date(),
    };
  }

  /**
   * 生成质量提醒 Prompt
   */
  buildQualityReminderPrompt(trend: QualityTrend): string {
    if (trend.trend !== "degrading") {
      return "";
    }

    return `
## 质量提醒

注意：最近几个任务的质量有所下降（平均分：${trend.averageScore.toFixed(1)}/10）。

请确保：
1. 内容完整，达到预期字数
2. 保持与前文的连贯性和一致性
3. 结构清晰，有明确的开头和结尾
4. 质量优先，宁可少写也要保证质量

`;
  }

  /**
   * 清理项目
   */
  clearProject(projectId: string): void {
    this.projectStores.delete(projectId);
    this.logger.log(`Cleared quality monitor for project: ${projectId}`);
  }

  // ============ 私有方法 ============

  /**
   * AI 质量评估
   */
  private async aiEvaluate(
    content: string,
    expected: ExpectedOutput,
  ): Promise<{ coherence: number; relevance: number; style: number }> {
    const prompt = `请评估以下内容的质量，给出 1-10 分的评分：

## 内容
${content.slice(0, 2000)}

## 评估维度
1. 连贯性：内容是否通顺、逻辑清晰
2. 相关性：是否紧扣主题（${expected.topic || "未指定"}）
3. 风格：写作风格是否专业、一致

请以 JSON 格式返回：
{"coherence": 8, "relevance": 7, "style": 8}`;

    try {
      const response = await this.aiChatService.chat({
        modelType: AIModelType.CHAT_FAST,
        messages: [
          {
            role: "system",
            content:
              "你是一个专业的内容质量评估专家。只返回 JSON，不要其他内容。",
          },
          { role: "user", content: prompt },
        ],
        taskProfile: {
          creativity: "deterministic",
          outputLength: "minimal",
        },
      });

      const result = JSON.parse(response.content || "{}");
      return {
        coherence: result.coherence || 5,
        relevance: result.relevance || 5,
        style: result.style || 5,
      };
    } catch (error) {
      this.logger.warn(`AI evaluate failed: ${error}`);
      return { coherence: 5, relevance: 5, style: 5 };
    }
  }

  /**
   * 检测异常
   */
  private detectAnomalies(
    store: ProjectQualityStore,
    taskId: string,
    taskTitle: string,
    metrics: QualityMetrics,
    config: QualityMonitorConfig,
  ): void {
    const { thresholds } = config;

    // 低质量
    if (metrics.overallScore < thresholds.errorScore) {
      store.anomalies.push({
        taskId,
        taskTitle,
        issue: "low_quality",
        severity: "error",
        details: `质量分数 ${metrics.overallScore.toFixed(1)} 低于阈值 ${thresholds.errorScore}`,
        detectedAt: new Date(),
      });
    } else if (metrics.overallScore < thresholds.warningScore) {
      store.anomalies.push({
        taskId,
        taskTitle,
        issue: "low_quality",
        severity: "warning",
        details: `质量分数 ${metrics.overallScore.toFixed(1)} 低于警告阈值 ${thresholds.warningScore}`,
        detectedAt: new Date(),
      });
    }

    // 内容过短
    if (metrics.completionRatio < thresholds.minWordRatio) {
      store.anomalies.push({
        taskId,
        taskTitle,
        issue: "short_content",
        severity: "warning",
        details: `完成度 ${(metrics.completionRatio * 100).toFixed(0)}% 低于最低要求 ${thresholds.minWordRatio * 100}%`,
        suggestedFix: "考虑启用续写机制",
        detectedAt: new Date(),
      });
    }

    // 结构不完整
    if (!metrics.hasStructuredEnd) {
      store.anomalies.push({
        taskId,
        taskTitle,
        issue: "incomplete",
        severity: "warning",
        details: "内容缺少结构化结尾",
        detectedAt: new Date(),
      });
    }
  }

  /**
   * 计算趋势
   */
  private calculateTrend(
    scores: number[],
    config: QualityMonitorConfig,
  ): QualityTrend {
    if (scores.length === 0) {
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

    const average = scores.reduce((a, b) => a + b, 0) / scores.length;

    // 计算标准差
    const squaredDiffs = scores.map((s) => Math.pow(s - average, 2));
    const avgSquaredDiff =
      squaredDiffs.reduce((a, b) => a + b, 0) / scores.length;
    const stdDev = Math.sqrt(avgSquaredDiff);

    // 计算连续下降次数
    let consecutiveDeclines = 0;
    for (let i = scores.length - 1; i > 0; i--) {
      if (scores[i] < scores[i - 1]) {
        consecutiveDeclines++;
      } else {
        break;
      }
    }

    // 计算连续低于阈值次数
    let consecutiveBelowThreshold = 0;
    for (let i = scores.length - 1; i >= 0; i--) {
      if (scores[i] < config.thresholds.warningScore) {
        consecutiveBelowThreshold++;
      } else {
        break;
      }
    }

    // 判断趋势方向
    let trend: TrendDirection = "stable";
    let trendConfidence = 0;

    if (scores.length >= 3) {
      // 计算趋势斜率
      const xMean = (scores.length - 1) / 2;
      const yMean = average;

      let numerator = 0;
      let denominator = 0;

      for (let i = 0; i < scores.length; i++) {
        numerator += (i - xMean) * (scores[i] - yMean);
        denominator += Math.pow(i - xMean, 2);
      }

      const slope = denominator !== 0 ? numerator / denominator : 0;
      const normalizedSlope = slope / average;

      if (normalizedSlope < -config.trendParams.significanceThreshold) {
        trend = "degrading";
        trendConfidence = Math.min(1, Math.abs(normalizedSlope) * 5);
      } else if (normalizedSlope > config.trendParams.significanceThreshold) {
        trend = "improving";
        trendConfidence = Math.min(1, normalizedSlope * 5);
      } else {
        trend = "stable";
        trendConfidence = 1 - Math.abs(normalizedSlope) * 5;
      }
    }

    return {
      trend,
      trendConfidence,
      recentScores: scores,
      averageScore: average,
      scoreStdDev: stdDev,
      consecutiveDeclines,
      consecutiveBelowThreshold,
      degradationRate:
        trend === "degrading" ? consecutiveDeclines * 0.1 : undefined,
      improvementRate: trend === "improving" ? 0.1 : undefined,
      calculatedAt: new Date(),
    };
  }

  /**
   * 统计字数
   */
  private countWords(text: string): number {
    return text.replace(/\s/g, "").length;
  }
}
