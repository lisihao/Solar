/**
 * Citation Navigation - 引用导航共享模块
 *
 * 用于在报告中点击引用标记时跳转到参考文献面板
 * 这是一个模块级的回调机制，避免组件间的循环依赖
 */

// 引用点击回调类型
type CitationClickCallback = (evidenceId: string) => void;

// 模块级回调存储
let citationClickCallback: CitationClickCallback | null = null;

/**
 * 设置引用点击回调
 * 由 TopicContentPanel 在挂载时调用
 */
export function setCitationClickCallback(
  callback: CitationClickCallback | null
) {
  citationClickCallback = callback;
}

/**
 * 触发引用点击事件
 * 由各个引用组件（CitationBadge, CitationTooltip 等）调用
 */
export function triggerCitationClick(evidenceId: string) {
  if (citationClickCallback) {
    citationClickCallback(evidenceId);
  }
}

/**
 * 检查是否有回调注册
 */
export function hasCitationClickCallback(): boolean {
  return citationClickCallback !== null;
}
