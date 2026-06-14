/**
 * ModelCapabilityService spec —— v3.1 §A 5 级优先级 + 派生链验证
 *
 * 覆盖：
 *   - Level 4 catalog first-match-wins（含别名 + modelPattern 区分）
 *   - Level 3 AIModel 19 既有列派生（admin override / isReasoning / temperature / ...）
 *   - Level 5 SAFE_DEFAULTS 兜底（未知 provider）
 *   - deriveStructuredOutputChain 边界（nativeMode 'none' 跳过 + 去重 + 兜底 prompt）
 *   - v3.1 §1.4 案例研究矩阵：deepseek-reasoner / deepseek-v4-pro / deepseek-chat
 */

import { ModelCapabilityService } from "../model-capability.service";
import type { AIModelConfig } from "../../types/model-config.types";

const baseConfig = (overrides: Partial<AIModelConfig> = {}): AIModelConfig => ({
  id: "",
  name: "",
  displayName: "",
  provider: "",
  modelId: "",
  apiEndpoint: "",
  apiKey: null,
  maxTokens: 0,
  temperature: 0,
  isEnabled: true,
  isDefault: false,
  ...overrides,
});

describe("ModelCapabilityService — resolveCapabilities (v3.1 §A)", () => {
  let svc: ModelCapabilityService;
  beforeEach(() => {
    svc = new ModelCapabilityService();
  });

  // ─────────── Level 4 catalog 命中 ───────────

  describe("Level 4: catalog first-match-wins", () => {
    it("provider=openai → catalog json_schema_strict", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "openai", modelId: "gpt-4o" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("json_schema_strict");
      expect(caps.tokenParam).toBe("max_tokens");
      expect(caps.toolUse.mode).toBe("openai_functions");
      expect(caps.systemPrompt.placement).toBe("messages_array");
    });

    it("provider=anthropic 旧模型(claude-3.5) → catalog tool_use + top_level_system_field", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "anthropic", modelId: "claude-3.5-sonnet" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("tool_use");
      expect(caps.systemPrompt.placement).toBe("top_level_system_field");
      expect(caps.promptCache.support).toBe("anthropic_cache_control");
      expect(caps.reasoning.kind).toBe("extended_thinking");
    });

    it("F7: provider=anthropic Claude 4.5+(opus-4-7) → native anthropic_output_config + tool_use 降级链", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "anthropic", modelId: "claude-opus-4-7" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("anthropic_output_config");
      expect(caps.structuredOutput.fallbackChain).toEqual(["tool_use"]);
      // 派生链：native → tool_use → 兜底 prompt
      expect(svc.deriveStructuredOutputChain(caps)).toEqual([
        "anthropic_output_config",
        "tool_use",
        "prompt",
      ]);
      expect(caps.systemPrompt.placement).toBe("top_level_system_field");
    });

    it("F7: provider=claude 别名 4.5+(sonnet-4-6) → native anthropic_output_config", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "claude", modelId: "claude-sonnet-4-6" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("anthropic_output_config");
    });

    it("F7: 防回归 — Claude 4.0(opus-4-0) 不匹配 native 模式 → 仍 tool_use", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "anthropic", modelId: "claude-opus-4-0" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("tool_use");
    });

    it("provider=claude alias → 同 anthropic 行为（别名条目命中）", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "claude", modelId: "claude-3.5-sonnet" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("tool_use");
      expect(caps.systemPrompt.placement).toBe("top_level_system_field");
    });

    it("provider=google → gemini_response_schema + maxOutputTokens", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "google", modelId: "gemini-2.5-pro" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("gemini_response_schema");
      expect(caps.tokenParam).toBe("maxOutputTokens");
      expect(caps.vision.support).toBe("native_multimodal");
    });

    it("Provider 大小写不敏感（Anthropic / OPENAI / Google）", () => {
      expect(
        svc.resolveCapabilities(baseConfig({ provider: "Anthropic" }))
          .structuredOutput.nativeMode,
      ).toBe("tool_use");
      expect(
        svc.resolveCapabilities(baseConfig({ provider: "OPENAI" }))
          .structuredOutput.nativeMode,
      ).toBe("json_schema_strict");
    });
  });

  // ─────────── modelPattern 区分（deepseek 三模型） ───────────

  describe("modelPattern 区分 (v3.1 §1.4 案例研究矩阵)", () => {
    it("deepseek-reasoner → nativeMode='none' (拒 response_format)", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "deepseek", modelId: "deepseek-reasoner" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("none");
      expect(caps.reasoning.kind).toBe("opaque");
      expect(caps.reasoning.exposeContent).toBe("reasoning_field");
    });

    it("deepseek-v4-pro → nativeMode='json_mode' (2026-05-24 事故修复)", () => {
      // 事故根因：原 isDeepseekReasoner = modelLower.includes("deepseek-reasoner")
      // → v4-pro 不含 'reasoner' → 误判 false → 发 json_schema → API 400
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "deepseek", modelId: "deepseek-v4-pro" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("json_mode");
      expect(caps.structuredOutput.fallbackChain).toEqual([]);
    });

    it("deepseek catch-all → nativeMode='json_mode' (V4 只支持 json_object，不支持 json_schema)", () => {
      // 2026-05-25 线上事故修：DeepSeek 官方只支持 response_format {type:'json_object'}，
      // deepseek-v4-flash 掉进 catch-all 后原发 json_schema 被 API 拒。
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "deepseek", modelId: "deepseek-chat" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("json_mode");
      expect(caps.structuredOutput.fallbackChain).toEqual([]);
    });

    it("deepseek-v4-flash → nativeMode='json_mode'（防回归：不得再发 json_schema）", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "deepseek", modelId: "deepseek-v4-flash" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("json_mode");
    });

    it("OpenRouter claude 二级匹配 → tool_use（modelPattern /claude|anthropic/）", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openrouter",
          modelId: "anthropic/claude-opus-4.1",
        }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("tool_use");
      expect(caps.toolUse.mode).toBe("anthropic_tools");
    });

    it("OpenRouter gemini 二级匹配 → gemini_response_schema", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openrouter",
          modelId: "google/gemini-2.5-pro",
        }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("gemini_response_schema");
      // OpenRouter 适配层把 maxOutputTokens 映射为 max_tokens
      expect(caps.tokenParam).toBe("max_tokens");
    });

    it("OpenRouter 通用兜底 → json_schema", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openrouter",
          modelId: "meta-llama/llama-3.1-405b",
        }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("json_schema");
    });
  });

  // ─────────── Level 3 AIModel 19 既有列派生 ───────────

  describe("Level 3: derive from AIModelConfig", () => {
    it("admin 显式 structuredOutputStrategy override catalog nativeMode", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "gpt-4o",
          structuredOutputStrategy: "json_mode",
          fallbackStrategies: [],
        }),
      );
      // admin override：catalog json_schema_strict → json_mode
      expect(caps.structuredOutput.nativeMode).toBe("json_mode");
      expect(caps.structuredOutput.fallbackChain).toEqual([]);
    });

    it("admin 仅配 fallback（无 strategy）→ 保留 catalog nativeMode，覆盖 fallback", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "gpt-4o",
          structuredOutputStrategy: null,
          fallbackStrategies: ["json_schema"],
        }),
      );
      // catalog nativeMode 保留 json_schema_strict
      expect(caps.structuredOutput.nativeMode).toBe("json_schema_strict");
      expect(caps.structuredOutput.fallbackChain).toEqual(["json_schema"]);
    });

    // v3.1 阶段 A review (2026-05-24)：fallbackChain undefined vs [] 语义锁
    it("admin 配 nativeMode='json_schema' + 不配 fallback → catalog 默认 fallback 生效", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "gpt-4o",
          structuredOutputStrategy: "json_schema",
          // fallbackStrategies 未设（undefined） → 保留 catalog 默认
        }),
      );
      // catalog openai fallback 默认是 ["json_schema", "json_mode"]
      // admin override nativeMode 但没动 fallback，应保留 catalog 默认
      expect(caps.structuredOutput.nativeMode).toBe("json_schema");
      expect(caps.structuredOutput.fallbackChain).toEqual([
        "json_schema",
        "json_mode",
      ]);
    });

    it("admin 配 nativeMode='json_schema' + fallback=[] → 强制无 fallback（只剩 prompt 兜底）", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "gpt-4o",
          structuredOutputStrategy: "json_schema",
          fallbackStrategies: [], // 显式空 → 覆盖 catalog 为空
        }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("json_schema");
      expect(caps.structuredOutput.fallbackChain).toEqual([]);
      // 派生链：只有 nativeMode + 兜底 prompt
      expect(svc.deriveStructuredOutputChain(caps)).toEqual([
        "json_schema",
        "prompt",
      ]);
    });

    it("admin 配置全 invalid → 完全用 catalog 默认（不污染）", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "gpt-4o",
          structuredOutputStrategy: "garbage-strategy",
          fallbackStrategies: ["also_garbage"],
        }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("json_schema_strict");
      // catalog OpenAI fallbackChain
      expect(caps.structuredOutput.fallbackChain).toEqual([
        "json_schema",
        "json_mode",
      ]);
    });

    it("isReasoning=true → reasoning.kind='opaque' (catalog 未指定 reasoning 时)", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "deepseek",
          modelId: "deepseek-chat",
          isReasoning: true,
        }),
      );
      // catalog deepseek-chat reasoning.kind='none'，但 isReasoning=true 派生覆盖为 opaque
      expect(caps.reasoning.kind).toBe("opaque");
    });

    it("supportsTemperature=false → temperature.support='none'", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "o1-mini",
          supportsTemperature: false,
        }),
      );
      expect(caps.temperature.support).toBe("none");
    });

    it("tokenParamName=max_completion_tokens → tokenParam override", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "o1",
          tokenParamName: "max_completion_tokens",
        }),
      );
      expect(caps.tokenParam).toBe("max_completion_tokens");
    });

    it("tokenParamName invalid → 忽略，用 catalog 默认", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "gpt-4o",
          tokenParamName: "invalid_param",
        }),
      );
      expect(caps.tokenParam).toBe("max_tokens"); // catalog OpenAI 默认
    });

    it("supportsVision=true → vision.support='image_url'", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "qwen",
          modelId: "qwen-vl",
          supportsVision: true,
        }),
      );
      expect(caps.vision.support).toBe("image_url");
    });

    it("supportsStreaming=false → streaming.support=false", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "gpt-4o",
          supportsStreaming: false,
        }),
      );
      expect(caps.streaming.support).toBe(false);
    });

    it("maxTokens 派生 context.maxOutputTokens", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "gpt-4o",
          maxTokens: 8192,
        }),
      );
      expect(caps.context.maxOutputTokens).toBe(8192);
    });
  });

  // ─────────── v3.1 §B 子片 2 review-fix (2026-05-24) ───────────
  // 移除 deriveFromConfig 的 nativeMode='none' 占位语义 + mergeInto 'none' 特判。
  // 'none' 现在是显式 override 语义（admin/user/self-heal 显式降级），
  // 真会覆盖 catalog 的 nativeMode。
  describe("nativeMode='none' explicit override (B 子片 2 review-fix)", () => {
    it("回归: catalog 'json_mode' + 无 override → 保留 'json_mode'", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "deepseek", modelId: "deepseek-v4-pro" }),
      );
      // catalog deepseek-v4-pro nativeMode='json_mode' 不被任何派生污染
      expect(caps.structuredOutput.nativeMode).toBe("json_mode");
    });

    it("回归: admin 仅配 fallback 没首选 → catalog nativeMode 保留 + fallback 覆盖", () => {
      // 与原"占位"路径同入口：fallback 有效但 structuredOutputStrategy=null
      // 修复前：deriveFromConfig 写 nativeMode='none' 占位 → mergeInto 特判保留 catalog
      // 修复后：deriveFromConfig 不写 nativeMode → mergeInto 走 ?? 分支保留 catalog
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "gpt-4o",
          structuredOutputStrategy: null,
          fallbackStrategies: ["json_schema"],
        }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("json_schema_strict");
      expect(caps.structuredOutput.fallbackChain).toEqual(["json_schema"]);
    });

    it("新功能: admin override 显式 nativeMode='none' → 覆盖 catalog 'json_schema_strict'", () => {
      // 模拟 admin 通过 capability_overrides JSONB 显式降级
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "gpt-4o",
          aiModelOverrides: { structuredOutput: { nativeMode: "none" } },
        }),
      );
      // 修复前: mergeInto 特判 'none' !== 'none' 失效 → 保留 catalog
      // 修复后: 'none' 真覆盖 → nativeMode='none'
      expect(caps.structuredOutput.nativeMode).toBe("none");
      // catalog fallback 保留（admin 没动 fallback）
      expect(caps.structuredOutput.fallbackChain).toEqual([
        "json_schema",
        "json_mode",
      ]);
    });

    it("新功能: user override 显式 nativeMode='none' → 覆盖 catalog 'tool_use'（Anthropic）", () => {
      // 模拟 BYOK 用户显式降级 Anthropic 到无 native structured output
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "anthropic",
          modelId: "claude-3.5-sonnet",
          userOverrides: { structuredOutput: { nativeMode: "none" } },
        }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("none");
    });

    it("新功能: nativeMode='none' override + fallbackChain=[] → 派生链仅 ['prompt']", () => {
      // 显式降级语义验证：彻底降级需同时清 fallback；
      // 仅改 nativeMode 不动 fallback 时，catalog 的 fallback 仍生效（合理：admin/user 没显式说放弃 fallback）
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "openai",
          modelId: "gpt-4o",
          userOverrides: {
            structuredOutput: { nativeMode: "none", fallbackChain: [] },
          },
        }),
      );
      expect(svc.deriveStructuredOutputChain(caps)).toEqual(["prompt"]);
    });

    it("self-heal 写 'none' + fallbackChain=[] → 双双显式覆盖", () => {
      // self-heal 完整 patch 形态：nativeMode='none' + 清空 fallback
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "deepseek",
          modelId: "deepseek-v4-pro",
          userOverrides: {
            structuredOutput: { nativeMode: "none", fallbackChain: [] },
          },
        }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("none");
      expect(caps.structuredOutput.fallbackChain).toEqual([]);
      expect(svc.deriveStructuredOutputChain(caps)).toEqual(["prompt"]);
    });
  });

  // ─────────── Level 5 SAFE_DEFAULTS ───────────

  describe("Level 5: SAFE_DEFAULTS 兜底", () => {
    it("未知 provider → nativeMode='none' 安全兜底", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({
          provider: "WeirdUnknownProvider",
          modelId: "x-model",
        }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("none");
      expect(caps.toolUse.mode).toBe("none");
      expect(caps.vision.support).toBe("none");
      expect(caps.promptCache.support).toBe("none");
    });

    it("空 provider → SAFE_DEFAULTS（不命中 catalog）", () => {
      const caps = svc.resolveCapabilities(baseConfig({ provider: "" }));
      expect(caps.structuredOutput.nativeMode).toBe("none");
    });

    it("仅 provider 命中无 modelPattern 时使用 provider 默认条目", () => {
      // anthropic 条目无 modelPattern → 任意 modelId 都命中
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "anthropic", modelId: "any-future-model" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("tool_use");
    });

    // v3.1 阶段 A review (2026-05-24)：边界 provider / modelId
    it("provider='' + modelId='deepseek-reasoner' → catalog 不命中（无 provider）→ SAFE_DEFAULTS", () => {
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "", modelId: "deepseek-reasoner" }),
      );
      // 空 provider 直接跳过 catalog → SAFE_DEFAULTS（nativeMode='none' + 'prompt' 兜底）
      expect(caps.structuredOutput.nativeMode).toBe("none");
      expect(caps.toolUse.mode).toBe("none");
    });

    it("provider='deepseek' + modelId='' → 落到 deepseek 通用第 7 条（non-reasoner / 非 v4-pro）", () => {
      // modelPattern /reasoner/ 不命中空串；/v4[-_]?pro/ 也不命中；
      // 落到无 modelPattern 的第 7 条 deepseek 兜底 → json_mode
      // （2026-05-25 修：DeepSeek 仅支持 json_object，原 json_schema 默认是线上事故根因）
      const caps = svc.resolveCapabilities(
        baseConfig({ provider: "deepseek", modelId: "" }),
      );
      expect(caps.structuredOutput.nativeMode).toBe("json_mode");
      expect(caps.structuredOutput.fallbackChain).toEqual([]);
    });
  });
});

