import { TopicInsightsContentSourceProvider } from "../topic-insights-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

const mockFindMany = jest.fn();
const mockPrisma = {
  researchTopic: { findMany: mockFindMany },
} as unknown as PrismaService;

const makeTopicListRow = (
  overrides: Partial<{
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
    reports: Array<{ executiveSummary: string; totalSources: number }>;
  }> = {},
) => ({
  id: "topic-1",
  name: "My Topic",
  description: "A topic description",
  createdAt: new Date("2024-06-01T00:00:00Z"),
  reports: [],
  ...overrides,
});

const makeTopicBundleRow = (
  overrides: Partial<{
    id: string;
    name: string;
    description: string | null;
    type: string;
    topicConfig: unknown;
    createdAt: Date;
    updatedAt: Date;
    reports: Array<{
      version: number;
      executiveSummary: string;
      fullReport: string;
      totalSources: number;
      generatedAt: Date;
    }>;
  }> = {},
) => ({
  id: "topic-1",
  name: "My Topic",
  description: "A topic description",
  type: "CUSTOM",
  topicConfig: null,
  createdAt: new Date("2024-06-01T00:00:00Z"),
  updatedAt: new Date("2024-06-01T00:00:00Z"),
  reports: [],
  ...overrides,
});

describe("TopicInsightsContentSourceProvider — userId isolation (integration)", () => {
  let provider: TopicInsightsContentSourceProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new TopicInsightsContentSourceProvider(mockPrisma);
    mockFindMany.mockResolvedValue([]);
  });

  it("uses the real TopicInsightsContentSourceProvider class", () => {
    expect(provider).toBeInstanceOf(TopicInsightsContentSourceProvider);
    expect(provider.id).toBe("AI_TOPIC_INSIGHTS");
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

    it("excludes ARCHIVED status in where", async () => {
      await provider.listItems("user-b", {});
      const callArg = mockFindMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(callArg.where).toMatchObject({ status: { not: "ARCHIVED" } });
    });

    it("maps topic rows to SourceItem with contentKind note", async () => {
      mockFindMany.mockResolvedValue([makeTopicListRow()]);
      const result = await provider.listItems("user-b", {});
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("topic-1");
      expect(result.items[0].contentKind).toBe("note");
      expect(result.items[0].createdAt).toBe("2024-06-01T00:00:00.000Z");
    });

    it("returns empty items when prisma returns empty array", async () => {
      const result = await provider.listItems("user-b", {});
      expect(result.items).toEqual([]);
    });
  });

  describe("fetchBundle", () => {
    it("passes userId in where.userId", async () => {
      await provider.fetchBundle(["topic-1", "topic-2"], "user-b");
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["topic-1", "topic-2"] },
            userId: "user-b",
          }),
        }),
      );
    });

    it("does NOT leak user-a id when called with user-b", async () => {
      await provider.fetchBundle(["topic-1"], "user-b");
      const callArg = mockFindMany.mock.calls[0][0] as { where: unknown };
      expect(JSON.stringify(callArg.where)).toContain("user-b");
      expect(JSON.stringify(callArg.where)).not.toContain("user-a");
    });

    it("short-circuits without DB call for empty itemIds", async () => {
      const bundles = await provider.fetchBundle([], "user-b");
      expect(bundles).toEqual([]);
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it("maps topic rows to SourceContentBundle with markdown body", async () => {
      mockFindMany.mockResolvedValue([makeTopicBundleRow()]);
      const bundles = await provider.fetchBundle(["topic-1"], "user-b");
      expect(bundles).toHaveLength(1);
      expect(bundles[0].sourceType).toBe("AI_TOPIC_INSIGHTS");
      expect(bundles[0].sourceId).toBe("topic-1");
      expect(bundles[0].bodyMime).toBe("text/markdown");
      expect(bundles[0].body).toContain("My Topic");
    });
  });
});
