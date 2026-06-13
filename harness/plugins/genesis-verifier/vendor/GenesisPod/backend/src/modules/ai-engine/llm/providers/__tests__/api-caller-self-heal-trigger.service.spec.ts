/**
 * ApiCallerSelfHealTriggerService spec — v3.1 §D.1 (2026-05-24)
 *
 * 验证从 AiApiCallerService god-class 抽出的 self-heal 触发器单元行为：
 *   1. 命中 4xx + 已识别 errorCode + userModelConfigId → 异步触发 maybeSelfHeal
 *   2. userModelConfigId 缺失 → noop（不调）
 *   3. CapabilitySelfHealService 未注入（@Optional BC）→ noop（不抛）
 *   4. 网络错（无 response.status / extractErrorSignal 返 null）→ noop
 *   5. maybeSelfHeal 异步抛错 → warn 日志，不传播（fire-and-forget）
 *
 * 与 ai-api-caller.self-heal-trigger.spec.ts 的关系：
 *   - 旧 spec 走 ai-api-caller 4 个 provider catch 块 端到端
 *   - 本 spec 直测 trigger service 单元（jest spec 对称重复 fire-and-forget 语义）
 */

import { ApiCallerSelfHealTriggerService } from "../api-caller-self-heal-trigger.service";
import type { CapabilitySelfHealService } from "../../models/capability/capability-self-heal.service";

describe("ApiCallerSelfHealTriggerService — v3.1 §D.1", () => {
  let selfHeal: { maybeSelfHeal: jest.Mock };
  let trigger: ApiCallerSelfHealTriggerService;

  beforeEach(() => {
    selfHeal = {
      maybeSelfHeal: jest
        .fn()
        .mockResolvedValue({ healed: false, reason: "noop" }),
    };
    trigger = new ApiCallerSelfHealTriggerService(
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
    err.config = { url: "https://api.openai.com/v1/chat/completions" };
    return err;
  }

  it("triggers maybeSelfHeal when 4xx + errorCode + userModelConfigId provided", async () => {
    const err = makeAxiosError(400, {
      error: { code: "invalid_request_error", message: "unsupported" },
    });

    trigger.triggerSelfHealAsync(err, {
      modelId: "gpt-4o",
      userModelConfigId: "cfg-1",
    });

    // fire-and-forget Promise — wait a tick
    await new Promise((r) => setImmediate(r));
    expect(selfHeal.maybeSelfHeal).toHaveBeenCalledTimes(1);
    const call = selfHeal.maybeSelfHeal.mock.calls[0][0];
    expect(call.target).toEqual({ kind: "user_model_config", id: "cfg-1" });
    expect(call.field).toBe("structuredOutput.nativeMode");
    expect(call.fromValue).toBe("json_schema");
    expect(call.toValue).toBe("none");
    expect(call.errorSignal.httpStatus).toBe(400);
    expect(call.errorSignal.errorCode).toBe("invalid_request_error");
  });

  it("R1: forwards chain-aware fromValue/toValue when caller provides them", async () => {
    const err = makeAxiosError(400, {
      error: { code: "invalid_request_error", message: "unsupported" },
    });

    trigger.triggerSelfHealAsync(err, {
      modelId: "deepseek-v4-flash",
      userModelConfigId: "cfg-1",
      fromValue: "json_schema",
      toValue: "json_mode", // chain-aware: 降到 json_mode 而非一刀切 none
    });

    await new Promise((r) => setImmediate(r));
    const call = selfHeal.maybeSelfHeal.mock.calls[0][0];
    expect(call.fromValue).toBe("json_schema");
    expect(call.toValue).toBe("json_mode");
  });

  it("does NOT trigger when userModelConfigId missing (non-BYOK path)", async () => {
    const err = makeAxiosError(400, {
      error: { code: "invalid_request_error", message: "x" },
    });

    trigger.triggerSelfHealAsync(err, { modelId: "gpt-4o" });

    await new Promise((r) => setImmediate(r));
    expect(selfHeal.maybeSelfHeal).not.toHaveBeenCalled();
  });

  it("does NOT throw when self-heal service not injected (@Optional BC)", () => {
    const trigger2 = new ApiCallerSelfHealTriggerService(undefined);
    const err = makeAxiosError(400, {
      error: { code: "invalid_request_error", message: "x" },
    });

    // Must not throw
    expect(() =>
      trigger2.triggerSelfHealAsync(err, {
        modelId: "gpt-4o",
        userModelConfigId: "cfg-2",
      }),
    ).not.toThrow();
    expect(selfHeal.maybeSelfHeal).not.toHaveBeenCalled();
  });

  it("does NOT trigger when extractErrorSignal returns null (network error)", async () => {
    const err = new Error("ECONNREFUSED") as Error & { code?: string };
    err.code = "ECONNREFUSED";

    trigger.triggerSelfHealAsync(err, {
      modelId: "gpt-4o",
      userModelConfigId: "cfg-3",
    });

    await new Promise((r) => setImmediate(r));
    expect(selfHeal.maybeSelfHeal).not.toHaveBeenCalled();
  });

  // ★ 2026-05-25: 退化输出（200 OK 空/畸形）触发入口
  describe("triggerDegenerateSelfHealAsync", () => {
    it("triggers maybeSelfHeal with synthetic 200 degenerate_output signal", async () => {
      trigger.triggerDegenerateSelfHealAsync({
        modelId: "deepseek-v4-flash",
        userModelConfigId: "cfg-1",
        fromValue: "json_mode",
        toValue: "none",
        bodySnippet: "degenerate_output nativeMode=json_mode",
      });

      await new Promise((r) => setImmediate(r));
      expect(selfHeal.maybeSelfHeal).toHaveBeenCalledTimes(1);
      const call = selfHeal.maybeSelfHeal.mock.calls[0][0];
      expect(call.target).toEqual({ kind: "user_model_config", id: "cfg-1" });
      expect(call.fromValue).toBe("json_mode");
      expect(call.toValue).toBe("none");
      expect(call.errorSignal.httpStatus).toBe(200);
      expect(call.errorSignal.errorCode).toBe("degenerate_output");
    });

    it("does NOT trigger when fromValue/toValue missing (no degrade target)", async () => {
      trigger.triggerDegenerateSelfHealAsync({
        modelId: "deepseek-v4-flash",
        userModelConfigId: "cfg-1",
      });
      await new Promise((r) => setImmediate(r));
      expect(selfHeal.maybeSelfHeal).not.toHaveBeenCalled();
    });

    it("does NOT trigger when userModelConfigId missing", async () => {
      trigger.triggerDegenerateSelfHealAsync({
        modelId: "deepseek-v4-flash",
        fromValue: "json_mode",
        toValue: "none",
      });
      await new Promise((r) => setImmediate(r));
      expect(selfHeal.maybeSelfHeal).not.toHaveBeenCalled();
    });
  });

  it("swallows maybeSelfHeal async rejection (fire-and-forget; no unhandled)", async () => {
    selfHeal.maybeSelfHeal.mockRejectedValue(new Error("self-heal blew up"));
    const err = makeAxiosError(400, {
      error: { code: "invalid_request_error", message: "x" },
    });

    // Call should return synchronously without throwing
    expect(() =>
      trigger.triggerSelfHealAsync(err, {
        modelId: "gpt-4o",
        userModelConfigId: "cfg-4",
      }),
    ).not.toThrow();

    await new Promise((r) => setImmediate(r));
    expect(selfHeal.maybeSelfHeal).toHaveBeenCalledTimes(1);
  });
});
