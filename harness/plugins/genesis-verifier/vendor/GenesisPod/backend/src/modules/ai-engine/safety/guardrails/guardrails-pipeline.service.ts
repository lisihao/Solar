/**
 * AI Engine - Guardrails Pipeline Service
 * 护栏管道服务
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  IInputGuardrail,
  IOutputGuardrail,
  GuardrailInput,
  GuardrailOutput,
  GuardrailsPipelineResult,
  GuardrailResult,
} from "./guardrails.interface";

/**
 * Guardrails Pipeline Service
 * Runs input/output through registered guardrails
 */
@Injectable()
export class GuardrailsPipelineService {
  private readonly logger = new Logger(GuardrailsPipelineService.name);
  private inputGuardrails: IInputGuardrail[] = [];
  private outputGuardrails: IOutputGuardrail[] = [];
  /**
   * ★ P2 escalation-only：语义级 LLM moderation 护栏。
   *
   * 不放进 inputGuardrails 数组（否则每请求都跑，烧 token/延迟）。仅当快筛的
   * 正则护栏报告"疑似但不确定"（severity:'warning'）时，processInput 才升级调用
   * 它做一次 LLM 语义分类。干净输入永不触发。undefined = 未注册（无升级层）。
   */
  private escalationGuardrail?: IInputGuardrail;

  /** B (2026-05-05): SAFETY_INPUT/OUTPUT plugin hook seam */
  constructor(
    @Optional()
    private readonly hookBus?: import("@/plugins/core/hook-bus").HookBus,
  ) {}

  /**
   * Register an input guardrail
   */
  registerInputGuardrail(guardrail: IInputGuardrail): void {
    this.logger.log(
      `Registering input guardrail: ${guardrail.id} (${guardrail.name})`,
    );
    this.inputGuardrails.push(guardrail);
  }

  /**
   * Register the escalation-only guardrail (LLM semantic moderation).
   *
   * Distinct from registerInputGuardrail: this guardrail does NOT run on every
   * request. It is invoked by processInput only when a regex input guardrail
   * flags a 'warning' (suspicious-but-not-blocked) result. Registering it more
   * than once replaces the previous one (single escalation layer).
   */
  registerEscalationGuardrail(guardrail: IInputGuardrail): void {
    this.logger.log(
      `Registering escalation guardrail: ${guardrail.id} (${guardrail.name})`,
    );
    this.escalationGuardrail = guardrail;
  }

  /**
   * Register an output guardrail
   */
  registerOutputGuardrail(guardrail: IOutputGuardrail): void {
    this.logger.log(
      `Registering output guardrail: ${guardrail.id} (${guardrail.name})`,
    );
    this.outputGuardrails.push(guardrail);
  }

