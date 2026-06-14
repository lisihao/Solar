/**
 * citation-verifier.utils.ts
 *
 * 引用准确性后验证：纯确定性文本处理，零 LLM 调用。
 *
 * 三个核心操作：
 * 1. 提取每个 [N] 引用及其上下文
 * 2. 为每条证据构建特征指纹（标题、数字、专有名词、n-gram）
 * 3. 打分匹配 → 纠正错误引用 / 移除幻觉引用
 */

// ==================== Types ====================

/** 从内容中提取的单个引用及其上下文 */
export interface CitationWithContext {
  /** 引用编号 */
  index: number;
  /** 引用在原文中的字符起始位置 */
  position: number;
  /** 引用前后的上下文文本（前后各 ~200 字符） */
  context: string;
}

/** 证据的特征指纹 */
export interface EvidenceFingerprint {
  /** 证据编号 */
  index: number;
  /** 标题（小写） */
  titleLower: string;
  /** 域名（小写） */
  domainLower: string;
  /** 精确数字集合（百分比、金额、年份等） */
  numbers: Set<string>;
  /** 字符级 3-gram 集合 */
  trigrams: Set<string>;
  /** 关键词集合（从标题 + 内容提取的重要词汇） */
  keywords: Set<string>;
}

/** 单条引用的验证结果 */
export interface CitationVerifyResult {
  /** 原始引用编号 */
  originalIndex: number;
  /** 纠正后的编号（null = 移除该引用） */
  correctedIndex: number | null;
  /** 原始引用的匹配得分 */
  originalScore: number;
  /** 最佳匹配的得分 */
  bestScore: number;
  /** 最佳匹配的证据编号 */
  bestMatchIndex: number;
  /** 操作类型 */
  action: "keep" | "correct" | "remove";
}

/** 验证统计 */
export interface VerificationStats {
  total: number;
  kept: number;
  corrected: number;
  removed: number;
}

/** verifyCitations 的返回结果 */
export interface VerifyCitationsResult {
  /** 纠正后的内容 */
  content: string;
  /** 每条引用的验证结果 */
  results: CitationVerifyResult[];
  /** 统计 */
  stats: VerificationStats;
}

/** 证据数据（仅需验证所需字段） */
export interface EvidenceForVerification {
  /** 证据编号（在 prompt 中的 [N]） */
  index: number;
  /** 标题 */
  title: string;
  /** 来源域名 */
  domain?: string | null;
  /** 内容片段或全文 */
  content?: string | null;
}

// ==================== 1. 提取引用及上下文 ====================

const CONTEXT_RADIUS = 200; // 前后各取 200 字符

/**
 * 提取内容中每个 [N] 引用及其前后上下文
 */
export function extractCitationsWithContext(
  content: string,
): CitationWithContext[] {
  const results: CitationWithContext[] = [];
  let match: RegExpExecArray | null;

  // 每次创建本地正则，避免模块级 g flag lastIndex 状态泄漏
  const citationRegex = /\[(\d+)\]/g;

  while ((match = citationRegex.exec(content)) !== null) {
    const index = parseInt(match[1], 10);
    const position = match.index;

    const ctxStart = Math.max(0, position - CONTEXT_RADIUS);
    const ctxEnd = Math.min(
      content.length,
      position + match[0].length + CONTEXT_RADIUS,
    );
    const context = content.slice(ctxStart, ctxEnd);

    results.push({ index, position, context });
  }

  return results;
}

// ==================== 2. 构建证据指纹 ====================

/**
 * 从文本中提取精确数字（百分比、金额、年份等）
 * 返回标准化后的字符串集合
 */
