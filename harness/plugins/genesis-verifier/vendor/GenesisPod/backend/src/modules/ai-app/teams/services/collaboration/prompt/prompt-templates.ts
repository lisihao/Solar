/**
 * Prompt Templates
 *
 * 任务执行、审核、修订等场景的提示词模板
 * 从 team-mission.service.ts 提取
 */

/**
 * 任务执行提示词模板
 */
export const TASK_EXECUTION_TEMPLATE = {
  /** 搜索上下文最大长度 */
  MAX_SEARCH_CONTEXT_LENGTH: 4000,

  /** 搜索上下文截断提示 */
  SEARCH_TRUNCATION_NOTICE: "\n\n...[搜索结果已截断，仅显示部分内容]",

  /** 搜索结果区块标题 */
  SEARCH_SECTION_HEADER: "【参考资料 - 联网搜索结果】",
  SEARCH_SECTION_INTRO:
    "以下是通过网络搜索获取的最新相关信息，请参考这些资料完成任务：",

  /** 大纲区块标题 */
  OUTLINE_SECTION_HEADER: "【⚠️ 重要：整体大纲与规划】",
  OUTLINE_SECTION_INTRO:
    "以下是 Leader 对整个任务的理解和规划，**你必须严格遵循这个大纲**，确保内容一致性：",

  /** 约束区块标题 */
  CONSTRAINTS_SECTION_HEADER: "【🚫 强制约束 - 违反将导致审核不通过】",
  CONSTRAINTS_SECTION_INTRO:
    "以下约束条件必须严格遵守，否则会被 Leader 打回修改：",

  /** 提取约束区块标题 */
  EXTRACTED_CONSTRAINTS_HEADER: "【📋 任务关键要求（从描述中提取）】",

  /** 输出要求区块标题 */
  OUTPUT_REQUIREMENTS_HEADER: "【✅ 输出要求】",

  /** 默认字数要求 */
  DEFAULT_WORD_COUNT: "内容充实，不少于1000字",

  /** 输出格式提示 */
  OUTPUT_FORMAT_HINTS: [
    "直接输出正文内容，不要包含「本章小结」、「未完待续」、「字数统计」等元信息",
    "必须与已完成章节的人物设定、世界观、文风保持一致",
    "确保内容完整，有头有尾，情节流畅",
  ],

  /** 执行要求 */
  EXECUTION_REQUIREMENTS: [
    "**⚠️ 务必遵循上面的整体大纲和规划**，保持与其他章节的一致性",
    "**⚠️ 严格遵守所有强制约束条件**",
    "确保输出内容完整、专业",
    "如果有参考资料，请充分利用并注明来源",
    "完成后会由 Leader 审核",
  ],
} as const;

/**
 * Leader 审核提示词模板
 */
export const LEADER_REVIEW_TEMPLATE = {
  /** 任务产出最大长度 */
  MAX_RESULT_LENGTH: 2500,

  /** 首部截取长度 */
  HEAD_TRUNCATION_LENGTH: 1500,

  /** 尾部截取长度 */
  TAIL_TRUNCATION_LENGTH: 800,

  /** 审核通过标准 */
  APPROVAL_CRITERIA: [
    "完成了任务的核心要求",
    "内容质量达到可接受水平",
    "无严重的设定冲突或事实错误",
  ],

  /** 需要修改的情况 */
  REJECTION_CRITERIA: [
    "完全偏离任务主题（写的内容与任务无关）",
    "严重违反人物核心设定（如让哑巴说话、让死人复活）",
    "字数严重不足（低于要求的 30%）",
    "内容明显不完整（只有开头没有结尾）",
  ],

  /** 重要提醒 */
  IMPORTANT_REMINDERS: [
    '文笔风格、细节处理、情节安排等都属于"可接受的创作差异"，不是拒绝理由',
    "与你期望的不完全一致 ≠ 需要修改",
    "有改进空间 ≠ 需要修改",
    "能够串联进整体故事即可通过",
  ],

  /** 核心原则 */
  CORE_PRINCIPLE: "质量达标即通过。完美是好的敌人。",

  /** 输出格式 - 通过 */
  OUTPUT_FORMAT_APPROVED: `## 审核结果：通过

**内容亮点：**
- [列出1-2个内容亮点，如人物刻画生动、情节紧凑等]

**改进建议（可选）：**
- [如有轻微可改进之处，简要提及，但不影响通过]`,

  /** 输出格式 - 需要修改 */
  OUTPUT_FORMAT_REJECTED: `## 审核结果：需要修改

**必须修复的问题：**
- [仅列出上述❌中的严重问题]`,
} as const;

/**
 * 任务修订提示词模板
 */
