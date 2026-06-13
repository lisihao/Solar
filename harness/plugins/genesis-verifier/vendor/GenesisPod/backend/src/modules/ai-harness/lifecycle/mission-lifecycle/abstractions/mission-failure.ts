/**
 * MissionFailure —— C2 / G3（2026-05-22）：mission 级失败 canonical 契约（single source of truth）。
 *
 * 此前失败原因散在 abort reason / markFailed message / liveness 兜底 / 前端 banner / app
 * inline 正则分类（social 4 码不落库 / radar message 正则）—— 真因 budget_exhausted 被层层
 * 改写成 cancelled/失联。本契约收口：
 *   - MissionFailureCode：mission 级 canonical code（小写 enum，平台唯一）。
 *   - FailureCategory：告警路由 + retry-eligibility 的分组维度。
 *     ★ Codex r5/r6 决议：category 不是第二真源——由 code 经【单一映射 codeToCategory】派生
 *       （投影，禁独立赋值；读路径必要时实时重算；旧 DB 列视为脏可重算）。
 *   - source?: 自由文本调试归因（★ 原 FailureSource enum 已砍——无具名决策消费方）。
 *   - 映射：MissionAbortReason（C1）→ MissionFailureCode（恒等子集）；agent 级大写 code
 *     （LOOP_ / PROVIDER_ 前缀，from failure-extraction.utils）→ mission 级 code。
 */

import { MissionAbortReason } from "../abort-registry";

/** mission 级失败 canonical code（平台唯一，小写）。 */
export enum MissionFailureCode {
  user_cancelled = "user_cancelled",
  budget_exhausted = "budget_exhausted",
  wall_time_exceeded = "wall_time_exceeded",
  mission_row_missing = "mission_row_missing",
  leader_signoff_rejected = "leader_signoff_rejected",
  provider_error = "provider_error",
  runtime_crashed = "runtime_crashed",
  unknown = "unknown",
}

/** 失败大类——告警路由 + retry-eligibility 的分组。 */
export enum FailureCategory {
  cancellation = "cancellation",
  budget = "budget",
  time = "time",
  quality = "quality",
  infra = "infra",
  provider = "provider",
  unknown = "unknown",
}

/**
 * ★ 唯一映射 code → category（投影，非第二真源）。
 * total over MissionFailureCode —— 契约测试断言每个 code 都有 category（穷尽）。
 */
const CODE_TO_CATEGORY: Record<MissionFailureCode, FailureCategory> = {
  [MissionFailureCode.user_cancelled]: FailureCategory.cancellation,
  [MissionFailureCode.budget_exhausted]: FailureCategory.budget,
  [MissionFailureCode.wall_time_exceeded]: FailureCategory.time,
  [MissionFailureCode.mission_row_missing]: FailureCategory.infra,
  [MissionFailureCode.leader_signoff_rejected]: FailureCategory.quality,
  [MissionFailureCode.provider_error]: FailureCategory.provider,
  [MissionFailureCode.runtime_crashed]: FailureCategory.infra,
  [MissionFailureCode.unknown]: FailureCategory.unknown,
};

/** code → category 派生（读路径以此重算，不信任存量 DB 列）。 */
export function codeToCategory(code: MissionFailureCode): FailureCategory {
  return CODE_TO_CATEGORY[code] ?? FailureCategory.unknown;
}

/**
 * mission 级失败值对象。category 由 code 派生（禁独立赋值）。
 * 用 buildMissionFailure 构造，保证 category 与 code 一致。
 */
export interface MissionFailure {
  readonly code: MissionFailureCode;
  readonly category: FailureCategory;
  readonly message: string;
  /** 自由文本调试归因（runtime / liveness / business_gate / persistence / provider）。 */
  readonly source?: string;
}

/** 构造 MissionFailure —— category 永远由 code 派生。 */
export function buildMissionFailure(
  code: MissionFailureCode,
  message: string,
  source?: string,
): MissionFailure {
  return { code, category: codeToCategory(code), message, source };
}

/**
 * MissionAbortReason（C1）→ MissionFailureCode。abort reason 是 failure code 的真子集，
 * 多数恒等。total over MissionAbortReason —— 契约测试断言穷尽。
 */
const ABORT_REASON_TO_FAILURE_CODE: Record<
  MissionAbortReason,
  MissionFailureCode
> = {
  [MissionAbortReason.user_cancelled]: MissionFailureCode.user_cancelled,
  [MissionAbortReason.budget_exhausted]: MissionFailureCode.budget_exhausted,
  [MissionAbortReason.mission_wall_time_exceeded]:
    MissionFailureCode.wall_time_exceeded,
  [MissionAbortReason.mission_no_activity]: MissionFailureCode.runtime_crashed,
  [MissionAbortReason.mission_row_missing]:
    MissionFailureCode.mission_row_missing,
  [MissionAbortReason.rerun_replacing_stale]:
    MissionFailureCode.runtime_crashed,
  [MissionAbortReason.superseded]: MissionFailureCode.runtime_crashed,
  [MissionAbortReason.orchestrator_shutdown]:
    MissionFailureCode.runtime_crashed,
};

export function mapAbortReasonToFailureCode(
  reason: MissionAbortReason,
): MissionFailureCode {
  return ABORT_REASON_TO_FAILURE_CODE[reason] ?? MissionFailureCode.unknown;
}

/**
 * agent 级大写 code（failure-extraction.utils.ts 产出：LOOP_* / PROVIDER_* / UNKNOWN）
 * → mission 级 code。未知 agent code 安全降级到 unknown（agent code 是开放字符串集，
 * 不强制穷尽；新增 agent code 默认 unknown，不会误判成具体类）。
 */
const AGENT_CODE_TO_FAILURE_CODE: Readonly<Record<string, MissionFailureCode>> =
  {
    LOOP_BUDGET_EXHAUSTED: MissionFailureCode.budget_exhausted,
    BUDGET_EXHAUSTED: MissionFailureCode.budget_exhausted,
    ORCH_CREDIT_INSUFFICIENT: MissionFailureCode.budget_exhausted,
    PROVIDER_API_ERROR: MissionFailureCode.provider_error,
    API_ERROR: MissionFailureCode.provider_error,
    PROVIDER_RATE_LIMIT: MissionFailureCode.provider_error,
    PROVIDER_BYOK_MODEL_NOT_FOUND: MissionFailureCode.provider_error,
    LOOP_EMPTY_RESPONSE_IMMEDIATE: MissionFailureCode.provider_error,
    RUNNER_WALL_TIME_EXCEEDED: MissionFailureCode.wall_time_exceeded,
    RUNNER_INPUT_SCHEMA_MISMATCH: MissionFailureCode.runtime_crashed,
    MISSION_STALE: MissionFailureCode.runtime_crashed,
    MISSION_ABORTED: MissionFailureCode.user_cancelled,
  };

export function mapAgentFailureCode(
  agentCode: string | undefined | null,
): MissionFailureCode {
  if (!agentCode) return MissionFailureCode.unknown;
  return AGENT_CODE_TO_FAILURE_CODE[agentCode] ?? MissionFailureCode.unknown;
}
