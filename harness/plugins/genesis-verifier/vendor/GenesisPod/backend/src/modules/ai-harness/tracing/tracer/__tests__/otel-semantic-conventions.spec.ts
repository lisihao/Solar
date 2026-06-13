/**
 * toOtelGenAiAttributes 单测 (PR-U)
 */

import { toOtelGenAiAttributes } from "../otel-semantic-conventions";

describe("toOtelGenAiAttributes (PR-U)", () => {
  it("maps Anthropic model to gen_ai.system=anthropic", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      modelId: "claude-opus-4-7",
      promptTokens: 100,
      completionTokens: 50,
      cacheReadTokens: 80,
    });
    expect(out["gen_ai.system"]).toBe("anthropic");
    expect(out["gen_ai.request.model"]).toBe("claude-opus-4-7");
    expect(out["gen_ai.usage.input_tokens"]).toBe(100);
    expect(out["gen_ai.usage.output_tokens"]).toBe(50);
    expect(out["gen_ai.usage.cache_read_input_tokens"]).toBe(80);
    expect(out["gen_ai.operation.name"]).toBe("chat");
  });

  it("maps OpenAI gpt-4o to gen_ai.system=openai", () => {
    const out = toOtelGenAiAttributes("react.iter", { modelId: "gpt-4o" });
    expect(out["gen_ai.system"]).toBe("openai");
  });

  it("infers operation=execute_tool for tool.* spans", () => {
    const out = toOtelGenAiAttributes("tool.web-search", {
      toolName: "web-search",
      callId: "tc-123",
    });
    expect(out["gen_ai.operation.name"]).toBe("execute_tool");
    expect(out["gen_ai.tool.name"]).toBe("web-search");
    expect(out["gen_ai.tool.call.id"]).toBe("tc-123");
  });

  it("preserves GenesisPod-specific fields under genesis.* prefix", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      agentId: "a1",
      loopKind: "react",
      costUsd: 0.05,
      success: true,
      durationMs: 1234,
    });
    expect(out["genesis.agent.id"]).toBe("a1");
    expect(out["genesis.loop.kind"]).toBe("react");
    expect(out["genesis.cost.usd"]).toBe(0.05);
    expect(out["genesis.success"]).toBe(true);
    expect(out["genesis.duration.ms"]).toBe(1234);
  });

  it("handles unknown model gracefully", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      modelId: "futuristic-llm-v9",
    });
    expect(out["gen_ai.system"]).toBe("unknown");
    expect(out["gen_ai.request.model"]).toBe("futuristic-llm-v9");
  });

  it("omits cache_read when 0 (no cache hit)", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      modelId: "claude-opus-4-7",
      promptTokens: 100,
      completionTokens: 50,
      cacheReadTokens: 0,
    });
    expect(out).not.toHaveProperty("gen_ai.usage.cache_read_input_tokens");
  });

  // ─── G8: operation.name from loopKind + error.type + response.id ───

  it("maps an agent loop (loopKind present) to operation=invoke_agent", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      modelId: "claude-opus-4-7",
      loopKind: "react",
    });
    expect(out["gen_ai.operation.name"]).toBe("invoke_agent");
  });

  it("falls back to chat when no loopKind and not a tool/embed span", () => {
    const out = toOtelGenAiAttributes("some.span", { modelId: "gpt-4o" });
    expect(out["gen_ai.operation.name"]).toBe("chat");
  });

  it("maps embedding spans to operation=embeddings", () => {
    const out = toOtelGenAiAttributes("embed.batch", {});
    expect(out["gen_ai.operation.name"]).toBe("embeddings");
  });

  it("execute_tool takes priority even when loopKind is set", () => {
    const out = toOtelGenAiAttributes("tool.web-search", {
      loopKind: "react",
      toolName: "web-search",
    });
    expect(out["gen_ai.operation.name"]).toBe("execute_tool");
  });

  it("emits error.type on failure (defaults when no finishReason)", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      success: false,
      finishReason: "PROVIDER_RATE_LIMIT",
    });
    expect(out["error.type"]).toBe("PROVIDER_RATE_LIMIT");
    const out2 = toOtelGenAiAttributes("react.iter", { success: false });
    expect(out2["error.type"]).toBe("agent_error");
  });

  it("does not emit error.type on success", () => {
    const out = toOtelGenAiAttributes("react.iter", { success: true });
    expect(out).not.toHaveProperty("error.type");
  });

  it("passes through gen_ai.response.id", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      responseId: "resp_abc123",
    });
    expect(out["gen_ai.response.id"]).toBe("resp_abc123");
    // not double-emitted as a raw passthrough key
    expect(out).not.toHaveProperty("responseId");
  });
});