function extractNumbers(text: string): Set<string> {
  const numbers = new Set<string>();
  if (!text) return numbers;

  // 百分比: 45%, 45.6%, 45％
  const pctRegex = /(\d+(?:\.\d+)?)\s*[%％]/g;
  let m: RegExpExecArray | null;
  while ((m = pctRegex.exec(text)) !== null) {
    numbers.add(m[1] + "%");
  }

  // 金额: $100B, $1.5万亿, ¥300亿, 100亿美元
  const amtRegex =
    /(?:[$¥€£])\s*(\d+(?:\.\d+)?)\s*(?:[BMTKbmtk万亿千百十]|(?:billion|million|trillion))?/gi;
  while ((m = amtRegex.exec(text)) !== null) {
    numbers.add(m[1]);
  }

  // CJK 金额: 100亿, 1.5万亿, 300万
  const cjkAmtRegex = /(\d+(?:\.\d+)?)\s*(?:万亿|亿|万|千)/g;
  while ((m = cjkAmtRegex.exec(text)) !== null) {
    numbers.add(m[1]);
  }

  // 年份: 2020-2030
  const yearRegex = /\b(20[1-3]\d)\b/g;
  while ((m = yearRegex.exec(text)) !== null) {
    numbers.add(m[1]);
  }

  // 独立大数字 (>=4位): 1000, 2500
  const bigNumRegex = /\b(\d{4,})\b/g;
  while ((m = bigNumRegex.exec(text)) !== null) {
    // 排除已被年份捕获的
    if (!numbers.has(m[1])) {
      numbers.add(m[1]);
    }
  }

  return numbers;
}

/**
 * 生成字符级 3-gram 集合
 * 对中文直接按字符切分，对英文先转小写
 */
function buildTrigrams(text: string): Set<string> {
  const trigrams = new Set<string>();
  if (!text || text.length < 3) return trigrams;

  // 归一化：去除多余空格，转小写
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();

  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }

  return trigrams;
}

/**
 * 从标题和内容中提取关键词
 */
function extractKeywords(title: string, content?: string | null): Set<string> {
  const keywords = new Set<string>();
  const text = `${title} ${content || ""}`.toLowerCase();

  // 英文关键词: 3+ 字符的词
  const enWords = text.match(/[a-z][a-z0-9]{2,}/g);
  if (enWords) {
    // 过滤常见停用词
    const stopWords = new Set([
      "the",
      "and",
      "for",
      "are",
      "but",
      "not",
      "you",
      "all",
      "can",
      "had",
      "her",
      "was",
      "one",
      "our",
      "out",
      "has",
      "that",
      "this",
      "with",
      "from",
      "have",
      "been",
      "will",
      "they",
      "were",
      "said",
      "each",
      "which",
      "their",
      "about",
      "would",
      "make",
      "like",
      "than",
      "them",
      "into",
      "could",
      "also",
      "more",
      "some",
      "other",
      "over",
      "such",
      "after",
      "most",
    ]);
    for (const w of enWords) {
      if (!stopWords.has(w) && w.length >= 3) {
        keywords.add(w);
      }
    }
  }

  // 中文关键词: 提取 2-4 字的 CJK 词汇（简单策略：连续中文字符切分为 bigram）
  const cjkChars = text.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < cjkChars.length - 1; i++) {
    keywords.add(cjkChars.slice(i, i + 2));
  }

  return keywords;
}

/**
 * 构建单条证据的特征指纹
 */
export function buildEvidenceFingerprint(
  evidence: EvidenceForVerification,
): EvidenceFingerprint {
  const fullText = `${evidence.title} ${evidence.content || ""}`;

  return {
    index: evidence.index,
    titleLower: evidence.title.toLowerCase(),
    domainLower: (evidence.domain || "").toLowerCase(),
    numbers: extractNumbers(fullText),
    trigrams: buildTrigrams(evidence.title), // 仅对标题做 trigram（内容太长）
    keywords: extractKeywords(evidence.title, evidence.content),
  };
}

// ==================== 3. 计算匹配得分 ====================

/**
 * 计算引用上下文与证据指纹的加权匹配得分
 */
