/**
 * PPT 相关工具函数
 * 提供幻灯片数量计算、内容解析等功能
 */

/**
 * 从 markdown 内容计算幻灯片数量
 * @param markdown - PPT 的 markdown 内容
 * @returns 幻灯片数量
 */
export function calculateSlideCount(markdown: string): number {
  if (!markdown || typeof markdown !== 'string') {
    return 0;
  }

  // 方法1: 统计幻灯片标题数量 (### Slide X, ## 第X页 等)
  const slideHeaders = (
    markdown.match(
      /^#{2,4}\s*(Slide\s*\d+|第\s*\d+\s*[页页]|封面|目录|.*[页页][:：])/gim
    ) || []
  ).length;

  // 方法2: 统计分隔符数量 (---)
  const separators = (markdown.match(/^---$/gm) || []).length;

  // 取两者中较大的值
  // 如果有分隔符，则幻灯片数 = 分隔符数 + 1
  // 如果没有分隔符但有标题，则幻灯片数 = 标题数
  return Math.max(slideHeaders, separators > 0 ? separators + 1 : 0);
}

/**
 * 验证 markdown 是否包含有效的幻灯片内容
 * @param markdown - PPT 的 markdown 内容
 * @returns 是否包含有效内容
 */
export function hasValidSlideContent(markdown: string): boolean {
  return calculateSlideCount(markdown) > 0;
}

/**
 * 从 markdown 提取幻灯片标题列表
 * @param markdown - PPT 的 markdown 内容
 * @returns 标题数组
 */
export function extractSlideTitles(markdown: string): string[] {
  if (!markdown || typeof markdown !== 'string') {
    return [];
  }

  const titles: string[] = [];
  const lines = markdown.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // 匹配幻灯片标题
    const match = trimmed.match(/^#{2,4}\s*(.+)$/);
    if (match) {
      titles.push(match[1]);
    }
  }

  return titles;
}
