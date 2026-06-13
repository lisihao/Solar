import { StructuredOutputRouter } from "../structured-output-router.service";
import { ModelCapabilityService } from "../../../models/capability/model-capability.service";

/**
 * v3.1 §A：本 spec 保留全部既有用例（行为契约不变）；router 内部派生
 * 实现已迁到 ModelCapabilityService.deriveStructuredOutputChain。
 *
 * 既有 PROVIDER_DEFAULT_CHAINS 17 条 → catalog `PROVIDER_CAPABILITY_DEFAULTS` 1:1
 * 收编 + 别名条目（claude/gemini/grok）；语义不变，spec 期望不变。
 */
describe("StructuredOutputRouter — 派生视图（v3.1 §A 收敛后）", () => {
  let router: StructuredOutputRouter;
  beforeEach(() => {
    router = new StructuredOutputRouter(new ModelCapabilityService());
  });

  it("admin 配置 strategy 时优先使用", () => {
    const chain = router.resolveChain({
      provider: "Anthropic",
      modelId: "claude-3.5-sonnet",
      structuredOutputStrategy: "json_schema_strict",
      fallbackStrategies: ["json_mode"],
    });
    // admin 配置 → 'json_schema_strict','json_mode'，最后兜底 'prompt'
    expect(chain).toEqual(["json_schema_strict", "json_mode", "prompt"]);
  });

  it("OpenAI 未配置 → 推断 strict json_schema → fallback chain", () => {
    const chain = router.resolveChain({
      provider: "OpenAI",
      modelId: "gpt-4o",
      structuredOutputStrategy: null,
      fallbackStrategies: [],
    });
    expect(chain).toEqual([
      "json_schema_strict",
      "json_schema",
      "json_mode",
      "prompt",
    ]);
  });

  it("Anthropic 未配置 → tool_use → prompt", () => {
    const chain = router.resolveChain({
      provider: "Anthropic",
      modelId: "claude-3.5-sonnet",
      structuredOutputStrategy: null,
      fallbackStrategies: null,
    });
    expect(chain).toEqual(["tool_use", "prompt"]);
  });

  it("Google Gemini 未配置 → responseSchema → json_mode → prompt", () => {
    const chain = router.resolveChain({
      provider: "Google",
      modelId: "gemini-2.5-pro",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["gemini_response_schema", "json_mode", "prompt"]);
  });

  it("DeepSeek-reasoner 未配置 → 仅 prompt（reasoner 不支持 response_format）", () => {
    const chain = router.resolveChain({
      provider: "DeepSeek",
      modelId: "deepseek-reasoner",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["prompt"]);
  });

  it("DeepSeek catch-all 未配置 → json_mode → prompt (DeepSeek 仅 json_object)", () => {
    // 2026-05-25 线上事故修：DeepSeek 官方只支持 response_format {type:'json_object'}，
    // 不支持 json_schema；catch-all 原默认 json_schema 让 v4-flash 崩溃。
    const chain = router.resolveChain({
      provider: "DeepSeek",
      modelId: "deepseek-chat",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["json_mode", "prompt"]);
  });

  it("DeepSeek-v4-flash 未配置 → json_mode → prompt (防回归: 不得发 json_schema)", () => {
    const chain = router.resolveChain({
      provider: "DeepSeek",
      modelId: "deepseek-v4-flash",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["json_mode", "prompt"]);
  });

  it("DeepSeek-v4-pro 未配置 → json_mode → prompt (2026-05-24 事故根因修复)", () => {
    // v3.1 §1.4 案例研究矩阵：deepseek-v4-pro API 现状仅支持 json_object，
    // 发 json_schema 直接 400；catalog 把它分到独立条目（match: /v4[-_]?pro/）。
    const chain = router.resolveChain({
      provider: "DeepSeek",
      modelId: "deepseek-v4-pro",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["json_mode", "prompt"]);
  });

  it("xAI Grok 未配置 → strict → fallback chain", () => {
    const chain = router.resolveChain({
      provider: "xAI",
      modelId: "grok-3",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual([
      "json_schema_strict",
      "json_schema",
      "json_mode",
      "prompt",
    ]);
  });

  it("Ollama 本地模型未配置 → GBNF → prompt", () => {
    const chain = router.resolveChain({
      provider: "Ollama",
      modelId: "qwen2.5",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["gbnf_grammar", "prompt"]);
  });

  it("vLLM 本地模型未配置 → GBNF → prompt", () => {
    const chain = router.resolveChain({
      provider: "vllm",
      modelId: "deepseek-r1-distill-32b",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["gbnf_grammar", "prompt"]);
  });

  it("ByteDance Doubao 未配置 → json_mode → prompt", () => {
    const chain = router.resolveChain({
      provider: "ByteDance",
      modelId: "doubao-pro-32k",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["json_mode", "prompt"]);
  });

  it("Zhipu GLM 未配置 → json_mode → prompt", () => {
    const chain = router.resolveChain({
      provider: "Zhipu",
      modelId: "glm-4-9b",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["json_mode", "prompt"]);
  });

  it("Groq 未配置 → json_mode → prompt", () => {
    const chain = router.resolveChain({
      provider: "Groq",
      modelId: "llama-3.3-70b-versatile",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["json_mode", "prompt"]);
  });

  it("OpenRouter Claude 二级匹配 → tool_use → prompt", () => {
    const chain = router.resolveChain({
      provider: "OpenRouter",
      modelId: "anthropic/claude-opus-4.1",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["tool_use", "prompt"]);
  });

  it("OpenRouter Gemini 二级匹配 → responseSchema → json_mode → prompt", () => {
    const chain = router.resolveChain({
      provider: "OpenRouter",
      modelId: "google/gemini-2.5-pro",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["gemini_response_schema", "json_mode", "prompt"]);
  });

  it("OpenRouter 其他 → json_schema → json_mode → prompt", () => {
    const chain = router.resolveChain({
      provider: "OpenRouter",
      modelId: "meta-llama/llama-3.1-405b",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["json_schema", "json_mode", "prompt"]);
  });

  it("Cohere 未配置 → 仅 prompt", () => {
    const chain = router.resolveChain({
      provider: "Cohere",
      modelId: "rerank-v3.5",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["prompt"]);
  });

  it("Mistral 未配置 → json_mode → prompt", () => {
    const chain = router.resolveChain({
      provider: "Mistral",
      modelId: "mistral-large",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["json_mode", "prompt"]);
  });

  it("Qwen 未配置 → json_mode → prompt", () => {
    const chain = router.resolveChain({
      provider: "qwen",
      modelId: "qwen-max",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["json_mode", "prompt"]);
  });

  it("Moonshot 未配置 → json_mode → prompt", () => {
    const chain = router.resolveChain({
      provider: "moonshot",
      modelId: "moonshot-v1-8k",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["json_mode", "prompt"]);
  });

  it("完全未知 provider → 仅 prompt 兜底（SAFE_DEFAULTS）", () => {
    const chain = router.resolveChain({
      provider: "WeirdProvider",
      modelId: "weird-model-1",
      structuredOutputStrategy: null,
    });
    expect(chain).toEqual(["prompt"]);
  });

  it("admin 部分配置（仅 strategy 无 fallback）→ 自动接 provider 默认链", () => {
    // admin 显式选 json_mode，但没填 fallback
    // → derived chain: ['json_mode', 'prompt']（catalog OpenAI nativeMode 被 admin 覆盖）
    const chain = router.resolveChain({
      provider: "OpenAI",
      modelId: "gpt-4o",
      structuredOutputStrategy: "json_mode",
      fallbackStrategies: [],
    });
    expect(chain).toEqual(["json_mode", "prompt"]);
  });

  it("admin 配置无效 strategy 字符串 → 忽略（不崩）", () => {
    const chain = router.resolveChain({
      provider: "OpenAI",
      modelId: "gpt-4o",
      structuredOutputStrategy: "garbage-strategy",
      fallbackStrategies: ["also_invalid"],
    });
    // 全部 invalid → 等同未配置 → 走 OpenAI catalog 默认链
    expect(chain).toEqual([
      "json_schema_strict",
      "json_schema",
      "json_mode",
      "prompt",
    ]);
  });

  it("getAdapter 拿到对应 strategy 实例", () => {
    expect(router.getAdapter("json_schema_strict").strategy).toBe(
      "json_schema_strict",
    );
    expect(router.getAdapter("tool_use").strategy).toBe("tool_use");
    expect(router.getAdapter("gemini_response_schema").strategy).toBe(
      "gemini_response_schema",
    );
    expect(router.getAdapter("gbnf_grammar").strategy).toBe("gbnf_grammar");
    expect(router.getAdapter("prompt").strategy).toBe("prompt");
    expect(router.getAdapter("none").strategy).toBe("none");
  });
});
