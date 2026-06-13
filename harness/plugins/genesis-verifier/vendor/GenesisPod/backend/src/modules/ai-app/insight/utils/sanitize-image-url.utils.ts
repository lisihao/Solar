/**
 * ★ 统一的 figure URL 有效性校验（单一真相源）
 *
 * 在以下位置使用：
 * - FigureExtractorService.validateSingleFigure (提取阶段)
 * - ReportSynthesisService.collectAllCharts (收集阶段)
 * - SectionWriterService.buildChartAllocations (写作阶段)
 *
 * ★ 只允许 HTTP/HTTPS URL，拒绝其他所有格式：
 * - data: URL（包括 data:image/）：不再生成也不再保留 base64 图片
 * - placeholder strings: LLM 幻觉的 "[base64-image:chart]" 等
 * - fabricated URLs: LLM 伪造的含 "xxxx" 的假 URL
 * - PDF links: 论文 PDF 被误识别为图片
 * - Substack CDN 损坏: $s! / %24s! 编码错误
 * - 非 HTTP 协议: 相对路径、file://、ftp:// 等
 */
export function isValidFigureUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.startsWith("[base64-image") || url.startsWith("base64-image"))
    return false;
  // ★ v7: 所有 data: URL 一律拒绝（不再兼容 base64 图片）
  if (url.startsWith("data:")) return false;
  if (url.includes("xxxx")) return false;
  if (/\.pdf(\?|$)/i.test(url)) return false;
  // ★ Substack CDN 编码损坏（$s! 或 %24s!）— 这些 URL 无法加载
  if (/\$s!|%24s!/i.test(url)) return false;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  return true;
}
