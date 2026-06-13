/**
 * 质量监控接口
 * Quality Monitor Interfaces
 */

/**
 * 基础质量指标
 */
export interface QualityMetrics {
  /** 字数 */
  wordCount: number;

  /** 完成度 (0-1)，相对于预期 */
  completionRatio: number;

  /** 是否有结构化结尾 */
  hasStructuredEnd: boolean;

  /** 连贯性分数 (0-10) */
  coherenceScore?: number;

  /** 相关性分数 (0-10) */
  relevanceScore?: number;

  /** 风格一致性分数 (0-10) */
  styleConsistency?: number;

  /** 综合评分 (0-10) */
  overallScore: number;

  /** 评估时间 */
  evaluatedAt: Date;
}

/**
 * 质量趋势方向
 */
export type TrendDirection = "improving" | "stable" | "degrading";

/**
 * 质量趋势
 */
export interface QualityTrend {
  /** 趋势方向 */
  trend: TrendDirection;

  /** 趋势置信度 (0-1) */
  trendConfidence: number;

  /** 最近 N 个任务的分数 */
  recentScores: number[];

  /** 平均分数 */
  averageScore: number;

  /** 分数标准差 */
  scoreStdDev: number;

  /** 下降速率（如果是 degrading） */
  degradationRate?: number;

  /** 上升速率（如果是 improving） */
  improvementRate?: number;

  /** 连续下降次数 */
  consecutiveDeclines: number;

  /** 连续低于阈值次数 */
  consecutiveBelowThreshold: number;

  /** 趋势计算时间 */
  calculatedAt: Date;
}

/**
 * 干预级别
 */
export type InterventionLevel = 1 | 2 | 3 | 4;

/**
 * 干预动作类型
 */
export type InterventionAction =
  | "soft_reminder" // 软提醒（注入 Prompt）
  | "adjust_temperature" // 调整 temperature
  | "increase_tokens" // 增加 max_tokens
  | "upgrade_model" // 升级模型
  | "split_task" // 拆分任务
  | "pause_execution" // 暂停执行
  | "notify_user"; // 通知用户

/**
 * 干预建议
 */
export interface InterventionRecommendation {
  /** 干预级别 (1-4) */
  level: InterventionLevel;

  /** 干预动作 */
  action: InterventionAction;

  /** 动作参数 */
  actionParams?: Record<string, unknown>;

  /** 干预原因 */
  reason: string;

  /** 详细说明 */
  details: string;

  /** 是否自动应用 */
  autoApply: boolean;

  /** 预期改善 */
  expectedImprovement?: string;

  /** 建议生成时间 */
  suggestedAt: Date;
}

/**
 * 异常任务
 */
export interface TaskAnomaly {
  /** 任务 ID */
  taskId: string;

  /** 任务标题 */
  taskTitle: string;

  /** 异常类型 */
  issue:
    | "low_quality"
    | "short_content"
    | "style_deviation"
    | "incomplete"
    | "error";

  /** 严重程度 */
  severity: "warning" | "error";

  /** 异常详情 */
  details: string;

  /** 建议修复 */
  suggestedFix?: string;

  /** 检测时间 */
  detectedAt: Date;
}

/**
 * 干预历史记录
 */
export interface InterventionRecord {
  /** 记录 ID */
  id: string;

  /** 项目 ID */
  projectId: string;

  /** 触发时间 */
  timestamp: Date;

  /** 干预级别 */
  level: InterventionLevel;

  /** 干预动作 */
  action: InterventionAction;

  /** 触发原因 */
  reason: string;

  /** 执行结果 */
  result: "applied" | "skipped" | "pending" | "failed";

  /** 结果详情 */
  resultDetails?: string;

  /** 干预后的质量变化 */
  qualityImpact?: {
    scoreBefore: number;
    scoreAfter: number;
    improvement: number;
  };
}

/**
 * 质量仪表盘
 */
export interface QualityDashboard {
  /** 项目 ID */
  projectId: string;

  /** 项目标题 */
  projectTitle: string;

  /** 进度 */
  progress: {
    completedTasks: number;
    totalTasks: number;
    percentage: number;
  };

  /** 质量概览 */
  quality: {
    overallScore: number;
    trend: QualityTrend;
    recentAverage: number;
  };

  /** 字数统计 */
  wordStats: {
    totalWords: number;
    averagePerTask: number;
    minTask: { id: string; title: string; words: number } | null;
    maxTask: { id: string; title: string; words: number } | null;
    targetWords?: number;
    progressToTarget?: number;
  };

  /** 异常任务 */
  anomalies: TaskAnomaly[];

  /** 干预历史 */
  interventions: InterventionRecord[];

  /** 仪表盘生成时间 */
  generatedAt: Date;
}

/**
 * 质量监控配置
 */
export interface QualityMonitorConfig {
  /** 质量评估阈值 */
  thresholds: {
    /** 低质量警告阈值 */
    warningScore: number;
    /** 严重质量问题阈值 */
    errorScore: number;
    /** 最小可接受字数比例 */
    minWordRatio: number;
    /** 连续下降触发 Level 1 干预 */
    declineCountForLevel1: number;
    /** 连续下降触发 Level 2 干预 */
    declineCountForLevel2: number;
    /** 低分次数触发 Level 3 干预 */
    lowScoreCountForLevel3: number;
    /** 持续恶化触发 Level 4 干预 */
    degradingCountForLevel4: number;
  };

  /** 趋势计算参数 */
  trendParams: {
    /** 计算趋势使用的最近任务数 */
    windowSize: number;
    /** 趋势变化显著性阈值 */
    significanceThreshold: number;
  };

  /** 自动干预配置 */
  autoIntervention: {
    /** 是否启用自动干预 */
    enabled: boolean;
    /** Level 1 自动应用 */
    autoApplyLevel1: boolean;
    /** Level 2 自动应用 */
    autoApplyLevel2: boolean;
  };

  /** AI 评估配置 */
  aiEvaluation: {
    /** 是否启用 AI 质量评估 */
    enabled: boolean;
    /** 每 N 个任务进行一次 AI 评估 */
    evaluationInterval: number;
    /** 评估模型 */
    evaluationModel: string;
  };
}

/**
 * 默认质量监控配置
 */
export const DEFAULT_QUALITY_MONITOR_CONFIG: QualityMonitorConfig = {
  thresholds: {
    warningScore: 6,
    errorScore: 4,
    minWordRatio: 0.7,
    declineCountForLevel1: 2,
    declineCountForLevel2: 3,
    lowScoreCountForLevel3: 5,
    degradingCountForLevel4: 8,
  },
  trendParams: {
    windowSize: 10,
    significanceThreshold: 0.15,
  },
  autoIntervention: {
    enabled: true,
    autoApplyLevel1: true,
    autoApplyLevel2: true,
  },
  aiEvaluation: {
    enabled: true,
    evaluationInterval: 5,
    evaluationModel: "",
  },
};

/**
 * 期望输出配置
 */
export interface ExpectedOutput {
  /** 最小字数 */
  minWords?: number;
  /** 最大字数 */
  maxWords?: number;
  /** 主题/话题 */
  topic?: string;
  /** 风格参考 */
  styleReference?: string;
  /** 是否需要结构化结尾 */
  requireStructuredEnd?: boolean;
}
