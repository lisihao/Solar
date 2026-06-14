/**
 * Citations - 通用引用系统
 *
 * 抽自 Topic Insights 报告引用模块，沉淀为跨模块平台能力。
 * - CitationBadge：行内 `[1]` 徽章 + hover 来源弹层
 * - CitationGroup：3+ 徽章自动折叠为 `[1] [2] +N` 形态
 * - CitationListItem：References/Sources 区块 `.map` 渲染的来源行（标题+摘要+元信息+链接）
 * - citationNavigation：点击徽章 → 跨视图跳转 References tab 的全局 callback
 *
 * 适用场景：内联引用用 Badge/Group；来源列表区块用 ListItem。
 */

export { CitationBadge } from './CitationBadge';
export { CitationGroup } from './CitationGroup';
export { CitationListItem } from './CitationListItem';
export type { CitationListItemProps } from './CitationListItem';
export {
  setCitationClickCallback,
  triggerCitationClick,
  hasCitationClickCallback,
} from './citationNavigation';
