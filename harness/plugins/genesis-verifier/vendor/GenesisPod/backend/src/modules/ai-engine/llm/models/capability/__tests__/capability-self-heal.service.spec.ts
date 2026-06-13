/**
 * CapabilitySelfHealService spec — v3.1 §B.4 自愈决策栈
 *
 * 覆盖矩阵：
 *   - feature flag ENABLE_CAPABILITY_SELF_HEAL='false' → 拒
 *   - target.kind != 'user_model_config' → 拒（admin 全局表永不自愈）
 *   - 错误信号 4 重严校全失败案例（status / code / body 无证据）
 *   - cooling-off：24h 内有 admin override → 拒
 *   - 阈值未到（count=1, 2）→ 拒
 *   - 阈值到（count=3）→ 写入 + AuditLog source='self-heal-user' + __meta 正确
 *   - 自愈成功 → Redis counter 清零
 *   - advisory_xact_lock 在 tx 内被调用
 *   - writer 异常 → 自愈返回 healed:false 不抛出
 */

import { CapabilitySelfHealService } from "../capability-self-heal.service";
import { CapabilityOverridesWriterService } from "../capability-overrides-writer.service";
import type { ErrorSignal } from "../error-signal.types";

const validErrorSignal: ErrorSignal = {
  httpStatus: 400,
  errorCode: "unsupported_response_format",
  bodySnippet: "the model does not support json_schema response_format",
};

