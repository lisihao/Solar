/**
 * agent-spec-catalog.ts —— 已沉淀 agent 的「单一源」解析表（spec id → @DefineAgent 类）
 *
 * 智能体市场 agent 沉淀的单一真相：把 playground 等模块里「可被其他团队复用」的
 * @DefineAgent 角色，按其 spec id 登记成 id → 类 的解析表。
 *
 * 两个消费方共用这一张表（契约：SKU id === spec id === CompanyHiredAgent.listingId）：
 *   1. 市场投影（company MarketplaceCatalogService）：对每个类 readDefineAgentMeta()
 *      取出真 id / role / description / skills / tools 投影成 AgentCatalogItem。
 *   2. 执行解析（company mission runner）：resolveAgentSpec(listingId) → 类 →
 *      AgentRunner.run(类, input) 真跑（与 playground 同一执行路径，tool-recall/env/BYOK 全保留）。
 *
 * 设计原则（按"原子性"沉淀，2026-06 与用户锁定）：
 *   • 登记 playground 的 11 个**原子角色**（同能力的 mission/dim/chapter 粒度变体折叠成
 *     一个代表类；不同能力 = 不同 Agent）。Leader 作"编排者"档位、Steward 作"资源守门"
 *     档位也登记——它们是原子 Agent，由工作流喂输入，不是必须能从一句话独立跑。
 *   • ai-app → harness 只经 facade（readDefineAgentMeta / AgentSpec），单向不穿透。
 *   • 这是「id → 可跑类」的解析表，不是展示台账：展示字段一律 readDefineAgentMeta 派生。
 */
import type { z } from "zod";
import type { AgentSpec } from "@/modules/ai-harness/facade";
import { LeaderAgent } from "../marketplace/capabilities/deep-insight/agents/leader/leader.agent";
import { ResearcherAgent } from "../marketplace/capabilities/deep-insight/agents/researcher/researcher.agent";
import { AnalystAgent } from "../marketplace/capabilities/deep-insight/agents/analyst/analyst.agent";
import { MissionOutlinePlannerAgent } from "../marketplace/capabilities/deep-insight/agents/writer/mission-outline-planner.agent";
import { SingleShotWriterAgent } from "../marketplace/capabilities/deep-insight/agents/writer/single-shot-writer.agent";
import { DimensionIntegratorAgent } from "../marketplace/capabilities/deep-insight/agents/writer/dimension-integrator.agent";
import { MissionReviewerAgent } from "../marketplace/capabilities/deep-insight/agents/reviewer/mission-reviewer.agent";
import { MissionCriticAgent } from "../marketplace/capabilities/deep-insight/agents/reviewer/mission-critic.agent";
import { VerifierAgent } from "../marketplace/capabilities/deep-insight/agents/verifier/verifier.agent";
import { ReconcilerAgent } from "../marketplace/capabilities/deep-insight/agents/reconciler/reconciler.agent";
import { StewardAgent } from "../marketplace/capabilities/deep-insight/agents/steward/steward.agent";

/** 一个可被 AgentRunner.run 直接执行的 @DefineAgent 类。 */
export type AgentSpecClass = new () => AgentSpec<z.ZodType, z.ZodType>;

/**
 * 已沉淀的 playground 11 个原子角色（spec id → 类）。
 * 每个 key 必须 === 对应类 @DefineAgent 的 id（契约②，spec 守护）。
 */
export const PLAYGROUND_AGENT_SPECS: Readonly<Record<string, AgentSpecClass>> =
  {
    "playground.leader": LeaderAgent,
    "playground.researcher": ResearcherAgent,
    "playground.analyst": AnalystAgent,
    "playground.writer.outline-planner": MissionOutlinePlannerAgent,
    "playground.writer": SingleShotWriterAgent,
    "playground.dimension-integrator": DimensionIntegratorAgent,
    "playground.reviewer": MissionReviewerAgent,
    "playground.critic": MissionCriticAgent,
    "playground.verifier": VerifierAgent,
    "playground.reconciler": ReconcilerAgent,
    "playground.steward": StewardAgent,
  };

/** 所有已沉淀 agent 的解析表（未来其他模块的角色并入此处）。 */
export const SEDIMENTED_AGENT_SPECS: Readonly<Record<string, AgentSpecClass>> =
  {
    ...PLAYGROUND_AGENT_SPECS,
  };

/** 按 SKU id / listingId 解析出可跑的 @DefineAgent 类；未沉淀返回 undefined。 */
export function resolveAgentSpec(id: string): AgentSpecClass | undefined {
  return SEDIMENTED_AGENT_SPECS[id];
}

/**
 * 「可从单条任务文本独立跑」的叶子 agent（标准 28 §3 粒度法）。
 *
 * 只有输入 = {topic, dimension, language} 这类、不依赖 pipeline 上游产物的叶子
 * agent 才能被其他团队的执行层直接 AgentRunner.run 真跑（researcher：单维度调研 +
 * 真 web-search）。中段 agent（analyst 吃 findings / writer 吃 outline / reviewer
 * 吃成稿）的输入是 pipeline 上游结构化产物，无法从单条任务独立构造 → 不在此集合，
 * 执行层对它们退回「注入真技能指令的通用 chat」。
 */
export const STANDALONE_RUNNABLE_AGENT_IDS: ReadonlySet<string> = new Set([
  "playground.researcher",
]);
