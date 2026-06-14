/**
 * RoleInventory — 角色原型调色板接口契约
 *
 * 设计文档：docs/architecture/ai-harness/self-driven-team/
 *            self-driven-agent-team-design-2026-06-04.md §5.3
 *
 * MECE 归属：harness/teams（role/team 是 agent 概念）。
 * 纯定义 + 查询，无 LLM，无 mission 状态。
 *
 * 安全护栏（safety-05 / safety-10）：
 *   - 每个 RolePrototype 声明 coreTools 默认工具白名单
 *   - DynamicTeamBuilder 只接受来自本清单的 roleId，禁 LLM 自由 id 直接实例化
 *   - maxIterations 不得超过 SELF_DRIVEN_AGENT_MAX_ITERATIONS（= 8）
 */

import type { RoleId } from "./role.interface";

/**
 * 角色原型——RoleInventory 中每个角色的调色板条目。
 *
 * coreTools：DynamicTeamBuilder 实例化 member 时的默认工具白名单；
 *            越界访问返回 AgentAccessDeniedError（设计 §5.3）。
 * maxIterations：角色的 ReAct/plan-act 循环上限，不得超过
 *            SELF_DRIVEN_AGENT_MAX_ITERATIONS（= 8）。
 */
export interface RolePrototype {
  /** 唯一角色 ID（来源：ROLE_INVENTORY_IDS 常量，禁 LLM 自由定义） */
  readonly roleId: RoleId;

  /** 用户可见角色标题（英文，UI 端自行 i18n） */
  readonly title: string;

  /**
   * 系统 prompt 提示片段。
   * DynamicTeamBuilder 将其嵌入 member systemPrompt 的职责段落。
   * 禁止含动态内容（时间戳/随机 id）——保 prompt cache 前缀稳定（反向洞察 #3/#7）。
   */
  readonly systemPromptHint: string;

  /**
   * 默认工具白名单（ToolId 字符串列表）。
   * member.tools = role.coreTools；越界 → AgentAccessDeniedError。
   * 空数组 = 无工具权限。
   */
  readonly coreTools: readonly string[];

  /**
   * ReAct / plan-act 循环上限（含）。
   * 必须 ≤ SELF_DRIVEN_AGENT_MAX_ITERATIONS（= 8）；
   * RoleInventory 实现在 constructor 中做运行期断言。
   */
  readonly maxIterations: number;
}

/**
 * RoleInventory 服务接口。
 * 唯一权威实现：capability-singleton.spec.ts 锁定。
 */
export interface IRoleInventory {
  /**
   * 按 roleId 查询角色原型。
   * @returns 原型，若 roleId 不在清单则返回 undefined。
   */
  getRole(roleId: RoleId): RolePrototype | undefined;

  /**
   * 返回全部角色原型列表（用于 Planner 候选集 / UI 展示）。
   */
  listRoles(): readonly RolePrototype[];

  /**
   * 判断 roleId 是否在白名单中。
   * DynamicTeamBuilder 在实例化 member 前调用此方法校验。
   */
  has(roleId: RoleId): boolean;
}

/** DI Token（NestJS useClass 注入） */
export const ROLE_INVENTORY = Symbol("ROLE_INVENTORY");
