/**
 * FeatureFlagService spec — PR-A6 (2026-05-07)
 *
 * 反向证据：
 *   1. isEnabled —— 无 grant → false
 *   2. isEnabled —— enabled=false → false
 *   3. isEnabled —— expiresAt 已过期 → false
 *   4. isEnabled —— enabled=true + 未过期 → true
 *   5. isEnabled —— DB 故障 → false（不抛错）
 *   6. listEnabledForWorkspace —— 仅返回 enabled=true 且未过期
 *   7. grant —— 新 grant 写 grant 表 + audit log(action=grant)
 *   8. grant —— 已存在改 audit log(action=update)
 *   9. revoke —— 写 enabled=false + audit log(action=revoke)
 *  10. revoke —— 没 prior grant 仍写 audit log（管理员看到尝试）
 */

import { Logger } from "@nestjs/common";
import { FeatureFlagService } from "../feature-flag.service";
import type { PrismaService } from "../../prisma/prisma.service";

beforeAll(() => {
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
});

interface MockPrisma {
  featureFlagWorkspaceGrant: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
  };
  featureFlagAuditLog: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makeMockPrisma(): MockPrisma {
  const m: MockPrisma = {
    featureFlagWorkspaceGrant: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    featureFlagAuditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  };
  // 默认 $transaction 把 callback 当 tx 直接执行
  m.$transaction.mockImplementation(async (cb: (tx: typeof m) => unknown) =>
    cb(m),
  );
  return m;
}

function makeService(prisma: MockPrisma) {
  return new FeatureFlagService(prisma as unknown as PrismaService);
}

