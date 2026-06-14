/**
 * AI Engine - Reliability
 * 可靠性原语聚合（entity-health + rate-limit）
 */

// Entity health（多实体健康注册 + 选择）
export * from "./entity-health/entity-health.registry";

// Rate limiting（RPM 策略；token-bucket 基元已下沉 platform/resilience）
export * from "./rate-limit/rate-limit.service";

// Module
export { AiEngineReliabilityModule } from "./reliability.module";
