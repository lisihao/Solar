/**
 * plan primitive（v5.1 §3.2 §5）
 *
 * 调 leader-style role 输出 dimensions / goals。
 * stateful=true 时自动 appendDecision (extractDecision hook)。
 *
 * Happy-path < 250 行：实际 LLM 调用由调用方注入的 hooks.runRole 完成；
 * 这里 primitive 只负责 orchestration（renderPrompt + extractDecision +
 * append to crossStageState）。
 */
import type {
  IStagePrimitive,
  StageRunArgs,
  PastDecision,
} from "./abstractions";

/** plan stage 输出形态（generic）*/
export interface PlanStageOutput {
  readonly dimensions?: ReadonlyArray<unknown>;
  readonly goals?: ReadonlyArray<unknown>;
  readonly raw: unknown;
}

/** plan hook 集合（业务可注入；都可选）*/
export interface PlanStageHooks {
  /** 必需：调 role 跑 LLM，返回 raw output；ai-app 提供具体 LLM 调用实现 */
  readonly runRole: (args: {
    role: StageRunArgs["role"];
    prompt: string;
    ctx: StageRunArgs["ctx"];
  }) => Promise<unknown>;

  /** 可选：从 raw output 提取 dimensions/goals 字段（业务 schema 决定）*/
  readonly extractPlanFields?: (raw: unknown) => {
    dimensions?: ReadonlyArray<unknown>;
    goals?: ReadonlyArray<unknown>;
  };

  /** 可选：stateful role decision 提取（v5.1 §3.4 P0-F）*/
  readonly extractDecision?: (args: {
    raw: unknown;
    phase: "plan";
  }) => PastDecision | undefined;
}

export const PLAN_PRIMITIVE: IStagePrimitive<unknown, PlanStageOutput> = {
  id: "plan",
  async run(args) {
    const hooks = args.hooks as unknown as PlanStageHooks;
    if (!hooks.runRole) {
      throw new Error(
        `plan primitive requires hooks.runRole (ai-app must provide LLM caller)`,
      );
    }

    const prompt = args.role.skillSpec.systemPrompt;
    const raw = await hooks.runRole({
      role: args.role,
      prompt,
      ctx: args.ctx,
    });

    // stateful role：自动 append decision（runner 写 IMissionStore + ctx state）
    if (args.role.stateful && hooks.extractDecision) {
      const decision = hooks.extractDecision({ raw, phase: "plan" });
      if (decision) {
        args.crossStageState.append(`role:${args.role.id}:decisions`, decision);
      }
    }

    const fields = hooks.extractPlanFields ? hooks.extractPlanFields(raw) : {};
    return {
      dimensions: fields.dimensions,
      goals: fields.goals,
      raw,
    };
  },
};
