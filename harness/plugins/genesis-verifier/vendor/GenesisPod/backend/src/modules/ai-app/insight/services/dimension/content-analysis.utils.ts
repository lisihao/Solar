/**
 * Content Analysis Utilities
 *
 * Pure functions for extracting structured items (trends, challenges, opportunities)
 * from Markdown content. Extracted from DimensionMissionService to reduce god-object size.
 */

import type { Trend, Challenge, Opportunity } from "../../types/research.types";

/**
 * Extract trend items from Markdown content
 */
export function extractTrendsFromContent(content: string): Trend[] {
  return extractSectionItems(content, [
    "趋势",
    "trend",
    "发展趋势",
    "未来趋势",
  ]).map((item) => ({
    trend: item,
    direction: "emerging" as const,
    timeframe: "近期",
    evidenceIds: [],
  }));
}

/**
 * Extract challenge items from Markdown content
 */
export function extractChallengesFromContent(content: string): Challenge[] {
  return extractSectionItems(content, [
    "挑战",
    "challenge",
    "风险",
    "问题",
    "障碍",
  ]).map((item) => ({
    challenge: item,
    impact: "",
    evidenceIds: [],
  }));
}

/**
 * Extract opportunity items from Markdown content
 */
export function extractOpportunitiesFromContent(
  content: string,
): Opportunity[] {
  return extractSectionItems(content, [
    "机遇",
    "机会",
    "opportunity",
    "发展机遇",
  ]).map((item) => ({
    opportunity: item,
    potential: "",
    evidenceIds: [],
  }));
}

/**
 * H1 fix: Multi-strategy Markdown section item extraction
 * Strategy 1: ## Header + bullet list items
 * Strategy 2: **Bold keyword**: content
 * Strategy 3: Sentences containing keywords
 */
export function extractSectionItems(
  content: string,
  sectionKeywords: string[],
): string[] {
  // Strategy 1: Markdown header + bullet items
  const fromHeaders = extractFromHeaders(content, sectionKeywords);
  if (fromHeaders.length > 0) return fromHeaders;

  // Strategy 2: **Bold keyword**: content pattern
  const fromBold = extractFromBoldPatterns(content, sectionKeywords);
  if (fromBold.length > 0) return fromBold;

  // Strategy 3: Sentences containing keywords
  return extractFromSentences(content, sectionKeywords);
}

function extractFromHeaders(
  content: string,
  sectionKeywords: string[],
): string[] {
  const items: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const isHeader = /^#{2,4}\s+/.test(line);
    if (!isHeader) continue;

    const headerText = line.replace(/^#{2,4}\s+/, "").toLowerCase();
    const matched = sectionKeywords.some((kw) =>
      headerText.includes(kw.toLowerCase()),
    );
    if (!matched) continue;

    for (let j = i + 1; j < lines.length; j++) {
      const nextLine = lines[j].trim();
      if (/^#{2,4}\s+/.test(nextLine)) break;
      const bulletMatch = nextLine.match(/^[-*]\s+\*\*(.+?)\*\*/);
      if (bulletMatch) {
        items.push(bulletMatch[1].replace(/:$/, "").trim());
      } else {
        const simpleBullet = nextLine.match(/^[-*]\s+(.{15,})/);
        if (simpleBullet) {
          const text = simpleBullet[1].replace(/\*\*/g, "").trim();
          const sentence = text.split(/[。；;]/)[0];
          if (sentence.length >= 10) {
            items.push(
              sentence.length > 120
                ? sentence.substring(0, 120) + "..."
                : sentence,
            );
          }
        }
      }
      if (items.length >= 5) break;
    }
    break;
  }

  return items;
}

function extractFromBoldPatterns(
  content: string,
  sectionKeywords: string[],
): string[] {
  const items: string[] = [];
  const regex = /\*\*(.+?)\*\*[:：]\s*(.+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const label = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (
      sectionKeywords.some((kw) => label.includes(kw.toLowerCase())) &&
      value.length >= 10
    ) {
      items.push(value.length > 120 ? value.substring(0, 120) + "..." : value);
      if (items.length >= 5) break;
    }
  }
  return items;
}

function extractFromSentences(
  content: string,
  sectionKeywords: string[],
): string[] {
  const sentences = content.match(/[^。！？\n]+[。！？]/g) || [];
  return sentences
    .filter(
      (s) =>
        s.length >= 15 &&
        sectionKeywords.some((kw) =>
          s.toLowerCase().includes(kw.toLowerCase()),
        ),
    )
    .slice(0, 5)
    .map((s) => {
      const trimmed = s.replace(/^[，、：:;\s]+/, "").trim();
      return trimmed.length > 120 ? trimmed.substring(0, 120) + "..." : trimmed;
    });
}

/**
 * Replace LLM prompt citation indices [N] with actual database citation indices.
 * E.g., if the first dimension has 10 evidence items, the second dimension's [1] becomes [11].
 */
export function replaceEvidenceIds(
  content: string,
  indexMapping: Map<number, number>,
): string {
  let result = content;
  // Replace from largest to smallest to avoid [1] replacing [10]
  const sortedEntries = Array.from(indexMapping.entries()).sort(
    (a, b) => b[0] - a[0],
  );
  for (const [promptIndex, actualCitationIndex] of sortedEntries) {
    if (promptIndex !== actualCitationIndex) {
      // Replace citation references [N]
      const pattern = new RegExp(`\\[${promptIndex}\\]`, "g");
      result = result.replace(pattern, `[${actualCitationIndex}]`);
      // Replace figure placeholders <!-- figure:N:M -->
      const figPattern = new RegExp(`(<!--\\s*figure:)${promptIndex}(:)`, "g");
      result = result.replace(figPattern, `$1${actualCitationIndex}$2`);
    }
  }
  return result;
}

/**
 * Validate date, returning null for invalid dates.
 * Fixes Invalid Date causing Prisma validation errors.
 */
export function validateDate(
  date: Date | string | null | undefined,
): Date | null {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return d;
}
