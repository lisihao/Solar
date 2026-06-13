import { isModelLevelFailoverError } from "../models/selection/model-failover.classifier";

/**
 * isModelLevelFailoverError 单元 spec —— 重点回归 2026-05-25 事故：
 * Groq "Request too large / TPM" 被误判成 quota → failover 被关掉 → mission 判死。
 * 修复后：request-too-large 必须触发 model-level failover（换模型),而真·quota 仍不切。
 */
describe("isModelLevelFailoverError", () => {
  describe("request-too-large / TPM (应 failover — 换模型)", () => {
    it("Groq 'Request too large ... tokens per minute' → true", () => {
      const err = new Error(
        "Request too large for model `openai/gpt-oss-120b` in organization org_x on tokens per minute (TPM): Limit 8000, Requested 55061.",
      );
      expect(isModelLevelFailoverError(err)).toBe(true);
    });

    it("包装后的 'REQUEST_TOO_LARGE - Request too large ...' → true", () => {
      const err = new Error(
        'All 1 API key(s) for provider "groq" failed. Last error: REQUEST_TOO_LARGE - Request too large for model `openai/gpt-oss-120b`',
      );
      expect(isModelLevelFailoverError(err)).toBe(true);
    });

    it("HTTP 413 字样 → true", () => {
      expect(
        isModelLevelFailoverError(new Error("413 Payload Too Large")),
      ).toBe(true);
    });

    it("'reduce your message size' → true", () => {
      expect(
        isModelLevelFailoverError(
          new Error("Please reduce your message size and try again"),
        ),
      ).toBe(true);
    });
  });

  describe("空响应 / 退化输出 (应 failover — 换模型)", () => {
    it("'AI 返回空响应 (原因: stop)' → true", () => {
      expect(
        isModelLevelFailoverError(new Error("AI 返回空响应 (原因: stop)")),
      ).toBe(true);
    });

    it("推理模型 token 全用于思考 → true", () => {
      expect(
        isModelLevelFailoverError(
          new Error(
            "AI 推理模型的 token 全部用于内部思考，没有空间输出结果。当前 max_tokens=25000",
          ),
        ),
      ).toBe(true);
    });

    it("'响应被完全截断' → true", () => {
      expect(
        isModelLevelFailoverError(
          new Error("AI 响应被完全截断（上下文可能过大）。prompt_tokens=20091"),
        ),
      ).toBe(true);
    });

    it("'empty response' (英文) → true", () => {
      expect(
        isModelLevelFailoverError(
          new Error("provider returned empty response"),
        ),
      ).toBe(true);
    });

    it("PROVIDER_API_ERROR 包装的空响应 → true", () => {
      expect(
        isModelLevelFailoverError(
          new Error("PROVIDER_API_ERROR — AI 返回空响应 (原因: stop)"),
        ),
      ).toBe(true);
    });
  });

  describe("真·quota / billing 耗尽 (不 failover — 让用户充值)", () => {
    it("'insufficient_quota' → false", () => {
      expect(
        isModelLevelFailoverError(
          new Error("You exceeded your current quota, check billing details"),
        ),
      ).toBe(false);
    });

    it("'payment required' → false", () => {
      expect(isModelLevelFailoverError(new Error("402 payment required"))).toBe(
        false,
      );
    });
  });

  describe("provider free-tier DAILY request cap (应 failover — 换 provider/模型)", () => {
    it("tokenmix 'Daily request limit exceeded: 10 requests per day for unpaid users' → true", () => {
      // Per-provider daily cap, not account budget — a different provider/model
      // (e.g. the user's deepseek on another key) may still work. Was previously
      // misclassified as false ('request limit' ≠ 'rate limit', no 'quota'),
      // so failover never tried the other model.
      expect(
        isModelLevelFailoverError(
          new Error(
            "Daily request limit exceeded: 10 requests per day for unpaid users. Add credits to remove this daily limit. Retry after 33844s.",
          ),
        ),
      ).toBe(true);
    });

    it("'requests per day' wording → true", () => {
      expect(
        isModelLevelFailoverError(new Error("limit: 50 requests per day")),
      ).toBe(true);
    });
  });

  describe("其它既有行为不回归", () => {
    it("5xx → true", () => {
      expect(
        isModelLevelFailoverError(new Error("503 Service Unavailable")),
      ).toBe(true);
    });

    it("rate limit / 429 → true", () => {
      expect(isModelLevelFailoverError(new Error("429 rate limit"))).toBe(true);
    });

    it("user abort → false", () => {
      const err = new Error("aborted");
      expect(isModelLevelFailoverError(err)).toBe(false);
    });
  });
});
