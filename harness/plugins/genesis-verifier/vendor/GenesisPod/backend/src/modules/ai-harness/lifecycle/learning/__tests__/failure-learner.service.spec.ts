/**
 * failure-learner.service.spec.ts
 * Tests for FailureLearnerService (DB-backed failure pattern memory).
 */

import { FailureLearnerService } from "../failure-learner.service";

function makePrisma() {
  return {
    harnessFailurePattern: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

const baseKey = {
  agentSpecId: "researcher",
  modelId: "gpt-4o",
  systemPrompt: "You are a researcher",
  failureCode: "PARSE_MALFORMED_JSON",
};

describe("FailureLearnerService", () => {
  // ─── recordFailure ─────────────────────────────────────────────────────────

  describe("recordFailure", () => {
    it("calls prisma.upsert with correct key fields", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      await svc.recordFailure({
        key: baseKey,
        missionId: "m1",
        userId: "u1",
      });
      expect(prisma.harnessFailurePattern.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.harnessFailurePattern.upsert.mock.calls[0][0];
      expect(
        call.where.agentSpecId_modelId_promptHashPrefix_failureCode,
      ).toMatchObject({
        agentSpecId: "researcher",
        modelId: "gpt-4o",
        failureCode: "PARSE_MALFORMED_JSON",
      });
    });

    it("hashes systemPrompt deterministically (same prompt → same hash)", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      await svc.recordFailure({ key: baseKey, missionId: "m1", userId: "u1" });
      await svc.recordFailure({ key: baseKey, missionId: "m2", userId: "u1" });
      const hash1 =
        prisma.harnessFailurePattern.upsert.mock.calls[0][0].where
          .agentSpecId_modelId_promptHashPrefix_failureCode.promptHashPrefix;
      const hash2 =
        prisma.harnessFailurePattern.upsert.mock.calls[1][0].where
          .agentSpecId_modelId_promptHashPrefix_failureCode.promptHashPrefix;
      expect(hash1).toBe(hash2);
    });

    it("different prompts produce different hashes", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      await svc.recordFailure({
        key: { ...baseKey, systemPrompt: "prompt A" },
        missionId: "m1",
        userId: "u1",
      });
      await svc.recordFailure({
        key: { ...baseKey, systemPrompt: "prompt B" },
        missionId: "m1",
        userId: "u1",
      });
      const hash1 =
        prisma.harnessFailurePattern.upsert.mock.calls[0][0].where
          .agentSpecId_modelId_promptHashPrefix_failureCode.promptHashPrefix;
      const hash2 =
        prisma.harnessFailurePattern.upsert.mock.calls[1][0].where
          .agentSpecId_modelId_promptHashPrefix_failureCode.promptHashPrefix;
      expect(hash1).not.toBe(hash2);
    });

    it("includes diagnostic in create and update", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      const diagnostic = { modelId: "gpt-4o", completionTokens: 100 };
      await svc.recordFailure({
        key: baseKey,
        missionId: "m1",
        userId: "u1",
        diagnostic,
      });
      const call = prisma.harnessFailurePattern.upsert.mock.calls[0][0];
      expect(call.create.lastDiagnostic).toEqual(diagnostic);
      expect(call.update.lastDiagnostic).toEqual(diagnostic);
    });

    it("does not throw when prisma upsert fails (swallows error)", async () => {
      const prisma = makePrisma();
      prisma.harnessFailurePattern.upsert.mockRejectedValue(
        new Error("DB down"),
      );
      const svc = new FailureLearnerService(prisma as never);
      await expect(
        svc.recordFailure({ key: baseKey, missionId: "m1", userId: "u1" }),
      ).resolves.toBeUndefined();
    });

    it("sets count=1 in create", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      await svc.recordFailure({ key: baseKey, missionId: "m1", userId: "u1" });
      const call = prisma.harnessFailurePattern.upsert.mock.calls[0][0];
      expect(call.create.count).toBe(1);
    });

    it("uses increment in update", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      await svc.recordFailure({ key: baseKey, missionId: "m1", userId: "u1" });
      const call = prisma.harnessFailurePattern.upsert.mock.calls[0][0];
      expect(call.update.count).toEqual({ increment: 1 });
    });
  });

  // ─── lookup ────────────────────────────────────────────────────────────────

  describe("lookup", () => {
    it("returns empty array when prisma returns nothing", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      const result = await svc.lookup({
        agentSpecId: "researcher",
        systemPrompt: "prompt A",
      });
      expect(result).toEqual([]);
    });

    it("maps prisma records to FailurePatternHit shape", async () => {
      const now = new Date();
      const prisma = makePrisma();
      prisma.harnessFailurePattern.findMany.mockResolvedValue([
        {
          modelId: "gpt-4o",
          failureCode: "PARSE_MALFORMED_JSON",
          count: 3,
          lastFallbackModel: "claude-3-sonnet",
          lastDiagnostic: { x: 1 },
          resolved: false,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      ]);
      const svc = new FailureLearnerService(prisma as never);
      const result = await svc.lookup({
        agentSpecId: "researcher",
        systemPrompt: "prompt",
      });
      expect(result).toHaveLength(1);
      expect(result[0].modelId).toBe("gpt-4o");
      expect(result[0].count).toBe(3);
      expect(result[0].lastFallbackModel).toBe("claude-3-sonnet");
      expect(result[0].resolved).toBe(false);
    });

    it("handles null lastFallbackModel as undefined", async () => {
      const prisma = makePrisma();
      prisma.harnessFailurePattern.findMany.mockResolvedValue([
        {
          modelId: "gpt-4o",
          failureCode: "X",
          count: 1,
          lastFallbackModel: null,
          lastDiagnostic: null,
          resolved: false,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
      ]);
      const svc = new FailureLearnerService(prisma as never);
      const result = await svc.lookup({
        agentSpecId: "researcher",
        systemPrompt: "prompt",
      });
      expect(result[0].lastFallbackModel).toBeUndefined();
    });

    it("passes modelId filter when provided", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      await svc.lookup({
        agentSpecId: "researcher",
        modelId: "gpt-4o",
        systemPrompt: "prompt",
      });
      const call = prisma.harnessFailurePattern.findMany.mock.calls[0][0];
      expect(call.where.modelId).toBe("gpt-4o");
    });

    it("omits modelId filter when not provided", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      await svc.lookup({ agentSpecId: "researcher", systemPrompt: "prompt" });
      const call = prisma.harnessFailurePattern.findMany.mock.calls[0][0];
      expect(call.where.modelId).toBeUndefined();
    });

    it("returns empty array when prisma findMany throws", async () => {
      const prisma = makePrisma();
      prisma.harnessFailurePattern.findMany.mockRejectedValue(
        new Error("DB err"),
      );
      const svc = new FailureLearnerService(prisma as never);
      const result = await svc.lookup({
        agentSpecId: "researcher",
        systemPrompt: "prompt",
      });
      expect(result).toEqual([]);
    });

    it("limits results to 20 records", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      await svc.lookup({ agentSpecId: "researcher", systemPrompt: "prompt" });
      const call = prisma.harnessFailurePattern.findMany.mock.calls[0][0];
      expect(call.take).toBe(20);
    });

    it("orders by lastSeenAt desc", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      await svc.lookup({ agentSpecId: "researcher", systemPrompt: "prompt" });
      const call = prisma.harnessFailurePattern.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ lastSeenAt: "desc" });
    });
  });

  // ─── recordSuccessfulFallback ──────────────────────────────────────────────

  describe("recordSuccessfulFallback", () => {
    it("calls prisma.updateMany with resolved=true and fallbackModelId", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      await svc.recordSuccessfulFallback({
        key: baseKey,
        fallbackModelId: "claude-3-sonnet",
      });
      expect(prisma.harnessFailurePattern.updateMany).toHaveBeenCalledTimes(1);
      const call = prisma.harnessFailurePattern.updateMany.mock.calls[0][0];
      expect(call.data.lastFallbackModel).toBe("claude-3-sonnet");
      expect(call.data.resolved).toBe(true);
    });

    it("uses correct where filter", async () => {
      const prisma = makePrisma();
      const svc = new FailureLearnerService(prisma as never);
      await svc.recordSuccessfulFallback({
        key: baseKey,
        fallbackModelId: "fallback-model",
      });
      const call = prisma.harnessFailurePattern.updateMany.mock.calls[0][0];
      expect(call.where.agentSpecId).toBe("researcher");
      expect(call.where.modelId).toBe("gpt-4o");
      expect(call.where.failureCode).toBe("PARSE_MALFORMED_JSON");
    });

    it("does not throw when prisma updateMany fails", async () => {
      const prisma = makePrisma();
      prisma.harnessFailurePattern.updateMany.mockRejectedValue(
        new Error("DB fail"),
      );
      const svc = new FailureLearnerService(prisma as never);
      await expect(
        svc.recordSuccessfulFallback({
          key: baseKey,
          fallbackModelId: "fallback-model",
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── shouldAutoDisable (E57 单一权威阈值) ────────────────────────────────────
  describe("shouldAutoDisable", () => {
    const svc = new FailureLearnerService(makePrisma() as never);

    it("count < 阈值 → false", () => {
      expect(svc.shouldAutoDisable({ count: 2, resolved: false })).toBe(false);
    });

    it("count >= 阈值 且未 resolved → true", () => {
      expect(svc.shouldAutoDisable({ count: 3, resolved: false })).toBe(true);
      expect(svc.shouldAutoDisable({ count: 9, resolved: false })).toBe(true);
    });

    it("已 resolved → false（即便 count 高也不再禁用）", () => {
      expect(svc.shouldAutoDisable({ count: 99, resolved: true })).toBe(false);
    });
  });
});
