/**
 * Writing Phases Configuration
 *
 * Centralized phase definitions, progress weights, and default parameters
 * for writing missions. Extracted from hardcoded values in WritingMissionService.
 */

/**
 * FSM states for writing missions
 */
export type WritingMissionState =
  | "CREATED"
  | "PREPARING"
  | "EXECUTING"
  | "REVIEWING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "NEEDS_REVISION";

/**
 * Execution sub-phases within EXECUTING state (for progress tracking)
 */
export interface ExecutionPhase {
  id: string;
  name: string;
  progressStart: number;
  progressEnd: number;
  description: string;
}

/**
 * Execution phases with progress ranges
 */
export const EXECUTION_PHASES: ExecutionPhase[] = [
  {
    id: "preparation",
    name: "准备阶段",
    progressStart: 0,
    progressEnd: 5,
    description: "模型分配、项目验证",
  },
  {
    id: "world_building",
    name: "世界观建设",
    progressStart: 5,
    progressEnd: 15,
    description: "世界观生成 (full_story only)",
  },
  {
    id: "outline_planning",
    name: "大纲规划",
    progressStart: 15,
    progressEnd: 25,
    description: "大纲/章节结构",
  },
  {
    id: "chapter_writing",
    name: "章节写作",
    progressStart: 25,
    progressEnd: 85,
    description: "逐章生成（线性推进）",
  },
  {
    id: "consistency_check",
    name: "一致性检查",
    progressStart: 85,
    progressEnd: 90,
    description: "Story Bible 一致性",
  },
  {
    id: "editing",
    name: "编辑润色",
    progressStart: 90,
    progressEnd: 95,
    description: "编辑润色",
  },
  {
    id: "finalization",
    name: "最终保存",
    progressStart: 95,
    progressEnd: 100,
    description: "保存、字数统计、Bible 更新",
  },
];

/**
 * ProgressTracker phase definitions (used by AI Kernel ProgressTracker)
 */
export const PROGRESS_TRACKER_PHASES = [
  { id: "preparation", name: "准备阶段", weight: 1 },
  { id: "planning", name: "大纲规划", weight: 1 },
  { id: "writing", name: "章节写作", weight: 5 },
  { id: "checking", name: "一致性检查", weight: 1 },
  { id: "editing", name: "编辑润色", weight: 1 },
];

/**
 * Default writing parameters
 */
export const WRITING_DEFAULTS = {
  /** Default words per chapter */
  WORDS_PER_CHAPTER: 3000,
  /** Default chapters per volume */
  CHAPTERS_PER_VOLUME: 10,
  /** Default target word count when not specified */
  DEFAULT_TARGET_WORDS: 50000,
  /** Minimum chapters in a story */
  MIN_CHAPTERS: 3,
  /** Minimum user prompt length */
  MIN_USER_PROMPT_LENGTH: 5,
  /** Model cache TTL (5 minutes) */
  MODEL_CACHE_TTL: 5 * 60 * 1000,
  /** Heartbeat interval for long operations (30 seconds) */
  HEARTBEAT_INTERVAL: 30 * 1000,
  /** Maximum parallel writers */
  MAX_PARALLEL_WRITERS: 3,
  /** Maximum mission duration for full_story (1 hour) */
  MAX_DURATION_FULL_STORY: 3600000,
  /** Maximum mission duration for other types (10 minutes) */
  MAX_DURATION_OTHER: 600000,
} as const;

/**
 * Content validation thresholds
 */
export const CONTENT_VALIDATION = {
  /** Minimum word count for general content */
  MIN_WORDS_GENERAL: 200,
  /** Minimum word count for outlines */
  MIN_WORDS_OUTLINE: 50,
  /** Error content indicators */
  ERROR_INDICATORS: [
    "API Error",
    "rate limit",
    "429",
    "quota",
    "ECONNREFUSED",
    "Request failed",
  ],
  /** Minimum content length to not be considered an error */
  MIN_CONTENT_LENGTH: 100,
  /** Completion markers that skip validation */
  COMPLETION_MARKERS: ["[ALL_CHAPTERS_COMPLETED]", "[CONTINUATION_COMPLETE]"],
  /** Mission types that skip word count validation */
  SKIP_WORD_COUNT_TYPES: ["edit", "consistency_check"] as const,
} as const;

/**
 * Story completion markers (for detecting finished stories)
 */
export const STORY_COMPLETION_MARKERS = [
  "全书完",
  "大结局",
  "（完）",
  "【完】",
  "（全文完）",
  "——END——",
  "全剧终",
  "故事结束",
  "THE END",
  "大同之世",
  "（终章）",
  "【终章】",
] as const;

/**
 * Mission type to DB enum mapping
 */
export const MISSION_TYPE_DB_MAP: Record<string, string> = {
  outline: "OUTLINE",
  chapter: "CHAPTER",
  revision: "REVISION",
  consistency: "CONSISTENCY",
  consistency_check: "CONSISTENCY",
  full_story: "CHAPTER",
  edit: "REVISION",
};
