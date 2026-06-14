/**
 * AiApiCallerService catch 块 self-heal 触发 spec — v3.1 §B.5.2
 *
 * 覆盖矩阵：
 *   - 命中 4xx + 能识别的 errorCode + 提供 userModelConfigId → 异步触发 maybeSelfHeal（且不阻断原 throw）
 *   - 命中 4xx 但 userModelConfigId 缺失 → 不触发（self-heal 只动 BYOK）
 *   - 命中 4xx 但 self-heal 服务未注入（@Optional）→ 不触发，不抛错
 *   - 网络错（无 response.status）→ extractErrorSignal 返 null → 不触发
 *   - self-heal 异步抛错 → 主 throw 不受影响（fire-and-forget）
 */

import { HttpService } from "@nestjs/axios";
import { throwError } from "rxjs";
import { AiApiCallerService } from "../ai-api-caller.service";
import { OpenaiCaller } from "../openai-caller";
import { AnthropicCaller } from "../anthropic-caller";
import { CohereCaller } from "../cohere-caller";
import { GoogleCaller } from "../google-caller";
import { XaiCaller } from "../xai-caller";
import type { CapabilitySelfHealService } from "../../models/capability/capability-self-heal.service";

// split 后 self-heal-in-catch 逻辑随各 provider 搬到对应 caller；用真 caller 构造
// AiApiCallerService(委派打到真 caller),catch 行为与拆分前一致。
function buildCallerSvc(
  http: HttpService,
  sh?: CapabilitySelfHealService,
): AiApiCallerService {
  return new AiApiCallerService(
    new OpenaiCaller(http, undefined, sh),
    new AnthropicCaller(http, undefined, sh),
    new CohereCaller(http, undefined, sh),
    new GoogleCaller(http, undefined, sh),
    new XaiCaller(http, undefined, sh),
  );
}

