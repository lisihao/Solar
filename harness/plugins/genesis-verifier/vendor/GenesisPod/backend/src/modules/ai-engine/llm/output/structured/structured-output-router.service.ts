/**
 * StructuredOutputRouter — 派生视图（v3.1 阶段 A 收敛）
 *
 * v3.1 之前：本文件内 module-level 常量 `PROVIDER_DEFAULT_CHAINS`（17 条 `match: (p,m)=>regex`）
 *   + `FINAL_FALLBACK` 决定每个 (provider, model) 的 structured-output strategy 链。
 *
 * v3.1 阶段 A 后：**删除 PROVIDER_DEFAULT_CHAINS + FINAL_FALLBACK**，本服务降级为
 *   `ModelCapabilityService` 的派生视图。strategy 链派生迁到
 *   `capability/model-capability.service.ts:deriveStructuredOutputChain()`。
 *
 * 路由优先级（保留语义，实现下沉）：
 *   1. model.structuredOutputStrategy（admin UI 显式配置）
 *      ← 由 ModelCapabilityService.deriveFromConfig 在 Level 3 注入
 *   2. catalog PROVIDER_CAPABILITY_DEFAULTS（数据驱动，原 17 条 1:1 收编）
 *      ← 由 ModelCapabilityService Level 4 注入
 *   3. SAFE_DEFAULTS + 最终兜底 'prompt'
 *      ← deriveStructuredOutputChain 末尾追加
 *
 * 本服务还剩两个职责：
 *   - resolveChain(model) → derived chain（薄壳：调 capability service）
 *   - getAdapter(strategy) → adapter 实例（adapter 注册表的薄壳）
 *
 * 删除 PROVIDER_DEFAULT_CHAINS 的副作用：
 *   - api-caller 的 `isDeepseekReasoner` 反模式同步删（A 阶段第 5 步）
 *   - contract spec `provider-default-chains-shape.contract.spec.ts` 同步演进
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  AnthropicOutputConfigAdapter,
  AnthropicToolUseAdapter,
  GbnfGrammarAdapter,
  GeminiResponseSchemaAdapter,
  JsonModeAdapter,
  JsonSchemaAdapter,
  JsonSchemaStrictAdapter,
  NoneAdapter,
  PromptOnlyAdapter,
} from "./adapters";
import type { IStructuredOutputAdapter } from "./structured-output-strategy.types";
import {
  STRUCTURED_OUTPUT_STRATEGIES,
  type StructuredOutputStrategy,
} from "./structured-output-strategy.types";
import { ModelCapabilityService } from "../../models/capability/model-capability.service";
import type { AIModelConfig } from "../../types/model-config.types";

/**
 * Router 调用方传入的"模型描述"——本服务把它转换成 AIModelConfig 子集
 * 喂给 ModelCapabilityService（capability service 输入的是 AIModelConfig）。
 *
 * 注意：admin 仅配 structuredOutputStrategy 时也走 capability derive 流程。
 */
export interface RouterResolveInput {
  provider: string;
  modelId: string;
  structuredOutputStrategy?: string | null;
  fallbackStrategies?: string[] | null;
}

@Injectable()
export class StructuredOutputRouter {
  private readonly logger = new Logger(StructuredOutputRouter.name);
  private readonly adapters: Record<
    StructuredOutputStrategy,
    IStructuredOutputAdapter
  >;

  constructor(private readonly capabilityService: ModelCapabilityService) {
    const list: IStructuredOutputAdapter[] = [
      new JsonSchemaStrictAdapter(),
      new JsonSchemaAdapter(),
      new AnthropicToolUseAdapter(),
      new AnthropicOutputConfigAdapter(),
      new JsonModeAdapter(),
      new GeminiResponseSchemaAdapter(),
      new GbnfGrammarAdapter(),
      new PromptOnlyAdapter(),
      new NoneAdapter(),
    ];
    this.adapters = list.reduce(
      (acc, a) => {
        acc[a.strategy] = a;
        return acc;
      },
      {} as Record<StructuredOutputStrategy, IStructuredOutputAdapter>,
    );
  }

  /**
   * 解析模型应使用的 strategy chain（派生视图）。
   *
   * 实现：把 model 转成最小 AIModelConfig 子集 → ModelCapabilityService
   *      → deriveStructuredOutputChain → readonly Strategy[]
   *
   * @param model AIModel 行片段（provider + modelId + 可选 admin 配置）
   * @returns 按尝试顺序的 strategy 列表（首选 → fallback... → 兜底 prompt）
   */
  resolveChain(model: RouterResolveInput): readonly StructuredOutputStrategy[] {
    // 把 RouterResolveInput 投影成 AIModelConfig 最小子集
    // （其它字段 capability service 在 deriveFromConfig 内只读未填则跳过）
    const projection = {
      id: "",
      name: "",
      displayName: "",
      provider: model.provider ?? "",
      modelId: model.modelId ?? "",
      apiEndpoint: "",
      apiKey: null,
      maxTokens: 0,
      temperature: 0,
      isEnabled: true,
      isDefault: false,
      structuredOutputStrategy: model.structuredOutputStrategy ?? null,
      fallbackStrategies: model.fallbackStrategies ?? [],
    } satisfies AIModelConfig;

    const caps = this.capabilityService.resolveCapabilities(projection);
    const chain = this.capabilityService.deriveStructuredOutputChain(caps);

    if (chain.length === 1 && chain[0] === "prompt") {
      this.logger.debug(
        `[resolveChain] model="${model.modelId}" provider="${model.provider}" derived chain=['prompt'] ` +
          `(no catalog match + no admin config)`,
      );
    }
    return chain;
  }

  /** 拿 strategy 对应 adapter 实例 */
  getAdapter(strategy: StructuredOutputStrategy): IStructuredOutputAdapter {
    return this.adapters[strategy];
  }

  /**
   * 返回所有已知 strategy（admin UI 下拉选项用）。
   */
  listStrategies(): readonly StructuredOutputStrategy[] {
    return STRUCTURED_OUTPUT_STRATEGIES;
  }
}
