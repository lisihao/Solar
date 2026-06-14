/**
 * Unified word count for mixed Chinese/English report content.
 *
 * Counts:
 *   - Each Chinese/CJK character as 1 "word"
 *   - Each contiguous Latin letter sequence as 1 "word"
 *
 * This is the single source of truth for word counts across both the
 * continuous (ReportEditor) and chapter (ChapterizedReportView) views.
 * Previously, TopicDetail used raw `fullReport.length` (character count
 * including markdown/LaTeX syntax), producing 2-3x inflated numbers
 * compared to the chapter view's per-chapter sum.
 */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars + englishWords;
}
