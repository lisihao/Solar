/**
 * Cards — 卡片设计系统（统一归属：components/ui/cards/）
 *
 * 单一事实来源（标准 22 §2.2）：**所有卡片 canonical 一律落本目录**，
 * 不再分散到 common/cards 或 common/asset-card（2026-05-21 收口）。
 * 由 audit-ui-discipline R15 守护：卡片目录只允许出现在 components/ui/cards/。
 *
 * - StatCard：统计/指标 tile（数字 + 标签）
 * - SectionPanelCard：区块/面板卡
 * - MessageCardShell：对话流消息卡外壳
 * - AssetCard（asset-card/）：资源/资产列表卡（composite；依赖 common/ClientDate，ui→common 已有先例）
 * - CardGrid：标准卡片网格容器（1/2/3/4 列响应式 + 等高）
 * - FeedCard：横向信息流行卡
 * - CreateCard：虚线“+新建”占位卡
 * - SettingsSectionCard：设置/区块卡
 * - CitationListItem / CitationBadge：引用/来源卡（components/common/citations，待后续并入）
 */

export { StatCard } from './StatCard';
export type { StatCardProps, StatTone } from './StatCard';
export { SectionPanelCard } from './SectionPanelCard';
export type { SectionPanelCardProps, SectionAccent } from './SectionPanelCard';
export { MessageCardShell } from './MessageCardShell';
export type { MessageCardShellProps, MessageTone } from './MessageCardShell';
export { CardGrid } from './CardGrid';
export type { CardGridProps } from './CardGrid';
export { FeedCard } from './FeedCard';
export type { FeedCardProps, FeedCardAction } from './FeedCard';
export { CreateCard } from './CreateCard';
export type { CreateCardProps } from './CreateCard';
export { SettingsSectionCard } from './SettingsSectionCard';
export * from './asset-card';
