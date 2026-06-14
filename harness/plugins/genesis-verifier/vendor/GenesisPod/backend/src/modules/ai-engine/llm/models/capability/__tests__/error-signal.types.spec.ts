/**
 * error-signal.types spec — v3.1 §B.5 严格解析 + 脱敏
 *
 * 覆盖：
 *   - httpStatus 严格：必须从 e.status 或 e.response.status 取（数字），缺失 → null
 *   - provider 形态分类：通过 url 嗅探 + 形状回退
 *   - errorCode 按 provider 形态严格取（OpenAI / Anthropic / Google / xAI / unknown）
 *   - bodySnippet 脱敏：API key / Authorization / Bearer / token 替换为 ***REDACTED***
 *   - bodySnippet 200 字符截断
 *   - fail-open：null / undefined / 异常对象 → null
 */

import {
  buildDegenerateOutputSignal,
  DEGENERATE_OUTPUT_ERROR_CODE,
  extractErrorSignal,
} from "../error-signal.types";

describe("buildDegenerateOutputSignal", () => {
  it("builds a synthetic 200 + degenerate_output signal", () => {
    const sig = buildDegenerateOutputSignal(
      "degenerate_output finish_reason=stop nativeMode=json_mode",
    );
    expect(sig.httpStatus).toBe(200);
    expect(sig.errorCode).toBe(DEGENERATE_OUTPUT_ERROR_CODE);
    expect(sig.bodySnippet).toContain("nativeMode=json_mode");
    expect(sig.provider).toBe("unknown");
  });

  it("sanitizes + truncates the bodySnippet", () => {
    const sig = buildDegenerateOutputSignal(
      `nativeMode=json_mode api_key: "sk-secret1234567890abc" ${"x".repeat(300)}`,
    );
    expect(sig.bodySnippet).not.toContain("sk-secret1234567890abc");
    expect(sig.bodySnippet.length).toBeLessThanOrEqual(200);
  });
});

