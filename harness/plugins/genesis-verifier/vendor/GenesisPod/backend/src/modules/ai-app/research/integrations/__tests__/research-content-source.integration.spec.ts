import { ResearchContentSourceProvider } from "../research-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockPrisma = {
  researchProject: { findMany: mockFindMany, count: mockCount },
} as unknown as PrismaService;

const makeProjectListRow = (
  overrides: Partial<{
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
    _count: { outputs: number };
  }> = {},
) => ({
  id: "proj-1",
  name: "My Research",
  description: "A great project",
  createdAt: new Date("2024-02-01T00:00:00Z"),
  _count: { outputs: 2 },
  ...overrides,
});

const makeProjectBundleRow = (
  overrides: Partial<{
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
    outputs: Array<{ content: string | null; createdAt: Date }>;
    deepResearchSessions: Array<{
      report: unknown;
      query: string;
      createdAt: Date;
    }>;
  }> = {},
) => ({
  id: "proj-1",
  name: "My Research",
  description: "A great project",
  createdAt: new Date("2024-02-01T00:00:00Z"),
  outputs: [],
  deepResearchSessions: [],
  ...overrides,
});

describe("ResearchContentSourceProvider — userId isolation (integration)", () => {
  let provider: ResearchContentSourceProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new ResearchContentSourceProvider(mockPrisma);
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
  });

  it("uses the real ResearchContentSourceProvider class", () => {
    expect(provider).toBeInstanceOf(ResearchContentSourceProvider);
    expect(provider.id).toBe("AI_RESEARCH");
  });

  describe("listItems", () => {
    it("passes userId into where.userId", async () => {
      await provider.listItems("user-b", {});
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-b" }),
        }),
      );
    });

    it("does NOT contain user-a id when called with user-b", async () => {
      await provider.listItems("user-b", {});
      const callArg = mockFindMany.mock.calls[0][0] as { where: unknown };
      expect(JSON.stringify(callArg.where)).toContain("user-b");
      expect(JSON.stringify(callArg.where)).not.toContain("user-a");
    });

    it("filters by status ACTIVE", async () => {
      await provider.listItems("user-b", {});
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "ACTIVE" }),
        }),
      );
    });

    it("maps rows to SourceItem with toISOString()", async () => {
      mockFindMany.mockResolvedValue([makeProjectListRow()]);
      mockCount.mockResolvedValue(1);
      const result = await provider.listItems("user-b", {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("proj-1");
      expect(result.items[0].createdAt).toBe("2024-02-01T00:00:00.000Z");
      expect(result.items[0].contentKind).toBe("report");
    });

    it("returns empty items when prisma returns empty array", async () => {
      const result = await provider.listItems("user-b", {});
      expect(result.items).toEqual([]);
    });
  });

  describe("fetchBundle", () => {
    it("passes userId in where.userId", async () => {
      await provider.fetchBundle(["proj-1", "proj-2"], "user-b");
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["proj-1", "proj-2"] },
            userId: "user-b",
          }),
        }),
      );
    });

    it("does NOT leak user-a id when called with user-b", async () => {
      await provider.fetchBundle(["proj-1"], "user-b");
      const callArg = mockFindMany.mock.calls[0][0] as { where: unknown };
      expect(JSON.stringify(callArg.where)).toContain("user-b");
      expect(JSON.stringify(callArg.where)).not.toContain("user-a");
    });

    it("short-circuits without DB call for empty itemIds", async () => {
      const bundles = await provider.fetchBundle([], "user-b");
      expect(bundles).toEqual([]);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it("maps rows to SourceContentBundle with fallback body", async () => {
      mockFindMany.mockResolvedValue([makeProjectBundleRow()]);
      const bundles = await provider.fetchBundle(["proj-1"], "user-b");
      expect(bundles).toHaveLength(1);
      expect(bundles[0].sourceType).toBe("AI_RESEARCH");
      expect(bundles[0].sourceId).toBe("proj-1");
      expect(bundles[0].bodyMime).toBe("text/markdown");
      expect(bundles[0].body).toContain("My Research");
    });
  });
});
