/**
 * ai-harness/guardrails/capability —— Agent 进程能力授权（access control）
 *
 * 按 agentProcess.grantedTools 闸 tool/skill/data 访问。属 agent 运行时状态
 * （查 prisma.agentProcess），W2（2026-06-04）从 ai-engine/safety 迁回 harness
 * ——engine 不得知 agent/mission（standards/16 §五·补 律4）。历史：PR-X3 曾误置 engine。
 */
export { CapabilityGuardService } from "./capability-guard.service";
export type { CapabilityCheckResult } from "./capability.types";
