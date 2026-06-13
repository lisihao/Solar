/**
 * Engine 端运行时依赖 DI tokens（PR-X18）
 *
 * ai-engine 的 planning module 在 NestJS useFactory 中需要注入若干 ai-harness
 * 实现类作为 executor 的依赖。直接 import harness 类会反向依赖 ai-harness。
 *
 * 这里定义 Symbol tokens + 最小契约接口；engine 通过 token 注入接口，harness 在
 * 自己 module 里用 useExisting 把这些 token 绑定到具体实现。
 *
 * ★ 严格保持单向依赖：engine 只看到 token + interface，不知道实现来自何处。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ════════════════════════════════════════════════════════════════════
// Tokens
// ════════════════════════════════════════════════════════════════════

export const AGENT_REGISTRY_PORT = Symbol("AgentRegistryPort");
export const AGENT_ORCHESTRATOR_PORT = Symbol("AgentOrchestratorPort");
export const AGENT_CONFIG_SERVICE_PORT = Symbol("AgentConfigServicePort");
export const CHAT_PROVIDER_PORT = Symbol("ChatProviderPort");
export const CHECKPOINT_MANAGER_PORT = Symbol("CheckpointManagerPort");
export const PROGRESS_TRACKER_PORT = Symbol("ProgressTrackerPort");
export const TRACE_COLLECTOR_PORT = Symbol("TraceCollectorPort");
export const CONSTRAINT_ENFORCEMENT_PORT = Symbol("ConstraintEnforcementPort");
export const EXECUTION_STATE_MANAGER_PORT = Symbol("ExecutionStateManagerPort");
export const MCP_PROVIDER_PORT = Symbol("MCPProviderPort");

// ════════════════════════════════════════════════════════════════════
// Loose duck-typed interfaces (engine 不关心 harness 实现细节)
// ════════════════════════════════════════════════════════════════════

export interface IAgentRegistryPort {
  tryGet(agentId: string): any;
  getAll(): any[];
}

export interface IAgentOrchestratorPort {
  [method: string]: any;
}

export interface IAgentConfigServicePort {
  [method: string]: any;
}

export interface ICheckpointManagerPort {
  createCheckpoint: (...args: any[]) => any;
  [method: string]: any;
}

export interface IProgressTrackerPort {
  create: (...args: any[]) => any;
  start: (...args: any[]) => any;
  startPhase: (...args: any[]) => any;
  completePhase: (...args: any[]) => any;
  failPhase: (...args: any[]) => any;
  skipPhase: (...args: any[]) => any;
  complete: (...args: any[]) => any;
  fail: (...args: any[]) => any;
  [method: string]: any;
}

export interface ITraceCollectorPort {
  startTrace: (...args: any[]) => any;
  addSpan: (...args: any[]) => any;
  endSpan: (...args: any[]) => any;
  endTrace: (...args: any[]) => any;
  [method: string]: any;
}

export interface IConstraintEnforcementPort {
  [method: string]: any;
}

export interface IExecutionStateManagerPort {
  [method: string]: any;
}

export interface IMCPProviderPort {
  [method: string]: any;
}