describe("extractErrorSignal — v3.1 §B.5 严格化", () => {
  // ─────────── httpStatus 严格 ───────────

  it("returns null when httpStatus missing", () => {
    expect(extractErrorSignal({ message: "boom" })).toBeNull();
  });

  it("reads httpStatus from e.status", () => {
    const sig = extractErrorSignal({ status: 400, response: { data: {} } });
    expect(sig?.httpStatus).toBe(400);
  });

  it("reads httpStatus from e.response.status when e.status absent", () => {
    const sig = extractErrorSignal({ response: { status: 422, data: {} } });
    expect(sig?.httpStatus).toBe(422);
  });

  it("returns null when status is not a number", () => {
    expect(
      extractErrorSignal({ response: { status: "400", data: {} } }),
    ).toBeNull();
  });

  // ─────────── OpenAI 形态 ───────────

  it("parses OpenAI error: error.code preferred over type", () => {
    const sig = extractErrorSignal({
      status: 400,
      config: { url: "https://api.openai.com/v1/chat/completions" },
      response: {
        status: 400,
        data: {
          error: {
            code: "unsupported_response_format",
            type: "invalid_request_error",
            message: "msg",
          },
        },
      },
    });
    expect(sig?.provider).toBe("openai");
    expect(sig?.errorCode).toBe("unsupported_response_format");
  });

  it("falls back to error.type when OpenAI has no code", () => {
    const sig = extractErrorSignal({
      status: 400,
      config: { url: "https://api.openai.com/v1/" },
      response: {
        status: 400,
        data: { error: { type: "invalid_request_error", message: "x" } },
      },
    });
    expect(sig?.errorCode).toBe("invalid_request_error");
  });

  // ─────────── Anthropic 形态 ───────────

  it("parses Anthropic error: error.type", () => {
    const sig = extractErrorSignal({
      status: 400,
      config: { url: "https://api.anthropic.com/v1/messages" },
      response: {
        status: 400,
        data: { error: { type: "invalid_request_error", message: "bad" } },
      },
    });
    expect(sig?.provider).toBe("anthropic");
    expect(sig?.errorCode).toBe("invalid_request_error");
  });

  // ─────────── Google 形态 ───────────

  it("parses Google error: error.status (e.g. INVALID_ARGUMENT)", () => {
    const sig = extractErrorSignal({
      status: 400,
      config: { url: "https://generativelanguage.googleapis.com/v1/models" },
      response: {
        status: 400,
        data: {
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message: "schema bad",
          },
        },
      },
    });
    expect(sig?.provider).toBe("google");
    expect(sig?.errorCode).toBe("INVALID_ARGUMENT");
  });

  // ─────────── xAI 形态 ───────────

  it("parses xAI error (OpenAI-compatible)", () => {
    const sig = extractErrorSignal({
      status: 400,
      config: { url: "https://api.x.ai/v1/chat/completions" },
      response: {
        status: 400,
        data: {
          error: {
            code: "invalid_request_error",
            type: "validation",
            message: "x",
          },
        },
      },
    });
    expect(sig?.provider).toBe("xai");
    expect(sig?.errorCode).toBe("invalid_request_error");
  });

  // ─────────── unknown 形态 + 形状回退 ───────────

  it("detects provider by shape when url missing (Google shape)", () => {
    const sig = extractErrorSignal({
      status: 400,
      response: {
        status: 400,
        data: { error: { status: "INVALID_ARGUMENT", message: "x" } },
      },
    });
    expect(sig?.provider).toBe("google");
  });

  it("returns provider=unknown when no url and no recognizable shape", () => {
    const sig = extractErrorSignal({
      status: 400,
      response: { status: 400, data: { msg: "boom" } },
    });
    expect(sig?.provider).toBe("unknown");
    expect(sig?.errorCode).toBe("unknown");
  });

  // ─────────── 脱敏 ───────────

  it("sanitizes API keys and Bearer tokens in bodySnippet", () => {
    const sig = extractErrorSignal({
      status: 400,
      response: {
        status: 400,
        data: {
          error: {
            code: "x",
            message: "auth failed for sk-proj-AbCdEfGh1234567890XYZ",
          },
          authorization: "Bearer sk-1234567890abcdef",
        },
      },
    });
    expect(sig?.bodySnippet).not.toContain("sk-proj-AbCdEfGh1234567890XYZ");
    expect(sig?.bodySnippet).not.toContain("sk-1234567890abcdef");
    expect(sig?.bodySnippet).toContain("***REDACTED***");
  });

  it("truncates bodySnippet to 200 chars", () => {
    const sig = extractErrorSignal({
      status: 400,
      response: { status: 400, data: { msg: "x".repeat(500) } },
    });
    expect(sig?.bodySnippet.length).toBeLessThanOrEqual(200);
  });

  // ─────────── fail-open ───────────

  it("returns null for null/undefined input", () => {
    expect(extractErrorSignal(null)).toBeNull();
    expect(extractErrorSignal(undefined)).toBeNull();
  });

  it("returns null when JSON.stringify throws (cyclic) — still graceful", () => {
    const cyclic: Record<string, unknown> = { status: 400 };
    cyclic.self = cyclic;
    const sig = extractErrorSignal({
      status: 400,
      response: { status: 400, data: cyclic },
    });
    // 解析不应抛错；bodySnippet 退化为空字符串（cyclic 时 JSON.stringify 抛错）
    expect(sig).not.toBeNull();
    expect(sig?.httpStatus).toBe(400);
  });

  // ─────────── string data 直接通过 ───────────

  it("accepts string response.data directly", () => {
    const sig = extractErrorSignal({
      status: 400,
      response: { status: 400, data: "raw text error message" },
    });
    expect(sig?.bodySnippet).toBe("raw text error message");
  });
});
