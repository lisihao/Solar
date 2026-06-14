/**
 * Shared types for AI Research components
 *
 * AI 编辑相关类型已下沉到平台层 components/common/ai-text-edit/types.ts
 * 此处 re-export 保留向后兼容（业务侧旧 import 仍可用）。
 */

export type {
  AIEditOperation,
  AIEditOperationRequest,
  AIEditStyleType as StyleType,
} from '@/components/common/ai-text-edit/types';

// Text selection info — 业务侧本地保留（lib/text-selection 也有平台版本）
export interface TextSelection {
  text: string;
  startOffset: number;
  endOffset: number;
}

// Text selection with DOMRect for positioning (used by AIFloatingToolbar)
export interface TextSelectionWithRect extends TextSelection {
  rect: DOMRect;
}
