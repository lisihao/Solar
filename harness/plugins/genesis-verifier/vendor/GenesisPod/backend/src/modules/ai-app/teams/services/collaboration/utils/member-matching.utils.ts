/**
 * 成员名称匹配工具函数
 *
 * 简单原则：只移除 @ 前缀，然后直接和真实名字匹配
 * 注意：不移除 AI- 前缀，因为数据库中的成员名称本身就带 AI- 前缀
 *
 * 增强功能：
 * - 精确匹配优先
 * - 模糊匹配兜底（相似度 > 0.8）
 * - 匹配结果包含置信度信息
 */

/**
 * 匹配类型
 */
export type MatchType = "exact" | "fuzzy" | "none";

/**
 * 匹配信息
 */
export interface MatchInfo {
  type: MatchType;
  confidence: number;
  originalInput?: string;
  suggestion?: string;
  availableMembers?: string[];
}

/**
 * 增强匹配结果
 */
export interface EnhancedMatchResult<T> {
  member: T | undefined;
  matchInfo: MatchInfo;
}

/**
 * 匹配统计
 */
export interface MatchStatistics {
  totalRows: number;
  matched: number;
  fuzzyMatched: number;
  unmatched: UnmatchedItem[];
  memberTaskCount: Map<string, number>;
  failureRate: number;
}

/**
 * 未匹配项
 */
export interface UnmatchedItem {
  taskTitle: string;
  inputName: string;
  availableMembers: string[];
}

/**
 * 清理 AI 输出的名称，只移除 @ 前缀
 * 例如: "@AI-ChatGPT (gpt-4o)" -> "AI-ChatGPT (gpt-4o)"
 */
export function cleanMemberName(name: string): string {
  return name
    .replace(/^@/, "") // 只移除 @ 前缀
    .trim();
}

/**
 * 名称最大长度限制（防止内存溢出）
 */
const MAX_NAME_LENGTH = 100;

/**
 * 计算两个字符串的相似度（Levenshtein 距离归一化）
 * 注意：为防止内存溢出，字符串长度被限制在 MAX_NAME_LENGTH
 */
export function calculateSimilarity(str1: string, str2: string): number {
  // 限制字符串长度，防止 O(m*n) 矩阵过大导致内存溢出
  const s1 = str1.toLowerCase().slice(0, MAX_NAME_LENGTH);
  const s2 = str2.toLowerCase().slice(0, MAX_NAME_LENGTH);

  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0;

  // 使用空间优化的 Levenshtein 算法（只保留两行，O(n) 空间）
  const len1 = s1.length;
  const len2 = s2.length;

  // 使用两个数组而非完整矩阵，节省内存
  let prevRow = new Array<number>(len2 + 1);
  let currRow = new Array<number>(len2 + 1);

  // 初始化第一行
  for (let j = 0; j <= len2; j++) {
    prevRow[j] = j;
  }

  // 计算距离
  for (let i = 1; i <= len1; i++) {
    currRow[0] = i;
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // 删除
        currRow[j - 1] + 1, // 插入
        prevRow[j - 1] + cost, // 替换
      );
    }
    // 交换行
    [prevRow, currRow] = [currRow, prevRow];
  }

  const distance = prevRow[len2];
  const maxLength = Math.max(len1, len2);
  return 1 - distance / maxLength;
}

/**
 * 精确匹配成员名称（保留原有函数签名以兼容）
 * 直接用清理后的名字和成员真实名字匹配（忽略大小写）
 *
 * @param assigneeName - AI 输出的负责人名称
 * @param teamMembers - 团队成员列表
 * @returns 匹配的成员或 undefined
 */
export function findMemberByName<
  T extends { agentName?: string | null; displayName: string },
>(assigneeName: string, teamMembers: T[]): T | undefined {
  // 清理输入：只移除 @ 前缀
  const cleanedInput = cleanMemberName(assigneeName).toLowerCase();

  // 直接精确匹配（忽略大小写）
  return teamMembers.find((m) => {
    const memberName = m.agentName || m.displayName;
    return memberName.toLowerCase() === cleanedInput;
  });
}

