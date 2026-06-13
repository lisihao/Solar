import { TopicInsightsContentSourceProvider } from "../topic-insights-content-source.provider";

// ---------------------------------------------------------------------------
// Minimal Prisma stub
// ---------------------------------------------------------------------------

type FindManyArgs = {
  where?: Record<string, unknown>;
  orderBy?: unknown;
  take?: number;
  select?: Record<string, unknown>;
  cursor?: unknown;
  skip?: number;
};

function makePrisma(researchTopicRows: unknown[]): {
  researchTopic: { findMany: jest.Mock };
} {
  return {
    researchTopic: {
      findMany: jest.fn().mockResolvedValue(researchTopicRows),
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_A = "user-a";
const _USER_B = "user-b";

function makeTopic(
  overrides: {
    id?: string;
    userId?: string;
    name?: string;
    description?: string | null;
    status?: string;
    createdAt?: Date;
    updatedAt?: Date;
    type?: string;
    topicConfig?: unknown;
    reports?: unknown[];
  } = {},
) {
  return {
    id: overrides.id ?? "topic-1",
    userId: overrides.userId ?? USER_A,
    name: overrides.name ?? "AI Macro Insight",
    description:
      "description" in overrides
        ? overrides.description
        : "A macro insight topic",
    status: overrides.status ?? "ACTIVE",
    type: overrides.type ?? "MACRO",
    topicConfig: overrides.topicConfig ?? {},
    createdAt: overrides.createdAt ?? new Date("2026-01-01"),
    updatedAt: overrides.updatedAt ?? new Date("2026-01-15"),
    reports: overrides.reports ?? [],
  };
}

function makeReport(
  overrides: Partial<{
    version: number;
    executiveSummary: string;
    fullReport: string;
    totalSources: number;
    generatedAt: Date;
  }> = {},
) {
  return {
    version: overrides.version ?? 1,
    executiveSummary:
      overrides.executiveSummary ?? "Summary of the AI macro landscape.",
    fullReport: overrides.fullReport ?? "## Section 1\nDetailed analysis...",
    totalSources: overrides.totalSources ?? 12,
    generatedAt: overrides.generatedAt ?? new Date("2026-01-15"),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TopicInsightsContentSourceProvider", () => {
  describe("descriptor metadata", () => {
    it("has correct id and contentKinds", () => {
      const prisma = makePrisma([]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      expect(provider.id).toBe("AI_TOPIC_INSIGHTS");
      expect(provider.contentKinds).toEqual(["note"]);
      expect(provider.maxItemsPerTask).toBe(10);
      expect(provider.icon).toBe("Lightbulb");
      expect(provider.displayName["zh-CN"]).toBe("AI 洞察");
      expect(provider.displayName["en-US"]).toBe("AI Topic Insights");
    });
  });

  // -------------------------------------------------------------------------
  // listItems
  // -------------------------------------------------------------------------
  describe("listItems", () => {
    it("returns SourceItems mapped from ResearchTopic rows", async () => {
      const topic = makeTopic({ reports: [makeReport()] });
      const prisma = makePrisma([topic]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const result = await provider.listItems(USER_A, {});

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.id).toBe("topic-1");
      expect(item.title).toBe("AI Macro Insight");
      expect(item.contentKind).toBe("note");
      expect(item.createdAt).toBe(new Date("2026-01-01").toISOString());
    });

    it("uses executiveSummary as preview when report exists", async () => {
      const summary = "X".repeat(300);
      const topic = makeTopic({
        reports: [makeReport({ executiveSummary: summary })],
      });
      const prisma = makePrisma([topic]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const result = await provider.listItems(USER_A, {});

      expect(result.items[0].preview).toHaveLength(200);
    });

    it("falls back to description preview when no report", async () => {
      const topic = makeTopic({
        description: "Short description",
        reports: [],
      });
      const prisma = makePrisma([topic]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const result = await provider.listItems(USER_A, {});

      expect(result.items[0].preview).toBe("Short description");
    });

    it("returns nextCursor when more items exist than limit", async () => {
      // Simulate 3 rows but limit=2 → extra row triggers pagination
      const topics = [
        makeTopic({ id: "t-1" }),
        makeTopic({ id: "t-2" }),
        makeTopic({ id: "t-3" }),
      ];
      const prisma = makePrisma(topics);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const result = await provider.listItems(USER_A, { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe("t-2");
    });

    it("returns no nextCursor when results fit within limit", async () => {
      const topic = makeTopic();
      const prisma = makePrisma([topic]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const result = await provider.listItems(USER_A, { limit: 5 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();
    });

    it("passes userId to prisma where clause — cross-user isolation", async () => {
      const prisma = makePrisma([]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      await provider.listItems(USER_A, {});

      const call = prisma.researchTopic.findMany.mock
        .calls[0][0] as FindManyArgs;
      expect((call.where as Record<string, unknown>).userId).toBe(USER_A);
    });

    it("caps limit at 50 regardless of caller input", async () => {
      const prisma = makePrisma([]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      await provider.listItems(USER_A, { limit: 999 });

      const call = prisma.researchTopic.findMany.mock
        .calls[0][0] as FindManyArgs;
      // take = limit + 1 = 51 (50 capped + 1 extra for hasMore)
      expect(call.take).toBe(51);
    });

    it("excludes ARCHIVED topics", async () => {
      const prisma = makePrisma([]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      await provider.listItems(USER_A, {});

      const call = prisma.researchTopic.findMany.mock
        .calls[0][0] as FindManyArgs;
      expect((call.where as Record<string, unknown>).status).toEqual({
        not: "ARCHIVED",
      });
    });

    it("returns empty items when no topics exist", async () => {
      const prisma = makePrisma([]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const result = await provider.listItems(USER_A, {});

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // fetchBundle
  // -------------------------------------------------------------------------
  describe("fetchBundle", () => {
    it("returns empty array for empty itemIds", async () => {
      const prisma = makePrisma([]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const result = await provider.fetchBundle([], USER_A);

      expect(result).toEqual([]);
      expect(prisma.researchTopic.findMany).not.toHaveBeenCalled();
    });

    it("builds markdown body with heading, summary and full report", async () => {
      const report = makeReport({
        executiveSummary: "Executive summary content.",
        fullReport: "## Section 1\nDetailed analysis.",
      });
      const topic = makeTopic({ reports: [report] });
      const prisma = makePrisma([topic]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const [bundle] = await provider.fetchBundle(["topic-1"], USER_A);

      expect(bundle.body).toContain("# AI Macro Insight");
      expect(bundle.body).toContain("## Executive Summary");
      expect(bundle.body).toContain("Executive summary content.");
      expect(bundle.body).toContain("## Full Report");
      expect(bundle.body).toContain("## Section 1\nDetailed analysis.");
      expect(bundle.bodyMime).toBe("text/markdown");
    });

    it("includes description in body when no report", async () => {
      const topic = makeTopic({
        description: "Topic description only.",
        reports: [],
      });
      const prisma = makePrisma([topic]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const [bundle] = await provider.fetchBundle(["topic-1"], USER_A);

      expect(bundle.body).toContain("# AI Macro Insight");
      expect(bundle.body).toContain("Topic description only.");
      expect(bundle.body).not.toContain("## Executive Summary");
    });

    it("sets correct sourceMetadata", async () => {
      const report = makeReport({ version: 3, totalSources: 7 });
      const topic = makeTopic({ type: "COMPANY", reports: [report] });
      const prisma = makePrisma([topic]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const [bundle] = await provider.fetchBundle(["topic-1"], USER_A);

      expect(bundle.sourceMetadata.topicType).toBe("COMPANY");
      expect(bundle.sourceMetadata.reportVersion).toBe(3);
      expect(bundle.sourceMetadata.totalSources).toBe(7);
    });

    it("sets sourceType to AI_TOPIC_INSIGHTS", async () => {
      const topic = makeTopic({ reports: [makeReport()] });
      const prisma = makePrisma([topic]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const [bundle] = await provider.fetchBundle(["topic-1"], USER_A);

      expect(bundle.sourceType).toBe("AI_TOPIC_INSIGHTS");
      expect(bundle.sourceId).toBe("topic-1");
    });

    // -----------------------------------------------------------------------
    // Cross-user isolation — critical security test
    // -----------------------------------------------------------------------
    it("ISOLATION: passes userId to where clause so DB rejects cross-user access", async () => {
      const prisma = makePrisma([]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      await provider.fetchBundle(["topic-owned-by-user-b"], USER_A);

      const call = prisma.researchTopic.findMany.mock
        .calls[0][0] as FindManyArgs;
      expect((call.where as Record<string, unknown>).userId).toBe(USER_A);
    });

    it("ISOLATION: returns only topics owned by the requesting user (DB returns 0 rows for others)", async () => {
      // DB returns empty because USER_A does not own USER_B's topics
      const prisma = makePrisma([]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const result = await provider.fetchBundle(["topic-of-b"], USER_A);

      expect(result).toHaveLength(0);
    });

    it("ISOLATION: multiple ids — only matching user topics returned", async () => {
      // Simulate DB returning only 1 of 2 requested ids (the other belongs to a different user)
      const topicA = makeTopic({ id: "topic-a", userId: USER_A });
      const prisma = makePrisma([topicA]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const result = await provider.fetchBundle(
        ["topic-a", "topic-b-belongs-to-user-b"],
        USER_A,
      );

      expect(result).toHaveLength(1);
      expect(result[0].sourceId).toBe("topic-a");
    });

    it("handles null description gracefully", async () => {
      const topic = makeTopic({ description: null, reports: [] });
      const prisma = makePrisma([topic]);
      const provider = new TopicInsightsContentSourceProvider(prisma as never);

      const [bundle] = await provider.fetchBundle(["topic-1"], USER_A);

      expect(bundle.body).toBe("# AI Macro Insight");
    });
  });
});
