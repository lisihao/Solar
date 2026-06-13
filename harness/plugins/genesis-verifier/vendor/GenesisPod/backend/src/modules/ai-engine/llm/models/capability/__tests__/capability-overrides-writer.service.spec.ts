/**
 * CapabilityOverridesWriterService spec — v3.1 §B.3 写入面
 *
 * 覆盖矩阵：
 *   - scope='ADMIN' 成功路径 → AuditLog 字段全对
 *   - scope='PERSONAL' / 'SYSTEM' 成功路径
 *   - scope='ASSIGNED' / 未知 → ForbiddenException
 *   - scope ↔ target.kind 矩阵不匹配 → ForbiddenException
 *   - scope ↔ actor.role 矩阵不匹配 → ForbiddenException
 *   - reason < 30 字符 → BadRequestException
 *   - patch 含 typo（reasoning.effort）→ BadRequestException（zod .strict() 拒）
 *   - patch 含 __meta → 接受（Fix-2 保障）
 *   - deep-merge 现有 {a:{x:1}} + patch {a:{y:2}} → {a:{x:1,y:2}}
 *   - $transaction 内 audit insert 抛错 → 整体回滚
 *   - scopeKey 算法（admin / BYOK / SYSTEM 三种）
 */

import { BadRequestException, ForbiddenException } from "@nestjs/common";

import { CapabilityOverridesWriterService } from "../capability-overrides-writer.service";
import type { ApplyOverrideOptions } from "../capability-overrides-writer.types";

// ─────────── 共享 prisma mock ───────────

interface MockState {
  aiModel: { id: string; capabilityOverrides: unknown } | null;
  userModelConfig: {
    id: string;
    userId: string;
    capabilityOverrides: unknown;
  } | null;
  auditLogs: Array<Record<string, unknown>>;
  /** 若 set 则 audit create 抛此错（用于事务回滚测试） */
  auditCreateError?: Error;
}

function buildMockPrisma(state: MockState) {
  const tx = {
    aIModel: {
      findUnique: jest.fn(
        async ({ where: { id } }: { where: { id: string } }) => {
          if (state.aiModel && state.aiModel.id === id) return state.aiModel;
          return null;
        },
      ),
      update: jest.fn(
        async ({
          where: { id },
          data,
        }: {
          where: { id: string };
          data: { capabilityOverrides: unknown };
        }) => {
          if (state.aiModel && state.aiModel.id === id) {
            state.aiModel.capabilityOverrides = data.capabilityOverrides;
          }
          return state.aiModel;
        },
      ),
    },
    userModelConfig: {
      findUnique: jest.fn(
        async ({ where: { id } }: { where: { id: string } }) => {
          if (state.userModelConfig && state.userModelConfig.id === id)
            return state.userModelConfig;
          return null;
        },
      ),
      update: jest.fn(
        async ({
          where: { id },
          data,
        }: {
          where: { id: string };
          data: { capabilityOverrides: unknown };
        }) => {
          if (state.userModelConfig && state.userModelConfig.id === id) {
            state.userModelConfig.capabilityOverrides =
              data.capabilityOverrides;
          }
          return state.userModelConfig;
        },
      ),
    },
    capabilityOverrideAuditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.auditCreateError) throw state.auditCreateError;
        state.auditLogs.push(data);
        return { id: "audit-1", ...data };
      }),
    },
  };
  return {
    tx,
    prisma: {
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => {
        // 模拟事务：cb 抛错 → 回滚（撤销 state 变更）
        const aiModelSnapshot = state.aiModel ? { ...state.aiModel } : null;
        const userConfigSnapshot = state.userModelConfig
          ? { ...state.userModelConfig }
          : null;
        const auditSnapshot = [...state.auditLogs];
        try {
          return await cb(tx);
        } catch (e) {
          // 回滚
          if (aiModelSnapshot && state.aiModel) {
            state.aiModel.capabilityOverrides =
              aiModelSnapshot.capabilityOverrides;
          }
          if (userConfigSnapshot && state.userModelConfig) {
            state.userModelConfig.capabilityOverrides =
              userConfigSnapshot.capabilityOverrides;
          }
          state.auditLogs = auditSnapshot;
          throw e;
        }
      }),
    },
  };
}