describe("ModelCapabilityService — deriveStructuredOutputChain", () => {
  let svc: ModelCapabilityService;
  beforeEach(() => {
    svc = new ModelCapabilityService();
  });

  it("nativeMode='none' → 跳过，直接 ['prompt']", () => {
    const caps = svc.resolveCapabilities(
      baseConfig({ provider: "deepseek", modelId: "deepseek-reasoner" }),
    );
    expect(svc.deriveStructuredOutputChain(caps)).toEqual(["prompt"]);
  });

  it("nativeMode + fallback chain + 兜底 prompt", () => {
    const caps = svc.resolveCapabilities(
      baseConfig({ provider: "openai", modelId: "gpt-4o" }),
    );
    expect(svc.deriveStructuredOutputChain(caps)).toEqual([
      "json_schema_strict",
      "json_schema",
      "json_mode",
      "prompt",
    ]);
  });

  it("派生链去重（fallback 与 nativeMode 重复时不双入）", () => {
    const caps = svc.resolveCapabilities(
      baseConfig({
        provider: "openai",
        modelId: "gpt-4o",
        structuredOutputStrategy: "json_schema",
        fallbackStrategies: ["json_schema", "json_mode"],
      }),
    );
    expect(svc.deriveStructuredOutputChain(caps)).toEqual([
      "json_schema",
      "json_mode",
      "prompt",
    ]);
  });

  it("fallback 含 prompt 时不重复加兜底", () => {
    const caps = svc.resolveCapabilities(
      baseConfig({
        provider: "openai",
        modelId: "gpt-4o",
        structuredOutputStrategy: "json_mode",
        fallbackStrategies: ["prompt"],
      }),
    );
    expect(svc.deriveStructuredOutputChain(caps)).toEqual([
      "json_mode",
      "prompt",
    ]);
  });
});