describe("AiApiCallerService — v3.1 §B.5.2 self-heal trigger in catch", () => {
  let httpService: { post: jest.Mock };
  let selfHeal: { maybeSelfHeal: jest.Mock };
  let svc: AiApiCallerService;

  beforeEach(() => {
    httpService = { post: jest.fn() };
    selfHeal = {
      maybeSelfHeal: jest
        .fn()
        .mockResolvedValue({ healed: false, reason: "noop" }),
    };
    svc = buildCallerSvc(
      httpService as unknown as HttpService,
      selfHeal as unknown as CapabilitySelfHealService,
    );
  });

  function makeAxiosError(status: number, data: unknown) {
    const err = new Error(
      `Request failed with status code ${status}`,
    ) as Error & {
      response?: { status: number; statusText?: string; data?: unknown };
      config?: { url?: string };
    };
    err.response = { status, statusText: "Bad Request", data };
    err.config = { url: "https://api.x.ai/v1/chat/completions" };
    return err;
  }

  // ─────────── 命中：4xx + errorCode + userModelConfigId → 触发 ───────────

  it("triggers maybeSelfHeal asynchronously when 4xx error + userModelConfigId provided", async () => {
    const err = makeAxiosError(400, {
      error: {
        code: "invalid_request_error",
        type: "invalid_request_error",
        message: "unsupported response_format",
      },
    });
    httpService.post.mockReturnValue(throwError(() => err));

    await expect(
      svc.callXAIAPI(
        "https://api.x.ai/v1",
        "key",
        "grok-3",
        [{ role: "user", content: "hi" }],
        100,
        0.7,
        30000,
        "max_tokens",
        "json",
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        "config-byok-1", // userModelConfigId
      ),
    ).rejects.toThrow(); // 原 throw 必须保留

    // 异步触发后需等一拍（fire-and-forget Promise）
    await new Promise((r) => setImmediate(r));
    expect(selfHeal.maybeSelfHeal).toHaveBeenCalledTimes(1);
    const call = selfHeal.maybeSelfHeal.mock.calls[0][0];
    expect(call.target).toEqual({
      kind: "user_model_config",
      id: "config-byok-1",
    });
    expect(call.errorSignal.httpStatus).toBe(400);
    expect(call.errorSignal.errorCode).toBe("invalid_request_error");
  });

  // ─────────── 不触发：userModelConfigId 缺失 ───────────

  it("does NOT trigger self-heal when userModelConfigId missing (non-BYOK path)", async () => {
    const err = makeAxiosError(400, {
      error: { code: "invalid_request_error", message: "x" },
    });
    httpService.post.mockReturnValue(throwError(() => err));

    await expect(
      svc.callXAIAPI(
        "https://api.x.ai/v1",
        "key",
        "grok-3",
        [{ role: "user", content: "hi" }],
        100,
        0.7,
        30000,
        // userModelConfigId 缺省
      ),
    ).rejects.toThrow();

    await new Promise((r) => setImmediate(r));
    expect(selfHeal.maybeSelfHeal).not.toHaveBeenCalled();
  });

  // ─────────── 不触发：网络错（无 status）───────────

  it("does NOT trigger when extractErrorSignal returns null (no response.status)", async () => {
    const err = new Error("ECONNREFUSED") as Error & { code?: string };
    err.code = "ECONNREFUSED";
    httpService.post.mockReturnValue(throwError(() => err));

    await expect(
      svc.callXAIAPI(
        "https://api.x.ai/v1",
        "key",
        "grok-3",
        [{ role: "user", content: "hi" }],
        100,
        0.7,
        30000,
        "max_tokens",
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        "config-byok-1",
      ),
    ).rejects.toThrow();

    await new Promise((r) => setImmediate(r));
    expect(selfHeal.maybeSelfHeal).not.toHaveBeenCalled();
  });

  // ─────────── 不触发：service 未注入（BC 旧单测路径）───────────

  it("does NOT throw when self-heal service not injected (Optional BC)", async () => {
    const svc2 = buildCallerSvc(httpService as unknown as HttpService); // no self-heal service
    const err = makeAxiosError(400, {
      error: { code: "invalid_request_error", message: "x" },
    });
    httpService.post.mockReturnValue(throwError(() => err));

    await expect(
      svc2.callXAIAPI(
        "https://api.x.ai/v1",
        "key",
        "grok-3",
        [{ role: "user", content: "hi" }],
        100,
        0.7,
        30000,
        "max_tokens",
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        "config-byok-1",
      ),
    ).rejects.toThrow(); // 仅原 throw
  });

  // ─────────── B+.3：其它 provider catch 接入 self-heal ───────────

  describe("v3.1 §B+.3 — OpenAI / Anthropic / Google providers also trigger self-heal", () => {
    it("OpenAI callOpenAICompatibleAPI catch triggers maybeSelfHeal", async () => {
      const err = makeAxiosError(400, {
        error: {
          code: "invalid_request_error",
          message: "Invalid response_format",
        },
      });
      httpService.post.mockReturnValue(throwError(() => err));
      await expect(
        svc.callOpenAICompatibleAPI(
          "https://api.openai.com/v1",
          "key",
          "gpt-4o",
          [{ role: "user", content: "hi" }],
          100,
          0.7,
          30000,
          "max_tokens",
          "json",
          undefined,
          undefined,
          undefined,
          false,
          undefined,
          undefined,
          undefined,
          undefined,
          "openai", // provider
          "config-byok-2", // userModelConfigId
        ),
      ).rejects.toThrow();
      await new Promise((r) => setImmediate(r));
      expect(selfHeal.maybeSelfHeal).toHaveBeenCalledTimes(1);
      const call = selfHeal.maybeSelfHeal.mock.calls[0][0];
      expect(call.target).toEqual({
        kind: "user_model_config",
        id: "config-byok-2",
      });
      expect(call.errorSignal.httpStatus).toBe(400);
    });

    it("Anthropic callAnthropicAPI catch triggers maybeSelfHeal", async () => {
      const err = makeAxiosError(400, {
        error: {
          type: "invalid_request_error",
          message: "tools.required not supported",
        },
      });
      httpService.post.mockReturnValue(throwError(() => err));
      await expect(
        svc.callAnthropicAPI(
          "https://api.anthropic.com/v1",
          "key",
          "claude-3.5-sonnet",
          [{ role: "user", content: "hi" }],
          100,
          0.7,
          30000,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          "config-byok-anthro",
        ),
      ).rejects.toThrow();
      await new Promise((r) => setImmediate(r));
      expect(selfHeal.maybeSelfHeal).toHaveBeenCalledTimes(1);
      const call = selfHeal.maybeSelfHeal.mock.calls[0][0];
      expect(call.target.id).toBe("config-byok-anthro");
    });

    it("Google callGoogleAPI catch triggers maybeSelfHeal", async () => {
      const err = makeAxiosError(400, {
        error: {
          code: 400,
          status: "INVALID_ARGUMENT",
          message: "responseSchema invalid",
        },
      });
      httpService.post.mockReturnValue(throwError(() => err));
      await expect(
        svc.callGoogleAPI(
          "https://generativelanguage.googleapis.com",
          "key",
          "gemini-2.5-pro",
          [{ role: "user", content: "hi" }],
          100,
          0.7,
          30000,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          "config-byok-gem",
        ),
      ).rejects.toThrow();
      await new Promise((r) => setImmediate(r));
      expect(selfHeal.maybeSelfHeal).toHaveBeenCalledTimes(1);
      const call = selfHeal.maybeSelfHeal.mock.calls[0][0];
      expect(call.target.id).toBe("config-byok-gem");
    });
  });

  // ─────────── self-heal 异步抛错不阻断主 throw ───────────

  it("propagates the original error even if maybeSelfHeal rejects (fire-and-forget)", async () => {
    selfHeal.maybeSelfHeal.mockRejectedValue(new Error("self-heal blew up"));
    const err = makeAxiosError(400, {
      error: { code: "invalid_request_error", message: "x" },
    });
    httpService.post.mockReturnValue(throwError(() => err));

    await expect(
      svc.callXAIAPI(
        "https://api.x.ai/v1",
        "key",
        "grok-3",
        [{ role: "user", content: "hi" }],
        100,
        0.7,
        30000,
        "max_tokens",
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        "config-byok-1",
      ),
    ).rejects.toThrow(/status code 400/);

    // 等异步 .catch 跑完，无 unhandled rejection
    await new Promise((r) => setImmediate(r));
    expect(selfHeal.maybeSelfHeal).toHaveBeenCalled();
  });
});
