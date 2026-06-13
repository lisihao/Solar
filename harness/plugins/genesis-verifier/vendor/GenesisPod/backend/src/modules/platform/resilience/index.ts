/**
 * platform/resilience — 韧性抽象集合
 *
 * 2026-05-05 第三轮审计后新增：把散点 listener leak / circuit breaker / cooldown
 * 失败降级 等基础设施模式抽出统一抽象。每个新增韧性能力都在这里登记，
 * 调用方走这里的入口而非自己手写。
 */
export { AbortableScope } from "./abortable-scope";
export { CircuitBreaker, isCooldownFailure } from "./circuit-breaker";
export type { CircuitBreakerOptions } from "./circuit-breaker";
export {
  InMemoryTokenBucketStore,
  RedisTokenBucketStore,
} from "./token-bucket";
export type { ITokenBucketStore } from "./abstractions/token-bucket.port";