// ─────────── B+.1 apiFormat-priority dual-pass catalog 匹配 ───────────
describe("ModelCapabilityService — apiFormat-priority dual-pass (v3.1 §B+.1)", () => {
  let svc: ModelCapabilityService;
  beforeEach(() => {
    svc = new ModelCapabilityService();
  });

  it("BYOK provider='custom' + apiFormat='openai' + modelId='deepseek-reasoner' → 命中 deepseek-reasoner catalog（apiFormat+modelPattern）", () => {
    // Pass 1 命中：apiFormat='openai' + modelPattern=/reasoner/ 同时匹配 deepseek-reasoner 条目
    // 没这个 Pass 1：provider='custom' 在 catalog 无任何条目 → SAFE_DEFAULTS
    const caps = svc.resolveCapabilities(
      baseConfig({
        provider: "custom",
        apiFormat: "openai",
        modelId: "deepseek-reasoner",
      }),
    );
    expect(caps.structuredOutput.nativeMode).toBe("none");
    expect(caps.reasoning.exposeContent).toBe("reasoning_field");
  });

  it("BYOK provider='custom' + apiFormat='openai' + modelId='gpt-4o' → 不命中任何 apiFormat-priority 条目（无 /gpt-4o/ modelPattern）→ SAFE_DEFAULTS", () => {
    // 关键：apiFormat 粗匹必须有 modelPattern 收窄；catalog 里 openai 通用条目无 modelPattern
    // → Pass 1 跳过；Pass 2 provider='custom' 也不命中 → SAFE_DEFAULTS
    const caps = svc.resolveCapabilities(
      baseConfig({
        provider: "custom",
        apiFormat: "openai",
        modelId: "gpt-4o",
      }),
    );
    expect(caps.structuredOutput.nativeMode).toBe("none"); // SAFE_DEFAULTS
  });

  it("provider='deepseek' + 不传 apiFormat → 原 provider-priority 路径（BC）", () => {
    // 原 21 条 entry 行为不变：不传 apiFormat 时 Pass 1 直接跳过
    const caps = svc.resolveCapabilities(
      baseConfig({ provider: "deepseek", modelId: "deepseek-v4-pro" }),
    );
    expect(caps.structuredOutput.nativeMode).toBe("json_mode");
  });

  it("apiFormat 大小写不敏感（OpenAI 等值匹配 openai）", () => {
    const caps = svc.resolveCapabilities(
      baseConfig({
        provider: "custom",
        apiFormat: "OpenAI",
        modelId: "deepseek-v4-pro",
      }),
    );
    expect(caps.structuredOutput.nativeMode).toBe("json_mode");
  });
});

