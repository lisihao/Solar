/**
 * AI Engine - LLM Module
 * LLM 适配层导出
 *
 * 包含：
 * - LLM 适配器接口
 * - 基础适配器实现
 * - LLM 工厂
 * - LLM 服务
 */

// Abstractions
export * from "./abstractions";

// Adapters
export * from "./adapters";

// Factory
export * from "./factory";

// Chat 补全管线（原 services/ai-chat + services/chat/*；含 AiChatService 与子服务）
export * from "./chat";

// Model Selection (PR-X-Q: 合并自原 election + recommendations + model-fallback)
export * from "./models/selection";
