/**
 * AI Ask Adapters
 *
 * 注意：AskLLMAdapter 已被移除，现在直接使用 AI Engine 的 FunctionCallingLLMAdapter
 * @see ../../ai-engine/llm/adapters/function-calling-llm.adapter.ts
 */

// 重新导出 AI Engine 的适配器以保持向后兼容
export { FunctionCallingLLMAdapter } from "@/modules/ai-harness/facade";