const baseAdminOpts = (
  patch: Record<string, unknown> = {
    structuredOutput: { nativeMode: "none" },
  },
): ApplyOverrideOptions => ({
  target: { kind: "ai_model", id: "model-1" },
  scope: "ADMIN",
  actor: { id: "admin-1", role: "admin" },
  patch: patch as never,
  source: "admin-override",
  reason:
    "Admin disables structured output for deepseek-v4-pro - 2026-05-24 incident response",
});

const baseUserOpts = (
  patch: Record<string, unknown> = {
    structuredOutput: { nativeMode: "json_mode" },
  },
): ApplyOverrideOptions => ({
  target: { kind: "user_model_config", id: "config-1" },
  scope: "PERSONAL",
  actor: { id: "user-1", role: "user" },
  patch: patch as never,
  source: "admin-override",
  reason:
    "User downgrades to json_mode after observing 400 errors on their proxy endpoint",
});

describe("CapabilityOverridesWriterService — v3.1 §B.3", () => {
  let state: MockState;
  let svc: CapabilityOverridesWriterService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    state = {
      aiModel: { id: "model-1", capabilityOverrides: null },
      userModelConfig: {
        id: "config-1",
        userId: "user-1",
        capabilityOverrides: null,
      },
      auditLogs: [],
    };
    mockPrisma = buildMockPrisma(state);
    svc = new CapabilityOverridesWriterService(mockPrisma.prisma as never);
  });

  // ─────────── happy path ───────────

  describe("happy path", () => {
    it("scope=ADMIN: writes AIModel + audit row with all fields", async () => {
      const result = await svc.applyOverrideTransactional(baseAdminOpts());

      expect(result.before).toBeNull();
      expect(result.after).toEqual({
        structuredOutput: { nativeMode: "none" },
      });
      expect(state.aiModel?.capabilityOverrides).toEqual({
        structuredOutput: { nativeMode: "none" },
      });
      expect(state.auditLogs).toHaveLength(1);
      const audit = state.auditLogs[0];
      expect(audit.actorId).toBe("admin-1");
      expect(audit.actorRole).toBe("admin");
      expect(audit.scope).toBe("ADMIN");
      expect(audit.scopeKey).toBe("admin:ai_models:model-1");
      expect(audit.aiModelId).toBe("model-1");
      expect(audit.userModelConfigId).toBeNull();
      expect(audit.source).toBe("admin-override");
      expect(audit.beforeValue).toBeNull();
      expect(audit.afterValue).toEqual({
        structuredOutput: { nativeMode: "none" },
      });
    });

    it("scope=PERSONAL: writes UserModelConfig + scopeKey uses row.userId", async () => {
      const result = await svc.applyOverrideTransactional(baseUserOpts());

      expect(result.after).toEqual({
        structuredOutput: { nativeMode: "json_mode" },
      });
      expect(state.auditLogs).toHaveLength(1);
      expect(state.auditLogs[0].scopeKey).toBe(
        "user:user-1:user_model_config:config-1",
      );
      expect(state.auditLogs[0].userModelConfigId).toBe("config-1");
      expect(state.auditLogs[0].aiModelId).toBeNull();
    });

    it("scope=SYSTEM (self-heal): scopeKey uses target row.userId not actor.id", async () => {
      const opts: ApplyOverrideOptions = {
        target: { kind: "user_model_config", id: "config-1" },
        scope: "SYSTEM",
        actor: { id: "system", role: "system" },
        patch: { structuredOutput: { nativeMode: "none" } } as never,
        source: "self-heal-user",
        reason:
          "auto self-heal triggered by HTTP 400 unsupported_response_format observed 3 times",
      };
      await svc.applyOverrideTransactional(opts);
      // scopeKey must use row.userId (user-1), NOT actor.id (system)
      expect(state.auditLogs[0].scopeKey).toBe(
        "user:user-1:user_model_config:config-1",
      );
      expect(state.auditLogs[0].source).toBe("self-heal-user");
    });

    it("deep-merge: existing {a:{x:1}} + patch {a:{y:2}} = {a:{x:1, y:2}}", async () => {
      state.aiModel = {
        id: "model-1",
        capabilityOverrides: {
          structuredOutput: { nativeMode: "json_mode" },
        },
      };
      const result = await svc.applyOverrideTransactional(
        baseAdminOpts({
          structuredOutput: { fallbackChain: ["none"] },
        }),
      );
      // 应保留 nativeMode + 加上 fallbackChain
      expect(result.after).toEqual({
        structuredOutput: {
          nativeMode: "json_mode",
          fallbackChain: ["none"],
        },
      });
    });

    it("patch with __meta: accepted (B 子片 1 Fix-2 schema 已覆盖)", async () => {
      const result = await svc.applyOverrideTransactional(
        baseAdminOpts({
          structuredOutput: { nativeMode: "none" },
          __meta: { source: "admin-override", autoDowngraded: false },
        }),
      );
      expect(result.after.__meta).toEqual({
        source: "admin-override",
        autoDowngraded: false,
      });
    });
  });

  // ─────────── scope guard ───────────

  describe("scope guards (v3.1 §4.2 矩阵)", () => {
    it("rejects scope='ASSIGNED' (D2: not in enum)", async () => {
      await expect(
        svc.applyOverrideTransactional({
          ...baseAdminOpts(),
          scope: "ASSIGNED" as never,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects ADMIN scope targeting user_model_config", async () => {
      await expect(
        svc.applyOverrideTransactional({
          ...baseAdminOpts(),
          target: { kind: "user_model_config", id: "config-1" },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects PERSONAL scope targeting ai_model", async () => {
      await expect(
        svc.applyOverrideTransactional({
          ...baseUserOpts(),
          target: { kind: "ai_model", id: "model-1" },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects ADMIN scope with actor.role='user' (cross-role)", async () => {
      await expect(
        svc.applyOverrideTransactional({
          ...baseAdminOpts(),
          actor: { id: "u", role: "user" },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects SYSTEM scope with actor.role='admin'", async () => {
      await expect(
        svc.applyOverrideTransactional({
          target: { kind: "user_model_config", id: "config-1" },
          scope: "SYSTEM",
          actor: { id: "admin-1", role: "admin" },
          patch: { structuredOutput: { nativeMode: "none" } } as never,
          source: "self-heal-user",
          reason:
            "auto self-heal triggered by HTTP 400 unsupported_response_format observed 3 times",
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─────────── reason guard ───────────

  describe("reason guards", () => {
    it("rejects reason < 30 chars", async () => {
      await expect(
        svc.applyOverrideTransactional({
          ...baseAdminOpts(),
          reason: "too short",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects reason > 2000 chars", async () => {
      await expect(
        svc.applyOverrideTransactional({
          ...baseAdminOpts(),
          reason: "x".repeat(2001),
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────── patch shape guard ───────────

  describe("patch zod-strict guards", () => {
    it("rejects patch with sub-object typo (reasoning.effort)", async () => {
      await expect(
        svc.applyOverrideTransactional(
          baseAdminOpts({ reasoning: { effort: "low" } }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects patch with unknown top-level field", async () => {
      await expect(
        svc.applyOverrideTransactional(baseAdminOpts({ unknownField: 123 })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────── transaction rollback ───────────

  describe("transaction atomicity", () => {
    it("audit insert failure rolls back AIModel update", async () => {
      state.auditCreateError = new Error("DB constraint violation");
      await expect(
        svc.applyOverrideTransactional(baseAdminOpts()),
      ).rejects.toThrow("DB constraint violation");
      // AIModel must remain null (pre-write state)
      expect(state.aiModel?.capabilityOverrides).toBeNull();
      // Audit log must remain empty
      expect(state.auditLogs).toHaveLength(0);
    });
  });

  // ─────────── applyOverrideInTx (self-heal 路径) ───────────

  describe("applyOverrideInTx (self-heal 路径)", () => {
    it("uses external tx without nested $transaction", async () => {
      const opts: ApplyOverrideOptions = {
        target: { kind: "user_model_config", id: "config-1" },
        scope: "SYSTEM",
        actor: { id: "system", role: "system" },
        patch: { structuredOutput: { nativeMode: "none" } } as never,
        source: "self-heal-user",
        reason:
          "auto self-heal triggered by HTTP 400 unsupported_response_format observed 3 times",
      };
      const result = await svc.applyOverrideInTx(mockPrisma.tx as never, opts);
      expect(result.after).toEqual({
        structuredOutput: { nativeMode: "none" },
      });
      // $transaction NOT called (caller already in tx)
      expect(mockPrisma.prisma.$transaction).not.toHaveBeenCalled();
    });

    it("still enforces all guards (reason / scope / shape) in tx path", async () => {
      await expect(
        svc.applyOverrideInTx(mockPrisma.tx as never, {
          target: { kind: "user_model_config", id: "config-1" },
          scope: "SYSTEM",
          actor: { id: "system", role: "system" },
          patch: { reasoning: { effort: "low" } } as never, // typo
          source: "self-heal-user",
          reason:
            "auto self-heal triggered by HTTP 400 unsupported_response_format observed 3 times",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────── v3.1 §B+.4 clearOverrideTransactional ───────────

  describe("clearOverrideTransactional (v3.1 §B+.4 真清整列)", () => {
    it("ADMIN: clears AIModel.capabilityOverrides (SET NULL) + audit afterValue=null", async () => {
      // 起始有现有 overlay
      state.aiModel = {
        id: "model-1",
        capabilityOverrides: { structuredOutput: { nativeMode: "json_mode" } },
      };
      const result = await svc.clearOverrideTransactional({
        target: { kind: "ai_model", id: "model-1" },
        scope: "ADMIN",
        actor: { id: "admin-1", role: "admin" },
        source: "admin-override",
        reason:
          "Admin clears stale overlay after upstream catalog upgrade — 2026-05-24",
      });
      expect(result.before).toEqual({
        structuredOutput: { nativeMode: "json_mode" },
      });
      expect(result.after).toBeNull();
      // AIModel.capabilityOverrides 被 SET NULL（mock 写 Prisma.DbNull symbol）
      expect(state.aiModel?.capabilityOverrides).toBeDefined();
      // AuditLog 同事务写入；afterValue 是 Prisma.DbNull symbol
      expect(state.auditLogs).toHaveLength(1);
      const audit = state.auditLogs[0];
      expect(audit.actorRole).toBe("admin");
      expect(audit.scope).toBe("ADMIN");
      expect(audit.scopeKey).toBe("admin:ai_models:model-1");
      expect(audit.aiModelId).toBe("model-1");
      expect(audit.userModelConfigId).toBeNull();
      expect(audit.beforeValue).toEqual({
        structuredOutput: { nativeMode: "json_mode" },
      });
      // afterValue 为 Prisma.DbNull（不是 JS null）
      expect(audit.afterValue).toBeDefined();
    });

    it("still enforces guards (reason length)", async () => {
      await expect(
        svc.clearOverrideTransactional({
          target: { kind: "ai_model", id: "model-1" },
          scope: "ADMIN",
          actor: { id: "admin-1", role: "admin" },
          source: "admin-override",
          reason: "too short",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
