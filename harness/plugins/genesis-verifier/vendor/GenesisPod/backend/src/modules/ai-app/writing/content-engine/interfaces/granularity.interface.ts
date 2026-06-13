/**
 * 任务粒度控制接口
 * Task Granularity Control Interfaces
 */

/**
 * 粒度级别
 */
export type GranularityLevel =
  | "volume" // 卷
  | "chapter" // 章
  | "section" // 节
  | "paragraph" // 段落
  | "item"; // 条目（适用于列表类任务）

/**
 * 粒度约束配置
 */
export interface GranularityConstraint {
  /** 粒度级别 */
  level: GranularityLevel;

  /** 每个任务的输出限制 */
  maxOutputPerTask: {
    /** 最大字符数 */
    characters?: number;
    /** 最大 token 数 */
    tokens?: number;
    /** 最大条目数（适用于列表类任务） */
    items?: number;
  };

  /** 是否允许将多个单元合并为一个任务 */
  allowMerge: boolean;

  /** 总任务数预期（可选） */
  expectedTotalTasks?: number;

  /** 每批并行任务数（可选） */
  batchSize?: number;
}

/**
 * 任务规模预估结果
 */
export interface TaskEstimate {
  /** 每个任务预计 token 数 */
  estimatedTokensPerTask: number;

  /** 推荐的粒度级别 */
  recommendedGranularity: GranularityLevel;

  /** 总任务数 */
  totalTasks: number;

  /** 建议的并行批次数 */
  parallelBatches: number;

  /** 每批任务数 */
  tasksPerBatch: number;

  /** 预计总 token 数 */
  estimatedTotalTokens: number;

  /** 潜在问题警告 */
  warnings: string[];

  /** 是否需要续写机制 */
  requiresContinuation: boolean;
}

/**
 * 任务分解结果
 */
export interface TaskDecomposition {
  /** 任务 ID（可选，新任务可能没有） */
  id?: string;
  /** 任务标题 */
  title: string;
  /** 任务描述 */
  description: string;
  /** 预估字数 */
  estimatedWords?: number;
  /** 顺序号 */
  order?: number;
}

/**
 * 任务分解验证结果
 */
export interface DecompositionValidation {
  /** 是否验证通过 */
  valid: boolean;

  /** 违规项列表 */
  violations: Array<{
    taskIndex: number;
    taskTitle: string;
    issue: string;
    severity: "error" | "warning";
  }>;

  /** 自动修正后的任务列表（如果验证失败） */
  autoFixed?: TaskDecomposition[];

  /** 验证统计 */
  stats: {
    originalTaskCount: number;
    fixedTaskCount?: number;
    totalEstimatedWords: number;
  };
}

/**
 * 粒度约束 Prompt 构建选项
 */
export interface GranularityPromptOptions {
  /** 项目类型（小说、报告、分析等） */
  projectType?: string;
  /** 示例任务标题（用于 Prompt） */
  exampleTitles?: string[];
  /** 额外约束说明 */
  additionalConstraints?: string;
}
