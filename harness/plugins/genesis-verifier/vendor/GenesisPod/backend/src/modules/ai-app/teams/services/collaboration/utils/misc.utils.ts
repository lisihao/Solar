/**
 * Miscellaneous Utilities
 *
 * 通用工具函数
 * 从 team-mission.service.ts 提取
 */

import { TaskType } from "@prisma/client";

/**
 * 任务类型映射
 */
const TASK_TYPE_MAPPING: Record<string, TaskType> = {
  research: TaskType.RESEARCH,
  design: TaskType.DESIGN,
  implementation: TaskType.IMPLEMENTATION,
  review: TaskType.REVIEW,
  documentation: TaskType.DOCUMENTATION,
  coordination: TaskType.COORDINATION,
  creative: TaskType.CREATIVE,
  synthesis: TaskType.SYNTHESIS,
};

/**
 * 将字符串任务类型映射为枚举值
 *
 * @param type 任务类型字符串
 * @returns TaskType 枚举值
 */
export function mapTaskType(type: string): TaskType {
  return TASK_TYPE_MAPPING[type.toLowerCase()] || TaskType.IMPLEMENTATION;
}

/**
 * 智能截断长文本，保留开头和结尾的关键信息
 *
 * @param text 原始文本
 * @param maxLength 最大长度
 * @param preserveEnding 是否保留结尾
 * @returns 截断后的文本
 */
export function truncateDescription(
  text: string,
  maxLength: number,
  preserveEnding = true,
): string {
  if (!text || text.length <= maxLength) {
    return text;
  }

  if (preserveEnding) {
    // 保留开头 70% 和结尾 30%
    const headLength = Math.floor(maxLength * 0.7);
    const tailLength = maxLength - headLength - 50; // 留 50 字符给省略提示
    const head = text.substring(0, headLength);
    const tail = text.substring(text.length - tailLength);
    return `${head}\n\n...[内容过长，已省略中间 ${text.length - headLength - tailLength} 字]...\n\n${tail}`;
  } else {
    return text.substring(0, maxLength) + "\n\n...[内容过长，已截断]...";
  }
}

/**
 * 需要实时数据的关键词列表
 */
const REALTIME_KEYWORDS = [
  // 中文关键词
  "最新",
  "2025年",
  "2024年",
  "今年",
  "近期",
  "当前",
  "目前",
  "现在",
  "实时",
  "最近",
  "新闻",
  "动态",
  "趋势",
  "市场",
  "调研",
  "研究",
  "分析",
  "报告",
  "数据",
  "统计",
  "行业",
  "企业",
  "公司",
  "进展",
  "案例",
  // 英文关键词
  "latest",
  "recent",
  "current",
  "2025",
  "2024",
  "this year",
  "market",
  "research",
  "analysis",
  "report",
  "trend",
  "news",
  "industry",
  "company",
  "enterprise",
  "case study",
];

/**
 * 检测任务是否需要联网搜索
 *
 * @param missionTitle 任务标题
 * @param missionDescription 任务描述
 * @param taskTitle 子任务标题
 * @param taskDescription 子任务描述
 * @returns 是否需要搜索
 */
export function needsWebSearch(
  missionTitle: string,
  missionDescription: string,
  taskTitle: string,
  taskDescription: string,
): boolean {
  const combinedText =
    `${missionTitle} ${missionDescription} ${taskTitle} ${taskDescription}`.toLowerCase();

  return REALTIME_KEYWORDS.some((keyword) => combinedText.includes(keyword));
}

/**
 * 构建搜索查询词
 *
 * @param missionTitle 任务标题
 * @param taskTitle 子任务标题
 * @param taskDescription 子任务描述
 * @returns 搜索查询字符串
 */
export function buildSearchQuery(
  missionTitle: string,
  taskTitle: string,
  taskDescription: string,
): string {
  // 从任务标题和描述中提取关键信息
  let query = taskTitle;

  // 如果任务描述不太长，也加入
  if (taskDescription && taskDescription.length < 100) {
    query += " " + taskDescription;
  }

  // 添加任务标题中的关键词
  if (!query.includes(missionTitle.substring(0, 20))) {
    // 取任务标题前20字符作为上下文
    const missionKeywords = missionTitle
      .replace(/[，。、！？\s]+/g, " ")
      .trim();
    if (missionKeywords.length < 50) {
      query = missionKeywords + " " + query;
    }
  }

  // 清理和截断
  query = query
    .replace(/[，。、！？【】「」\[\]()（）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 限制查询长度
  if (query.length > 100) {
    query = query.substring(0, 100);
  }

  return query;
}

/**
 * 智能截取文本，保留首尾
 *
 * @param text 原始文本
 * @param headLength 头部长度
 * @param tailLength 尾部长度
 * @returns 截取后的文本
 */
export function truncateWithHeadTail(
  text: string,
  headLength: number,
  tailLength: number,
): string {
  if (text.length <= headLength + tailLength) {
    return text;
  }

  const head = text.substring(0, headLength);
  const tail = text.substring(text.length - tailLength);
  const omitted = text.length - headLength - tailLength;

  return `${head}\n\n...[已省略 ${omitted} 字符]...\n\n${tail}`;
}
