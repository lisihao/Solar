/**
 * signoff primitive（v5.1 §3.2 §5）
 *
 * 调 leader-style role 终审 + accountability。
 * accountability hook 引用 ctx.crossStageState 中所有累计副作用（如
 * consumer s4PatchFailures forces quality-degraded）。
 */
import type {
  IStagePrimitive,
  StageRunArgs,
  PastDecision,
} from "./abstractions";

export interface SignoffStageOutput {
  readonly signoff: unknown;
  readonly forcedDegraded?: boolean;
}

export interface SignoffStageHooks {
  readonly runRole: (args: {
    role: StageRunArgs["role"];
    prompt: string;
    ctx: StageRunArgs["ctx"];
    previousOutputs: StageRunArgs["previousOutputs"];
  }) => Promise<unknown>;

  /** 可选：accountability 计算（业务规则，例：patchFailures > 0 forces degraded） */
  readonly accountability?: (args: {
    raw: unknown;
    role: StageRunArgs["role"];
    ctx: StageRunArgs["ctx"];
    crossStageState: StageRunArgs["crossStageState"];
  }) => Promise<{ forcedDegraded?: boolean; signoff: unknown }>;

  readonly extractDecision?: (args: {
    raw: unknown;
    phase: "signoff";
  }) => PastDecision | undefined;
}

export const SIGNOFF_PRIMITIVE: IStagePrimitive<unknown, SignoffStageOutput> = {
  id: "signoff",
  async run(args) {
    const hooks = args.hooks as unknown as SignoffStageHooks;
    if (!hooks.runRole) {
      throw new Error(`signoff primitive requires hooks.runRole`);
    }

    const raw = await hooks.runRole({
      role: args.role,
      prompt: args.role.skillSpec.systemPrompt,
      ctx: args.ctx,
      previousOutputs: args.previousOutputs,
    });

    if (args.role.stateful && hooks.extractDecision) {
      const pd = hooks.extractDecision({ raw, phase: "signoff" });
      if (pd) {
        args.crossStageState.append(`role:${args.role.id}:decisions`, pd);
      }
    }

    if (hooks.accountability) {
      const a = await hooks.accountability({
        raw,
        role: args.role,
        ctx: args.ctx,
        crossStageState: args.crossStageState,
      });
      return {
        signoff: a.signoff,
        forcedDegraded: a.forcedDegraded,
      };
    }
    return { signoff: raw };
  },
};
