/**
 * ContentTransformerAgentService — S3 跨平台内容适配派发（mission agent 版本）
 *
 * 多平台时 stage 层用 ConcurrencyLimiter 并发调本 service 的 run()，每个平台
 * 一份独立 LLM 调用。
 *
 * 与 services/content-transformer.service.ts 的 `ContentTransformerService`（同步
 * 工作流，sync URL 处理用）分轨。命名后缀 `Agent` 与 PublishExecutorAgentService
 * 对齐。
 */

import { Injectable } from "@nestjs/common";
import {
  ContentTransformerAgent,
  type ContentTransformerInput,
  type ContentTransformerOutput,
} from "../../mission/agents/content-transformer";
import {
  SocialAgentInvoker,
  extractTokenSpend,
  type SocialInvocationContext,
} from "./social-agent-invoker.service";
import {
  MissionBudgetPool,
  type IAgentEvent,
} from "@/modules/ai-harness/facade";
import { normalizeRunnerState } from "@/modules/ai-harness/facade";

export interface ContentTransformerInvocationResult {
  state: "completed" | "degraded" | "failed" | "cancelled";
  output?: ContentTransformerOutput;
  events: readonly IAgentEvent[];
  iterations: number;
  wallTimeMs: number;
}

@Injectable()
export class ContentTransformerAgentService {
  constructor(private readonly invoker: SocialAgentInvoker) {}

  async run(args: {
    input: ContentTransformerInput;
    ctx: SocialInvocationContext;
    pool?: MissionBudgetPool;
  }): Promise<ContentTransformerInvocationResult> {
    const first = await this.invoker.invoke(
      ContentTransformerAgent,
      args.input,
      args.ctx,
    );
    let chosen = first;
    let events: IAgentEvent[] = [...first.events];

    // 公众号成稿「字数/结构」硬校验：不达标强制重试一次（注入扩写指令），取更优。
    // 这是"要求"而非"建议"——短源也必须展开成 ≥2000 字 + ≥3 小标题的长文。
    if (this.belowWechatFloor(first.output, args.input.platform)) {
      const priorChars = this.bodyChars(first.output);
      const retry = await this.invoker.invoke(
        ContentTransformerAgent,
        {
          ...args.input,
          expandDirective: `上一稿正文仅约 ${priorChars} 字、太简陋（多半只搭了小标题骨架、每节一两句）。必须大幅扩写到 2000 字以上：**每个 ## 小标题下至少 300 字**（拆 3–5 个短段：论点 + 通俗解释 + 例子/类比 + 为什么重要），绝不可一节只写一两句；不得编造新事实 / 数据。`,
        },
        args.ctx,
      );
      events = [...events, ...retry.events];
      if (this.bodyChars(retry.output) > this.bodyChars(first.output)) {
        chosen = retry;
      }
    }

    if (args.pool) {
      await this.invoker.tickCost(
        args.ctx.missionId,
        args.ctx.userId,
        `content-transform-${args.input.platform}`,
        args.pool,
        extractTokenSpend(events),
      );
    }
    return {
      state: normalizeRunnerState(chosen.state),
      output: chosen.output as ContentTransformerOutput | undefined,
      events,
      iterations: chosen.iterations,
      wallTimeMs: chosen.wallTimeMs,
    };
  }

  /** 微信公众号长文硬要求：正文 ≥ 1500 字（去标签去空白）+ ≥ 3 个小标题 */
  private belowWechatFloor(out: unknown, platform: string): boolean {
    if (platform !== "WECHAT_MP") return false;
    const body = (out as ContentTransformerOutput | undefined)?.body;
    if (!body) return false;
    const headings = (body.match(/(^|\n)\s*#{1,6}\s|<h[1-6][\s>]/gi) ?? [])
      .length;
    return this.bodyChars(out) < 1500 || headings < 3;
  }

  private bodyChars(out: unknown): number {
    const body = (out as ContentTransformerOutput | undefined)?.body;
    if (!body) return 0;
    return body.replace(/<[^>]+>/g, "").replace(/\s/g, "").length;
  }
}
