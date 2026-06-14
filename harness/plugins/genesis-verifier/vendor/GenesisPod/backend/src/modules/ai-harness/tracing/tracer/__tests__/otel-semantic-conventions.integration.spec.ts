/**
 * toOtelGenAiAttributes — extra branch coverage
 * Covers: temperature, maxTokens, finishReason, truncated, toolId fallback
 */

import { toOtelGenAiAttributes } from "../otel-semantic-conventions";

describe("toOtelGenAiAttributes — extra branches", () => {
  it("maps temperature to gen_ai.request.temperature", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      temperature: 0.7,
    });
    expect(out["gen_ai.request.temperature"]).toBe(0.7);
  });

  it("maps maxTokens to gen_ai.request.max_tokens", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      maxTokens: 4096,
    });
    expect(out["gen_ai.request.max_tokens"]).toBe(4096);
  });

  it("maps finishReason to gen_ai.response.finish_reasons array", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      finishReason: "stop",
    });
    expect(out["gen_ai.response.finish_reasons"]).toEqual(["stop"]);
  });

  it("maps truncated to genesis.tool.truncated", () => {
    const out = toOtelGenAiAttributes("tool.call", {
      truncated: true,
    });
    expect(out["genesis.tool.truncated"]).toBe(true);
  });

  it("uses toolId as fallback when toolName is absent", () => {
    const out = toOtelGenAiAttributes("tool.call", {
      toolId: "my-tool-id",
      callId: "call-1",
    });
    expect(out["gen_ai.tool.name"]).toBe("my-tool-id");
    expect(out["gen_ai.tool.call.id"]).toBe("call-1");
  });

  it("passthrough unknown attributes are preserved", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      customField: "custom-value",
    } as never);
    expect(out["customField"]).toBe("custom-value");
  });

  it("temperature=0 is still mapped (falsy value check)", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      temperature: 0,
    });
    expect(out["gen_ai.request.temperature"]).toBe(0);
  });

  it("maxTokens=0 is still mapped", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      maxTokens: 0,
    });
    expect(out["gen_ai.request.max_tokens"]).toBe(0);
  });

  it("success=false is mapped to genesis.success", () => {
    const out = toOtelGenAiAttributes("react.iter", {
      success: false,
    });
    expect(out["genesis.success"]).toBe(false);
  });

  it("truncated=false is mapped to genesis.tool.truncated", () => {
    const out = toOtelGenAiAttributes("tool.call", {
      truncated: false,
    });
    expect(out["genesis.tool.truncated"]).toBe(false);
  });

  it("maps Gemini model to gen_ai.system=google", () => {
    const out = toOtelGenAiAttributes("react.iter", { modelId: "gemini-pro" });
    expect(out["gen_ai.system"]).toBe("google");
  });

  it("infers operation=chat for non-tool spans", () => {
    const out = toOtelGenAiAttributes("react.iter", {});
    expect(out["gen_ai.operation.name"]).toBe("chat");
  });
});