describe("FeatureFlagService", () => {
  describe("isEnabled", () => {
    it("无 grant → false（默认灰度关闭）", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockResolvedValue(null);
      const svc = makeService(prisma);
      expect(await svc.isEnabled("FLAG_X", "ws-1")).toBe(false);
    });

    it("enabled=false → false", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockResolvedValue({
        enabled: false,
        expiresAt: null,
      });
      const svc = makeService(prisma);
      expect(await svc.isEnabled("FLAG_X", "ws-1")).toBe(false);
    });

    it("expiresAt 已过期 → false", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockResolvedValue({
        enabled: true,
        expiresAt: new Date(Date.now() - 1000), // 1s 前
      });
      const svc = makeService(prisma);
      expect(await svc.isEnabled("FLAG_X", "ws-1")).toBe(false);
    });

    it("enabled=true + 未过期 → true", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockResolvedValue({
        enabled: true,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h 后
      });
      const svc = makeService(prisma);
      expect(await svc.isEnabled("FLAG_X", "ws-1")).toBe(true);
    });

    it("expiresAt=null → 永久有效", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockResolvedValue({
        enabled: true,
        expiresAt: null,
      });
      const svc = makeService(prisma);
      expect(await svc.isEnabled("FLAG_X", "ws-1")).toBe(true);
    });

    it("DB 故障 → fall back 到 false（不抛错）", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockRejectedValue(
        new Error("DB down"),
      );
      const svc = makeService(prisma);
      expect(await svc.isEnabled("FLAG_X", "ws-1")).toBe(false);
    });
  });

  describe("listEnabledForWorkspace", () => {
    it("过滤 enabled=true 且未过期", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findMany.mockResolvedValue([
        { flagKey: "F1", enabled: true, expiresAt: null },
        {
          flagKey: "F2",
          enabled: true,
          expiresAt: new Date(Date.now() - 1000), // 已过期
        },
        {
          flagKey: "F3",
          enabled: true,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ]);
      const svc = makeService(prisma);
      const result = await svc.listEnabledForWorkspace("ws-1");
      expect(result).toEqual(["F1", "F3"]);
    });

    it("DB 故障 → 空数组（degrade）", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findMany.mockRejectedValue(
        new Error("DB down"),
      );
      const svc = makeService(prisma);
      expect(await svc.listEnabledForWorkspace("ws-1")).toEqual([]);
    });
  });

  describe("grant", () => {
    it("新 grant 写 audit log(action=grant)", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockResolvedValue(null);
      const svc = makeService(prisma);
      await svc.grant({
        flagKey: "FLAG_X",
        workspaceId: "ws-1",
        enabled: true,
        grantedBy: "admin-1",
        reason: "rollout",
      });
      expect(prisma.featureFlagWorkspaceGrant.upsert).toHaveBeenCalled();
      expect(prisma.featureFlagAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          flagKey: "FLAG_X",
          action: "grant",
          actorUserId: "admin-1",
          prevEnabled: null,
          nextEnabled: true,
          reason: "rollout",
        }),
      });
    });

    it("已存在 grant 改 audit log(action=update) + 记录 prevEnabled", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockResolvedValue({
        enabled: false,
      });
      const svc = makeService(prisma);
      await svc.grant({
        flagKey: "FLAG_X",
        workspaceId: "ws-1",
        enabled: true,
        grantedBy: "admin-1",
      });
      expect(prisma.featureFlagAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "update",
          prevEnabled: false,
          nextEnabled: true,
        }),
      });
    });

    it("返回 (prevEnabled, nextEnabled) 二元组让 caller emit event", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockResolvedValue({
        enabled: false,
      });
      const svc = makeService(prisma);
      const r = await svc.grant({
        flagKey: "FLAG_X",
        workspaceId: "ws-1",
        enabled: true,
        grantedBy: "admin-1",
      });
      expect(r).toEqual({ prevEnabled: false, nextEnabled: true });
    });
  });

  describe("revoke", () => {
    it("写 grant.enabled=false + audit log(action=revoke)", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockResolvedValue({
        enabled: true,
      });
      const svc = makeService(prisma);
      await svc.revoke({
        flagKey: "FLAG_X",
        workspaceId: "ws-1",
        actorUserId: "admin-1",
        reason: "rollback bug",
      });
      expect(prisma.featureFlagWorkspaceGrant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            flagKey_workspaceId: {
              flagKey: "FLAG_X",
              workspaceId: "ws-1",
            },
          },
          data: { enabled: false },
        }),
      );
      expect(prisma.featureFlagAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "revoke",
          prevEnabled: true,
          nextEnabled: false,
          reason: "rollback bug",
        }),
      });
    });

    it("没 prior grant 仍写 audit log（管理员看到尝试）", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockResolvedValue(null);
      const svc = makeService(prisma);
      await svc.revoke({
        flagKey: "FLAG_X",
        workspaceId: "ws-1",
        actorUserId: "admin-1",
      });
      expect(prisma.featureFlagWorkspaceGrant.update).not.toHaveBeenCalled();
      expect(prisma.featureFlagAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "revoke",
          prevEnabled: null,
          nextEnabled: false,
          reason: "no-prior-grant",
        }),
      });
    });
  });

  // ★ R2 共识 P1 (tester): audit log 写入失败 → 整事务回滚（grant 不应单独成功）
  describe("audit log 失败 → 事务回滚（不留 grant 与 audit 不一致）", () => {
    it("grant 时 auditLog.create 抛错 → 整事务 throw（grant 不留 partial state）", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockResolvedValue(null);
      prisma.featureFlagAuditLog.create.mockRejectedValue(
        new Error("audit table down"),
      );
      const svc = makeService(prisma);
      await expect(
        svc.grant({
          flagKey: "FLAG_X",
          workspaceId: "ws-1",
          enabled: true,
          grantedBy: "admin-1",
        }),
      ).rejects.toThrow(/audit table down/);
      // grant.upsert 因 mock $transaction 同步执行已经被 call，但真 prisma
      // tx 里整体回滚 — 此 spec 验证 service 不吞错（caller 能感知失败）
    });

    it("revoke 时 auditLog.create 抛错 → 整事务 throw", async () => {
      const prisma = makeMockPrisma();
      prisma.featureFlagWorkspaceGrant.findUnique.mockResolvedValue({
        enabled: true,
      });
      prisma.featureFlagAuditLog.create.mockRejectedValue(
        new Error("audit table down"),
      );
      const svc = makeService(prisma);
      await expect(
        svc.revoke({
          flagKey: "FLAG_X",
          workspaceId: "ws-1",
          actorUserId: "admin-1",
        }),
      ).rejects.toThrow(/audit table down/);
    });
  });
});
