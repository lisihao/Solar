/**
 * Unit tests for ResearchContentSourceProvider
 *
 * Key scenarios:
 *  1. listItems — basic listing with userId isolation
 *  2. listItems — search filter
 *  3. listItems — date-range filter
 *  4. listItems — pagination (cursor)
 *  5. listItems — cross-user isolation (other user's projects not returned)
 *  6. fetchBundle — returns output content when available
 *  7. fetchBundle — falls back to DeepResearchSession report
 *  8. fetchBundle — falls back to project metadata when no output/session
 *  9. fetchBundle — cross-user isolation (projects not belonging to userId omitted)
 * 10. fetchBundle — empty itemIds returns []
 * 11. Static descriptor fields are correct
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ResearchContentSourceProvider } from "../research-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Test Project",
    description: "A description",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    _count: { outputs: 2 },
    ...overrides,
  };
}

function makeProjectWithRelations(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Test Project",
    description: "A description",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    outputs: [],
    deepResearchSessions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

const mockPrisma = {
  researchProject: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ResearchContentSourceProvider", () => {
  let provider: ResearchContentSourceProvider;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchContentSourceProvider,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    provider = module.get<ResearchContentSourceProvider>(
      ResearchContentSourceProvider,
    );
  });

  // -------------------------------------------------------------------------
  // Descriptor
  // -------------------------------------------------------------------------

  describe("static descriptor", () => {
    it("has the correct id", () => {
      expect(provider.id).toBe("AI_RESEARCH");
    });

    it("has the correct icon", () => {
      expect(provider.icon).toBe("FlaskConical");
    });

    it("exposes only 'report' contentKind", () => {
      expect(provider.contentKinds).toEqual(["report"]);
    });

    it("has maxItemsPerTask = 10", () => {
      expect(provider.maxItemsPerTask).toBe(10);
    });

    it("has zh-CN and en-US display names", () => {
      expect(provider.displayName["zh-CN"]).toBeTruthy();
      expect(provider.displayName["en-US"]).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // listItems
  // -------------------------------------------------------------------------

  describe("listItems", () => {
    it("queries only the caller's projects (userId isolation)", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);
      mockPrisma.researchProject.count.mockResolvedValue(0);

      await provider.listItems("user-A", {});

      expect(mockPrisma.researchProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-A" }),
        }),
      );
    });

    it("returns mapped SourceItems with contentKind = report", async () => {
      const project = makeProject();
      mockPrisma.researchProject.findMany.mockResolvedValue([project]);
      mockPrisma.researchProject.count.mockResolvedValue(1);

      const result = await provider.listItems("user-A", {});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "proj-1",
        title: "Test Project",
        contentKind: "report",
      });
    });

    it("applies search filter to the query", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);
      mockPrisma.researchProject.count.mockResolvedValue(0);

      await provider.listItems("user-A", { search: "climate" });

      const call = mockPrisma.researchProject.findMany.mock.calls[0][0];
      expect(call.where).toHaveProperty("OR");
    });

    it("applies dateRange filter when provided", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);
      mockPrisma.researchProject.count.mockResolvedValue(0);

      await provider.listItems("user-A", {
        dateRange: { from: "2026-01-01", to: "2026-12-31" },
      });

      const call = mockPrisma.researchProject.findMany.mock.calls[0][0];
      expect(call.where).toHaveProperty("createdAt");
    });

    it("sets nextCursor when more items exist", async () => {
      // Return limit+1 items to trigger hasMore
      const items = Array.from({ length: 6 }, (_, i) =>
        makeProject({ id: `proj-${i}` }),
      );
      mockPrisma.researchProject.findMany.mockResolvedValue(items);
      mockPrisma.researchProject.count.mockResolvedValue(20);

      const result = await provider.listItems("user-A", { limit: 5 });

      expect(result.items).toHaveLength(5);
      expect(result.nextCursor).toBe("5");
    });

    it("does not set nextCursor when all items are on the page", async () => {
      const items = [makeProject()];
      mockPrisma.researchProject.findMany.mockResolvedValue(items);
      mockPrisma.researchProject.count.mockResolvedValue(1);

      const result = await provider.listItems("user-A", { limit: 10 });

      expect(result.nextCursor).toBeUndefined();
    });

    it("respects cursor for pagination", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);
      mockPrisma.researchProject.count.mockResolvedValue(5);

      await provider.listItems("user-A", { cursor: "10" });

      const call = mockPrisma.researchProject.findMany.mock.calls[0][0];
      expect(call.skip).toBe(10);
    });

    it("does not return another user's projects (cross-user isolation)", async () => {
      // Simulate Prisma enforcing userId: 'user-A' — returns nothing for user-B data
      mockPrisma.researchProject.findMany.mockResolvedValue([]);
      mockPrisma.researchProject.count.mockResolvedValue(0);

      const result = await provider.listItems("user-A", {});

      // The where clause must NOT contain userId: 'user-B'
      const call = mockPrisma.researchProject.findMany.mock.calls[0][0];
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
      expect(mockPrisma.researchProject.findMany).not.toHaveBeenCalled();
    });

    it("scopes query to userId (cross-user isolation)", async () => {
      mockPrisma.researchProject.findMany.mockResolvedValue([]);

      await provider.fetchBundle(["proj-1", "proj-2"], "user-A");

      const call = mockPrisma.researchProject.findMany.mock.calls[0][0];
      expect(call.where).toMatchObject({
        id: { in: ["proj-1", "proj-2"] },
        userId: "user-A",
      });
    });

    it("uses output content when a COMPLETED REPORT output exists", async () => {
      const project = makeProjectWithRelations({
        outputs: [
          {
            content: "# Report Content\n\nDetails here.",
            createdAt: new Date(),
          },
        ],
        deepResearchSessions: [],
      });
      mockPrisma.researchProject.findMany.mockResolvedValue([project]);

      const [bundle] = await provider.fetchBundle(["proj-1"], "user-A");

      expect(bundle.body).toBe("# Report Content\n\nDetails here.");
      expect(bundle.bodyMime).toBe("text/markdown");
    });

    it("falls back to DeepResearchSession report when no output", async () => {
      const report = {
        executiveSummary: "Key findings.",
        sections: [{ title: "Intro", content: "Background info." }],
        conclusion: "Final thoughts.",
      };
      const project = makeProjectWithRelations({
        outputs: [],
        deepResearchSessions: [
          { report, query: "Climate change trends", createdAt: new Date() },
        ],
      });
      mockPrisma.researchProject.findMany.mockResolvedValue([project]);

      const [bundle] = await provider.fetchBundle(["proj-1"], "user-A");

      expect(bundle.body).toContain("Climate change trends");
      expect(bundle.body).toContain("Key findings.");
      expect(bundle.body).toContain("Intro");
      expect(bundle.body).toContain("Final thoughts.");
    });

    it("falls back to project metadata when no output and no session", async () => {
      const project = makeProjectWithRelations({
        outputs: [],
        deepResearchSessions: [],
      });
      mockPrisma.researchProject.findMany.mockResolvedValue([project]);

      const [bundle] = await provider.fetchBundle(["proj-1"], "user-A");

      expect(bundle.body).toContain("Test Project");
      expect(bundle.body).toContain("A description");
    });

    it("omits projects that do not belong to the caller (cross-user isolation)", async () => {
      // Prisma returns only the project that belongs to user-A (proj-1),
      // not proj-99 which would belong to user-B
      const project = makeProjectWithRelations({ id: "proj-1" });
      mockPrisma.researchProject.findMany.mockResolvedValue([project]);

      const result = await provider.fetchBundle(
        ["proj-1", "proj-99"],
        "user-A",
      );

      // Only 1 bundle returned (proj-99 filtered out by userId constraint)
      expect(result).toHaveLength(1);
      expect(result[0].sourceId).toBe("proj-1");
    });

    it("includes correct sourceType and sourceId in the bundle", async () => {
      const project = makeProjectWithRelations();
      mockPrisma.researchProject.findMany.mockResolvedValue([project]);

      const [bundle] = await provider.fetchBundle(["proj-1"], "user-A");

      expect(bundle.sourceType).toBe("AI_RESEARCH");
      expect(bundle.sourceId).toBe("proj-1");
    });

    it("handles DeepResearchSession report with missing fields gracefully", async () => {
      const project = makeProjectWithRelations({
        outputs: [],
        deepResearchSessions: [
          { report: {}, query: "Sparse query", createdAt: new Date() },
        ],
      });
      mockPrisma.researchProject.findMany.mockResolvedValue([project]);

      const [bundle] = await provider.fetchBundle(["proj-1"], "user-A");

      // Should not throw and should at minimum contain the query
      expect(bundle.body).toContain("Sparse query");
    });
  });
});
