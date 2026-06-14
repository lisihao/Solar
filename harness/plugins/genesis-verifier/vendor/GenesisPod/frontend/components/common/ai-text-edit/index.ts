/**
 * AI Text Edit - 通用「选中文本 → AI 改写」工具集
 *
 * 抽自 Topic Insights 报告 AI 编辑功能，沉淀为跨模块平台能力。
 *
 * 工作流：
 * 1. 用户选中文本 → AIFloatingToolbar 浮现
 * 2. 选择操作（expand / shorten / simplify / rephrase / formal / casual / custom）
 *    → AIEditInputModal 输入指令
 * 3. AI 处理 → AIEditPreviewModal/Dialog 对比预览
 * 4. 用户接受 / 拒绝 → useAIEdit hook 完成回写
 *
 * 适用场景：
 * - AI Writing 段落改写
 * - AI Research 报告内容打磨
 * - 任何 LLM 文本编辑场景
 */

export { AIEditInputModal } from './AIEditInputModal';
export { AIEditPreviewDialog } from './AIEditPreviewDialog';
export { AIEditPreviewModal } from './AIEditPreviewModal';
export { AIFloatingToolbar } from './AIFloatingToolbar';
export { useAIEdit } from './useAIEdit';
