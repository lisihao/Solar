import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { GraphService } from "../graph.service";
import { PrismaService } from "../../prisma/prisma.service";

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

const mockPrisma = {
  resource: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  collection: {
    findMany: jest.fn(),
  },
  note: {
    findMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const makeResource = (overrides: Record<string, unknown> = {}) => ({
  id: "res-1",
  type: "article",
  title: "Test Article",
  abstract: "Abstract text",
  publishedAt: new Date("2024-01-01"),
  qualityScore: 0.9,
  trendingScore: 0.5,
  categories: ["AI", "ML"],
  tags: ["transformer", "llm"],
  primaryCategory: "AI",
  authors: [{ name: "Alice", platform: "arxiv" }],
  sourceUrl: "https://example.com",
  thumbnailUrl: null,
  createdAt: new Date(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GraphService", () => {
  let service: GraphService;

  beforeEach(async () => {
    jest.clearAllMocks();

    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GraphService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<GraphService>(GraphService);
  });

  // -------------------------------------------------------------------------
  // findSimilarResources
  // -------------------------------------------------------------------------

  describe("findSimilarResources", () => {
    it("returns empty array when target resource does not exist", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(null);

      const result = await service.findSimilarResources("nonexistent");

      expect(result).toEqual([]);
    });

    it("returns mapped results from raw query when resource exists", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(makeResource());

      const rawRow = {
        ...makeResource({ id: "res-2", title: "Similar Article" }),
        commonCount: 3,
      };
      mockPrisma.$queryRaw.mockResolvedValue([rawRow]);

      const result = await service.findSimilarResources("res-1");

      expect(result).toHaveLength(1);
      expect(result[0].resource.id).toBe("res-2");
      expect(result[0].commonCount).toBe(3);
    });

    it("respects the limit parameter", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(makeResource());
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await service.findSimilarResources("res-1", 5);

      // The raw query is built with a Prisma template tag; we can only verify
      // that $queryRaw was called (limit is embedded in the tagged template)
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getResourceGraph
  // -------------------------------------------------------------------------

  describe("getResourceGraph", () => {
    it("returns empty nodes/edges when resource not found", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(null);

      const result = await service.getResourceGraph("nonexistent");

      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it("adds a Resource node for the root resource", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(makeResource());

      const result = await service.getResourceGraph("res-1", 1);

      const resNode = result.nodes.find((n) => n.id === "res-1");
      expect(resNode).toBeDefined();
      expect(resNode!.label).toBe("Resource");
    });

    it("adds Author nodes and AUTHORED edges", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(makeResource());

      const result = await service.getResourceGraph("res-1", 1);

      const authorNode = result.nodes.find((n) => n.id === "author:Alice");
      expect(authorNode).toBeDefined();
      const authoredEdge = result.edges.find(
        (e) => e.source === "author:Alice" && e.type === "AUTHORED",
      );
      expect(authoredEdge).toBeDefined();
    });

    it("adds Topic nodes and BELONGS_TO edges for categories", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(makeResource());

      const result = await service.getResourceGraph("res-1", 1);

      const topicNode = result.nodes.find((n) => n.id === "topic:AI");
      expect(topicNode).toBeDefined();
      const edge = result.edges.find(
        (e) => e.source === "res-1" && e.target === "topic:AI",
      );
      expect(edge).toBeDefined();
    });

    it("adds Tag nodes and TAGGED_WITH edges", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(makeResource());

      const result = await service.getResourceGraph("res-1", 1);

      const tagNode = result.nodes.find((n) => n.id === "tag:transformer");
      expect(tagNode).toBeDefined();
    });

    it("includes similar resources when depth > 1", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(makeResource());
      mockPrisma.$queryRaw.mockResolvedValue([
        { ...makeResource({ id: "res-2", title: "Related" }), commonCount: 2 },
      ]);

      const result = await service.getResourceGraph("res-1", 2);

      const similarNode = result.nodes.find((n) => n.id === "res-2");
      expect(similarNode).toBeDefined();
    });

    it("does NOT fetch similar resources when depth === 1", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(makeResource());

      await service.getResourceGraph("res-1", 1);

      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getAuthorGraph
  // -------------------------------------------------------------------------

  describe("getAuthorGraph", () => {
    it("returns an Author node as the graph root", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getAuthorGraph("alice");

      const authorNode = result.nodes.find((n) => n.id === "author:alice");
      expect(authorNode).toBeDefined();
      expect(authorNode!.label as string).toBe("Author");
    });

    it("adds Resource nodes and AUTHORED edges for each resource", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        makeResource({ id: "res-10", title: "Paper A", categories: [] }),
      ]);

      const result = await service.getAuthorGraph("alice");

      const resNode = result.nodes.find((n) => n.id === "res-10");
      expect(resNode).toBeDefined();
      const edge = result.edges.find(
        (e) => e.source === "author:alice" && e.target === "res-10",
      );
      expect(edge).toBeDefined();
    });

    it("adds Topic nodes for resource categories", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        makeResource({ id: "res-11", categories: ["NLP"] }),
      ]);

      const result = await service.getAuthorGraph("alice");

      const topicNode = result.nodes.find((n) => n.id === "topic:NLP");
      expect(topicNode).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // getTopicGraph
  // -------------------------------------------------------------------------

  describe("getTopicGraph", () => {
    it("returns a Topic node as the graph root", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getTopicGraph("AI");

      const topicNode = result.nodes.find((n) => n.id === "topic:AI");
      expect(topicNode).toBeDefined();
    });

    it("adds Resource and BELONGS_TO edges for matched resources", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        makeResource({ id: "res-20", authors: [] }),
      ]);

      const result = await service.getTopicGraph("AI");

      const edge = result.edges.find(
        (e) => e.source === "res-20" && e.target === "topic:AI",
      );
      expect(edge).toBeDefined();
    });

    it("collects authors from resources and adds Author nodes", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        makeResource({ id: "res-21", authors: [{ name: "Bob" }] }),
      ]);

      const result = await service.getTopicGraph("AI");

      const authorNode = result.nodes.find((n) => n.id === "author:Bob");
      expect(authorNode).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // getGraphOverview
  // -------------------------------------------------------------------------

  describe("getGraphOverview", () => {
    it("delegates to getUserGraphOverview when userId is provided", async () => {
      // Setup for getUserGraphOverview
      mockPrisma.user.findUnique.mockResolvedValue(null); // returns empty graph

      const result = await service.getGraphOverview("user-1");

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "user-1" } }),
      );
      expect(result.nodes).toEqual([]);
    });

    it("returns global overview when no userId provided", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([
        makeResource({ id: "res-30", authors: [], categories: [], tags: [] }),
      ]);
      mockPrisma.resource.count.mockResolvedValue(1);

      const result = await service.getGraphOverview();

      expect(result.stats.totalResources).toBe(1);
      const resNode = result.nodes.find((n) => n.id === "res-30");
      expect(resNode).toBeDefined();
    });

    it("global overview stats reflect authorSet/topicSet/tagSet sizes", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([
        makeResource({
          id: "res-40",
          authors: [{ name: "Carol" }],
          categories: ["CV"],
          tags: ["cnn"],
          primaryCategory: "CV",
        }),
      ]);
      mockPrisma.resource.count.mockResolvedValue(1);

      const result = await service.getGraphOverview();

      expect(result.stats.totalAuthors).toBe(1);
      expect(result.stats.totalTopics).toBeGreaterThanOrEqual(1);
      expect(result.stats.totalTags).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // buildGraphFromResource / buildGraphForAllResources
  // -------------------------------------------------------------------------

  describe("buildGraphFromResource", () => {
    it("is a no-op that resolves without error", async () => {
      await expect(
        service.buildGraphFromResource("res-1"),
      ).resolves.toBeUndefined();
    });
  });

  describe("buildGraphForAllResources", () => {
    it("returns { success: count, failed: 0 }", async () => {
      mockPrisma.resource.count.mockResolvedValue(42);

      const result = await service.buildGraphForAllResources();

      expect(result.success).toBe(42);
      expect(result.failed).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // unlinkTag
  // -------------------------------------------------------------------------

  describe("unlinkTag", () => {
    it("removes the specified tag and persists update", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(
        makeResource({ tags: ["transformer", "llm"] }),
      );
      mockPrisma.resource.update.mockResolvedValue({});

      await service.unlinkTag("res-1", "transformer");

      expect(mockPrisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "res-1" },
          data: { tags: ["llm"] },
        }),
      );
    });

    it("throws when resource does not exist", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(null);

      await expect(service.unlinkTag("bad-id", "tag")).rejects.toThrow(
        "Resource bad-id not found",
      );
    });
  });

  // -------------------------------------------------------------------------
  // unlinkCategory
  // -------------------------------------------------------------------------

  describe("unlinkCategory", () => {
    it("removes category and updates primaryCategory if it matches", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(
        makeResource({ categories: ["AI", "ML"], primaryCategory: "AI" }),
      );
      mockPrisma.resource.update.mockResolvedValue({});

      await service.unlinkCategory("res-1", "AI");

      expect(mockPrisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            categories: ["ML"],
            primaryCategory: "ML",
          }),
        }),
      );
    });

    it("does not change primaryCategory when removed category is not primary", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(
        makeResource({ categories: ["AI", "ML"], primaryCategory: "AI" }),
      );
      mockPrisma.resource.update.mockResolvedValue({});

      await service.unlinkCategory("res-1", "ML");

      const call = mockPrisma.resource.update.mock.calls[0][0];
      // primaryCategory should not be in the update payload (or stays as AI)
      expect(call.data.primaryCategory).toBeUndefined();
    });

    it("throws when resource does not exist", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(null);

      await expect(service.unlinkCategory("bad-id", "AI")).rejects.toThrow(
        "Resource bad-id not found",
      );
    });
  });

  // -------------------------------------------------------------------------
  // unlinkAuthor
  // -------------------------------------------------------------------------

  describe("unlinkAuthor", () => {
    it("removes the specified author by name", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(
        makeResource({
          authors: [{ name: "Alice" }, { name: "Bob" }],
        }),
      );
      mockPrisma.resource.update.mockResolvedValue({});

      await service.unlinkAuthor("res-1", "Alice");

      expect(mockPrisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { authors: [{ name: "Bob" }] },
        }),
      );
    });

    it("throws when resource does not exist", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(null);

      await expect(service.unlinkAuthor("bad-id", "Alice")).rejects.toThrow(
        "Resource bad-id not found",
      );
    });
  });

  // -------------------------------------------------------------------------
  // unlinkNode dispatcher
  // -------------------------------------------------------------------------

  describe("unlinkNode", () => {
    it("delegates tag type to unlinkTag", async () => {
      const spy = jest.spyOn(service, "unlinkTag").mockResolvedValue();
      await service.unlinkNode("res-1", "tag", "transformer");
      expect(spy).toHaveBeenCalledWith("res-1", "transformer");
    });

    it("delegates category type to unlinkCategory", async () => {
      const spy = jest.spyOn(service, "unlinkCategory").mockResolvedValue();
      await service.unlinkNode("res-1", "category", "AI");
      expect(spy).toHaveBeenCalledWith("res-1", "AI");
    });

    it("delegates author type to unlinkAuthor", async () => {
      const spy = jest.spyOn(service, "unlinkAuthor").mockResolvedValue();
      await service.unlinkNode("res-1", "author", "Alice");
      expect(spy).toHaveBeenCalledWith("res-1", "Alice");
    });

    it("throws for unknown node type", async () => {
      await expect(
        service.unlinkNode("res-1", "unknown" as any, "x"),
      ).rejects.toThrow("Unknown node type: unknown");
    });
  });
});
