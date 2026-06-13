import { AgentPlaygroundContentSourceProvider } from "../playground-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockPrisma = {
  agentPlaygroundMission: { findMany: mockFindMany, count: mockCount },
} as unknown as PrismaService;

const makeMissionListRow = (
  overrides: Partial<{
    id: string;
    topic: string;
    reportTitle: string | null;
    reportSummary: string | null;
    completedAt: Date | null;
    startedAt: Date;
    finalScore: number | null;
    depth: string;
  }> = {},
) => ({
  id: "mission-1",
  topic: "AI Trends",
  reportTitle: "AI in 2024",
  reportSummary: "A comprehensive overview",
  completedAt: new Date("2024-07-01T00:00:00Z"),
  startedAt: new Date("2024-06-30T00:00:00Z"),
  finalScore: 85,
  depth: "standard",
  ...overrides,
});

const makeMissionBundleRow = (
  overrides: Partial<{
    id: string;
    topic: string;
    reportTitle: string | null;
    reportSummary: string | null;
    reportFull: unknown;
    completedAt: Date | null;
    startedAt: Date;
    depth: string;
    finalScore: number | null;
    leaderSigned: boolean | null;
  }> = {},
) => ({
  id: "mission-1",
  topic: "AI Trends",
  reportTitle: "AI in 2024",
  reportSummary: "A comprehensive overview",
  reportFull: null,
  completedAt: new Date("2024-07-01T00:00:00Z"),
  startedAt: new Date("2024-06-30T00:00:00Z"),
  depth: "standard",
  finalScore: 85,
  leaderSigned: true,
  ...overrides,
});

describe("AgentPlaygroundContentSourceProvider — userId isolation (integration)", () => {
  let provider: AgentPlaygroundContentSourceProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new AgentPlaygroundContentSourceProvider(mockPrisma);
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
  });

  it("uses the real AgentPlaygroundContentSourceProvider class", () => {
    expect(provider).toBeInstanceOf(AgentPlaygroundContentSourceProvider);
    expect(provider.id).toBe("AI_PLAYGROUND");
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

    it("filters by status completed", async () => {
      await provider.listItems("user-b", {});
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "completed" }),
        }),
      );
    });

    it("maps mission rows to SourceItem with contentKind report", async () => {
      mockFindMany.mockResolvedValue([makeMissionListRow()]);
      mockCount.mockResolvedValue(1);
      const result = await provider.listItems("user-b", {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("mission-1");
      expect(result.items[0].contentKind).toBe("report");
      expect(result.items[0].createdAt).toBe("2024-07-01T00:00:00.000Z");
    });

    it("returns empty items when prisma returns empty array", async () => {
      const result = await provider.listItems("user-b", {});
      expect(result.items).toEqual([]);
    });
  });

  describe("fetchBundle", () => {
    it("passes userId and status:completed in where", async () => {
      await provider.fetchBundle(["mission-1", "mission-2"], "user-b");
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["mission-1", "mission-2"] },
            userId: "user-b",
            status: "completed",
          }),
        }),
      );
    });

    it("does NOT leak user-a id when called with user-b", async () => {
      await provider.fetchBundle(["mission-1"], "user-b");
      const callArg = mockFindMany.mock.calls[0][0] as { where: unknown };
      expect(JSON.stringify(callArg.where)).toContain("user-b");
      expect(JSON.stringify(callArg.where)).not.toContain("user-a");
    });

    it("short-circuits without DB call for empty itemIds", async () => {
      const bundles = await provider.fetchBundle([], "user-b");
      expect(bundles).toEqual([]);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it("maps mission rows to SourceContentBundle with markdown bodyMime", async () => {
      mockFindMany.mockResolvedValue([makeMissionBundleRow()]);
      const bundles = await provider.fetchBundle(["mission-1"], "user-b");
      expect(bundles).toHaveLength(1);
      expect(bundles[0].sourceType).toBe("AI_PLAYGROUND");
      expect(bundles[0].sourceId).toBe("mission-1");
      expect(bundles[0].bodyMime).toBe("text/markdown");
      expect(bundles[0].sourceMetadata).toMatchObject({ depth: "standard" });
    });
  });
});
