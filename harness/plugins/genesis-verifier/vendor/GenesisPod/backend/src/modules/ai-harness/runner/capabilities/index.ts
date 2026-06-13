/**
 * AI Engine Orchestration - Capabilities
 * AI 能力解析模块
 */

export * from "./ai-capability-resolver.service";
export * from "./types";

// 向后兼容：导出旧名称作为别名
export { AICapabilityResolver as CapabilityResolver } from "./ai-capability-resolver.service";
