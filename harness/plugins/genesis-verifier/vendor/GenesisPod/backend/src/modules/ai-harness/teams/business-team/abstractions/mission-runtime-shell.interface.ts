/**
 * BusinessAgentTeam — Mission Runtime Shell 抽象
 *
 * 设计目标：让 mission lifecycle (wallTimer / heartbeat / abort / cleanup / billing 装配
 * / validateModels / validateCredits) 在 ai-harness 单一源；业务方（各 ai-app 模块）
 * 通过 IMissionRuntimeAdapter 注入业务专属语义（事件 namespace、
 * mission 行 schema、heartbeat 持久化方式、wallTime/credits 解析规则）。
 *
 * 上提自：ai-app/playground/ @migrated-from
 *   reference 实现已稳定运行，5×5 状态矩阵 + 4 层 timeout 守护 + spec 覆盖。
 *
 * 2026-05-08 PR-E0
 */

// PR-E0 守护 (P32 P1-1 修): harness 内部成员禁止 import 自身 facade barrel
// （facade 也 re-export 本文件，构成循环加载，emit-decorator-metadata 会把
// ctor token 写成 undefined）。直接从依赖的 source 文件导入。
import type { BillingRuntimeEnvAdapter } from "@/modules/ai-harness/guardrails/billing/billing-adapter";
import type { MissionBudgetPool } from "@/modules/ai-harness/guardrails/budget/mission-budget-pool";

/** Mission session 运行时句柄 — 跨 stage 传递 */
export interface MissionRuntimeSession {
  readonly missionId: string;
  readonly userId: string;
  readonly workspaceId?: string;
  readonly billing: BillingRuntimeEnvAdapter;
  readonly pool: MissionBudgetPool;
  readonly budgetMultiplier: number;
  readonly missionAbort: AbortController;
  /** ★ C4/G5:wall-time 上限(配置态,喂给 setTimeout)。原名 wallTimeMs 二义→ wallTimeCapMs。 */
  readonly wallTimeCapMs: number;
  cleanup(): void;
}

/**
 * 业务方注入的 mission runtime adapter。
 *
 * 一个 BusinessAgentTeam 实现一个 adapter，把"业务专属决策"注入到通用 shell 框架：
 *   - resolve* 方法：input → 数值（业务方决定档位映射）
 *   - createMissionRow / refreshHeartbeat：业务方持久化（业务 schema）
 *   - emitMissionEvent：业务方决定走 EventBus / EventEmitter2 / 其他
 *   - eventNamespace：业务事件前缀（如 "my-app" / "research"），框架内部
 *     生成 lifecycle 事件 type 时拼接（{namespace}.mission:rejected / :warning / :budget-warning-hard）
 *   - billingModuleType：BillingContext.run 用，区分计费归属
 */
export interface IMissionRuntimeAdapter<TInput = unknown> {
  /** 业务方决定 wall time **上限**计算（depth × audit × budget 等矩阵）。C4:cap 语义。 */
  resolveWallTimeCapMs(input: TInput): number;
  /** 业务方决定 mission 级 max credits */
  resolveMaxCredits(input: TInput): number;
  /** 业务方决定 agent budget multiplier */
  resolveBudgetMultiplier(input: TInput): number;

  /** 业务方持久化 mission 行（业务 schema 决定字段映射） */
  createMissionRow(args: {
    missionId: string;
    userId: string;
    workspaceId?: string;
    input: TInput;
    effectiveMaxCredits: number;
  }): Promise<void>;

  /** 业务方刷新 heartbeat 到 mission 行（指明 podId 防 zombie） */
  refreshHeartbeat(missionId: string, podId: string): Promise<void>;

  /** 业务方 emit lifecycle 事件（type 字符串由业务方 namespace 决定） */
  emitMissionEvent(args: {
    type: string;
    missionId: string;
    userId: string;
    payload: unknown;
  }): Promise<void>;

  /** 业务事件 type 命名空间（如 "my-app" / "research"） */
  readonly eventNamespace: string;

  /** BillingContext.run 用的 moduleType（如 "my-app" / "research"） */
  readonly billingModuleType: string;
}
