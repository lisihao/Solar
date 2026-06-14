/**
 * 续写协议接口
 * Continuation Protocol Interfaces
 */

/**
 * 扩展的任务状态
 */
export enum ExtendedTaskStatus {
  /** 待处理 */
  PENDING = "PENDING",
  /** 执行中 */
  IN_PROGRESS = "IN_PROGRESS",
  /** 续写中 */
  CONTINUING = "CONTINUING",
  /** 等待审核 */
  REVIEW_PENDING = "REVIEW_PENDING",
  /** 已完成 */
  COMPLETED = "COMPLETED",
  /** 失败 */
  FAILED = "FAILED",
}

/**
 * 续写原因类型
 */
export type ContinuationReason =
  | "explicit_marker" // 显式标记（如"未完待续"）
  | "incomplete_sentence" // 句子未完成
  | "short_content" // 内容过短
  | "structured_incomplete" // 结构化内容未完成
  | "no_ending_marker"; // 缺少结束标记

/**
 * 续写检测结果
 */
export interface ContinuationDetectionResult {
  /** 是否需要续写 */
  needsContinuation: boolean;

  /** 续写原因 */
  reason?: ContinuationReason;

  /** 检测到的标记（如果有） */
  detectedMarker?: string;

  /** 已完成比例 (0-1) */
  completedPortion: number;

  /** 最后检查点描述 */
  lastCheckpoint: string;

  /** 检测置信度 (0-1) */
  confidence: number;
}

/**
 * 续写状态
 */
export interface ContinuationState {
  /** 任务 ID */
  taskId: string;

  /** 是否需要续写 */
  needsContinuation: boolean;

  /** 续写原因 */
  reason: ContinuationReason;

  /** 已完成比例 */
  completedPortion: number;

  /** 最后检查点 */
  lastCheckpoint: string;

  /** 当前续写次数 */
  continuationCount: number;

  /** 最大续写次数 */
  maxContinuations: number;

  /** 累积结果 */
  accumulatedResult: string;

  /** 预期总字数 */
  expectedTotalWords: number;

  /** 当前总字数 */
  currentTotalWords: number;

  /** 开始时间 */
  startedAt: Date;

  /** 最后更新时间 */
  lastUpdatedAt: Date;
}

/**
 * 续写 Prompt 构建选项
 */
export interface ContinuationPromptOptions {
  /** 原始任务标题 */
  taskTitle: string;
  /** 原始任务描述 */
  taskDescription: string;
  /** 上下文窗口大小（显示最后多少字符） */
  contextWindowSize?: number;
  /** 风格提醒 */
  styleReminder?: string;
}

/**
 * 续写停止条件
 */
export interface ContinuationStopCondition {
  /** 是否应该停止 */
  shouldStop: boolean;

  /** 停止原因 */
  reason:
    | "completed" // 检测到完成标记
    | "max_continuations" // 达到最大续写次数
    | "sufficient_length" // 达到足够长度
    | "quality_issue" // 质量问题
    | "error"; // 错误

  /** 详细说明 */
  details: string;
}

/**
 * 结果合并选项
 */
export interface MergeOptions {
  /** 是否移除重叠部分 */
  removeOverlap?: boolean;
  /** 重叠检测窗口大小 */
  overlapWindowSize?: number;
  /** 是否添加分隔符 */
  addSeparator?: boolean;
  /** 分隔符内容 */
  separator?: string;
}

/**
 * 续写配置
 */
export interface ContinuationConfig {
  /** 最大续写次数 */
  maxContinuations: number;
  /** 最小完成比例才触发续写 */
  minCompletionRatioForContinuation: number;
  /** 续写上下文窗口大小（字符数） */
  contextWindowSize: number;
  /** 是否自动检测完成标记 */
  autoDetectCompletion: boolean;
  /** 自定义续写标记 */
  customMarkers?: string[];
  /** 自定义完成标记 */
  customCompletionMarkers?: string[];
}

/**
 * 默认续写配置
 */
export const DEFAULT_CONTINUATION_CONFIG: ContinuationConfig = {
  maxContinuations: 5,
  minCompletionRatioForContinuation: 0.3,
  contextWindowSize: 500,
  autoDetectCompletion: true,
};
