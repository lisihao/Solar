/**
 * drawer-derive-shapes.ts — Drawer derive re-export module（B4-4 final）
 *
 * 落地依据：thinning plan §B4-4 / §B5-2 / §7.2 raw event timeline display.
 *
 * deriveDrawerSections 是 §7.2 允许的 frontend behavior（"raw event timeline
 * display" + "local presentation-only fallbacks"），不是 mission truth derivation。
 * 它从 agent.trace 派生 drawer UI sections（toolUsage / searchCalls / sources）—
 * 这部分数据 backend canonical view 尚未 expose，§7.2 允许 frontend 从 raw event 解析。
 *
 * 本文件让 TodoDetailDrawer 通过 -shapes proxy 引用，与其他 derive 模块保持一致的
 * 解耦风格。
 */

export type {
  ParsedFinding,
  ParsedToolUsage,
  ParsedSource,
  ParsedSearchCall,
  DrawerDerived,
} from './drawer-derive';

export { deriveDrawerSections, TOOL_LABEL } from './drawer-derive';
