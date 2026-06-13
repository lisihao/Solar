/**
 * RoleInventory — 角色原型调色板（权威实现）
 *
 * 设计文档：docs/architecture/ai-harness/self-driven-team/
 *            self-driven-agent-team-design-2026-06-04.md §5.3
 *
 * capability-singleton.spec.ts 锁定：全项目唯一 `export class RoleInventory`，
 * 归属目录 modules/ai-harness/teams/role-inventory/。
 *
 * 安全护栏（safety-05 / safety-09 / safety-10）：
 *   - 每角色声明 coreTools 默认工具白名单
 *   - maxIterations ≤ SELF_DRIVEN_AGENT_MAX_ITERATIONS（= 8），constructor 断言
 *   - DynamicTeamBuilder 通过 has() / getRole() 校验 roleId，禁 LLM 自由 id 直接实例化
 *
 * 设计约束：
 *   - 纯定义 + 查询，无 LLM 调用，无 mission/agent 状态
 *   - systemPromptHint 禁含动态内容（时间戳/随机 id）——保 prompt cache 稳定
 *   - 本文件不 import ai-engine 任何内部路径（facade 边界）
 */

import { Injectable, Logger } from "@nestjs/common";
import { SELF_DRIVEN_AGENT_MAX_ITERATIONS } from "../../evaluation/thresholds.constants";
import type {
  IRoleInventory,
  RolePrototype,
} from "../abstractions/role-inventory.interface";
import type { RoleId } from "../abstractions/role.interface";

// ── 工具 ID 常量（字面量，避免循环依赖 engine tool-registry） ──────────────
// 仅用 string 字面量；DynamicTeamBuilder 在实例化时做运行期 ACL 校验
// 所有 ID 均来自 ai-engine/tools/tools.provider.ts TOOL_ID_CLASS_MAP，连字符格式。
const T = {
  WEB_SEARCH: "web-search",
  WEB_SCRAPER: "web-scraper",
  IMAGE_SEARCH: "image-search",
  RAG_SEARCH: "rag-search",
  DATA_ANALYSIS: "data-analysis",
} as const;

// ── 角色原型清单 ──────────────────────────────────────────────────────────────

/** 全部角色 ID 常量（供 DynamicTeamBuilder / Planner 引用，禁 LLM 自由字符串） */
export const ROLE_INVENTORY_IDS = {
  RESEARCHER: "researcher",
  ANALYST: "analyst",
  WRITER: "writer",
  CRITIC: "critic",
  REVIEWER: "reviewer",
  INTEGRATOR: "integrator",
  DOMAIN_EXPERT: "domain-expert",
  LEADER: "leader",
} as const;

export type RoleInventoryId =
  (typeof ROLE_INVENTORY_IDS)[keyof typeof ROLE_INVENTORY_IDS];

