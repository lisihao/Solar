/**
 * BusinessAgentTeam — Mission Rerun Orchestrator Contract
 *
 * 2026-05-24 (P5 Wave 1)：mission-pipeline rerun 走 A 路线（创建新 mission）的装配机制对
 * 所有 BusinessAgentTeam 同形：
 *
 *   机制（framework 提供）：
 *     - assertSourceMissionRerunnable：rerun guard 入站 + status 白名单校验 + ownership 校验
 *     - newMissionId 生成 + ownership.assign
 *     - 可选 checkpoint clone（incremental mode）
 *     - emit mission:manual-rerun-from-todo（todo rerun 链路）
 *     - fire-and-forget orchestrator.runMission + 错误 log
 *
 *   业务（hook）：
 *     - sourceMissionResolver：怎么从 source missionId + userId 取主行（业务表 schema）
 *     - inputCloner：怎么用 source mission 重建 RunMissionInput（业务输入 shape）
 *     - statusWhitelist：哪些 status 允许 rerun（业务可加 cancelled / paused 等）
 *     - eventNames：emit mission:rerun-from-todo 的 type 字符串
 *     - rerunGuard：业务自己的 RerunGuard 实现（满足 IBusinessRerunGuard）
 *     - orchestratorRun：怎么调业务 pipeline-dispatcher.runMission
 *     - streamNamespace：返回 result 中的 stream namespace（业务 namespace）
 */

import type { IBusinessRerunGuard } from "../../abstractions/rerun-guard.interface";

/** Rerun 入站参数（todo rerun + full rerun 共用结构） */
export interface MissionRerunRequest<TTodoBody = unknown> {
  readonly sourceMissionId: string;
  readonly userId: string;
  /** 'fresh' = 不 clone checkpoint，全新从头跑；'incremental' = clone checkpoint */
  readonly mode?: "fresh" | "incremental";
  /** todo rerun 路径用；full rerun 不传 */
  readonly todoId?: string;
  /** todo rerun 路径用；full rerun 不传（typed by 业务 TTodoBody） */
  readonly todoBody?: TTodoBody;
}

/** Rerun 装配结果（业务方决定 streamNamespace 字符串） */
export interface MissionRerunResult {
  readonly missionId: string;
  readonly streamNamespace: string;
}

/**
 * Orchestrator hooks — 业务方提供"怎么取 source / 怎么 clone input / 怎么 emit / 怎么跑"。
 *
 * @template TSourceMission business 主行 detail 类型
 * @template TInput business RunMissionInput shape
 * @template TTodoBody business todo rerun body shape
 */
export interface MissionRerunOrchestratorHooks<
  TSourceMission,
  TInput,
  TTodoBody,
> {
  /**
   * phantom marker — 让 TS 把 TTodoBody 视作"被使用"。framework 在 rerunFromTodo
   * 入参签名中实际消费 TTodoBody（见下方 rerunFromTodo），phantom 字段不需要业务赋值。
   */
  readonly __todoBodyMarker?: TTodoBody;

  /** 业务 rerun guard 实现（in-flight + zombie cleanup） */
  readonly rerunGuard: IBusinessRerunGuard;

  /** 取 source mission 主行（含 ownership 校验）。null → throw ForbiddenException */
  readonly sourceMissionResolver: (
    sourceMissionId: string,
    userId: string,
  ) => Promise<TSourceMission | null>;

  /** RERUNNABLE_STATUSES 白名单（业务自定义）。framework 用 `.includes` 校验 */
  readonly rerunnableStatuses: readonly string[];

  /** 取 source mission 的 status 字段（业务字段名各异） */
  readonly extractStatus: (source: TSourceMission) => string;

  /** 取 source mission 的 topic 字段（用于 todo rerun overrides.topic） */
  readonly extractTopic: (source: TSourceMission) => string;

  /** 把 source mission + overrides → 新 mission 的 RunMissionInput（业务实现） */
  readonly cloneInput: (
    source: TSourceMission,
    overrides: {
      topic?: string;
      inheritFromMissionId?: string;
    },
  ) => TInput;

  /**
   * 业务 fire-and-forget orchestrator runner（caller 已 catch promise，business
   * 在此调 pipeline-dispatcher.runMission）。
   */
  readonly runMission: (
    newMissionId: string,
    input: TInput,
    userId: string,
  ) => Promise<void>;

  /** mission ownership 注册（business 持有 ownership registry） */
  readonly assignOwnership: (newMissionId: string, userId: string) => void;

  /** 可选：incremental mode 复制原 checkpoint */
  readonly cloneCheckpoint?: (
    sourceMissionId: string,
    newMissionId: string,
  ) => Promise<boolean>;

  /** 业务 emit 函数 + event type（mission:manual-rerun-from-todo 通用骨架） */
  readonly emit: (event: {
    type: string;
    missionId: string;
    userId: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;

  /** 返回值 streamNamespace（业务 namespace） */
  readonly streamNamespace: string;

  /** event 命名（rerunFromTodo 触发的事件 type） */
  readonly eventNames: {
    readonly manualRerunFromTodo: string;
  };
}

/** Topic length 上限（业务可覆盖，默认 200） */
export const RERUN_TOPIC_LIMIT_DEFAULT = 200;
