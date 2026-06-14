/**
 * Unit tests for AgentPlaygroundContentSourceProvider
 *
 * Key scenarios:
 *  1. Static descriptor fields are correct
 *  2. listItems — userId isolation enforced in query
 *  3. listItems — only COMPLETED missions returned (status filter)
 *  4. listItems — running/failed missions do not appear
 *  5. listItems — search filter applied to topic/reportTitle
 *  6. listItems — dateRange filter applied to completedAt
 *  7. listItems — pagination cursor respected
 *  8. listItems — nextCursor set when more items exist
 *  9. listItems — no nextCursor when last page
 * 10. listItems — cross-user isolation (other user's missions not returned)
 * 11. fetchBundle — empty itemIds returns []
 * 12. fetchBundle — cross-user isolation (userId scoped in query)
 * 13. fetchBundle — extracts body from reportFull.content.fullMarkdown (v2)
 * 14. fetchBundle — falls back to reportSummary + topic when fullMarkdown absent
 * 15. fetchBundle — falls back to topic title only when no summary
 * 16. fetchBundle — omits missions not belonging to caller (cross-user isolation)
 * 17. fetchBundle — includes correct sourceType / sourceId
 * 18. fetchBundle — includes correct sourceMetadata fields
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AgentPlaygroundContentSourceProvider } from "../playground-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

function makeMissionRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "mission-1",
    topic: "AI Trends 2026",
    reportTitle: "AI Trends Report",
    reportSummary: "Key findings about AI in 2026.",
    depth: "deep",
    completedAt: new Date("2026-04-01T10:00:00Z"),
    startedAt: new Date("2026-04-01T08:00:00Z"),
    finalScore: 87,
    _count: undefined,
    ...overrides,
  };
}

function makeMissionBundle(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "mission-1",
    topic: "AI Trends 2026",
    reportTitle: "AI Trends Report",
    reportSummary: "Key findings about AI in 2026.",
    reportFull: {
      content: { fullMarkdown: "# AI Trends Report\n\nFull content here." },
      metadata: { topic: "AI Trends 2026" },
    },
    depth: "deep",
    completedAt: new Date("2026-04-01T10:00:00Z"),
    startedAt: new Date("2026-04-01T08:00:00Z"),
    finalScore: 87,
    leaderSigned: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

const mockPrisma = {
  agentPlaygroundMission: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("AgentPlaygroundContentSourceProvider", () => {
  let provider: AgentPlaygroundContentSourceProvider;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentPlaygroundContentSourceProvider,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    provider = module.get<AgentPlaygroundContentSourceProvider>(
      AgentPlaygroundContentSourceProvider,
    );
  });

  // -------------------------------------------------------------------------
  // Descriptor
  // -------------------------------------------------------------------------

  describe("static descriptor", () => {
    it("has id = AI_PLAYGROUND", () => {
      expect(provider.id).toBe("AI_PLAYGROUND");
    });

    it("has icon = Bot", () => {
      expect(provider.icon).toBe("Bot");
    });

    it("exposes report and article contentKinds", () => {
      expect(provider.contentKinds).toContain("report");
      expect(provider.contentKinds).toContain("article");
    });

    it("has maxItemsPerTask = 10", () => {
      expect(provider.maxItemsPerTask).toBe(10);
    });

    it("has zh-CN and en-US display names", () => {
      expect(provider.displayName["zh-CN"]).toBeTruthy();
      expect(provider.displayName["en-US"]).toBeTruthy();
    });

    it("has zh-CN and en-US descriptions", () => {
      expect(provider.description["zh-CN"]).toBeTruthy();
      expect(provider.description["en-US"]).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // listItems
  // -------------------------------------------------------------------------

  describe("listItems", () => {
    it("queries only the caller's missions (userId isolation)", async () => {
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([]);
      mockPrisma.agentPlaygroundMission.count.mockResolvedValue(0);

      await provider.listItems("user-A", {});

      expect(mockPrisma.agentPlaygroundMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-A" }),
        }),
      );
    });

    it("filters status = 'completed' (only completed missions)", async () => {
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([]);
      mockPrisma.agentPlaygroundMission.count.mockResolvedValue(0);

      await provider.listItems("user-A", {});

      const call = mockPrisma.agentPlaygroundMission.findMany.mock.calls[0][0];
      expect(call.where.status).toBe("completed");
    });

    it("running/failed missions are excluded by status filter", async () => {
      // Prisma enforces status = 'completed' — so running/failed rows never appear.
      // We verify the where clause contains the status constraint.
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([]);
      mockPrisma.agentPlaygroundMission.count.mockResolvedValue(0);

      await provider.listItems("user-A", {});

      const call = mockPrisma.agentPlaygroundMission.findMany.mock.calls[0][0];
      expect(call.where.status).toBe("completed");
      expect(call.where.status).not.toBe("running");
      expect(call.where.status).not.toBe("failed");
    });

    it("requires reportFull to be non-null", async () => {
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([]);
      mockPrisma.agentPlaygroundMission.count.mockResolvedValue(0);

      await provider.listItems("user-A", {});

      const call = mockPrisma.agentPlaygroundMission.findMany.mock.calls[0][0];
      expect(call.where.reportFull).toEqual({ not: null });
    });

    it("returns mapped SourceItems with contentKind = report", async () => {
      const mission = makeMissionRow();
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([mission]);
      mockPrisma.agentPlaygroundMission.count.mockResolvedValue(1);

      const result = await provider.listItems("user-A", {});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "mission-1",
        title: "AI Trends Report",
        contentKind: "report",
      });
    });

    it("uses topic as title fallback when reportTitle is null", async () => {
      const mission = makeMissionRow({ reportTitle: null });
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([mission]);
      mockPrisma.agentPlaygroundMission.count.mockResolvedValue(1);

      const result = await provider.listItems("user-A", {});

      expect(result.items[0].title).toBe("AI Trends 2026");
    });

    it("applies search filter to the query", async () => {
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([]);
      mockPrisma.agentPlaygroundMission.count.mockResolvedValue(0);

      await provider.listItems("user-A", { search: "climate" });

      const call = mockPrisma.agentPlaygroundMission.findMany.mock.calls[0][0];
      expect(call.where).toHaveProperty("OR");
    });

    it("applies dateRange filter on completedAt when provided", async () => {
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([]);
      mockPrisma.agentPlaygroundMission.count.mockResolvedValue(0);

      await provider.listItems("user-A", {
        dateRange: { from: "2026-01-01", to: "2026-12-31" },
      });

      const call = mockPrisma.agentPlaygroundMission.findMany.mock.calls[0][0];
      expect(call.where).toHaveProperty("completedAt");
    });

    it("respects cursor for pagination (skip offset)", async () => {
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([]);
      mockPrisma.agentPlaygroundMission.count.mockResolvedValue(5);

      await provider.listItems("user-A", { cursor: "10" });

      const call = mockPrisma.agentPlaygroundMission.findMany.mock.calls[0][0];
      expect(call.skip).toBe(10);
    });

    it("sets nextCursor when more items exist beyond limit", async () => {
      const missions = Array.from({ length: 6 }, (_, i) =>
        makeMissionRow({ id: `mission-${i}` }),
      );
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue(missions);
      mockPrisma.agentPlaygroundMission.count.mockResolvedValue(20);

      const result = await provider.listItems("user-A", { limit: 5 });

      expect(result.items).toHaveLength(5);
      expect(result.nextCursor).toBe("5");
    });

    it("does not set nextCursor when all items are on one page", async () => {
      const missions = [makeMissionRow()];
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue(missions);
      mockPrisma.agentPlaygroundMission.count.mockResolvedValue(1);

      const result = await provider.listItems("user-A", { limit: 10 });

      expect(result.nextCursor).toBeUndefined();
    });

    it("does not return another user's missions (cross-user isolation)", async () => {
      // Prisma enforces userId: 'user-A' — nothing from user-B comes back
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([]);
      mockPrisma.agentPlaygroundMission.count.mockResolvedValue(0);

      const result = await provider.listItems("user-A", {});

      const call = mockPrisma.agentPlaygroundMission.findMany.mock.calls[0][0];
      expect(call.where.userId).toBe("user-A");
      expect(call.where.userId).not.toBe("user-B");
      expect(result.items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // fetchBundle
  // -------------------------------------------------------------------------

  describe("fetchBundle", () => {
    it("returns empty array when itemIds is empty", async () => {
      const result = await provider.fetchBundle([], "user-A");
      expect(result).toEqual([]);
      expect(mockPrisma.agentPlaygroundMission.findMany).not.toHaveBeenCalled();
    });

    it("scopes query to userId (cross-user isolation guard)", async () => {
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([]);

      await provider.fetchBundle(["mission-1", "mission-2"], "user-A");

      const call = mockPrisma.agentPlaygroundMission.findMany.mock.calls[0][0];
      expect(call.where).toMatchObject({
        id: { in: ["mission-1", "mission-2"] },
        userId: "user-A",
        status: "completed",
      });
    });

    it("omits missions not belonging to the caller (cross-user isolation result)", async () => {
      // Prisma returns only mission-1 (belongs to user-A); mission-99 silently dropped
      const mission = makeMissionBundle({ id: "mission-1" });
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([mission]);

      const result = await provider.fetchBundle(
        ["mission-1", "mission-99"],
        "user-A",
      );

      expect(result).toHaveLength(1);
      expect(result[0].sourceId).toBe("mission-1");
    });

    it("extracts body from reportFull.content.fullMarkdown (v2 artifact)", async () => {
      const mission = makeMissionBundle();
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([mission]);

      const [bundle] = await provider.fetchBundle(["mission-1"], "user-A");

      expect(bundle.body).toBe("# AI Trends Report\n\nFull content here.");
      expect(bundle.bodyMime).toBe("text/markdown");
    });

    it("falls back to reportSummary + topic when fullMarkdown is absent", async () => {
      const mission = makeMissionBundle({
        reportFull: { content: {} }, // no fullMarkdown
      });
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([mission]);

      const [bundle] = await provider.fetchBundle(["mission-1"], "user-A");

      expect(bundle.body).toContain("AI Trends Report");
      expect(bundle.body).toContain("Key findings about AI in 2026.");
    });

    it("falls back gracefully when reportFull is null", async () => {
      const mission = makeMissionBundle({ reportFull: null });
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([mission]);

      const [bundle] = await provider.fetchBundle(["mission-1"], "user-A");

      // Should not throw; body contains at least the title
      expect(bundle.body).toContain("AI Trends Report");
    });

    it("uses topic as title fallback when reportTitle is null", async () => {
      const mission = makeMissionBundle({
        reportTitle: null,
        reportFull: null,
      });
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([mission]);

      const [bundle] = await provider.fetchBundle(["mission-1"], "user-A");

      expect(bundle.title).toBe("AI Trends 2026");
      expect(bundle.body).toContain("AI Trends 2026");
    });

    it("includes correct sourceType and sourceId", async () => {
      const mission = makeMissionBundle();
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([mission]);

      const [bundle] = await provider.fetchBundle(["mission-1"], "user-A");

      expect(bundle.sourceType).toBe("AI_PLAYGROUND");
      expect(bundle.sourceId).toBe("mission-1");
    });

    it("includes missionId, completedAt, depth, finalScore in sourceMetadata", async () => {
      const mission = makeMissionBundle();
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([mission]);

      const [bundle] = await provider.fetchBundle(["mission-1"], "user-A");

      expect(bundle.sourceMetadata).toMatchObject({
        missionId: "mission-1",
        completedAt: "2026-04-01T10:00:00.000Z",
        depth: "deep",
        finalScore: 87,
      });
    });

    it("uses startedAt as completedAt fallback in sourceMetadata", async () => {
      const mission = makeMissionBundle({ completedAt: null });
      mockPrisma.agentPlaygroundMission.findMany.mockResolvedValue([mission]);

      const [bundle] = await provider.fetchBundle(["mission-1"], "user-A");

      expect(bundle.sourceMetadata.completedAt).toBe(
        "2026-04-01T08:00:00.000Z",
      );
    });
  });
});