/**
 * 增强版成员名称匹配（带模糊匹配和置信度）
 *
 * @param assigneeName - AI 输出的负责人名称
 * @param teamMembers - 团队成员列表
 * @returns 匹配结果和匹配信息
 */
export function findMemberByNameEnhanced<
  T extends { agentName?: string | null; displayName: string },
>(assigneeName: string, teamMembers: T[]): EnhancedMatchResult<T> {
  const cleanedInput = cleanMemberName(assigneeName).toLowerCase();
  const availableNames = teamMembers.map((m) => m.agentName || m.displayName);

  // 1. 精确匹配
  const exactMatch = teamMembers.find((m) => {
    const memberName = m.agentName || m.displayName;
    return memberName.toLowerCase() === cleanedInput;
  });

  if (exactMatch) {
    return {
      member: exactMatch,
      matchInfo: { type: "exact", confidence: 1.0 },
    };
  }

  // 2. 模糊匹配
  const similarities = teamMembers.map((m) => ({
    member: m,
    similarity: calculateSimilarity(
      cleanedInput,
      (m.agentName || m.displayName).toLowerCase(),
    ),
  }));

  const bestMatch = similarities.sort((a, b) => b.similarity - a.similarity)[0];

  if (bestMatch && bestMatch.similarity > 0.8) {
    return {
      member: bestMatch.member,
      matchInfo: {
        type: "fuzzy",
        confidence: bestMatch.similarity,
        originalInput: assigneeName,
        suggestion: bestMatch.member.agentName || bestMatch.member.displayName,
      },
    };
  }

  // 3. 无法匹配
  return {
    member: undefined,
    matchInfo: {
      type: "none",
      confidence: 0,
      originalInput: assigneeName,
      availableMembers: availableNames,
    },
  };
}

/**
 * 创建空的匹配统计
 */
export function createMatchStatistics(): MatchStatistics {
  return {
    totalRows: 0,
    matched: 0,
    fuzzyMatched: 0,
    unmatched: [],
    memberTaskCount: new Map<string, number>(),
    failureRate: 0,
  };
}

/**
 * 计算匹配失败率（纯函数，无副作用）
 *
 * @param stats - 匹配统计
 * @returns 失败率 (0-1)
 */
export function calculateFailureRate(stats: MatchStatistics): number {
  if (stats.totalRows === 0) return 0;
  return stats.unmatched.length / stats.totalRows;
}

/**
 * 检查匹配失败率是否超过阈值（纯函数，无副作用）
 *
 * @param stats - 匹配统计
 * @param threshold - 失败率阈值（默认 0.1 即 10%）
 * @returns 是否超过阈值
 */
export function isMatchFailureRateExceeded(
  stats: MatchStatistics,
  threshold: number = 0.1,
): boolean {
  const failureRate = calculateFailureRate(stats);
  return failureRate > threshold;
}

/**
 * 更新统计对象的失败率字段（显式修改）
 *
 * @param stats - 匹配统计（会被修改）
 */
export function updateFailureRate(stats: MatchStatistics): void {
  stats.failureRate = calculateFailureRate(stats);
}

/**
 * 格式化匹配失败错误消息
 */
export function formatMatchFailureError(
  stats: MatchStatistics,
  availableMembers: string[],
): string {
  const failureRate = calculateFailureRate(stats);
  const failurePercent = (failureRate * 100).toFixed(1);
  const unmatchedNames = stats.unmatched.map((u) => u.inputName).join(", ");

  return (
    `任务分配失败率过高 (${stats.unmatched.length}/${stats.totalRows}, ${failurePercent}%)。\n` +
    `无法匹配的名称: ${unmatchedNames}\n` +
    `可用成员: ${availableMembers.join(", ")}`
  );
}

// 保留旧函数名以兼容其他代码
export const normalizeMemberName = cleanMemberName;
