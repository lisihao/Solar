import { Logger } from "@nestjs/common";
import { AiChatFailoverCallerService } from "../ai-chat-failover-caller.service";
import { BYOKError } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.errors";
import type { AIModelConfig } from "../../models/config/ai-model-config.service";
import type { ChatMessage } from "../../types";

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();

type AnyMock = jest.Mock;

const RESULT = (model: string) => ({
  content: "ok",
  model,
  tokensUsed: 10,
});

const FAKE_KEY = {
  apiKey: "sk-test",
  apiEndpoint: "https://key.example.com",
  healthKeyId: "health-1",
};

function makeConfig(overrides: Partial<AIModelConfig> = {}): AIModelConfig {
  return {
    modelId: "gpt-test",
    apiEndpoint: "https://config.example.com",
    provider: "openai",
    apiFormat: "openai",
    supportsTemperature: true,
    isReasoning: false,
    tokenParamName: "",
    maxTokens: 0,
    defaultTimeoutMs: 0,
    ...overrides,
  } as AIModelConfig;
}

describe("AiChatFailoverCallerService", () => {
  let apiCaller: Record<string, AnyMock>;
  let retry: { withExponentialBackoff: AnyMock; sleep: AnyMock };
  let modelConfig: {
    getTimeoutForModel: AnyMock;
    getRateLimitForUserModel: AnyMock;
  };
  let keyExecutor: Record<string, AnyMock>;

  const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

  const build = (withExecutor = true) =>
    new AiChatFailoverCallerService(
      apiCaller as never,
      retry as never,
      modelConfig as never,
      withExecutor ? (keyExecutor as never) : undefined,
    );

  // call helper that fills positional args with sensible defaults
  const call = (
    svc: AiChatFailoverCallerService,
    config: AIModelConfig,
    opts: Partial<{
      maxTokens: number;
      temperature: number;
      strict: boolean;
    }> = {},
  ) =>
    svc.callAPIWithFailover(
      "user-1",
      config,
      messages,
      opts.maxTokens ?? 100,
      opts.temperature ?? 0.5,
      opts.strict,
      undefined,
      undefined,
      undefined,
      undefined,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    apiCaller = {
      callOpenAICompatibleAPI: jest.fn().mockResolvedValue(RESULT("gpt-test")),
      callAnthropicAPI: jest.fn().mockResolvedValue(RESULT("claude")),
      callGoogleAPI: jest.fn().mockResolvedValue(RESULT("gemini")),
      callXAIAPI: jest.fn().mockResolvedValue(RESULT("grok")),
    };
    retry = {
      // run the inner apiCall directly
      withExponentialBackoff: jest.fn(async (fn: () => Promise<unknown>) =>
        fn(),
      ),
      sleep: jest.fn().mockResolvedValue(undefined),
    };
    modelConfig = {
      getTimeoutForModel: jest.fn().mockReturnValue(1_000),
      getRateLimitForUserModel: jest.fn().mockResolvedValue(null),
    };
    keyExecutor = {
      // invoke the callback with a fake resolved key and return its result
      execute: jest.fn(
        async (
          _uid: string,
          _prov: string,
          cb: (k: unknown) => Promise<unknown>,
        ) => cb(FAKE_KEY),
      ),
      isKeyRecentlyHealthy: jest.fn().mockResolvedValue(false),
      acquireProviderSlot: jest.fn().mockResolvedValue(() => undefined),
      trackSuccess: jest.fn().mockResolvedValue(undefined),
      trackFailure: jest.fn().mockResolvedValue(undefined),
    };
  });

  describe("isAvailable", () => {
    it("true when keyExecutor injected", () => {
      expect(build(true).isAvailable()).toBe(true);
    });
    it("false when keyExecutor absent", () => {
      expect(build(false).isAvailable()).toBe(false);
    });
  });

  describe("acquireProviderSlot", () => {
    it("returns null when no keyExecutor", async () => {
      expect(await build(false).acquireProviderSlot("u", "openai")).toBeNull();
    });
    it("delegates to keyExecutor when available", async () => {
      const release = await build(true).acquireProviderSlot("u", "openai");
      expect(keyExecutor.acquireProviderSlot).toHaveBeenCalledWith(
        "u",
        "openai",
      );
      expect(typeof release).toBe("function");
    });
  });

  describe("trackSuccess / trackFailure", () => {
    it("trackSuccess is a no-op without executor", async () => {
      await build(false).trackSuccess("h", "openai", "u");
      expect(keyExecutor.trackSuccess).not.toHaveBeenCalled();
    });
    it("trackSuccess delegates with executor", async () => {
      await build(true).trackSuccess("h", "openai", "u");
      expect(keyExecutor.trackSuccess).toHaveBeenCalledWith("h", "openai", "u");
    });
    it("trackFailure is a no-op without executor", async () => {
      await build(false).trackFailure("h", "openai", new Error("x"));
      expect(keyExecutor.trackFailure).not.toHaveBeenCalled();
    });
    it("trackFailure delegates with executor", async () => {
      const err = new Error("x");
      await build(true).trackFailure("h", "openai", err);
      expect(keyExecutor.trackFailure).toHaveBeenCalledWith("h", "openai", err);
    });
  });

  describe("callAPIWithFailover — guard", () => {
    it("throws when keyExecutor not available", async () => {
      await expect(call(build(false), makeConfig())).rejects.toThrow(
        "KeyExecutor not available",
      );
    });
  });

  describe("callAPIWithFailover — apiFormat routing", () => {
    it("routes openai format to callOpenAICompatibleAPI", async () => {
      const res = await call(build(), makeConfig({ apiFormat: "openai" }));
      expect(apiCaller.callOpenAICompatibleAPI).toHaveBeenCalledTimes(1);
      expect(res.apiKeySource).toBe("personal");
    });

    it("routes anthropic format to callAnthropicAPI", async () => {
      await call(
        build(),
        makeConfig({ apiFormat: "anthropic", provider: "anthropic" }),
      );
      expect(apiCaller.callAnthropicAPI).toHaveBeenCalledTimes(1);
      expect(apiCaller.callOpenAICompatibleAPI).not.toHaveBeenCalled();
    });

    it("routes google format to callGoogleAPI", async () => {
      await call(
        build(),
        makeConfig({ apiFormat: "google", provider: "google" }),
      );
      expect(apiCaller.callGoogleAPI).toHaveBeenCalledTimes(1);
    });

    it("routes xai format to callXAIAPI", async () => {
      await call(build(), makeConfig({ apiFormat: "xai", provider: "xai" }));
      expect(apiCaller.callXAIAPI).toHaveBeenCalledTimes(1);
    });

    it("falls back to OpenAI-compatible for unknown apiFormat", async () => {
      await call(build(), makeConfig({ apiFormat: "weird" as never }));
      expect(apiCaller.callOpenAICompatibleAPI).toHaveBeenCalledTimes(1);
    });

    it("defaults to openai format when apiFormat empty", async () => {
      await call(build(), makeConfig({ apiFormat: "" as never }));
      expect(apiCaller.callOpenAICompatibleAPI).toHaveBeenCalledTimes(1);
    });

    it("prefers the resolved key endpoint over the config endpoint", async () => {
      await call(build(), makeConfig());
      const endpointArg = apiCaller.callOpenAICompatibleAPI.mock.calls[0][0];
      expect(endpointArg).toBe(FAKE_KEY.apiEndpoint);
    });
  });

  describe("callAPIWithFailover — maxTokens clamping", () => {
    it("clamps maxTokens to the model config limit", async () => {
      await call(build(), makeConfig({ maxTokens: 50 }), { maxTokens: 9999 });
      const passedMaxTokens =
        apiCaller.callOpenAICompatibleAPI.mock.calls[0][4];
      expect(passedMaxTokens).toBe(50);
    });

    it("does not clamp when within limit", async () => {
      await call(build(), makeConfig({ maxTokens: 1000 }), { maxTokens: 100 });
      const passedMaxTokens =
        apiCaller.callOpenAICompatibleAPI.mock.calls[0][4];
      expect(passedMaxTokens).toBe(100);
    });
  });

  describe("callAPIWithFailover — timeout & temperature", () => {
    it("uses the larger of computed and configured timeout", async () => {
      modelConfig.getTimeoutForModel.mockReturnValue(1_000);
      await call(build(), makeConfig({ defaultTimeoutMs: 9_000 }));
      const timeoutArg = apiCaller.callOpenAICompatibleAPI.mock.calls[0][6];
      expect(timeoutArg).toBe(9_000);
    });

    it("uses computed timeout when larger than configured", async () => {
      modelConfig.getTimeoutForModel.mockReturnValue(20_000);
      await call(build(), makeConfig({ defaultTimeoutMs: 5_000 }));
      const timeoutArg = apiCaller.callOpenAICompatibleAPI.mock.calls[0][6];
      expect(timeoutArg).toBe(20_000);
    });

    it("passes undefined temperature when model does not support it", async () => {
      await call(build(), makeConfig({ supportsTemperature: false }), {
        temperature: 0.9,
      });
      const tempArg = apiCaller.callOpenAICompatibleAPI.mock.calls[0][5];
      expect(tempArg).toBeUndefined();
    });
  });

  describe("callAPIWithFailover — rpm pacing (opt-in)", () => {
    it("does not sleep when no rpm configured", async () => {
      modelConfig.getRateLimitForUserModel.mockResolvedValue(null);
      await call(build(), makeConfig());
      expect(retry.sleep).not.toHaveBeenCalled();
    });

    it("does not sleep on the first call even with rpm configured", async () => {
      modelConfig.getRateLimitForUserModel.mockResolvedValue({ rpmLimit: 60 });
      await call(build(), makeConfig());
      // first call reserves the slot but waits 0ms
      expect(retry.sleep).not.toHaveBeenCalled();
    });

    it("paces the second back-to-back call by the rpm interval", async () => {
      modelConfig.getRateLimitForUserModel.mockResolvedValue({ rpmLimit: 60 });
      const svc = build();
      await call(svc, makeConfig());
      await call(svc, makeConfig());
      expect(retry.sleep).toHaveBeenCalledTimes(1);
      // 60 rpm → 1000ms interval
      expect(retry.sleep.mock.calls[0][0]).toBeGreaterThan(0);
    });

    it("ignores non-positive rpm", async () => {
      modelConfig.getRateLimitForUserModel.mockResolvedValue({ rpmLimit: 0 });
      await call(build(), makeConfig());
      expect(retry.sleep).not.toHaveBeenCalled();
    });
  });

  describe("callAPIWithFailover — recently-healthy retry hint", () => {
    it("passes retryTransient401=true when key recently healthy", async () => {
      keyExecutor.isKeyRecentlyHealthy.mockResolvedValue(true);
      await call(build(), makeConfig());
      const opts = retry.withExponentialBackoff.mock.calls[0][3];
      expect(opts).toEqual({ retryTransient401: true });
    });

    it("passes retryTransient401=false otherwise", async () => {
      keyExecutor.isKeyRecentlyHealthy.mockResolvedValue(false);
      await call(build(), makeConfig());
      const opts = retry.withExponentialBackoff.mock.calls[0][3];
      expect(opts).toEqual({ retryTransient401: false });
    });
  });

  describe("callAPIWithFailover — error handling", () => {
    it("rethrows BYOKError untouched", async () => {
      const byok = new BYOKError("INVALID_API_KEY", "all keys failed");
      keyExecutor.execute.mockRejectedValue(byok);
      await expect(call(build(), makeConfig())).rejects.toBe(byok);
    });

    it("rethrows generic errors in strict mode", async () => {
      const err = new Error("provider 5xx");
      keyExecutor.execute.mockRejectedValue(err);
      await expect(call(build(), makeConfig(), { strict: true })).rejects.toBe(
        err,
      );
    });

    it("returns a structured isError result for generic errors in non-strict mode", async () => {
      keyExecutor.execute.mockRejectedValue(new Error("provider 5xx"));
      const res = await call(build(), makeConfig(), { strict: false });
      expect(res.isError).toBe(true);
      expect(res.tokensUsed).toBe(0);
      expect(res.model).toBe("gpt-test");
      expect(res.content).toContain("provider 5xx");
    });

    it("stringifies non-Error throwables in the failure message", async () => {
      keyExecutor.execute.mockRejectedValue("plain string boom");
      const res = await call(build(), makeConfig(), { strict: false });
      expect(res.content).toContain("plain string boom");
    });
  });

  describe("callAPIWithFailover — tokenParamName (reasoning fallback)", () => {
    // index 7 of callOpenAICompatibleAPI positional args = tokenParamName
    const TOKEN_PARAM_ARG = 7;

    it("infers max_completion_tokens when isReasoning unset for a reasoning modelId (★ user failure path: gpt-5.4)", async () => {
      await call(
        build(),
        makeConfig({ modelId: "gpt-5.4", isReasoning: undefined }),
      );
      const tokenParamArg =
        apiCaller.callOpenAICompatibleAPI.mock.calls[0][TOKEN_PARAM_ARG];
      expect(tokenParamArg).toBe("max_completion_tokens");
    });

    it("infers max_completion_tokens when isReasoning is FALSE (DB NOT NULL collapse) for a reasoning modelId (★ 真实 DB 场景：?? 会漏、必须 ||)", async () => {
      // isReasoning 列是 Boolean @default(false) NOT NULL —— 用户漏标的 gpt-5.4 落库即 false（非 undefined）。
      // 这正是 ?? 失效、|| 救回的判别 case：?? 会保留 false → max_tokens → 线上 INVALID_REQUEST。
      await call(
        build(),
        makeConfig({ modelId: "gpt-5.4", isReasoning: false }),
      );
      const tokenParamArg =
        apiCaller.callOpenAICompatibleAPI.mock.calls[0][TOKEN_PARAM_ARG];
      expect(tokenParamArg).toBe("max_completion_tokens");
    });

    it("uses max_tokens when isReasoning explicitly false on a non-reasoning modelId", async () => {
      await call(
        build(),
        makeConfig({ modelId: "gpt-4o", isReasoning: false }),
      );
      const tokenParamArg =
        apiCaller.callOpenAICompatibleAPI.mock.calls[0][TOKEN_PARAM_ARG];
      expect(tokenParamArg).toBe("max_tokens");
    });

    it("honors explicit DB isReasoning=true even on a non-reasoning-looking modelId", async () => {
      await call(
        build(),
        makeConfig({ modelId: "custom-model", isReasoning: true }),
      );
      const tokenParamArg =
        apiCaller.callOpenAICompatibleAPI.mock.calls[0][TOKEN_PARAM_ARG];
      expect(tokenParamArg).toBe("max_completion_tokens");
    });

    it("respects an explicit tokenParamName override regardless of inference", async () => {
      await call(
        build(),
        makeConfig({
          modelId: "gpt-5.4",
          isReasoning: undefined,
          tokenParamName: "max_tokens",
        }),
      );
      const tokenParamArg =
        apiCaller.callOpenAICompatibleAPI.mock.calls[0][TOKEN_PARAM_ARG];
      expect(tokenParamArg).toBe("max_tokens");
    });
  });

  describe("callAPIWithFailover — apiKeySource", () => {
    it("keeps an explicit apiKeySource from the result", async () => {
      keyExecutor.execute.mockImplementation(
        async (_u, _p, cb: (k: unknown) => Promise<unknown>) => {
          const r = (await cb(FAKE_KEY)) as Record<string, unknown>;
          return { ...r, apiKeySource: "assigned" };
        },
      );
      const res = await call(build(), makeConfig());
      expect(res.apiKeySource).toBe("assigned");
    });
  });
});