describe("CapabilitySelfHealService — v3.1 §B.4", () => {
  let cache: {
    incrby: jest.Mock;
    expire: jest.Mock;
    del: jest.Mock;
  };
  let prisma: {
    userModelConfig: { findUnique: jest.Mock };
    capabilityOverrideAuditLog: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let writer: { applyOverrideInTx: jest.Mock };
  let svc: CapabilitySelfHealService;
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFlag = process.env.ENABLE_CAPABILITY_SELF_HEAL;
    delete process.env.ENABLE_CAPABILITY_SELF_HEAL;

    cache = {
      incrby: jest.fn().mockResolvedValue(3),
      expire: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      userModelConfig: {
        findUnique: jest.fn().mockResolvedValue({ userId: "user-1" }),
      },
      capabilityOverrideAuditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([{ lock: null }]),
        };
        return cb(tx);
      }),
    };
    writer = {
      applyOverrideInTx: jest
        .fn()
        .mockResolvedValue({ before: null, after: {} }),
    };

    svc = new CapabilitySelfHealService(
      cache as never,
      prisma as never,
      writer as unknown as CapabilityOverridesWriterService,
    );
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.ENABLE_CAPABILITY_SELF_HEAL;
    } else {
      process.env.ENABLE_CAPABILITY_SELF_HEAL = originalFlag;
    }
  });

  // ─────────── feature flag ───────────

  it("returns healed=false when feature flag disabled", async () => {
    process.env.ENABLE_CAPABILITY_SELF_HEAL = "false";
    const result = await svc.maybeSelfHeal({
      target: { kind: "user_model_config", id: "config-1" },
      field: "structuredOutput.nativeMode",
      fromValue: "json_schema",
      toValue: "none",
      errorSignal: validErrorSignal,
    });
    expect(result.healed).toBe(false);
    expect(result.reason).toBe("feature_flag_disabled");
  });

  // ─────────── target kind guard ───────────

  it("rejects non-user_model_config target (admin 全局表永不自愈)", async () => {
    const result = await svc.maybeSelfHeal({
      target: { kind: "ai_model", id: "model-1" },
      field: "structuredOutput.nativeMode",
      fromValue: "json_schema",
      toValue: "none",
      errorSignal: validErrorSignal,
    });
    expect(result.healed).toBe(false);
    expect(result.reason).toBe("target_kind_not_supported");
  });

  // ─────────── 错误信号 4 重严校 ───────────

  describe("error signal 4-check", () => {
    it("rejects when HTTP status not in {400, 422}", async () => {
      const result = await svc.maybeSelfHeal({
        target: { kind: "user_model_config", id: "config-1" },
        field: "structuredOutput.nativeMode",
        fromValue: "json_schema",
        toValue: "none",
        errorSignal: { ...validErrorSignal, httpStatus: 500 },
      });
      expect(result.healed).toBe(false);
      expect(result.reason).toBe("http_status_not_whitelisted");
    });

    it("rejects when error code not whitelisted", async () => {
      const result = await svc.maybeSelfHeal({
        target: { kind: "user_model_config", id: "config-1" },
        field: "structuredOutput.nativeMode",
        fromValue: "json_schema",
        toValue: "none",
        errorSignal: { ...validErrorSignal, errorCode: "internal_error" },
      });
      expect(result.healed).toBe(false);
      expect(result.reason).toBe("error_code_not_whitelisted");
    });

    it("rejects when body has no evidence (no fromValue / no field leaf)", async () => {
      const result = await svc.maybeSelfHeal({
        target: { kind: "user_model_config", id: "config-1" },
        field: "structuredOutput.nativeMode",
        fromValue: "json_schema",
        toValue: "none",
        errorSignal: {
          ...validErrorSignal,
          bodySnippet: "some other error text",
        },
      });
      expect(result.healed).toBe(false);
      expect(result.reason).toBe("body_snippet_no_evidence");
    });

    it("accepts body containing field leaf name", async () => {
      cache.incrby.mockResolvedValue(3); // 阈值到位
      const result = await svc.maybeSelfHeal({
        target: { kind: "user_model_config", id: "config-1" },
        field: "structuredOutput.nativeMode",
        fromValue: "some-rare-value",
        toValue: "none",
        errorSignal: {
          ...validErrorSignal,
          bodySnippet: "nativeMode field is invalid",
        },
      });
      expect(result.healed).toBe(true);
    });

    // ★ 2026-05-25: 退化输出（200 OK 但空/畸形）合成信号也能自愈降档。
    it("accepts synthetic degenerate-output signal (200 + degenerate_output)", async () => {
      cache.incrby.mockResolvedValue(3);
      const result = await svc.maybeSelfHeal({
        target: { kind: "user_model_config", id: "config-1" },
        field: "structuredOutput.nativeMode",
        fromValue: "json_mode",
        toValue: "none",
        errorSignal: {
          httpStatus: 200,
          errorCode: "degenerate_output",
          bodySnippet: "degenerate_output nativeMode=json_mode",
        },
      });
      expect(result.healed).toBe(true);
    });

    it("rejects 200 when errorCode is NOT degenerate_output (防绕过)", async () => {
      cache.incrby.mockResolvedValue(3);
      const result = await svc.maybeSelfHeal({
        target: { kind: "user_model_config", id: "config-1" },
        field: "structuredOutput.nativeMode",
        fromValue: "json_mode",
        toValue: "none",
        errorSignal: {
          httpStatus: 200,
          errorCode: "unsupported_response_format",
          bodySnippet: "nativeMode json_mode",
        },
      });
      expect(result.healed).toBe(false);
      expect(result.reason).toBe("http_200_requires_degenerate_code");
    });
  });

  // ─────────── cooling-off ───────────

  it("rejects when admin override within 24h cooling-off window", async () => {
    prisma.capabilityOverrideAuditLog.findFirst.mockResolvedValue({
      id: "audit-recent",
    });
    const result = await svc.maybeSelfHeal({
      target: { kind: "user_model_config", id: "config-1" },
      field: "structuredOutput.nativeMode",
      fromValue: "json_schema",
      toValue: "none",
      errorSignal: validErrorSignal,
    });
    expect(result.healed).toBe(false);
    expect(result.reason).toBe("admin_override_cooling_off");
    // Writer not called
    expect(writer.applyOverrideInTx).not.toHaveBeenCalled();
  });

  // ─────────── 阈值计数 ───────────

  describe("threshold N=3 / 10min", () => {
    it("rejects when count=1 (below threshold)", async () => {
      cache.incrby.mockResolvedValue(1);
      const result = await svc.maybeSelfHeal({
        target: { kind: "user_model_config", id: "config-1" },
        field: "structuredOutput.nativeMode",
        fromValue: "json_schema",
        toValue: "none",
        errorSignal: validErrorSignal,
      });
      expect(result.healed).toBe(false);
      expect(result.reason).toContain("threshold_not_reached(1/3)");
      // expire was set only on count=1 (first hit)
      expect(cache.expire).toHaveBeenCalled();
    });

    it("rejects when count=2 + does NOT re-set expire", async () => {
      cache.incrby.mockResolvedValue(2);
      cache.expire.mockClear();
      const result = await svc.maybeSelfHeal({
        target: { kind: "user_model_config", id: "config-1" },
        field: "structuredOutput.nativeMode",
        fromValue: "json_schema",
        toValue: "none",
        errorSignal: validErrorSignal,
      });
      expect(result.healed).toBe(false);
      expect(result.reason).toContain("threshold_not_reached(2/3)");
      // expire only set on count=1 (which already happened in earlier call); not re-set on count=2
      expect(cache.expire).not.toHaveBeenCalled();
    });

    it("triggers self-heal when count=3 + clears Redis counter on success", async () => {
      cache.incrby.mockResolvedValue(3);
      const result = await svc.maybeSelfHeal({
        target: { kind: "user_model_config", id: "config-1" },
        field: "structuredOutput.nativeMode",
        fromValue: "json_schema",
        toValue: "none",
        errorSignal: validErrorSignal,
      });
      expect(result.healed).toBe(true);
      expect(writer.applyOverrideInTx).toHaveBeenCalledTimes(1);
      expect(cache.del).toHaveBeenCalled();
    });
  });

  // ─────────── self-heal patch + audit ───────────

  describe("self-heal patch shape (writer 调用参数)", () => {
    it("builds nested patch from dot-field + __meta with selfHealedAt + source", async () => {
      cache.incrby.mockResolvedValue(3);
      await svc.maybeSelfHeal({
        target: { kind: "user_model_config", id: "config-1" },
        field: "structuredOutput.nativeMode",
        fromValue: "json_schema",
        toValue: "none",
        errorSignal: validErrorSignal,
      });
      expect(writer.applyOverrideInTx).toHaveBeenCalledTimes(1);
      const writeCall = writer.applyOverrideInTx.mock.calls[0][1];
      expect(writeCall.scope).toBe("SYSTEM");
      expect(writeCall.actor).toEqual({ id: "system", role: "system" });
      expect(writeCall.source).toBe("self-heal-user");
      expect(writeCall.patch.structuredOutput).toEqual({ nativeMode: "none" });
      expect(writeCall.patch.__meta.autoDowngraded).toBe(true);
      expect(writeCall.patch.__meta.source).toBe("self-heal-user");
      expect(writeCall.patch.__meta.selfHealedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T/,
      );
      expect(writeCall.patch.__meta.selfHealedReason).toBe(
        "400_unsupported_response_format",
      );
      // reason must be ≥30 chars (writer guard)
      expect(writeCall.reason.length).toBeGreaterThanOrEqual(30);
    });
  });

  // ─────────── advisory lock ───────────

  it("acquires pg_advisory_xact_lock inside transaction", async () => {
    cache.incrby.mockResolvedValue(3);
    let lockQueried = false;
    prisma.$transaction.mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        const tx = {
          $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
            if (strings.join("").includes("pg_advisory_xact_lock")) {
              lockQueried = true;
            }
            return [{ lock: null }];
          }),
        };
        return cb(tx);
      },
    );
    await svc.maybeSelfHeal({
      target: { kind: "user_model_config", id: "config-1" },
      field: "structuredOutput.nativeMode",
      fromValue: "json_schema",
      toValue: "none",
      errorSignal: validErrorSignal,
    });
    expect(lockQueried).toBe(true);
  });

  // ─────────── writer exception ───────────

  it("returns healed=false on writer exception (does not propagate)", async () => {
    cache.incrby.mockResolvedValue(3);
    writer.applyOverrideInTx.mockRejectedValue(
      new Error("DB constraint violation"),
    );
    const result = await svc.maybeSelfHeal({
      target: { kind: "user_model_config", id: "config-1" },
      field: "structuredOutput.nativeMode",
      fromValue: "json_schema",
      toValue: "none",
      errorSignal: validErrorSignal,
    });
    expect(result.healed).toBe(false);
    expect(result.reason).toMatch(/^exception:/);
  });

  // ─────────── target row missing ───────────

  it("returns healed=false when target row not found", async () => {
    prisma.userModelConfig.findUnique.mockResolvedValue(null);
    const result = await svc.maybeSelfHeal({
      target: { kind: "user_model_config", id: "missing" },
      field: "structuredOutput.nativeMode",
      fromValue: "json_schema",
      toValue: "none",
      errorSignal: validErrorSignal,
    });
    expect(result.healed).toBe(false);
    expect(result.reason).toBe("target_row_missing");
  });
});
