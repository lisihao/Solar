import { Logger } from "@nestjs/common";
import { AuditLogService } from "./audit-log.service";

function makePrisma() {
  return {
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: "audit-1" }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

describe("AuditLogService", () => {
  describe("record", () => {
    it("append-only writes one row to auditLog with mapped fields", async () => {
      const prisma = makePrisma();
      const service = new AuditLogService(prisma as never);

      await service.record({
        actorUserId: "user-1",
        action: "credit.freeze",
        resourceType: "credit_account",
        resourceId: "user-1",
        result: "success",
        ip: "1.2.3.4",
        traceId: "trace-9",
        metadata: { reason: "abuse" },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: "user-1",
          action: "credit.freeze",
          resourceType: "credit_account",
          resourceId: "user-1",
          result: "success",
          ip: "1.2.3.4",
          traceId: "trace-9",
          metadata: { reason: "abuse" },
        }),
      });
    });

    it("defaults actorUserId to null and metadata to {} when omitted", async () => {
      const prisma = makePrisma();
      const service = new AuditLogService(prisma as never);

      await service.record({
        action: "secret.access",
        resourceType: "secret",
        result: "success",
      });

      const arg = prisma.auditLog.create.mock.calls[0][0].data;
      expect(arg.actorUserId).toBeNull();
      expect(arg.metadata).toEqual({});
    });

    it("does not throw when DB write fails; warns with audit_write_failed", async () => {
      const prisma = makePrisma();
      prisma.auditLog.create.mockRejectedValue(new Error("db down"));
      const warnSpy = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);
      const service = new AuditLogService(prisma as never);

      await expect(
        service.record({
          action: "mission.delete",
          resourceType: "agent_playground_mission",
          result: "success",
        }),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("audit_write_failed"),
      );
      warnSpy.mockRestore();
    });
  });

  describe("query", () => {
    it("filters by actorUserId/action and returns items + total", async () => {
      const prisma = makePrisma();
      prisma.auditLog.findMany.mockResolvedValue([{ id: "audit-1" }]);
      prisma.auditLog.count.mockResolvedValue(1);
      const service = new AuditLogService(prisma as never);

      const result = await service.query({
        actorUserId: "user-1",
        action: "secret.access",
        limit: 10,
      });

      expect(result).toEqual({ items: [{ id: "audit-1" }], total: 1 });
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            actorUserId: "user-1",
            action: "secret.access",
          }),
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      );
    });
  });
});