  /**
   * Process input through all registered input guardrails
   * Short-circuits on 'block' severity
   */
  async processInput(input: GuardrailInput): Promise<GuardrailsPipelineResult> {
    // B (2026-05-05): SAFETY_INPUT plugin hook fire-and-forget（PII/审核 plugin 用）
    // ★ 全覆盖审计修 (2026-05-06): hook 失败必须可见，改 warn 而非吞错
    if (this.hookBus) {
      void this.hookBus
        .fire(
          "engine.safety.input",
          {
            text: typeof input === "string" ? input : JSON.stringify(input),
            source: "user" as const,
          },
          async () => undefined,
        )
        .catch((err) =>
          this.logger.warn("[safety hook] input hook error", err),
        );
    }
    const results: GuardrailResult[] = [];
    let blockedBy: string | undefined;
    // ★ PII 脱敏通道：随管道逐个 guardrail 改写内容（chain），最终回传给调用方。
    let currentContent = input.content;
    let transformed = false;

    for (const guardrail of this.inputGuardrails) {
      // Skip disabled guardrails
      if (!guardrail.enabled) {
        this.logger.debug(`Skipping disabled input guardrail: ${guardrail.id}`);
        continue;
      }

      try {
        // ★ 把上一个 guardrail 的脱敏结果作为下一个的输入（链式改写）
        const result = await guardrail.check({
          ...input,
          content: currentContent,
        });
        results.push(result);

        // ★ 若该 guardrail 改写了内容（如 PII 脱敏），更新当前内容
        if (typeof result.transformedContent === "string") {
          currentContent = result.transformedContent;
          transformed = true;
        }

        // Short-circuit on 'block' severity
        if (result.severity === "block" && !result.passed) {
          blockedBy = guardrail.id;
          this.logger.warn(
            `Input blocked by guardrail: ${guardrail.id} - ${result.message}`,
          );
          break;
        }

        // Log non-passing results
        if (!result.passed) {
          this.logger.warn(
            `Input guardrail ${guardrail.id} failed with severity ${result.severity}: ${result.message}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Error running input guardrail ${guardrail.id}: ${error instanceof Error ? error.message : error}`,
        );
        // ★ Security (P0): 护栏 check() 抛错 → fail-closed 阻断。
        // 安全护栏执行失败时无法判定输入是否安全，按 block 处理而非放行。
        results.push({
          passed: false,
          guardrailId: guardrail.id,
          severity: "block",
          message: `Guardrail execution error: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
        blockedBy = guardrail.id;
        break;
      }
    }

    // ★ P2 escalation-only：正则护栏已快筛完。仅当未被 block，且某个护栏报告
    //   "疑似但不确定"（severity:'warning'）时，才升级跑一次 LLM 语义分类。
    //   干净输入（全 info/pass）**不**触发 → 不每请求烧 token/延迟。
    if (!blockedBy && this.escalationGuardrail?.enabled) {
      const suspicious = results.some((r) => r.severity === "warning");
      if (suspicious && input.trustedInternal === true) {
        // trusted-internal（服务端内部管线）opt-in：可疑只记日志，不升级不 block。
        // regex 直接 block 的硬违规不受影响（上方循环已短路）。
        const flaggedBy = results
          .filter((r) => r.severity === "warning")
          .map((r) => r.guardrailId)
          .join(", ");
        this.logger.warn(
          `Trusted-internal input flagged suspicious by [${flaggedBy}] — LLM moderation escalation skipped (log-only)`,
        );
      } else if (suspicious) {
        this.logger.warn(
          `Escalating to LLM moderation (${this.escalationGuardrail.id}): regex guardrail reported suspicious input`,
        );
        try {
          const moderationResult = await this.escalationGuardrail.check({
            ...input,
            content: currentContent,
          });
          results.push(moderationResult);
          if (
            moderationResult.severity === "block" &&
            !moderationResult.passed
          ) {
            blockedBy = this.escalationGuardrail.id;
            this.logger.warn(
              `Input blocked by escalation guardrail: ${this.escalationGuardrail.id} - ${moderationResult.message}`,
            );
          }
        } catch (error) {
          // fail-closed：升级护栏抛错 → 阻断（与正则护栏 catch 语义一致）
          this.logger.error(
            `Error running escalation guardrail ${this.escalationGuardrail.id}: ${error instanceof Error ? error.message : error}`,
          );
          results.push({
            passed: false,
            guardrailId: this.escalationGuardrail.id,
            severity: "block",
            message: `Escalation guardrail execution error: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
          blockedBy = this.escalationGuardrail.id;
        }
      }
    }

    const passed =
      !blockedBy &&
      results.every(
        (r) => r.passed || r.severity === "info" || r.severity === "warning",
      );

    return {
      passed,
      results,
      blockedBy,
      // ★ 仅当确实发生改写且未被阻断时回传脱敏内容，否则 undefined（调用方沿用原文）
      transformedContent:
        transformed && !blockedBy ? currentContent : undefined,
    };
  }

  /**
   * Process output through all registered output guardrails
   * Short-circuits on 'block' severity
   */
  async processOutput(
    output: GuardrailOutput,
  ): Promise<GuardrailsPipelineResult> {
    // B (2026-05-05): SAFETY_OUTPUT plugin hook fire-and-forget
    // ★ 全覆盖审计修 (2026-05-06): hook 失败必须可见，改 warn 而非吞错
    if (this.hookBus) {
      void this.hookBus
        .fire(
          "engine.safety.output",
          {
            text: typeof output === "string" ? output : JSON.stringify(output),
            producedBy: "agent",
          },
          async () => undefined,
        )
        .catch((err) =>
          this.logger.warn("[safety hook] output hook error", err),
        );
    }
    const results: GuardrailResult[] = [];
    let blockedBy: string | undefined;
    // ★ 输出侧同样支持脱敏链式改写
    let currentContent = output.content;
    let transformed = false;

    for (const guardrail of this.outputGuardrails) {
      // Skip disabled guardrails
      if (!guardrail.enabled) {
        this.logger.debug(
          `Skipping disabled output guardrail: ${guardrail.id}`,
        );
        continue;
      }

      try {
        const result = await guardrail.check({
          ...output,
          content: currentContent,
        });
        results.push(result);

        if (typeof result.transformedContent === "string") {
          currentContent = result.transformedContent;
          transformed = true;
        }

        // Short-circuit on 'block' severity
        if (result.severity === "block" && !result.passed) {
          blockedBy = guardrail.id;
          this.logger.warn(
            `Output blocked by guardrail: ${guardrail.id} - ${result.message}`,
          );
          break;
        }

        // Log non-passing results
        if (!result.passed) {
          this.logger.warn(
            `Output guardrail ${guardrail.id} failed with severity ${result.severity}: ${result.message}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Error running output guardrail ${guardrail.id}: ${error instanceof Error ? error.message : error}`,
        );
        // ★ Security (P0): 护栏 check() 抛错 → fail-closed 阻断。
        // 安全护栏执行失败时无法判定输出是否安全，按 block 处理而非放行。
        results.push({
          passed: false,
          guardrailId: guardrail.id,
          severity: "block",
          message: `Guardrail execution error: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
        blockedBy = guardrail.id;
        break;
      }
    }

    const passed =
      !blockedBy &&
      results.every(
        (r) => r.passed || r.severity === "info" || r.severity === "warning",
      );

    return {
      passed,
      results,
      blockedBy,
      transformedContent:
        transformed && !blockedBy ? currentContent : undefined,
    };
  }

  /**
   * Get pipeline status
   */
  getStatus(): {
    inputGuardrails: string[];
    outputGuardrails: string[];
  } {
    return {
      inputGuardrails: this.inputGuardrails.map(
        (g) => `${g.id} (enabled: ${g.enabled})`,
      ),
      outputGuardrails: this.outputGuardrails.map(
        (g) => `${g.id} (enabled: ${g.enabled})`,
      ),
    };
  }

  /**
   * Get detailed guardrail list for admin display
   */
  getRegisteredGuardrails(): {
    input: Array<{ id: string; name: string; enabled: boolean }>;
    output: Array<{ id: string; name: string; enabled: boolean }>;
    totalRules: number;
  } {
    return {
      input: this.inputGuardrails.map((g) => ({
        id: g.id,
        name: g.name,
        enabled: g.enabled,
      })),
      output: this.outputGuardrails.map((g) => ({
        id: g.id,
        name: g.name,
        enabled: g.enabled,
      })),
      totalRules: this.inputGuardrails.length + this.outputGuardrails.length,
    };
  }

  /**
   * Get count of registered guardrails
   */
  getCount(): { input: number; output: number } {
    return {
      input: this.inputGuardrails.length,
      output: this.outputGuardrails.length,
    };
  }
}
