/**
 * Text Selection 平台类型
 *
 * 抽自 ai-insights/panels/TextSelectionContextMenu，作为跨模块（TI / AI Writing /
 * AI Office / Agent Playground）共享的"用户在长文本里选中一段"的统一描述。
 *
 * 不依赖任何业务 domain 类型；纯结构性接口。
 */

/** 单次文本选择的描述（用户拖蓝选中一段文字时的快照）。 */
export interface SelectionInfo {
  /** 被选中的文字 */
  text: string;
  /** 选区在容器内的起始 offset（DOM-relative） */
  startOffset: number;
  /** 选区在容器内的结束 offset */
  endOffset: number;
  /** 选区前的上下文片段（用于在重渲染后稳定匹配 / fuzzy locate） */
  selectorPrefix?: string;
  /** 选区后的上下文片段 */
  selectorSuffix?: string;
}
