/**
 * Runtime resource abstractions —— ai-engine 端定义的极小接口
 *
 * RuntimeEnvironmentService 需要从 ai-harness 拿两类信息：
 *   - spec agent ids（哪些 agent 已注册）
 *   - tool circuit breaker 状态（哪些工具被熔断）
 *
 * 让 ai-engine 直接 import ai-harness 实现 = 反向依赖（违反 Phase H1 单向规则）。
 * 改为：ai-engine 在这里定义接口 + DI token，ai-harness 实现并通过 provider 绑到 token 上。
 *
 * 这样：
 *   - ai-harness/guardrails/* 只 import 本文件接口（不感知 ai-harness 存在）
 *   - ai-harness/harness.module 把 SpecAgentRegistry/ToolCircuitBreaker 作为 token 提供
 *   - 单向依赖恢复（ai-harness → ai-engine 仅通过接口契约）
 */

/** Spec agent registry 的最小接口契约（runtime-environment 实际只需要枚举 id） */
export interface ISpecAgentRegistryProbe {
  getAllIds(): readonly string[];
}

/** Tool circuit breaker 的最小接口契约 */
export interface IToolCircuitBreakerProbe {
  getState(toolId: string): "closed" | "open" | "half-open";
}

/** DI tokens — ai-harness 模块在 providers 里 useExisting / useClass 绑定到这些 token */
export const SPEC_AGENT_REGISTRY_PROBE = Symbol("SPEC_AGENT_REGISTRY_PROBE");
export const TOOL_CIRCUIT_BREAKER_PROBE = Symbol("TOOL_CIRCUIT_BREAKER_PROBE");
