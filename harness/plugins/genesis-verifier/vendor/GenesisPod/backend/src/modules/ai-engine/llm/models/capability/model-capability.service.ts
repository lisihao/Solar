/**
 * ModelCapabilityService —— v3.1 §3.4 capability 解析 SSOT
 *
 * 5 级优先级解析（v3 §3.4）：
 *   1. UserModelConfig.capability_overrides（B 阶段加；A 阶段返回 empty）
 *   2. AIModel.capability_overrides         （B 阶段加；A 阶段返回 empty）
 *   3. AIModel 19 既有列 + AiChat-derived  （从 config 字段推导）
 *   4. ProviderCapabilityDefaults          （catalog first-match-wins）
 *   5. SAFE_DEFAULTS                       （全 'none' 安全兜底）
 *
 * 派生：deriveStructuredOutputChain(caps) 把 capability 转成 structured-output
 * strategy 链，替代原 router.PROVIDER_DEFAULT_CHAINS 数据驱动逻辑。
 *
 * v3.1 阶段 A 范围：
 *   - resolveCapabilities 是**纯同步**函数（输入 AIModelConfig，无 DB / 无 Redis）
 *   - 优先级 #1/#2 永远返 empty —— B 阶段才接 capability_overrides JSONB
 *   - 不写任何 DB / Redis / cache —— 那是 B 阶段 self-heal 范畴（D7 SSOT 收敛）
 *
 * SSOT 守护（v3 §3.6）：
 *   - 本服务不出 ai-engine/llm/facade（不被 ai-app 直接读 caps）
 *   - 只有 ai-engine/llm/services/** 和 structured-output/router 可以注入
 *   - ai-app 拿能力的方式仍是调 AiChatService.chat() 黑盒
 */

import { Injectable } from "@nestjs/common";

import type { AIModelConfig } from "../../types/model-config.types";
import {
  PROVIDER_CAPABILITY_DEFAULTS,
  SAFE_DEFAULTS,
  type ProviderCapabilityRule,
} from "./model-capability-catalog";
import type {
  ModelCapabilities,
  ModelCapabilitiesOverrides,
  NativeStructuredOutputMode,
  ReasoningKind,
  TemperatureSupport,
  TokenParamName,
  VisionSupport,
} from "./model-capability.types";

@Injectable()
export class ModelCapabilityService {
  /**
   * 解析某模型的全维度 capability。
   *
   * **同步**：输入 AIModelConfig（上游已从 DB 加载），无 DB / Redis 调用。
   *
   * 优先级（高 → 低）：
   *   1. UserModelConfig.capability_overrides   ★ A 阶段 stub 返 empty
   *   2. AIModel.capability_overrides            ★ A 阶段 stub 返 empty
   *   3. AIModel 19 既有列 + AiChat-derived
   *   4. ProviderCapabilityDefaults (catalog)
   *   5. SAFE_DEFAULTS
   *
   * @param config AIModelConfig（来自 AiModelConfigService.getModelConfig()）
   * @returns 完整 ModelCapabilities（保证每字段都有值）
   */
  resolveCapabilities(config: AIModelConfig): ModelCapabilities {
    // 5 级合并（低优先级先铺底，高优先级覆盖）
    const merged: ModelCapabilities = this.cloneCapabilities(SAFE_DEFAULTS);

    // Level 4: catalog（first-match-wins，dual-pass §B+.1）
    //   Pass 1: apiFormat + modelPattern 优先匹配（仅当 entry 同时带 modelPattern；
    //           粗匹 apiFormat='openai' 字段不让任意 modelId 误命中通用 openai-compat 规则）
    //   Pass 2: 退回 provider + (modelPattern? | provider-only) 原匹配
    const catalogRule = this.findCatalogRule(
      config.provider,
      config.modelId,
      config.apiFormat,
    );
    if (catalogRule) {
      this.mergeInto(merged, catalogRule.capabilities);
    }

    // Level 3: AIModel 19 既有列 + AiChat-derived
    this.mergeInto(merged, this.deriveFromConfig(config));

    // Level 2: AIModel.capability_overrides
    //
    // v3.1 阶段 A review (2026-05-24)：取消注释，启用真 mergeInto 调用。
    // A 阶段 AiModelConfigService.buildModelConfig 不填 aiModelOverrides，
    // 字段永远 undefined → ?? {} → mergeInto 无操作，行为与 stub 期一致。
    // B 阶段只需在 buildModelConfig 内写入 JSONB 列即可启用，无需改本服务。
    this.mergeInto(merged, config.aiModelOverrides ?? {});

    // Level 1: UserModelConfig.capability_overrides
    //
    // v3.1 阶段 A review (2026-05-24)：取消注释，启用真 mergeInto 调用（同上）。
    this.mergeInto(merged, config.userOverrides ?? {});

    return merged;
  }

