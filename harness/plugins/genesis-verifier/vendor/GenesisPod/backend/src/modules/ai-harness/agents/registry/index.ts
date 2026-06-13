/**
 * Legacy Agent Registry Module — PR-X5 (now in ai-harness/agents/registry)
 *
 * AgentRegistry here = IPlanBasedAgent registry (old plan→execute model).
 * Distinguished from ai-harness/handoffs/agent-registry (IAgent runtime registry).
 *
 * @deprecated Use SpecAgentRegistry for new-style agents.
 */

export { PlanBasedAgentRegistry } from "./plan-based-agent-registry";
export type { PlanBasedAgentRegistryStats } from "./plan-based-agent-registry";
// @deprecated back-compat aliases — the old name `AgentRegistry` collided with
// ai-harness/handoffs/AgentRegistry. Prefer PlanBasedAgentRegistry.
export { PlanBasedAgentRegistry as AgentRegistry } from "./plan-based-agent-registry";
export type { PlanBasedAgentRegistryStats as AgentRegistryStats } from "./plan-based-agent-registry";
export { AgentOrchestrator } from "./agent-orchestrator";
export type { AgentStatusReport } from "./agent-orchestrator";
