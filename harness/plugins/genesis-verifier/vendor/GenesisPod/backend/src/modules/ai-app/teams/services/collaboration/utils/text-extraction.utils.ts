/**
 * Text Extraction Utilities
 *
 * 文本提取和检测相关的工具函数
 * 从 team-mission.service.ts 提取
 */

/**
 * 章节匹配模式
 */
const CHAPTER_PATTERNS = [
  /卷[一二三四五六七八九十百千\d]+[·.\s]*第[\d一二三四五六七八九十百千]+章/,
  /第[一二三四五六七八九十百千\d]+卷[·.\s]*第[\d一二三四五六七八九十百千]+章/,
  /第[\d一二三四五六七八九十百千]+章/,
  /Chapter\s*\d+/i,
];

/**
 * 内容创作关键词
 */
const CONTENT_KEYWORDS = [
  "小说",
  "武侠",
  "奇幻",
  "玄幻",
  "科幻",
  "言情",
  "悬疑",
  "推理",
  "历史",
  "传记",
  "剧本",
  "故事",
  "连载",
  "长篇",
  "系列",
  "动漫",
  "漫画",
  "剧集",
  "课程",
  "教程",
  "专栏",
  "文章",
];

/**
 * 结构化单位关键词
 */
const STRUCTURE_KEYWORDS = [
  "卷",
  "部",
  "篇",
  "季",
  "册",
  "辑",
  "编",
  "章",
  "回",
  "集",
  "话",
  "期",
  "幕",
  "讲",
  "课",
];

/**
 * 数量模式正则
 */
const QUANTITY_PATTERN = /(\d+)\s*(卷|部|篇|季|册|章|回|集|话|期|幕|讲|课)/;

/**
 * 从任务标题中提取章节键值
 * 支持格式：卷X·第Y章、卷X第Y章、第X卷第Y章 等
 *
 * @param title 任务标题
 * @returns 章节键值或 null
 */
export function extractChapterKey(title: string): string | null {
  for (const pattern of CHAPTER_PATTERNS) {
    const match = title.match(pattern);
    if (match) {
      // 标准化章节键：移除特殊字符，统一格式
      return match[0].replace(/[\s·.]/g, "");
    }
  }
  return null;
}

/**
 * 从描述中提取结构提示
 *
 * @param text 描述文本
 * @returns 结构提示字符串
 */
export function extractStructureHint(text: string): string {
  // 尝试匹配数字卷数
  const volumeMatch = text.match(/(\d+)\s*卷/);
  // 尝试匹配中文卷数
  const volumeMatch2 = text.match(/([一二三四五六七八九十]+)\s*卷/);

  if (volumeMatch) {
    const volumes = parseInt(volumeMatch[1], 10);
    return `4. **用户明确要求 ${volumes} 卷** - 你必须分解全部 ${volumes} 卷的所有章节\n`;
  }

  if (volumeMatch2) {
    const chineseNum = volumeMatch2[1];
    return `4. **用户明确要求 ${chineseNum} 卷** - 你必须分解全部卷的所有章节\n`;
  }

  return "";
}

/**
 * 检测是否为大型内容创作任务
 *
 * @param text 任务描述文本
 * @returns 是否为大型内容任务
 */
export function detectLargeContentTask(text: string): boolean {
  const hasContentKeyword = CONTENT_KEYWORDS.some((kw) => text.includes(kw));
  const hasStructureKeyword = STRUCTURE_KEYWORDS.some((kw) =>
    text.includes(kw),
  );
  const hasQuantity = QUANTITY_PATTERN.test(text);

  // 如果同时满足内容关键词和结构关键词，或者有明确数量
  return (hasContentKeyword && hasStructureKeyword) || hasQuantity;
}

/**
 * 从文本中提取字数要求
 *
 * @param text 文本内容
 * @returns 字数要求字符串或 null
 */
export function extractWordCount(text: string): string | null {
  // 匹配各种字数表达方式
  const patterns = [
    /(\d+)\s*[万千]?\s*字/,
    /字数[：:]\s*(\d+)/,
    /不少于\s*(\d+)/,
    /至少\s*(\d+)\s*字/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return null;
}

/**
 * 检测任务列表中的章节重复
 *
 * @param titles 任务标题列表
 * @returns 重复的章节信息
 */
export function findDuplicateChapters(titles: string[]): {
  key: string;
  titles: string[];
}[] {
  const chapterMap = new Map<string, string[]>();

  for (const title of titles) {
    const key = extractChapterKey(title);
    if (key) {
      const existing = chapterMap.get(key) || [];
      existing.push(title);
      chapterMap.set(key, existing);
    }
  }

  // 返回有重复的章节
  return Array.from(chapterMap.entries())
    .filter(([_, titles]) => titles.length > 1)
    .map(([key, titles]) => ({ key, titles }));
}

/**
 * 章节序列验证结果
 */
export interface ChapterSequenceValidation {
  isValid: boolean;
  missingChapters: number[];
  firstChapter: number | null;
  lastChapter: number | null;
  totalChapters: number;
}

/**
 * 验证章节序列的连续性
 *
 * 检查：
 * 1. 章节是否从第1章开始
 * 2. 章节序号是否连续（无跳跃）
 *
 * @param titles 任务标题列表
 * @returns 验证结果，包含缺失的章节号
 */
export function validateChapterSequence(
  titles: string[],
): ChapterSequenceValidation {
  // 提取所有章节号
  const chapterNums: number[] = [];
  for (const title of titles) {
    // 匹配 "第X章" 格式
    const match = title.match(/第(\d+)章/);
    if (match) {
      chapterNums.push(parseInt(match[1], 10));
    }
  }

  // 如果没有检测到章节格式的任务，返回有效（可能不是小说类任务）
  if (chapterNums.length === 0) {
    return {
      isValid: true,
      missingChapters: [],
      firstChapter: null,
      lastChapter: null,
      totalChapters: 0,
    };
  }

  // 排序并去重
  const sortedChapters = [...new Set(chapterNums)].sort((a, b) => a - b);
  const firstChapter = sortedChapters[0];
  const lastChapter = sortedChapters[sortedChapters.length - 1];

  const missingChapters: number[] = [];

  // 检查是否从第1章开始
  if (firstChapter !== 1) {
    for (let i = 1; i < firstChapter; i++) {
      missingChapters.push(i);
    }
  }

  // 检查连续性（无跳跃）
  for (let i = 1; i < sortedChapters.length; i++) {
    const expected = sortedChapters[i - 1] + 1;
    const actual = sortedChapters[i];
    if (actual !== expected) {
      for (let j = expected; j < actual; j++) {
        missingChapters.push(j);
      }
    }
  }

  return {
    isValid: missingChapters.length === 0,
    missingChapters,
    firstChapter,
    lastChapter,
    totalChapters: sortedChapters.length,
  };
}
