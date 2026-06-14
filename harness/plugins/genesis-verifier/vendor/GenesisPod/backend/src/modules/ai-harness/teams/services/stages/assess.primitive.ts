/**
 * assess primitive（v5.1 §3.2 §5）
 *
 * 调 leader-style role 评估前序产出，决定 retry/abort/continue。
 * dispatchAssessActions hook 处理 4 路 action（continue / retry-some /
 * abort-mission / patch-then-retry，consumer s4 用法）。
 */
import {
  type IStagePrimitive,
  type StageRunArgs,
  type PastDecision,
  StageAbortError,
} from "./abstractions";

export type AssessDecision =
  | "continue"
  | "retry-some"
  | "abort-mission"
  | "patch-then-retry";

export interface AssessStageOutput {
  readonly decision: AssessDecision;
  readonly raw: unknown;
}

export interface AssessStageHooks {
  readonly runRole: (args: {
    role: StageRunArgs["role"];
    prompt: string;
    ctx: StageRunArgs["ctx"];
    previousOutputs: StageRunArgs["previousOutputs"];
  }) => Promise<unknown>;

  /** 必需：从 raw 输出 parse 出 decision */
  readonly parseDecision: (raw: unknown) => AssessDecision;

  /**
   * 可选：dispatch 4 路 action 到 crossStageState（非 LLM 副作用）
   * 例：consumer 的 s4PatchRound++ / s4PatchFailures.append
   */
  readonly dispatchAssessActions?: (args: {
    decision: AssessDecision;
    raw: unknown;
    ctx: StageRunArgs["ctx"];
    crossStageState: StageRunArgs["crossStageState"];
  }) => void | Promise<void>;

  readonly extractDecision?: (args: {
    raw: unknown;
    phase: "assess";
  }) => PastDecision | undefined;
}

export const ASSESS_PRIMITIVE: IStagePrimitive<unknown, AssessStageOutput> = {
  id: "assess",
  async run(args) {
    const hooks = args.hooks as unknown as AssessStageHooks;
    if (!hooks.runRole || !hooks.parseDecision) {
      throw new Error(
        `assess primitive requires hooks.runRole + hooks.parseDecision`,
      );
    }

    const raw = await hooks.runRole({
      role: args.role,
      prompt: args.role.skillSpec.systemPrompt,
      ctx: args.ctx,
      previousOutputs: args.previousOutputs,
    });
    const decision = hooks.parseDecision(raw);

    if (hooks.dispatchAssessActions) {
      await hooks.dispatchAssessActions({
        decision,
        raw,
        ctx: args.ctx,
        crossStageState: args.crossStageState,
      });
    }

    if (args.role.stateful && hooks.extractDecision) {
      const pd = hooks.extractDecision({ raw, phase: "assess" });
      if (pd) {
        args.crossStageState.append(`role:${args.role.id}:decisions`, pd);
      }
    }

    if (decision === "abort-mission") {
      throw new StageAbortError("assess", "leader decided abort-mission", raw);
    }

    return { decision, raw };
  },
};
