/**
 * AI Text Edit 平台类型
 *
 * 抽自原 ai-insights/types.ts 中和"选中文本 → AI 改写"工作流相关的类型，
 * 作为跨模块共享的平台契约。业务方的扩展可以基于此扩展。
 */

/** AI 编辑操作类型 */
export type AIEditOperation =
  | 'rewrite'
  | 'polish'
  | 'expand'
  | 'compress'
  | 'style';

/** 文本风格（style 操作专用） */
export type AIEditStyleType = 'academic' | 'business' | 'casual' | 'technical';

/** AI 编辑操作请求（带额外选项） */
export interface AIEditOperationRequest {
  operation: AIEditOperation;
  customInstruction?: string;
  styleType?: AIEditStyleType;
}
