/**
 * chapter-integrity.validator.ts
 *
 * Pure-utility functions for validating and inspecting written chapter content.
 * Extracted from per-dim-pipeline.util.ts (L1645-1740) as part of PR-D-1 god-class split.
 *
 * No LLM calls, no side-effects, fully synchronous / exported for reuse.
 */

const MIN_CHAPTER_SUBSTANTIVE_CHARS = 60;

/**
 * Return type for validateWrittenChapters.
 *
 * ★ 2026-05-12 v1: tolerance parameter (missing chapters allowed by ratio).
 * ★ 2026-05-13 v2: filter-and-forward semantics — validChapters excludes too-short
 *   and outline-only entries; droppedChapters carries the reason for each exclusion.
 */
export interface ChapterIntegrityResult<C> {
  missingCount: number;
  missingRatio: number;
  validChapters: C[];
  droppedChapters: Array<{ chapter: C; reason: string }>;
}

/**
 * Validates a set of written chapters against an expected chapter count.
 *
 * - Chapters whose substantive text length is below the minimum threshold are dropped.
 * - Outline-only chapters (no prose lines) are dropped.
 * - If the resulting missing ratio exceeds `tolerance.maxMissingRatio`, throws.
 */
export function validateWrittenChapters<
  C extends { index: number; heading: string; body: string; wordCount: number },
>(args: {
  dimensionName: string;
  expectedCount: number;
  chapters: C[];
  tolerance?: { maxMissingRatio: number };
}): ChapterIntegrityResult<C> {
  const { dimensionName, expectedCount, chapters, tolerance } = args;
  const maxMissingRatio = tolerance?.maxMissingRatio ?? 0;

  if (chapters.length > expectedCount) {
    throw new Error(
      `[chapter-integrity] ${dimensionName}: expected ${expectedCount} chapters, got ${chapters.length} (more than expected)`,
    );
  }

  const validChapters: C[] = [];
  const droppedChapters: Array<{ chapter: C; reason: string }> = [];

  for (const chapter of chapters) {
    const substantive = extractSubstantiveChapterText(chapter.body);
    if (substantive.length < MIN_CHAPTER_SUBSTANTIVE_CHARS) {
      droppedChapters.push({
        chapter,
        reason: `body too short after normalization (${substantive.length} chars)`,
      });
      continue;
    }
    if (isOutlineOnlyChapter(substantive)) {
      droppedChapters.push({
        chapter,
        reason: `outline-only without substantive prose`,
      });
      continue;
    }
    validChapters.push(chapter);
  }

  const missingCount = Math.max(0, expectedCount - validChapters.length);
  const missingRatio =
    expectedCount > 0 ? missingCount / expectedCount : missingCount > 0 ? 1 : 0;

  if (missingCount > 0 && missingRatio > maxMissingRatio) {
    const droppedDetail = droppedChapters
      .map((d) => `§${d.chapter.index} "${d.chapter.heading}" (${d.reason})`)
      .join("; ");
    throw new Error(
      `[chapter-integrity] ${dimensionName}: expected ${expectedCount} chapters, got ${chapters.length} (missing ${missingCount}, ratio ${(missingRatio * 100).toFixed(1)}% > tolerance ${(maxMissingRatio * 100).toFixed(0)}%)${droppedDetail ? "; dropped: " + droppedDetail : ""}`,
    );
  }

  return { missingCount, missingRatio, validChapters, droppedChapters };
}

/**
 * Strip markdown formatting and list markers from chapter body, leaving only
 * prose characters.  Used to measure substantive content length.
 */
export function extractSubstantiveChapterText(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+[^\n]+\n*/gmu, "")
    .replace(/^>\s*/gmu, "")
    .replace(/^\s*[-*•·—–]\s+/gmu, "")
    .replace(/^\s*\d+[.)、]\s+/gmu, "")
    .replace(/^\s*[（(]?\d+[)）.、]?\s+/gmu, "")
    .replace(/^\s*[一二三四五六七八九十]+[、.)]\s+/gmu, "")
    .replace(/\[(\d+)\]/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Returns true when the chapter text contains only headings/list items and
 * no substantive prose lines.
 */
export function isOutlineOnlyChapter(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return true;

  const proseLines = lines.filter(
    (line) =>
      !/^#{1,6}\s+/.test(line) &&
      !/^[-*•·—–]/.test(line) &&
      !/^\d+[.)、]\s*/.test(line) &&
      !/^[（(]?\d+[)）.、]?\s*/.test(line) &&
      !/^[一二三四五六七八九十]+[、.)]\s*/u.test(line),
  );

  return proseLines.length === 0;
}