export function scoreCitationMatch(
  context: string,
  fingerprint: EvidenceFingerprint,
): number {
  let score = 0;
  const ctxLower = context.toLowerCase();

  // 1. 标题子串匹配 (+10)
  if (
    fingerprint.titleLower.length >= 4 &&
    ctxLower.includes(fingerprint.titleLower)
  ) {
    score += 10;
  } else if (fingerprint.titleLower.length >= 4) {
    // 标题部分匹配：检查标题中的关键片段（4+ 字符的连续子串）
    const titleParts = fingerprint.titleLower
      .split(/[\s,.:;，。：；]+/)
      .filter((p) => p.length >= 4);
    const matchedParts = titleParts.filter((p) => ctxLower.includes(p));
    if (matchedParts.length > 0) {
      score += Math.min(8, matchedParts.length * 3);
    }
  }

  // 2. 域名/来源匹配 (+8)
  if (
    fingerprint.domainLower.length >= 3 &&
    ctxLower.includes(fingerprint.domainLower)
  ) {
    score += 8;
  }

  // 3. 精确数字匹配 (+5 每个，上限 20)
  let numberMatches = 0;
  for (const num of fingerprint.numbers) {
    if (context.includes(num)) {
      numberMatches++;
    }
  }
  score += Math.min(20, numberMatches * 5);

  // 4. 关键词重叠
  let keywordMatches = 0;
  for (const kw of fingerprint.keywords) {
    if (ctxLower.includes(kw)) {
      keywordMatches++;
    }
  }
  // 归一化：匹配关键词数 / 总关键词数（避免除零）
  const keywordTotal = fingerprint.keywords.size || 1;
  const keywordRatio = keywordMatches / keywordTotal;
  score += keywordRatio * 15; // 最高 15 分

  // 5. 标题 trigram 重叠率（补充信号）
  if (fingerprint.trigrams.size > 0) {
    const ctxTrigrams = buildTrigrams(context);
    let trigramOverlap = 0;
    for (const tg of fingerprint.trigrams) {
      if (ctxTrigrams.has(tg)) {
        trigramOverlap++;
      }
    }
    const trigramRatio = trigramOverlap / fingerprint.trigrams.size;
    score += trigramRatio * 10; // 最高 10 分
  }

  return score;
}

// ==================== 4. 主验证函数 ====================

/** 最低匹配阈值：低于此分数的引用视为幻觉 */
const MIN_MATCH_THRESHOLD = 3;

/** 纠正倍率：最佳匹配得分 > 当前得分 × 此倍率时才纠正 */
const CORRECTION_RATIO = 1.5;

/**
 * 验证并纠正内容中的引用
 *
 * 对每个 [N] 引用：
 * - 如果当前证据是最佳匹配（或接近最佳），保留
 * - 如果存在显著更好的匹配（>1.5x 得分），纠正为最佳匹配
 * - 如果没有任何证据超过最低阈值，移除该引用（幻觉）
 *
 * @param content 含引用标记的文本
 * @param evidenceList 可用证据列表
 * @returns 纠正后的内容和验证结果
 */