export const TASK_REVISION_TEMPLATE = {
  /** 之前产出最大长度 */
  MAX_PREVIOUS_RESULT_LENGTH: 2500,

  /** 首部截取长度 */
  HEAD_TRUNCATION_LENGTH: 1500,

  /** 尾部截取长度 */
  TAIL_TRUNCATION_LENGTH: 800,

  /** 无记录占位符 */
  NO_RECORD_PLACEHOLDER: "（无记录）",

  /** 修订要求 */
  REVISION_REQUIREMENTS: [
    "**仅修复 Leader 指出的问题**，其他内容保持不变",
    "**保持原有结构和风格**",
    "直接输出完整的修改后内容",
    "不要输出解释或说明",
  ],
} as const;

/**
 * 任务分解提示词模板
 */
export const TASK_BREAKDOWN_TEMPLATE = {
  /** 表格格式示例 */
  TABLE_FORMAT_EXAMPLE: `| 序号 | 任务标题 | 执行人 | 依赖 | 优先级 | 任务分配理由 |
|-----|---------|-------|-----|-------|-------------|
| 1   | 第一章 xxx | 成员A | 无 | 高 | xxx |
| 2   | 第二章 xxx | 成员B | 1 | 中 | xxx |`,

  /** 优先级选项 */
  PRIORITY_OPTIONS: ["关键", "高", "中", "低"],

  /** 依赖格式说明 */
  DEPENDENCY_FORMAT: "依赖：填写所依赖的任务序号，无依赖填「无」",
} as const;

/**
 * 审核结果解析模式
 */
export const REVIEW_RESULT_PATTERNS = {
  /** 标准格式正则 */
  STANDARD_FORMAT: /##\s*审核结果[：:]\s*(通过|需要修改)/,

  /** 通过模式（按权重排序） */
  APPROVE_PATTERNS: [
    { pattern: "审核通过", weight: 1.0 },
    { pattern: "评审通过", weight: 1.0 },
    { pattern: "审批通过", weight: 1.0 },
    { pattern: "✅ 通过", weight: 1.0 },
    { pattern: "✅通过", weight: 1.0 },
    { pattern: "approved", weight: 0.95 },
    { pattern: "passed", weight: 0.9 },
    { pattern: "✅", weight: 0.85 },
    { pattern: "符合要求", weight: 0.85 },
    { pattern: "质量达标", weight: 0.85 },
    { pattern: "可以接受", weight: 0.8 },
  ],

  /** 拒绝模式（按权重排序） */
  REJECT_PATTERNS: [
    { pattern: "不通过", weight: 1.0 },
    { pattern: "暂不通过", weight: 1.0 },
    { pattern: "未通过", weight: 1.0 },
    { pattern: "未能通过", weight: 1.0 },
    { pattern: "无法通过", weight: 1.0 },
    { pattern: "没通过", weight: 1.0 },
    { pattern: "不合格", weight: 0.95 },
    { pattern: "rejected", weight: 1.0 },
    { pattern: "not approved", weight: 1.0 },
    { pattern: "failed", weight: 0.9 },
    { pattern: "❌", weight: 1.0 },
  ],

  /** 需要修改模式 */
  REVISION_NEEDED_PATTERNS: [
    { pattern: "需要修改", weight: 1.0 },
    { pattern: "需要改进", weight: 0.95 },
    { pattern: "需要完善", weight: 0.9 },
    { pattern: "建议修改", weight: 0.9 },
    { pattern: "请修改", weight: 0.95 },
    { pattern: "请改进", weight: 0.9 },
    { pattern: "不够完整", weight: 0.85 },
    { pattern: "不够详细", weight: 0.85 },
    { pattern: "内容不足", weight: 0.85 },
    { pattern: "质量不够", weight: 0.9 },
    { pattern: "存在问题", weight: 0.8 },
    { pattern: "有待改进", weight: 0.85 },
    { pattern: "仍需", weight: 0.8 },
    { pattern: "还需", weight: 0.8 },
  ],

  /** 实质性反馈关键词 */
  SUBSTANTIVE_FEEDBACK_KEYWORDS: ["建议", "可以", "应该", "需要注意"],
} as const;

// 导出类型
export type TaskExecutionTemplate = typeof TASK_EXECUTION_TEMPLATE;
export type LeaderReviewTemplate = typeof LEADER_REVIEW_TEMPLATE;
export type TaskRevisionTemplate = typeof TASK_REVISION_TEMPLATE;
export type TaskBreakdownTemplate = typeof TASK_BREAKDOWN_TEMPLATE;
export type ReviewResultPatterns = typeof REVIEW_RESULT_PATTERNS;
