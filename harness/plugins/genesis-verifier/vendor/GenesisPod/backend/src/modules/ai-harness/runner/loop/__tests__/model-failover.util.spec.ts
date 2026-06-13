/**
 * executeWithModelFailover — shared loop failover helper unit tests
 *
 * Covers:
 *   - no provider → single attempt, no failover
 *   - THROW model-level error → failover to next model → success
 *   - THROW non-failoverable (abort) → rethrow, provider NOT called
 *   - isError-RETURN model-level → failover → success
 *   - isError-RETURN guardrail → classifier rejects → returned as-is (no failover)
 *   - bounded at maxFailovers (all models fail → last error thrown)
 *   - anti-infinite: provider returns the SAME model → stops
 *   - excludeModelIds accumulates failed model ids
 */

import { executeWithModelFailover } from "../model-failover.util";

interface FakeResult {
  content: string;
  model: string;
  isError?: boolean;
}

const ok = (model: string): FakeResult => ({ content: "{}", model });
const errResult = (model: string, message: string): FakeResult => ({
  content: message,
  model,
  isError: true,
});

describe("executeWithModelFailover", () => {
  it("no provider → single attempt, returns result", async () => {
    const attempt = jest.fn(async () => ok("default"));
    const res = await executeWithModelFailover({ attempt });
    expect(res.model).toBe("default");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("THROW model-level error → fails over to next model and succeeds", async () => {
    const attempt = jest.fn(async (model: string | undefined) => {
      if (model === undefined) throw new Error("503 service unavailable");
      return ok(model);
    });
    const provider = jest.fn(async () => "model-b");

    const res = await executeWithModelFailover({ attempt, provider });

    expect(res.model).toBe("model-b");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt.mock.calls[1][0]).toBe("model-b");
  });

  it("THROW non-failoverable (abort) → rethrows, provider NOT called", async () => {
    const abort = new DOMException("aborted", "AbortError");
    const attempt = jest.fn(async () => {
      throw abort;
    });
    const provider = jest.fn(async () => "model-b");

    await expect(
      executeWithModelFailover({ attempt, provider }),
    ).rejects.toThrow("aborted");
    expect(provider).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("isError-RETURN model-level → fails over and succeeds", async () => {
    const attempt = jest.fn(async (model: string | undefined) =>
      model === undefined
        ? errResult("model-a", "PROVIDER_API_ERROR: 503")
        : ok(model),
    );
    const provider = jest.fn(async () => "model-b");

    const res = await executeWithModelFailover<FakeResult>({
      attempt,
      provider,
      inspectResult: (r) => ({
        failoverable: r.isError === true,
        modelId: r.model,
        message: r.content,
      }),
    });

    expect(res.model).toBe("model-b");
    expect(res.isError).toBeUndefined();
    expect(provider).toHaveBeenCalledTimes(1);
    // failed model-a recorded for exclusion
    expect(provider.mock.calls[0][0]).toContain("model-a");
  });

  it("isError-RETURN guardrail → classifier rejects, returned as-is", async () => {
    const guardrail = errResult(
      "model-a",
      "Request blocked by content safety guardrail: ...",
    );
    const attempt = jest.fn(async () => guardrail);
    const provider = jest.fn(async () => "model-b");

    const res = await executeWithModelFailover<FakeResult>({
      attempt,
      provider,
      inspectResult: (r) => ({
        failoverable: r.isError === true,
        modelId: r.model,
        message: r.content,
      }),
    });

    // guardrail is NOT a model-level failure → no failover, original returned
    expect(res.model).toBe("model-a");
    expect(res.isError).toBe(true);
    expect(provider).not.toHaveBeenCalled();
  });

  it("bounded at maxFailovers → throws last error when all models fail", async () => {
    let n = 0;
    const attempt = jest.fn(async () => {
      throw new Error(`503 attempt ${++n}`);
    });
    const provider = jest.fn(async () => `model-${n}`);

    await expect(
      executeWithModelFailover({ attempt, provider, maxFailovers: 2 }),
    ).rejects.toThrow(/503/);
    // 1 initial + 2 failovers = 3 attempts
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("anti-infinite: provider returns the SAME model → stops and throws", async () => {
    const attempt = jest.fn(async () => {
      throw new Error("503 down");
    });
    // provider ignores exclude and keeps returning the same id
    const provider = jest.fn(async () => "model-x");

    await expect(
      executeWithModelFailover({ attempt, provider, maxFailovers: 5 }),
    ).rejects.toThrow("503 down");
    // first attempt (default) fails → failover to model-x;
    // model-x fails → provider returns model-x again → next===current → stop.
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("extracts failed provider from error → passes excludeProviders (skip whole dead provider)", async () => {
    const attempt = jest.fn(async (model: string | undefined) => {
      if (model === "gemini-2.5-flash") return ok(model);
      // xai out of credits / no key
      throw new Error('No API Key available for provider "xai"');
    });
    const provider = jest.fn(
      async (
        _excl: ReadonlyArray<string>,
        exclProviders?: ReadonlyArray<string>,
      ) => (exclProviders?.includes("xai") ? "gemini-2.5-flash" : "grok-2"),
    );

    const res = await executeWithModelFailover<FakeResult>({
      attempt,
      provider,
    });

    expect(res.model).toBe("gemini-2.5-flash");
    // provider received "xai" in excludeProviders → jumped straight off xai
    expect(provider).toHaveBeenCalledWith(
      expect.any(Array),
      expect.arrayContaining(["xai"]),
    );
  });

  it("provider throwing is swallowed → original error rethrown", async () => {
    const attempt = jest.fn(async () => {
      throw new Error("PROVIDER_API_ERROR: down");
    });
    const provider = jest.fn(async () => {
      throw new Error("election infra down");
    });

    await expect(
      executeWithModelFailover({ attempt, provider }),
    ).rejects.toThrow("PROVIDER_API_ERROR: down");
  });
});
