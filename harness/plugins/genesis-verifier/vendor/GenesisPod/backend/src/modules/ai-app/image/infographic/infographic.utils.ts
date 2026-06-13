import { ICONS, DEFAULT_ICON } from "./infographic.constants";

/**
 * HTML 转义
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * 文本截断（保留原样，不添加省略号）
 */
export function truncateText(text: string, _maxLength: number): string {
  // 移除截断逻辑，保持原样
  // AI 应该已经提供了合适长度的内容
  return text;
}

/**
 * 调整颜色亮度
 */
export function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * 获取图标 SVG
 */
export function getIcon(type?: string): string {
  if (!type) return DEFAULT_ICON;
  const normalized = type.toLowerCase().replace(/[^a-z]/g, "");
  return ICONS[normalized] || DEFAULT_ICON;
}