  /**
   * 把 ModelCapabilities 派生为 structured-output strategy 链。
   *
   * 派生规则：
   *   1. nativeMode（非 'none' 时入队）
   *   2. fallbackChain（按序入队）
   *   3. 'prompt' 永远兜底（任何 provider 都能跑 prompt + post-parse）
   *   4. 去重保序
   *
   * @returns [nativeMode, ...fallbackChain, 'prompt'] 去重后的链
   */
  deriveStructuredOutputChain(
    caps: ModelCapabilities,
  ): readonly NativeStructuredOutputMode[] {
    const out: NativeStructuredOutputMode[] = [];
    const seen = new Set<NativeStructuredOutputMode>();
    const push = (s: NativeStructuredOutputMode): void => {
      if (s === "none" || seen.has(s)) return;
      out.push(s);
      seen.add(s);
    };

    if (caps.structuredOutput.nativeMode !== "none") {
      push(caps.structuredOutput.nativeMode);
    }
    for (const s of caps.structuredOutput.fallbackChain) push(s);

    // 兜底 prompt（与原 router FINAL_FALLBACK 一致）
    if (!seen.has("prompt")) {
      out.push("prompt");
    }

    return out;
  }

  // ─────────── 内部 helpers ───────────

  /**
   * Catalog first-match-wins 查找（v3.1 §B+.1 dual-pass）：
   *
   * Pass 1 — apiFormat-priority（仅当 config.apiFormat 存在且 entry 同时带
   *   modelPattern 时启用）：
   *     - entry.apiFormat === config.apiFormat（小写等值）
   *     - entry.modelPattern.test(modelId)（防止 apiFormat='openai' 这种粗匹
   *       字段让任意 modelId 误命中第一条 openai-compat 规则；apiFormat-only
   *       匹配天然不安全，必须靠 modelPattern 收窄）
   *   命中场景：BYOK provider='custom' + apiFormat='openai' + modelId='deepseek-reasoner'
   *   → 命中 deepseek-reasoner 条目（apiFormat='openai' + /reasoner/ 同时匹配），
   *     而非走 SAFE_DEFAULTS。
   *
   * Pass 2 — provider-priority（原行为）：
   *     - rule.provider === config.provider
   *     - rule.modelPattern? 命中 OR 无 modelPattern
   *
   * BC：原 21 条 entry 都没 apiFormat 时 Pass 1 直接跳过，行为与重构前一致。
   */
  private findCatalogRule(
    provider: string | undefined,
    modelId: string | undefined,
    apiFormat: string | undefined,
  ): ProviderCapabilityRule | undefined {
    const m = (modelId ?? "").toLowerCase();
    // Pass 1: apiFormat + modelPattern（高优先级；apiFormat 粗匹必须有 modelPattern 收窄）
    if (apiFormat) {
      const af = apiFormat.toLowerCase().trim();
      for (const rule of PROVIDER_CAPABILITY_DEFAULTS) {
        if (!rule.apiFormat || !rule.modelPattern) continue;
        if (rule.apiFormat.toLowerCase() !== af) continue;
        if (!rule.modelPattern.test(m)) continue;
        return rule;
      }
    }
    // Pass 2: provider + modelPattern?（原行为）
    if (!provider) return undefined;
    const p = provider.toLowerCase().trim();
    for (const rule of PROVIDER_CAPABILITY_DEFAULTS) {
      if (rule.provider !== p) continue;
      if (rule.modelPattern && !rule.modelPattern.test(m)) continue;
      return rule;
    }
    return undefined;
  }

