/**
 * API Caller Self-Heal Trigger Service
 *
 * v3.1 阶段 D.1 (2026-05-24)：从 AiApiCallerService god-class 中抽出的
 * self-heal 触发逻辑。每个 provider 的 catch 块原本会内联调用一段
 * `extractErrorSignal → maybeSelfHeal` 流程；现在统一委派给本 service。
 *
 * 职责（单一）：
 *   - 在 LLM API 调用 catch 块中被调用
 *   - 命中能力错误形态（4xx + 已识别 errorCode）→ 异步触发 CapabilitySelfHealService.maybeSelfHeal
 *   - 非命中 / 未注入 / 缺 userModelConfigId → 静默 noop
 *   - fire-and-forget：不阻断 caller 的 throw，self-heal 异步异常仅 warn
 *
 * 决策语义与 v3.1 §B+.3 一致：
 *   - 仅 BYOK 路径触发（userModelConfigId 必填）
 *   - 当前只针对 structuredOutput.nativeMode 自降级（json_schema → none）
 *
 * **不要在本 service 加业务判断**——它只是一个 thin trigger，所有阈值 /
 * cooling-off / advisory lock 决策都在 CapabilitySelfHealService 内。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { CapabilitySelfHealService } from "../models/capability/capability-self-heal.service";
import {
  buildDegenerateOutputSignal,
  extractErrorSignal,
} from "../models/capability/error-signal.types";

export interface SelfHealTriggerOptions {
  /** 模型 id（仅用于日志，不参与决策） */
  modelId: string;
  /**
   * 用户模型配置 id：self-heal 写入面唯一作用对象。
   * 缺失（系统级模型 / 旧调用方）→ 不触发。
   */
  userModelConfigId?: string;
  /**
   * R1 (2026-05-25): chain-aware 降级 from/to（caller 用 effectiveNativeMode
   * + deriveStructuredOutputChain 算出，见 ai-api-caller.computeSelfHealDegrade）。
   * 缺省 = 旧一刀切 json_schema → none（保留 BC：未传的 caller / Anthropic 路径）。
   */
  fromValue?: string;
  toValue?: string;
}

@Injectable()
export class ApiCallerSelfHealTriggerService {
  private readonly logger = new Logger(ApiCallerSelfHealTriggerService.name);

  constructor(
    // @Optional 保留 BC：旧单测可不注入 self-heal service（trigger 静默）
    @Optional()
    private readonly capabilitySelfHealService?: CapabilitySelfHealService,
  ) {}

  /**
   * catch 块调用入口（fire-and-forget；调用方仍须自行 throw err）。
   *
   * 命中条件：
   *   1. userModelConfigId 非空（BYOK 路径）
   *   2. self-heal service 已注入
   *   3. extractErrorSignal 能从 err 抽出严格信号（4xx + 已识别 errorCode）
   *
   * 异步 maybeSelfHeal 抛错 → warn 日志，不传播
   */
  triggerSelfHealAsync(err: unknown, opts: SelfHealTriggerOptions): void {
    const { modelId, userModelConfigId } = opts;
    if (!userModelConfigId || !this.capabilitySelfHealService) return;
    const signal = extractErrorSignal(err);
    if (signal === null) return;
    void this.capabilitySelfHealService
      .maybeSelfHeal({
        target: { kind: "user_model_config", id: userModelConfigId },
        field: "structuredOutput.nativeMode",
        // R1: chain-aware 降级（caller 传）；缺省回退旧 json_schema → none
        fromValue: opts.fromValue ?? "json_schema",
        toValue: opts.toValue ?? "none",
        errorSignal: signal,
      })
      .catch((e: unknown) =>
        this.logger.warn(
          `[self-heal-trigger] modelId=${modelId}: ${String(e).slice(0, 200)}`,
        ),
      );
  }

  /**
   * 退化输出（200 OK 但 content 空/畸形）触发入口。
   *
   * 与 {@link triggerSelfHealAsync} 同样 fire-and-forget，但信号是合成的
   * degenerate-output（httpStatus=200 + errorCode='degenerate_output'），用于
   * 那些"接受 response_format 却吐退化输出"、没有 4xx 可解析的模型。命中阈值后
   * self-heal 把 structuredOutput.nativeMode 持久化降到 chain 下一档。
   *
   * bodySnippet 应含 fromValue / 'nativeMode' 以通过 self-heal 的 body 证据校验。
   */
  triggerDegenerateSelfHealAsync(
    opts: SelfHealTriggerOptions & { bodySnippet?: string },
  ): void {
    const { modelId, userModelConfigId } = opts;
    if (!userModelConfigId || !this.capabilitySelfHealService) return;
    if (!opts.fromValue || !opts.toValue) return; // 无降档目标 → 不触发
    const signal = buildDegenerateOutputSignal(
      opts.bodySnippet ?? `degenerate_output nativeMode=${opts.fromValue}`,
    );
    void this.capabilitySelfHealService
      .maybeSelfHeal({
        target: { kind: "user_model_config", id: userModelConfigId },
        field: "structuredOutput.nativeMode",
        fromValue: opts.fromValue,
        toValue: opts.toValue,
        errorSignal: signal,
      })
      .catch((e: unknown) =>
        this.logger.warn(
          `[self-heal-trigger:degenerate] modelId=${modelId}: ${String(e).slice(0, 200)}`,
        ),
      );
  }
}
