/**
 * ByokMaintenanceScheduler unit tests (v5: drop_distributable_keys)
 *
 * 2026-05-08 v5 删除 resetMonthlyQuotas 测试（池级配额已废）；
 * markStaleAssignments 触发条件改为 AIModel.isEnabled=false。
 */
import { ByokMaintenanceScheduler } from "../byok-maintenance.scheduler";
import { KeyAssignmentStatus } from "@prisma/client";

function makePrisma() {
  return {
    keyAssignment: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
}

function makeKeyAssignments() {
  return {
    computeNextRenewalAt: jest.fn((from: Date) => {
      const next = new Date(from);
      next.setDate(next.getDate() + 30);
      return next;
    }),
  };
}

describe("ByokMaintenanceScheduler (v5)", () => {
  let service: ByokMaintenanceScheduler;
  let prisma: ReturnType<typeof makePrisma>;
  let keyAssignments: ReturnType<typeof makeKeyAssignments>;

  beforeEach(() => {
    prisma = makePrisma();
    keyAssignments = makeKeyAssignments();
    service = new ByokMaintenanceScheduler(
      prisma as unknown as Parameters<
        typeof ByokMaintenanceScheduler.prototype.constructor
      >[0],
      keyAssignments as unknown as Parameters<
        typeof ByokMaintenanceScheduler.prototype.constructor
      >[1],
    );
  });

  describe("expireAssignments", () => {
    it("scopes to validityType='ONE_TIME' (not RECURRING)", async () => {
      prisma.keyAssignment.updateMany.mockResolvedValueOnce({ count: 3 });
      await service.expireAssignments();
      expect(prisma.keyAssignment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: KeyAssignmentStatus.ACTIVE,
            validityType: "ONE_TIME",
            expiresAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
          data: { status: KeyAssignmentStatus.EXPIRED },
        }),
      );
    });

    it("does not throw on count=0", async () => {
      await expect(service.expireAssignments()).resolves.toBeUndefined();
    });

    it("catches errors and does not rethrow", async () => {
      prisma.keyAssignment.updateMany.mockRejectedValueOnce(
        new Error("connection lost"),
      );
      await expect(service.expireAssignments()).resolves.toBeUndefined();
    });
  });

  describe("heartbeat", () => {
    it("completes without error", async () => {
      await expect(service.heartbeat()).resolves.toBeUndefined();
    });
  });

  describe("markStaleAssignments (v5: based on AIModel.isEnabled)", () => {
    it("executes raw SQL ACTIVE→STALE for assignments under disabled models", async () => {
      prisma.$executeRaw.mockResolvedValueOnce(2);
      await service.markStaleAssignments();
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const sqlTemplate = prisma.$executeRaw.mock.calls[0][0];
      const sqlText = Array.isArray(sqlTemplate)
        ? sqlTemplate.join("?")
        : String(sqlTemplate);
      expect(sqlText).toMatch(/SET\s+status\s*=\s*'STALE'/i);
      expect(sqlText).toMatch(/ai_models/);
      expect(sqlText).toMatch(/is_enabled\s*=\s*false/i);
    });

    it("does not do reverse STALE→ACTIVE auto-recovery", async () => {
      prisma.$executeRaw.mockResolvedValueOnce(0);
      await service.markStaleAssignments();
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("catches errors and does not rethrow", async () => {
      prisma.$executeRaw.mockRejectedValueOnce(new Error("DB error"));
      await expect(service.markStaleAssignments()).resolves.toBeUndefined();
    });
  });

  describe("renewRecurringAssignments", () => {
    it("renews via service.computeNextRenewalAt", async () => {
      const dueDate = new Date("2026-05-08T00:00:00Z");
      prisma.keyAssignment.findMany.mockResolvedValueOnce([
        {
          id: "a-1",
          recurrenceUnit: "MONTH",
          recurrenceInterval: 1,
          nextRenewalAt: dueDate,
        },
      ]);
      await service.renewRecurringAssignments();

      expect(keyAssignments.computeNextRenewalAt).toHaveBeenCalledWith(
        dueDate,
        "MONTH",
        1,
      );
      expect(prisma.keyAssignment.update).toHaveBeenCalledWith({
        where: { id: "a-1" },
        data: expect.objectContaining({
          userSpendCents: 0,
          nextRenewalAt: expect.any(Date),
        }),
      });
    });

    it("skips assignment with missing recurrence fields", async () => {
      prisma.keyAssignment.findMany.mockResolvedValueOnce([
        {
          id: "broken",
          recurrenceUnit: null,
          recurrenceInterval: null,
          nextRenewalAt: null,
        },
        {
          id: "a-1",
          recurrenceUnit: "WEEK",
          recurrenceInterval: 1,
          nextRenewalAt: new Date("2026-05-08T00:00:00Z"),
        },
      ]);
      await service.renewRecurringAssignments();
      expect(prisma.keyAssignment.update).toHaveBeenCalledTimes(1);
      expect(prisma.keyAssignment.update.mock.calls[0][0].where.id).toBe("a-1");
    });

    it("single update failure does not block others", async () => {
      prisma.keyAssignment.findMany.mockResolvedValueOnce([
        {
          id: "fail",
          recurrenceUnit: "MONTH",
          recurrenceInterval: 1,
          nextRenewalAt: new Date(),
        },
        {
          id: "ok",
          recurrenceUnit: "MONTH",
          recurrenceInterval: 1,
          nextRenewalAt: new Date(),
        },
      ]);
      prisma.keyAssignment.update
        .mockRejectedValueOnce(new Error("conflict"))
        .mockResolvedValueOnce({});
      await expect(
        service.renewRecurringAssignments(),
      ).resolves.toBeUndefined();
      expect(prisma.keyAssignment.update).toHaveBeenCalledTimes(2);
    });

    it("filters to RECURRING + nextRenewalAt <= now + ACTIVE", async () => {
      await service.renewRecurringAssignments();
      const findArgs = prisma.keyAssignment.findMany.mock.calls[0][0];
      expect(findArgs.where.status).toBe(KeyAssignmentStatus.ACTIVE);
      expect(findArgs.where.validityType).toBe("RECURRING");
      expect(findArgs.where.nextRenewalAt).toEqual(
        expect.objectContaining({ lte: expect.any(Date) }),
      );
    });

    it("catches outer errors", async () => {
      prisma.keyAssignment.findMany.mockRejectedValueOnce(new Error("DB"));
      await expect(
        service.renewRecurringAssignments(),
      ).resolves.toBeUndefined();
    });
  });
});