  /**
   * 从 AIModelConfig 19 既有列派生 capabilities（Level 3）。
   *
   * 仅派生**有信息量的字段**（既有列里有值），其它保持 partial 让上层 merge
   * 时不覆盖 catalog 默认值。
   *
   * 关键派生：
   *   - structuredOutput.nativeMode ← config.structuredOutputStrategy
   *     （admin 显式配置覆盖 catalog）
   *   - structuredOutput.fallbackChain ← config.fallbackStrategies
   *   - reasoning.kind ← config.isReasoning（true → 'reasoning_effort' 或保留 catalog）
   *   - temperature.support ← config.supportsTemperature
   *   - tokenParam ← config.tokenParamName
   *   - vision.support ← config.supportsVision
   *   - streaming.support ← config.supportsStreaming
   *   - context.maxOutputTokens ← config.maxTokens
   *
   * 返回 ModelCapabilitiesOverrides（deep-partial）允许 structuredOutput 子对象
   * 只设 fallbackChain 不设 nativeMode（消除原 `nativeMode: 'none'` 占位二义性）。
   */
  private deriveFromConfig(config: AIModelConfig): ModelCapabilitiesOverrides {
    const out: ModelCapabilitiesOverrides = {};

    // structuredOutput：admin 显式配置 override catalog 默认
    //
    // v3.1 §B 子片 2 review-fix (2026-05-24)：消除 'none' 占位二义性
    //   - undefined（admin 没配 fallbackStrategies） → 用 catalog 默认 fallback
    //   - []（admin 显式配空数组） → 强制无 fallback（只剩 prompt 兜底）
    //   - [...]（admin 显式配链） → 覆盖 catalog
    //
    // 关键：当 admin 仅配 fallback 没首选时，子对象只设 fallbackChain 不设
    // nativeMode（deep-partial 允许）。'none' 现在是显式 override 语义
    // （admin/user/self-heal 显式降级），不再有占位含义。
    const primaryValid = config.structuredOutputStrategy
      ? this.filterValidStrategies([config.structuredOutputStrategy])
      : [];
    const fallbackValid: readonly NativeStructuredOutputMode[] | undefined =
      config.fallbackStrategies !== undefined
        ? this.filterValidStrategies(config.fallbackStrategies)
        : undefined;
    if (primaryValid.length > 0) {
      // admin 配了首选 → 设 nativeMode；fallbackChain 仅在 admin 实际配过时设
      // （deep-partial 允许 fallbackChain 缺失 → mergeInto 保留 catalog 默认）
      out.structuredOutput = {
        nativeMode: primaryValid[0],
        ...(fallbackValid !== undefined && { fallbackChain: fallbackValid }),
      };
    } else if (fallbackValid !== undefined && fallbackValid.length > 0) {
      // admin 仅配 fallback 没首选（或首选 invalid 被过滤） → 只覆盖 fallback，
      // 不设 nativeMode（mergeInto 保留 catalog 的 nativeMode）
      out.structuredOutput = {
        fallbackChain: fallbackValid,
      };
    }
    // 全 invalid（structuredOutputStrategy/fallbackStrategies 都未配或全无效）
    //   → out.structuredOutput 不设 → 完全用 catalog 默认

    // reasoning：isReasoning=true 时映射 kind；具体 kind 区分由 catalog 决定
    // 本派生仅在 catalog 没指定时给最保守的 'opaque'
    if (config.isReasoning === true) {
      out.reasoning = {
        kind: "opaque" as ReasoningKind,
        exposeContent: "none",
      };
    }

    // temperature
    if (config.supportsTemperature === false) {
      out.temperature = { support: "none" as TemperatureSupport };
    }

    // tokenParam
    if (config.tokenParamName) {
      const valid = (
        [
          "max_tokens",
          "max_completion_tokens",
          "max_output_tokens",
          "maxOutputTokens",
        ] as TokenParamName[]
      ).includes(config.tokenParamName as TokenParamName);
      if (valid) {
        out.tokenParam = config.tokenParamName as TokenParamName;
      }
    }

    // vision
    if (config.supportsVision === true) {
      out.vision = { support: "image_url" as VisionSupport };
    } else if (config.supportsVision === false) {
      out.vision = { support: "none" as VisionSupport };
    }

    // streaming
    if (typeof config.supportsStreaming === "boolean") {
      out.streaming = { support: config.supportsStreaming };
    }

    // context.maxOutputTokens（既有 19 列里有 maxTokens，作 maxOutput 用）
    if (typeof config.maxTokens === "number" && config.maxTokens > 0) {
      out.context = {
        maxInputTokens: 0,
        maxOutputTokens: config.maxTokens,
      };
    }

    return out;
  }

