/**
 * HandoffService —— 协调 A → B 转移
 *
 * 流程：
 *   1. 验证目标 agent 存在（AgentRegistry.has(toAgentId)）
 *   2. 应用 IHandoffPolicy.authorize（默认 allow）
 *   3. 复制 / 形塑 envelope（policy.shapeEnvelope）
 *   4. emit 'handoff' 事件到 EventBus（可选）
 *   5. 触发目标 agent.execute()，把控制权交出
 *
 * 不负责：取消 source agent；source agent 的 cleanup（caller 自行 cancel）
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "crypto";
import type {
  IAgent,
  IContextEnvelope,
} from "@/modules/ai-harness/agents/abstractions";
import { AgentRegistry } from "./agent-registry";
import type {
  HandoffContext,
  HandoffResult,
  IHandoffPolicy,
} from "./handoff.types";
import { ContextEnvelope } from "@/modules/ai-harness/agents/core/context-envelope";

class DefaultHandoffPolicy implements IHandoffPolicy {
  async authorize(
    ctx: HandoffContext,
  ): Promise<{ allow: boolean; reason?: string }> {
    // 默认策略：禁止自我 handoff（避免环），其它都 allow
    if (ctx.fromAgentId === ctx.toAgentId) {
      return { allow: false, reason: "cannot handoff to self" };
    }
    return { allow: true };
  }
  /** 默认 no-op；业务方自定义 policy 可覆盖以做脱敏 / budget 调整 */
  async shapeEnvelope(
    env: import("@/modules/ai-harness/agents/abstractions").IContextEnvelope,
  ) {
    return env;
  }
}

@Injectable()
export class HandoffService {
  private readonly log = new Logger(HandoffService.name);
  private readonly defaultPolicy = new DefaultHandoffPolicy();

  constructor(
    private readonly registry: AgentRegistry,
    @Optional() private readonly policy?: IHandoffPolicy,
    /** B (2026-05-05): TEAM_HANDOFF hook seam — plugin 收 handoff 通知（audit 用） */
    @Optional()
    private readonly hookBus?: import("@/plugins/core/hook-bus").HookBus,
  ) {}

  /**
   * 执行 handoff —— 返回目标 agent 的最终 envelope（target.execute 串接调用）。
   *
   * 注意：本方法**不**触发 target.execute()；只准备好 envelope，由 caller 决定何时调
   * `await target.execute({ goal: ..., ... })`。这给 caller 控制权（同步 / 后台 / 队列）。
   */
  async handoff(
    fromAgent: IAgent,
    ctx: HandoffContext,
  ): Promise<HandoffResult> {
    const target = this.registry.get(ctx.toAgentId);
    if (!target) {
      return {
        toAgentId: ctx.toAgentId,
        accepted: false,
        rejectedReason: `target agent "${ctx.toAgentId}" not in registry`,
        handoffId: randomUUID(),
      };
    }

    const policy: IHandoffPolicy = this.policy ?? this.defaultPolicy;
    const auth = await policy.authorize(ctx);
    if (!auth.allow) {
      return {
        toAgentId: ctx.toAgentId,
        accepted: false,
        rejectedReason: auth.reason ?? "policy denied",
        handoffId: randomUUID(),
      };
    }

    // G6: on_handoff 钩子 —— 校验 ctx.input / 审计 / 二次否决（authorize 后、形塑前）
    if (policy.onHandoff) {
      const decision = await policy.onHandoff(ctx);
      if (decision?.block) {
        return {
          toAgentId: ctx.toAgentId,
          accepted: false,
          rejectedReason: decision.reason ?? "blocked by onHandoff",
          handoffId: randomUUID(),
        };
      }
    }

    // 准备 envelope
    let nextEnvelope: IContextEnvelope = fromAgent.getEnvelope();
    if (ctx.carryEnvelope === false) {
      // 全新 envelope —— 用 target 的（保留它原本的 system / identity）
      nextEnvelope = target.getEnvelope();
    } else if (policy.shapeEnvelope) {
      nextEnvelope = await policy.shapeEnvelope(nextEnvelope, ctx);
    }

    // 注入 handoff 标记 reminder
    if (nextEnvelope instanceof ContextEnvelope) {
      const reminded = nextEnvelope.withReminder(
        `[handoff from ${ctx.fromAgentId}] reason: ${ctx.reason}` +
          (ctx.handoverMessage ? `\nMessage: ${ctx.handoverMessage}` : ""),
        "high",
        "handoff",
      );
      nextEnvelope = reminded.envelope;
    }

    this.log.log(
      `[handoff] ${ctx.fromAgentId} → ${ctx.toAgentId} (${ctx.reason})`,
    );

    // B (2026-05-05): TEAM_HANDOFF hook fire-and-forget（audit / RBAC plugin 用）
    if (this.hookBus) {
      void this.hookBus
        .fire(
          "harness.team.handoff",
          {
            missionId:
              (ctx as unknown as { missionId?: string }).missionId ?? "",
            fromAgentId: ctx.fromAgentId,
            toAgentId: ctx.toAgentId,
            context: {
              reason: ctx.reason,
              handoverMessage: ctx.handoverMessage,
            },
          },
          async () => undefined,
        )
        .catch(() => undefined);
    }

    return {
      toAgentId: ctx.toAgentId,
      accepted: true,
      handoffId: randomUUID(),
      handoverEnvelope: nextEnvelope,
    };
  }
}