// ─────────── Fix-5 (arch-auditor P3 review 2026-05-24) ───────────
// mergeInto 接受 Partial<ModelCapabilities> ∪ ModelCapabilitiesOverrides 联合，
// 两者在 runtime 等价（spread + truthy guard 都安全处理 undefined / 空对象）。
// 守护：空 sub-object patch 不动 target（否则会破坏 deep-partial 语义）。
describe("ModelCapabilityService — mergeInto deep-partial 等价性 (Fix-5)", () => {
  let svc: ModelCapabilityService;
  beforeEach(() => {
    svc = new ModelCapabilityService();
  });

  it("mergeInto 空子对象 patch 不应改 target（deep-partial 等价性）", () => {
    // 通过 resolveCapabilities 拿到完整 target（包含 catalog 派生的所有字段）
    const target = svc.resolveCapabilities(
      baseConfig({ provider: "openai", modelId: "gpt-4o" }),
    );
    const before = JSON.stringify(target);

    // 用 bracket access 拿 private mergeInto（测试场景允许）
    const mergeInto = (
      svc as unknown as {
        mergeInto: (
          target: typeof target,
          patch: Record<string, unknown>,
        ) => void;
      }
    ).mergeInto.bind(svc);

    // patch 全是空子对象 —— deep-partial 合法形状
    mergeInto(target, {
      structuredOutput: {},
      toolUse: {},
      reasoning: {},
      temperature: {},
      vision: {},
      streaming: {},
      context: {},
      systemPrompt: {},
      promptCache: {},
    });

    // 关键断言：target 字节级未变（空子对象不应触发 spread 覆盖）
    expect(JSON.stringify(target)).toBe(before);
  });
});