  /**
   * 过滤无效 strategy 字符串（与 isStructuredOutputStrategy 一致语义）。
   * admin 配置漂移时不让 garbage 字符串渗入 chain。
   */
  private filterValidStrategies(
    arr: readonly string[],
  ): readonly NativeStructuredOutputMode[] {
    const known = new Set<NativeStructuredOutputMode>([
      "json_schema_strict",
      "json_schema",
      "tool_use",
      "json_mode",
      "gemini_response_schema",
      "gbnf_grammar",
      "prompt",
      "none",
    ]);
    return arr.filter((s): s is NativeStructuredOutputMode =>
      known.has(s as NativeStructuredOutputMode),
    );
  }

  /**
   * Deep merge `patch` 进 `target`（仅覆盖 patch 提供的字段；嵌套对象按字段
   * 级合并；`undefined` 子字段保留现有 target 值）。
   *
   * patch 接受两种形状：
   *   - `Partial<ModelCapabilities>`：catalog rule 用（顶层 optional，子对象字段必填）
   *   - `ModelCapabilitiesOverrides`：deriveFromConfig + B.2 admin/user JSONB override 用（deep partial）
   * 两者在 runtime 等价（spread + truthy guard 都安全处理 undefined 子字段）；
   * 类型上用联合统一接受。
   *
   * v3.1 §B 子片 2 review-fix (2026-05-24)：移除 'none' 占位特判。
   *   `nativeMode='none'` 现在是显式 override 语义（admin/user/self-heal 显式降级），
   *   会真正覆盖 target.nativeMode。"不动 nativeMode" 由调用方不设字段表达
   *   （deriveFromConfig 仅配 fallback 时不再写 nativeMode）。
   */
  private mergeInto(
    target: ModelCapabilities,
    patch: Partial<ModelCapabilities> | ModelCapabilitiesOverrides,
  ): void {
    if (patch.structuredOutput) {
      const next = patch.structuredOutput;
      target.structuredOutput = {
        nativeMode:
          next.nativeMode !== undefined
            ? next.nativeMode
            : target.structuredOutput.nativeMode,
        fallbackChain:
          next.fallbackChain !== undefined
            ? next.fallbackChain
            : target.structuredOutput.fallbackChain,
      };
    }
    if (patch.toolUse) {
      target.toolUse = { ...target.toolUse, ...patch.toolUse };
    }
    if (patch.reasoning) {
      target.reasoning = { ...target.reasoning, ...patch.reasoning };
    }
    if (patch.temperature) {
      target.temperature = { ...target.temperature, ...patch.temperature };
    }
    if (patch.tokenParam !== undefined) {
      target.tokenParam = patch.tokenParam;
    }
    if (patch.vision) {
      target.vision = { ...target.vision, ...patch.vision };
    }
    if (patch.streaming) {
      target.streaming = { ...target.streaming, ...patch.streaming };
    }
    if (patch.context) {
      target.context = { ...target.context, ...patch.context };
    }
    if (patch.systemPrompt) {
      target.systemPrompt = { ...target.systemPrompt, ...patch.systemPrompt };
    }
    if (patch.promptCache) {
      target.promptCache = { ...target.promptCache, ...patch.promptCache };
    }
  }

  /** 深拷贝 SAFE_DEFAULTS（防被 mergeInto 改原对象）。 */
  private cloneCapabilities(c: ModelCapabilities): ModelCapabilities {
    return {
      structuredOutput: {
        nativeMode: c.structuredOutput.nativeMode,
        fallbackChain: [...c.structuredOutput.fallbackChain],
      },
      toolUse: { ...c.toolUse },
      reasoning: { ...c.reasoning },
      temperature: { ...c.temperature },
      tokenParam: c.tokenParam,
      vision: { ...c.vision },
      streaming: { ...c.streaming },
      context: { ...c.context },
      systemPrompt: { ...c.systemPrompt },
      promptCache: { ...c.promptCache },
    };
  }
}