/** 内置角色原型定义表 */
const BUILTIN_PROTOTYPES: readonly RolePrototype[] = [
  {
    roleId: ROLE_INVENTORY_IDS.RESEARCHER,
    title: "Researcher",
    systemPromptHint:
      "You are a Researcher. Your responsibility is to gather, verify, and " +
      "organize information from authoritative sources. Prioritize accuracy " +
      "and source credibility. Cite sources for every factual claim.",
    coreTools: [T.WEB_SEARCH, T.WEB_SCRAPER, T.IMAGE_SEARCH],
    maxIterations: 5,
  },
  {
    roleId: ROLE_INVENTORY_IDS.ANALYST,
    title: "Analyst",
    systemPromptHint:
      "You are an Analyst. Your responsibility is to synthesize research " +
      "findings, identify patterns, evaluate evidence quality, and produce " +
      "data-backed conclusions. Use structured reasoning and quantify " +
      "uncertainty where relevant.",
    coreTools: [T.WEB_SEARCH, T.DATA_ANALYSIS],
    maxIterations: 5,
  },
  {
    roleId: ROLE_INVENTORY_IDS.WRITER,
    title: "Writer",
    systemPromptHint:
      "You are a Writer. Your responsibility is to transform analysis and " +
      "research into clear, well-structured, audience-appropriate prose. " +
      "Maintain logical flow, consistent terminology, and appropriate tone " +
      "throughout the document.",
    coreTools: [],
    maxIterations: 4,
  },
  {
    roleId: ROLE_INVENTORY_IDS.CRITIC,
    title: "Critic",
    systemPromptHint:
      "You are a Critic. Your responsibility is to identify weaknesses, " +
      "logical gaps, unsupported claims, and structural issues in drafts. " +
      "Provide specific, actionable critique with clear improvement suggestions. " +
      "Do not rewrite — only diagnose and prescribe.",
    coreTools: [],
    maxIterations: 3,
  },
  {
    roleId: ROLE_INVENTORY_IDS.REVIEWER,
    title: "Reviewer",
    systemPromptHint:
      "You are a Reviewer. Your responsibility is to assess final output " +
      "against the acceptance rubric, assign numeric scores per dimension, " +
      "and produce a structured pass/fail verdict. Be objective and consistent.",
    coreTools: [],
    maxIterations: 3,
  },
  {
    roleId: ROLE_INVENTORY_IDS.INTEGRATOR,
    title: "Integrator",
    systemPromptHint:
      "You are an Integrator. Your responsibility is to merge contributions " +
      "from multiple team members into a coherent whole, resolve contradictions, " +
      "eliminate duplication, and ensure consistent voice and formatting.",
    coreTools: [],
    maxIterations: 4,
  },
  {
    roleId: ROLE_INVENTORY_IDS.DOMAIN_EXPERT,
    title: "Domain Expert",
    systemPromptHint:
      "You are a Domain Expert. Your responsibility is to provide deep " +
      "subject-matter knowledge, validate technical accuracy, flag " +
      "domain-specific nuances, and calibrate complexity to the target " +
      "audience's expertise level.",
    coreTools: [T.WEB_SEARCH, T.WEB_SCRAPER],
    maxIterations: 5,
  },
  {
    roleId: ROLE_INVENTORY_IDS.LEADER,
    title: "Leader",
    systemPromptHint:
      "You are the team Leader. Your responsibility is to decompose the " +
      "mission into sub-tasks, assign work to team members, track progress, " +
      "resolve conflicts, and synthesize outputs into an executive summary. " +
      "Prioritize task clarity and team coordination over individual contribution.",
    coreTools: [],
    maxIterations: 8,
  },
] as const;

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * RoleInventory — 角色原型调色板服务（全项目唯一权威实现）。
 *
 * 职责：纯查询，不持有 agent/mission 状态，不调用 LLM。
 *
 * 消费方：
 *   - SelfDrivenMissionPlannerService（候选角色集）
 *   - DynamicTeamBuilder（白名单校验 + 原型查找）
 */
@Injectable()
export class RoleInventory implements IRoleInventory {
  private readonly logger = new Logger(RoleInventory.name);
  private readonly _roles: ReadonlyMap<RoleId, RolePrototype>;

  constructor() {
    // ── safety-09: 运行期断言 maxIterations ≤ SELF_DRIVEN_AGENT_MAX_ITERATIONS ──
    for (const proto of BUILTIN_PROTOTYPES) {
      if (proto.maxIterations > SELF_DRIVEN_AGENT_MAX_ITERATIONS) {
        throw new Error(
          `RoleInventory: role "${proto.roleId}" declares maxIterations=${proto.maxIterations} ` +
            `which exceeds SELF_DRIVEN_AGENT_MAX_ITERATIONS=${SELF_DRIVEN_AGENT_MAX_ITERATIONS}. ` +
            `Reduce maxIterations to comply with the iteration cap (safety-09).`,
        );
      }
    }

    this._roles = new Map(BUILTIN_PROTOTYPES.map((p) => [p.roleId, p]));

    this.logger.log(
      `RoleInventory initialised with ${this._roles.size} role prototypes: ` +
        `[${[...this._roles.keys()].join(", ")}]`,
    );
  }

  /**
   * 按 roleId 查询角色原型。
   * @returns 原型；若 roleId 不在清单返回 undefined（DynamicTeamBuilder 需检查）。
   */
  getRole(roleId: RoleId): RolePrototype | undefined {
    return this._roles.get(roleId);
  }

  /**
   * 返回全部角色原型（顺序同 BUILTIN_PROTOTYPES 定义）。
   */
  listRoles(): readonly RolePrototype[] {
    return BUILTIN_PROTOTYPES;
  }

  /**
   * 判断 roleId 是否在白名单中。
   * DynamicTeamBuilder 在实例化 member 前调用，roleId 不在清单时拒绝实例化。
   */
  has(roleId: RoleId): boolean {
    return this._roles.has(roleId);
  }
}
