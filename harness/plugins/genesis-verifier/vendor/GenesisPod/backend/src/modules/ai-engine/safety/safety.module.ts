/**
 * AI Engine Safety Module
 * 安全引擎子模块（约束 / 校验 / Guardrails）
 *
 * 提供:
 * - Schema Validator
 * - Content Filter (Guardrail)
 * - Cost Controller (Guardrail)
 * - Rate Limiter (Guardrail)
 * - Guardrails Pipeline (New Framework)
 */

import { Global, Module, OnModuleInit, Logger } from "@nestjs/common";
import { CacheModule } from "@/common/cache/cache.module";

// Validators
import { SchemaValidator } from "./validation/schema-validator";

// W2（2026-06-04）：CapabilityGuardService 已迁回 ai-harness/guardrails/capability
// （按 agent 进程授权表闸访问 = agent 运行时状态，engine 不得知 agent，律4）。

// Guardrails (Legacy)
import { ContentFilter } from "./moderation/content-filter";
// CostController 由 ai-harness/RuntimeResourceModule (@Global) 提供，
// RateLimitService 由 AiEngineReliabilityModule (@Global) 提供，
// 任何模块都能直接注入 — engine 不再反向 import。

// Guardrails Pipeline (New Framework)
import { GuardrailsPipelineService } from "./guardrails/guardrails-pipeline.service";

// Input Guardrails
import {
  PromptInjectionDetector,
  ContentSafetyFilter,
  InputComplexityCheck,
} from "./guardrails/input";
// ★ P2: LLM 语义级 moderation（escalation-only，懒解析 AiChatService 破循环 DI）
import { LlmModerationGuardrail } from "./guardrails/input/llm-moderation.guardrail";

// Output Guardrails
import { ContentComplianceCheck } from "./guardrails/output";

/**
 * Content Filter Factory
 */
const contentFilterFactory = {
  provide: ContentFilter,
  useFactory: () => {
    return new ContentFilter();
  },
};

@Global()
@Module({
  imports: [CacheModule],
  providers: [
    // Validators
    SchemaValidator,

    // Guardrails (Legacy)
    contentFilterFactory,

    // Guardrails Pipeline (New Framework)
    GuardrailsPipelineService,

    // Input Guardrails
    PromptInjectionDetector,
    ContentSafetyFilter,
    InputComplexityCheck,
    // ★ P2: escalation-only LLM 语义 moderation
    LlmModerationGuardrail,

    // Output Guardrails
    ContentComplianceCheck,
  ],
  exports: [SchemaValidator, ContentFilter, GuardrailsPipelineService],
})
export class AiEngineSafetyModule implements OnModuleInit {
  private readonly logger = new Logger(AiEngineSafetyModule.name);

  constructor(
    private readonly guardrailsPipeline: GuardrailsPipelineService,
    private readonly promptInjectionDetector: PromptInjectionDetector,
    private readonly contentSafetyFilter: ContentSafetyFilter,
    private readonly inputComplexityCheck: InputComplexityCheck,
    private readonly contentComplianceCheck: ContentComplianceCheck,
    private readonly llmModerationGuardrail: LlmModerationGuardrail,
  ) {}

  onModuleInit() {
    // Register input guardrails
    this.guardrailsPipeline.registerInputGuardrail(
      this.promptInjectionDetector,
    );
    this.guardrailsPipeline.registerInputGuardrail(this.contentSafetyFilter);
    this.guardrailsPipeline.registerInputGuardrail(this.inputComplexityCheck);

    // ★ P2: escalation-only LLM moderation —— 不进 inputGuardrails 数组（不每请求跑），
    //   仅当正则护栏报 'warning'（疑似但不确定）时由管道升级调用。
    this.guardrailsPipeline.registerEscalationGuardrail(
      this.llmModerationGuardrail,
    );

    // Register output guardrails
    this.guardrailsPipeline.registerOutputGuardrail(
      this.contentComplianceCheck,
    );

    const count = this.guardrailsPipeline.getCount();
    this.logger.log(
      `Guardrails Pipeline initialized: ${count.input} input guardrails, ${count.output} output guardrails`,
    );
  }
}
