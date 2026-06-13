/**
 * Supplemental tests for GraphService — covers branches not in graph.service.spec.ts
 */
import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { GraphService } from "../graph.service";
import { PrismaService } from "../../prisma/prisma.service";

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

describe("GraphService (supplemental)", () => {
  let service: GraphService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GraphService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<GraphService>(GraphService);
  });

  // =========================================================================
  // unlinkTag
  // =========================================================================
  describe("unlinkTag", () => {
    it("removes the specified tag and updates the resource", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce({
        id: "res-1",
        tags: ["ai", "nlp", "transformers"],
      });
      mockPrisma.resource.update.mockResolvedValueOnce({});

      await service.unlinkTag("res-1", "nlp");

      expect(mockPrisma.resource.update).toHaveBeenCalledWith({
        where: { id: "res-1" },
        data: { tags: ["ai", "transformers"] },
      });
    });

    it("throws when resource is not found", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce(null);

      await expect(service.unlinkTag("missing", "nlp")).rejects.toThrow(
        "Resource missing not found",
      );
    });

    it("handles resource with null tags", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce({
        id: "res-1",
        tags: null,
      });
      mockPrisma.resource.update.mockResolvedValueOnce({});

      await service.unlinkTag("res-1", "nonexistent");

      expect(mockPrisma.resource.update).toHaveBeenCalledWith({
        where: { id: "res-1" },
        data: { tags: [] },
      });
    });
  });

  // =========================================================================
  // unlinkCategory
  // =========================================================================
  describe("unlinkCategory", () => {
    it("removes non-primary category without changing primaryCategory", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce({
        id: "res-1",
        categories: ["AI", "ML", "NLP"],
        primaryCategory: "AI",
      });
      mockPrisma.resource.update.mockResolvedValueOnce({});

      await service.unlinkCategory("res-1", "ML");

      const updateData = mockPrisma.resource.update.mock.calls[0][0].data;
      expect(updateData.categories).toEqual(["AI", "NLP"]);
      // primaryCategory should NOT be in the updateData since it didn't change
      expect(updateData.primaryCategory).toBeUndefined();
    });

    it("reassigns primaryCategory to first remaining when removing primary", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce({
        id: "res-1",
        categories: ["AI", "ML", "NLP"],
        primaryCategory: "AI",
      });
      mockPrisma.resource.update.mockResolvedValueOnce({});

      await service.unlinkCategory("res-1", "AI");

      const updateData = mockPrisma.resource.update.mock.calls[0][0].data;
      expect(updateData.categories).toEqual(["ML", "NLP"]);
      expect(updateData.primaryCategory).toBe("ML");
    });

    it("sets primaryCategory to null when last category removed", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce({
        id: "res-1",
        categories: ["AI"],
        primaryCategory: "AI",
      });
      mockPrisma.resource.update.mockResolvedValueOnce({});

      await service.unlinkCategory("res-1", "AI");

      const updateData = mockPrisma.resource.update.mock.calls[0][0].data;
      expect(updateData.primaryCategory).toBeNull();
    });

    it("throws when resource not found", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce(null);

      await expect(service.unlinkCategory("missing", "AI")).rejects.toThrow(
        "Resource missing not found",
      );
    });
  });

  // =========================================================================
  // unlinkAuthor
  // =========================================================================
  describe("unlinkAuthor", () => {
    it("removes author by name field", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce({
        id: "res-1",
        authors: [{ name: "Alice" }, { name: "Bob" }],
      });
      mockPrisma.resource.update.mockResolvedValueOnce({});

      await service.unlinkAuthor("res-1", "Alice");

      const updateData = mockPrisma.resource.update.mock.calls[0][0].data;
      expect(updateData.authors).toEqual([{ name: "Bob" }]);
    });

    it("removes author by username field", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce({
        id: "res-1",
        authors: [{ username: "alice_gh" }, { name: "Bob" }],
      });
      mockPrisma.resource.update.mockResolvedValueOnce({});

      await service.unlinkAuthor("res-1", "alice_gh");

      const updateData = mockPrisma.resource.update.mock.calls[0][0].data;
      expect(updateData.authors).toEqual([{ name: "Bob" }]);
    });

    it("throws when resource not found", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce(null);

      await expect(service.unlinkAuthor("missing", "Alice")).rejects.toThrow(
        "Resource missing not found",
      );
    });
  });

  // =========================================================================
  // unlinkNode (dispatch)
  // =========================================================================
  describe("unlinkNode", () => {
    it("dispatches to unlinkTag", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce({
        id: "res-1",
        tags: ["ai"],
      });
      mockPrisma.resource.update.mockResolvedValueOnce({});

      await service.unlinkNode("res-1", "tag", "ai");

      expect(mockPrisma.resource.update).toHaveBeenCalled();
    });

    it("dispatches to unlinkCategory", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce({
        id: "res-1",
        categories: ["AI"],
        primaryCategory: "AI",
      });
      mockPrisma.resource.update.mockResolvedValueOnce({});

      await service.unlinkNode("res-1", "category", "AI");

      expect(mockPrisma.resource.update).toHaveBeenCalled();
    });

    it("dispatches to unlinkAuthor", async () => {
      mockPrisma.resource.findUnique.mockResolvedValueOnce({
        id: "res-1",
        authors: [{ name: "Alice" }],
      });
      mockPrisma.resource.update.mockResolvedValueOnce({});

      await service.unlinkNode("res-1", "author", "Alice");

      expect(mockPrisma.resource.update).toHaveBeenCalled();
    });

    it("throws for unknown nodeType", async () => {
      // @ts-expect-error -- testing runtime error path
      await expect(
        service.unlinkNode("res-1", "invalid", "val"),
      ).rejects.toThrow("Unknown node type: invalid");
    });
  });

  // =========================================================================
  // buildGraphFromResource & buildGraphForAllResources
  // =========================================================================
  describe("buildGraphFromResource", () => {
    it("resolves without error (no-op PostgreSQL impl)", async () => {
      await expect(
        service.buildGraphFromResource("res-1"),
      ).resolves.toBeUndefined();
    });
  });

  describe("buildGraphForAllResources", () => {
    it("returns count from prisma resource.count with failed=0", async () => {
      mockPrisma.resource.count.mockResolvedValueOnce(100);

      const result = await service.buildGraphForAllResources();

      expect(result.success).toBe(100);
      expect(result.failed).toBe(0);
    });
  });

  // =========================================================================
  // getGraphOverview — user not found
  // =========================================================================
  describe("getGraphOverview", () => {
    it("delegates to user graph when userId provided", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await service.getGraphOverview("nonexistent-user");

      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    });

    it("returns global overview without userId", async () => {
      mockPrisma.resource.findMany.mockResolvedValueOnce([]);
      mockPrisma.resource.count.mockResolvedValueOnce(0);

      const result = await service.getGraphOverview();

      expect(result.stats.totalResources).toBe(0);
    });
  });

  // =========================================================================
  // getUserGraphOverview - with notes linked to resources
  // =========================================================================
  describe("getUserGraphOverview", () => {
    it("creates ANNOTATES edge when note.resourceId is in resourceIds", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "user-1",
        username: "alice",
        email: "alice@test.com",
      });

      const collections = [
        {
          id: "col-1",
          name: "Col",
          description: null,
          icon: null,
          color: null,
          items: [
            {
              resource: {
                id: "res-1",
                title: "Resource",
                type: "ARTICLE",
                authors: [],
                categories: [],
                primaryCategory: null,
                tags: [],
              },
              readStatus: "UNREAD",
              readProgress: 0,
              note: null,
              tags: [],
              addedAt: new Date(),
            },
          ],
        },
      ];
      mockPrisma.collection.findMany.mockResolvedValueOnce(collections);
      mockPrisma.note.findMany.mockResolvedValueOnce([
        {
          id: "note-1",
          title: "My note",
          content: "Some content",
          resourceId: "res-1",
          tags: [],
          createdAt: new Date(),
        },
      ]);

      const result = await service.getUserGraphOverview("user-1");

      const annotatesEdge = result.edges.find((e) => e.type === "ANNOTATES");
      expect(annotatesEdge).toBeDefined();
      expect(annotatesEdge?.source).toBe("note-note-1");
      expect(annotatesEdge?.target).toBe("res-1");
    });

    it("does NOT create ANNOTATES edge when note.resourceId not in resourceIds", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "user-1",
        username: "alice",
        email: "alice@test.com",
      });
      mockPrisma.collection.findMany.mockResolvedValueOnce([]);
      mockPrisma.note.findMany.mockResolvedValueOnce([
        {
          id: "note-2",
          title: null,
          content: "Standalone note",
          resourceId: "non-existent-res",
          tags: [],
          createdAt: new Date(),
        },
      ]);

      const result = await service.getUserGraphOverview("user-1");

      const annotatesEdges = result.edges.filter((e) => e.type === "ANNOTATES");
      expect(annotatesEdges).toHaveLength(0);
    });

    it("skips resource when item.resource is null", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "user-1",
        username: "alice",
        email: "alice@test.com",
      });
      const collections = [
        {
          id: "col-1",
          name: "Col",
          description: null,
          icon: null,
          color: null,
          items: [
            {
              resource: null,
              readStatus: "UNREAD",
              readProgress: 0,
              note: null,
              tags: [],
              addedAt: new Date(),
            },
          ],
        },
      ];
      mockPrisma.collection.findMany.mockResolvedValueOnce(collections);
      mockPrisma.note.findMany.mockResolvedValueOnce([]);

      const result = await service.getUserGraphOverview("user-1");

      expect(result.stats.totalResources).toBe(0);
    });

    it("does not add duplicate resource nodes", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "user-1",
        username: "alice",
        email: "alice@test.com",
      });

      const sharedResource = {
        id: "res-shared",
        title: "Shared",
        type: "ARTICLE",
        authors: [],
        categories: [],
        primaryCategory: null,
        tags: [],
      };
      const collections = [
        {
          id: "col-1",
          name: "Col1",
          description: null,
          icon: null,
          color: null,
          items: [
            {
              resource: sharedResource,
              readStatus: "UNREAD",
              readProgress: 0,
              note: null,
              tags: [],
              addedAt: new Date(),
            },
            {
              resource: sharedResource,
              readStatus: "UNREAD",
              readProgress: 0,
              note: null,
              tags: [],
              addedAt: new Date(),
            },
          ],
        },
      ];
      mockPrisma.collection.findMany.mockResolvedValueOnce(collections);
      mockPrisma.note.findMany.mockResolvedValueOnce([]);

      const result = await service.getUserGraphOverview("user-1");

      const resourceNodes = result.nodes.filter((n) => n.type === "Resource");
      expect(resourceNodes).toHaveLength(1);
    });
  });

  // =========================================================================
  // getTopicGraph
  // =========================================================================
  describe("getTopicGraph", () => {
    it("returns topic node even with no resources", async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.getTopicGraph("RareTopic");

      const topicNode = result.nodes.find(
        (n) => (n as Record<string, string>).id === "topic:RareTopic",
      );
      expect(topicNode).toBeDefined();
    });

    it("caps author nodes at 20", async () => {
      const resources = Array.from({ length: 30 }, (_, i) => ({
        id: `res-${i}`,
        type: "ARTICLE",
        title: `Paper ${i}`,
        abstract: "Abs",
        categories: ["AI"],
        authors: [{ name: `Author${i}` }],
      }));
      mockPrisma.$queryRaw.mockResolvedValueOnce(resources);

      const result = await service.getTopicGraph("AI");

      const authorNodes = result.nodes.filter(
        (n) => (n as Record<string, string>).label === "Author",
      );
      expect(authorNodes.length).toBeLessThanOrEqual(20);
    });
  });

  // =========================================================================
  // getAuthorGraph
  // =========================================================================
  describe("getAuthorGraph", () => {
    it("returns author node and no resources when query returns empty", async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.getAuthorGraph("NoName");

      expect(result.nodes).toHaveLength(1);
      expect((result.nodes[0] as Record<string, string>).id).toBe(
        "author:NoName",
      );
    });

    it("creates topic nodes without duplicates", async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          id: "res-1",
          type: "ARTICLE",
          title: "P1",
          abstract: "A",
          categories: ["AI", "ML"],
          authors: [{ name: "Alice" }],
        },
        {
          id: "res-2",
          type: "ARTICLE",
          title: "P2",
          abstract: "B",
          categories: ["AI"],
          authors: [{ name: "Alice" }],
        },
      ]);

      const result = await service.getAuthorGraph("Alice");

      const topicNodes = result.nodes.filter(
        (n) => (n as Record<string, string>).label === "Topic",
      );
      const aiTopics = topicNodes.filter(
        (n) => (n as Record<string, string>).id === "topic:AI",
      );
      expect(aiTopics).toHaveLength(1);
    });
  });
});