export function verifyCitations(
  content: string,
  evidenceList: EvidenceForVerification[],
): VerifyCitationsResult {
  if (!content || evidenceList.length === 0) {
    return {
      content,
      results: [],
      stats: { total: 0, kept: 0, corrected: 0, removed: 0 },
    };
  }

  // 构建所有证据的指纹
  const fingerprints = evidenceList.map(buildEvidenceFingerprint);

  // 提取所有引用
  const citations = extractCitationsWithContext(content);
  if (citations.length === 0) {
    return {
      content,
      results: [],
      stats: { total: 0, kept: 0, corrected: 0, removed: 0 },
    };
  }

  // 构建有效证据编号集合（用于快速查找）
  const validIndices = new Set(evidenceList.map((e) => e.index));

  // 验证每个引用
  const results: CitationVerifyResult[] = [];

  for (const citation of citations) {
    // 对所有证据打分
    const scores = fingerprints.map((fp) => ({
      index: fp.index,
      score: scoreCitationMatch(citation.context, fp),
    }));

    // 按得分排序
    scores.sort((a, b) => b.score - a.score);

    const bestMatch = scores[0];
    const currentScore =
      scores.find((s) => s.index === citation.index)?.score ?? 0;

    let action: "keep" | "correct" | "remove";
    let correctedIndex: number | null;

    if (!validIndices.has(citation.index)) {
      // 引用了不存在的证据编号
      if (bestMatch.score >= MIN_MATCH_THRESHOLD) {
        action = "correct";
        correctedIndex = bestMatch.index;
      } else {
        action = "remove";
        correctedIndex = null;
      }
    } else if (bestMatch.score < MIN_MATCH_THRESHOLD) {
      // 没有任何证据与上下文匹配 → 幻觉引用
      action = "remove";
      correctedIndex = null;
    } else if (
      bestMatch.index !== citation.index &&
      currentScore < MIN_MATCH_THRESHOLD &&
      bestMatch.score >= MIN_MATCH_THRESHOLD
    ) {
      // 当前引用得分极低且存在明显更好的匹配
      action = "correct";
      correctedIndex = bestMatch.index;
    } else if (
      bestMatch.index !== citation.index &&
      bestMatch.score > currentScore * CORRECTION_RATIO &&
      bestMatch.score >= MIN_MATCH_THRESHOLD
    ) {
      // 最佳匹配显著优于当前引用
      action = "correct";
      correctedIndex = bestMatch.index;
    } else {
      // 当前引用可接受
      action = "keep";
      correctedIndex = citation.index;
    }

    results.push({
      originalIndex: citation.index,
      correctedIndex,
      originalScore: currentScore,
      bestScore: bestMatch.score,
      bestMatchIndex: bestMatch.index,
      action,
    });
  }

  // 应用纠正：从后往前替换避免位置偏移
  let correctedContent = content;
  const stats: VerificationStats = {
    total: results.length,
    kept: 0,
    corrected: 0,
    removed: 0,
  };

  // 按位置从后往前处理
  const citationsWithResults = citations.map((c, i) => ({
    citation: c,
    result: results[i],
  }));
  citationsWithResults.sort(
    (a, b) => b.citation.position - a.citation.position,
  );

  for (const { citation, result } of citationsWithResults) {
    const originalMarker = `[${citation.index}]`;
    const markerStart = citation.position;
    const markerEnd = markerStart + originalMarker.length;

    switch (result.action) {
      case "keep":
        stats.kept++;
        break;
      case "correct":
        stats.corrected++;
        correctedContent =
          correctedContent.slice(0, markerStart) +
          `[${result.correctedIndex}]` +
          correctedContent.slice(markerEnd);
        break;
      case "remove":
        stats.removed++;
        // 移除引用标记，处理前后可能的多余空格
        let removeStart = markerStart;
        const removeEnd = markerEnd;
        // 如果前面是空格，也移除
        if (removeStart > 0 && correctedContent[removeStart - 1] === " ") {
          removeStart--;
        }
        correctedContent =
          correctedContent.slice(0, removeStart) +
          correctedContent.slice(removeEnd);
        break;
    }
  }

  return { content: correctedContent, results, stats };
}

// ==================== 5. 连续编号工具函数 ====================

/** 本地→全局编号映射 */
export type LocalToGlobalMap = Map<number, number>;

/**
 * 将不连续的证据编号映射为连续编号 1, 2, 3...
 * 返回映射表供写完后还原
 *
 * @param globalIndices 原始的全局编号列表（可能不连续，如 [2, 5, 8, 11, 13]）
 * @returns localToGlobalMap: 连续编号 → 全局编号（如 1→2, 2→5, 3→8...）
 */
export function buildContiguousMapping(
  globalIndices: number[],
): LocalToGlobalMap {
  const sorted = [...globalIndices].sort((a, b) => a - b);
  const map: LocalToGlobalMap = new Map();

  sorted.forEach((globalIdx, i) => {
    map.set(i + 1, globalIdx); // local 1-based → global
  });

  return map;
}

/**
 * 将内容中的本地连续编号还原为全局编号
 *
 * @param content 含本地连续编号 [1], [2]... 的文本
 * @param localToGlobalMap 本地→全局映射
 * @returns 还原为全局编号的文本
 */
export function restoreGlobalIndices(
  content: string,
  localToGlobalMap: LocalToGlobalMap,
): string {
  if (localToGlobalMap.size === 0) return content;

  return content.replace(/\[(\d+)\]/g, (match, numStr) => {
    const localIdx = parseInt(numStr, 10);
    const globalIdx = localToGlobalMap.get(localIdx);
    return globalIdx !== undefined ? `[${globalIdx}]` : match;
  });
}
