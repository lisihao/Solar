import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { KnowledgeGraphController } from "../knowledge-graph.controller";
import { LibraryKnowledgeGraphService } from "../knowledge-graph.service.postgres";
import { AiChatService } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(userId: string | undefined): { user?: { id: string } } {
  return { user: userId ? { id: userId } : undefined };
}

const USER_ID = "user-001";

// ── Mock data ─────────────────────────────────────────────────────────────────

const mockGraphOverview = {
  stats: {
    totalResources: 100,
    totalAuthors: 25,
    totalTopics: 40,
    totalTags: 60,
    totalEdges: 200,
  },
  nodes: [
    { label: "Machine Learning", type: "topic" },
    { label: "NLP", type: "topic" },
    { label: "John Doe", type: "author" },
  ],
};

const mockResourceGraph = {
  resourceId: "res-001",
  nodes: [],
  edges: [],
};

const mockSimilarResources = [
  { id: "res-002", title: "Similar Resource 1", similarity: 0.9 },
  { id: "res-003", title: "Similar Resource 2", similarity: 0.8 },
];

const mockChatResponse = {
  content: "Your knowledge graph shows strong connections around AI topics.",
  model: "gpt-4o",
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe("KnowledgeGraphController", () => {
  let controller: KnowledgeGraphController;
  let kgService: jest.Mocked<LibraryKnowledgeGraphService>;
  let aiChatService: jest.Mocked<AiChatService>;

  beforeEach(async () => {
    const mockKgService = {
      buildGraphFromResource: jest.fn(),
      buildGraphForAllResources: jest.fn(),
      getResourceGraph: jest.fn(),
      getAuthorGraph: jest.fn(),
      getTopicGraph: jest.fn(),
      getGraphOverview: jest.fn(),
      getUserGraphOverview: jest.fn(),
      findSimilarResources: jest.fn(),
      unlinkNode: jest.fn(),
      unlinkTag: jest.fn(),
      unlinkCategory: jest.fn(),
      unlinkAuthor: jest.fn(),
    };

    const mockAiChatService = {
      chat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [KnowledgeGraphController],
      providers: [
        { provide: LibraryKnowledgeGraphService, useValue: mockKgService },
        { provide: AiChatService, useValue: mockAiChatService },
      ],
    }).compile();

    controller = module.get<KnowledgeGraphController>(KnowledgeGraphController);
    kgService = module.get(LibraryKnowledgeGraphService);
    aiChatService = module.get(AiChatService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── buildGraphForResource ─────────────────────────────────────────────────────

  describe("POST /knowledge-graph/build/:id", () => {
    it("builds graph for resource and returns success message", async () => {
      kgService.buildGraphFromResource.mockResolvedValue(undefined);

      const result = await controller.buildGraphForResource("res-001");

      expect(kgService.buildGraphFromResource).toHaveBeenCalledWith("res-001");
      expect(result).toEqual({
        message: "Knowledge graph built successfully",
        resourceId: "res-001",
      });
    });

    it("propagates service errors", async () => {
      kgService.buildGraphFromResource.mockRejectedValue(
        new Error("Build failed"),
      );

      await expect(controller.buildGraphForResource("res-001")).rejects.toThrow(
        "Build failed",
      );
    });
  });

  // ── buildGraphForAll ──────────────────────────────────────────────────────────

  describe("POST /knowledge-graph/build-all", () => {
    it("builds graph for all resources and returns batch result", async () => {
      const batchResult = { processed: 50, failed: 2, skipped: 3 };
      kgService.buildGraphForAllResources.mockResolvedValue(batchResult);

      const result = await controller.buildGraphForAll();

      expect(kgService.buildGraphForAllResources).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        message: "Batch build completed",
        ...batchResult,
      });
    });
  });

  // ── getResourceGraph ──────────────────────────────────────────────────────────

  describe("GET /knowledge-graph/resource/:id", () => {
    it("returns resource graph with default depth 2", async () => {
      kgService.getResourceGraph.mockResolvedValue(mockResourceGraph);

      const result = await controller.getResourceGraph("res-001", 2);

      expect(kgService.getResourceGraph).toHaveBeenCalledWith("res-001", 2);
      expect(result).toEqual(mockResourceGraph);
    });

    it("returns resource graph with custom depth", async () => {
      kgService.getResourceGraph.mockResolvedValue(mockResourceGraph);

      await controller.getResourceGraph("res-001", 3);

      expect(kgService.getResourceGraph).toHaveBeenCalledWith("res-001", 3);
    });
  });

  // ── getAuthorGraph ────────────────────────────────────────────────────────────

  describe("GET /knowledge-graph/author/:username", () => {
    it("returns author graph for given username", async () => {
      const authorGraph = { username: "john-doe", nodes: [], edges: [] };
      kgService.getAuthorGraph.mockResolvedValue(authorGraph);

      const result = await controller.getAuthorGraph("john-doe");

      expect(kgService.getAuthorGraph).toHaveBeenCalledWith("john-doe");
      expect(result).toEqual(authorGraph);
    });
  });

  // ── getTopicGraph ─────────────────────────────────────────────────────────────

  describe("GET /knowledge-graph/topic/:name", () => {
    it("returns topic graph for given topic name", async () => {
      const topicGraph = { name: "machine-learning", nodes: [], edges: [] };
      kgService.getTopicGraph.mockResolvedValue(topicGraph);

      const result = await controller.getTopicGraph("machine-learning");

      expect(kgService.getTopicGraph).toHaveBeenCalledWith("machine-learning");
      expect(result).toEqual(topicGraph);
    });
  });

  // ── getOverview ───────────────────────────────────────────────────────────────

  describe("GET /knowledge-graph/overview", () => {
    it("returns global overview when no userId is provided", async () => {
      kgService.getGraphOverview.mockResolvedValue(mockGraphOverview);

      const result = await controller.getOverview(
        undefined,
        undefined,
        undefined,
      );

      expect(kgService.getGraphOverview).toHaveBeenCalledTimes(1);
      expect(kgService.getUserGraphOverview).not.toHaveBeenCalled();
      expect(result).toEqual(mockGraphOverview);
    });

    it("returns personalized overview when userId is provided", async () => {
      kgService.getUserGraphOverview.mockResolvedValue(mockGraphOverview);

      const result = await controller.getOverview(
        USER_ID,
        undefined,
        undefined,
      );

      expect(kgService.getUserGraphOverview).toHaveBeenCalledWith(USER_ID, {
        collectionId: undefined,
        includeNotes: true,
      });
      expect(kgService.getGraphOverview).not.toHaveBeenCalled();
      expect(result).toEqual(mockGraphOverview);
    });

    it("passes collectionId to getUserGraphOverview when provided", async () => {
      kgService.getUserGraphOverview.mockResolvedValue(mockGraphOverview);

      await controller.getOverview(USER_ID, "col-001", undefined);

      expect(kgService.getUserGraphOverview).toHaveBeenCalledWith(USER_ID, {
        collectionId: "col-001",
        includeNotes: true,
      });
    });

    it("sets includeNotes to false when includeNotes=false query param is provided", async () => {
      kgService.getUserGraphOverview.mockResolvedValue(mockGraphOverview);

      await controller.getOverview(USER_ID, undefined, "false");

      expect(kgService.getUserGraphOverview).toHaveBeenCalledWith(USER_ID, {
        collectionId: undefined,
        includeNotes: false,
      });
    });

    it("defaults includeNotes to true for any value other than 'false'", async () => {
      kgService.getUserGraphOverview.mockResolvedValue(mockGraphOverview);

      await controller.getOverview(USER_ID, undefined, "true");

      expect(kgService.getUserGraphOverview).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ includeNotes: true }),
      );
    });
  });

  // ── findSimilar ───────────────────────────────────────────────────────────────

  describe("GET /knowledge-graph/similar/:id", () => {
    it("returns similar resources with default limit 10", async () => {
      kgService.findSimilarResources.mockResolvedValue(mockSimilarResources);

      const result = await controller.findSimilar("res-001", 10);

      expect(kgService.findSimilarResources).toHaveBeenCalledWith(
        "res-001",
        10,
      );
      expect(result).toEqual(mockSimilarResources);
    });

    it("passes custom limit to service", async () => {
      kgService.findSimilarResources.mockResolvedValue([]);

      await controller.findSimilar("res-001", 5);

      expect(kgService.findSimilarResources).toHaveBeenCalledWith("res-001", 5);
    });
  });

  // ── unlinkNode ────────────────────────────────────────────────────────────────

  describe("DELETE /knowledge-graph/resource/:id/unlink", () => {
    it("unlinks a tag node from resource", async () => {
      kgService.unlinkNode.mockResolvedValue({ unlinked: true } as never);

      const result = await controller.unlinkNode("res-001", {
        nodeType: "tag",
        nodeName: "machine-learning",
      });

      expect(kgService.unlinkNode).toHaveBeenCalledWith(
        "res-001",
        "tag",
        "machine-learning",
      );
      expect(result).toEqual({ unlinked: true });
    });

    it("unlinks a category node from resource", async () => {
      kgService.unlinkNode.mockResolvedValue({ unlinked: true } as never);

      await controller.unlinkNode("res-001", {
        nodeType: "category",
        nodeName: "AI",
      });

      expect(kgService.unlinkNode).toHaveBeenCalledWith(
        "res-001",
        "category",
        "AI",
      );
    });

    it("unlinks an author node from resource", async () => {
      kgService.unlinkNode.mockResolvedValue({ unlinked: true } as never);

      await controller.unlinkNode("res-001", {
        nodeType: "author",
        nodeName: "John Doe",
      });

      expect(kgService.unlinkNode).toHaveBeenCalledWith(
        "res-001",
        "author",
        "John Doe",
      );
    });

    it("throws BadRequestException when nodeType is missing", async () => {
      await expect(
        controller.unlinkNode("res-001", {
          nodeType: "" as never,
          nodeName: "ml",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when nodeName is missing", async () => {
      await expect(
        controller.unlinkNode("res-001", { nodeType: "tag", nodeName: "" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException for invalid nodeType", async () => {
      await expect(
        controller.unlinkNode("res-001", {
          nodeType: "invalid" as never,
          nodeName: "something",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── unlinkTag ─────────────────────────────────────────────────────────────────

  describe("DELETE /knowledge-graph/resource/:id/tag/:tagName", () => {
    it("unlinks tag from resource", async () => {
      kgService.unlinkTag.mockResolvedValue({ unlinked: true } as never);

      const result = await controller.unlinkTag("res-001", "machine-learning");

      expect(kgService.unlinkTag).toHaveBeenCalledWith(
        "res-001",
        "machine-learning",
      );
      expect(result).toEqual({ unlinked: true });
    });
  });

  // ── unlinkCategory ────────────────────────────────────────────────────────────

  describe("DELETE /knowledge-graph/resource/:id/category/:categoryName", () => {
    it("unlinks category from resource", async () => {
      kgService.unlinkCategory.mockResolvedValue({ unlinked: true } as never);

      const result = await controller.unlinkCategory(
        "res-001",
        "Artificial Intelligence",
      );

      expect(kgService.unlinkCategory).toHaveBeenCalledWith(
        "res-001",
        "Artificial Intelligence",
      );
      expect(result).toEqual({ unlinked: true });
    });
  });

  // ── unlinkAuthor ──────────────────────────────────────────────────────────────

  describe("DELETE /knowledge-graph/resource/:id/author/:authorName", () => {
    it("unlinks author from resource", async () => {
      kgService.unlinkAuthor.mockResolvedValue({ unlinked: true } as never);

      const result = await controller.unlinkAuthor("res-001", "John Doe");

      expect(kgService.unlinkAuthor).toHaveBeenCalledWith(
        "res-001",
        "John Doe",
      );
      expect(result).toEqual({ unlinked: true });
    });
  });

  // ── chat ──────────────────────────────────────────────────────────────────────

  describe("POST /knowledge-graph/chat", () => {
    it("returns AI reply using graph overview as context for authenticated user", async () => {
      kgService.getUserGraphOverview.mockResolvedValue(mockGraphOverview);
      aiChatService.chat.mockResolvedValue(mockChatResponse as never);

      const result = await controller.chat(makeReq(USER_ID) as never, {
        message: "What topics am I exploring?",
      });

      expect(kgService.getUserGraphOverview).toHaveBeenCalledWith(USER_ID, {
        collectionId: undefined,
      });
      expect(aiChatService.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "What topics am I exploring?" }],
          modelType: AIModelType.CHAT,
          taskProfile: { creativity: "medium", outputLength: "medium" },
          userId: USER_ID,
        }),
      );
      expect(result).toEqual({
        reply: mockChatResponse.content,
        model: mockChatResponse.model,
      });
    });

    it("throws UnauthorizedException for anonymous requests", async () => {
      await expect(
        controller.chat(makeReq(undefined) as never, {
          message: "What does the graph show?",
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(aiChatService.chat).not.toHaveBeenCalled();
    });

    it("passes collectionId to getUserGraphOverview when provided", async () => {
      kgService.getUserGraphOverview.mockResolvedValue(mockGraphOverview);
      aiChatService.chat.mockResolvedValue(mockChatResponse as never);

      await controller.chat(makeReq(USER_ID) as never, {
        message: "Show my collection",
        collectionId: "col-001",
      });

      expect(kgService.getUserGraphOverview).toHaveBeenCalledWith(USER_ID, {
        collectionId: "col-001",
      });
    });

    it("throws BadRequestException when message is empty", async () => {
      await expect(
        controller.chat(makeReq(USER_ID) as never, { message: "" }),
      ).rejects.toThrow(BadRequestException);

      expect(aiChatService.chat).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when message is whitespace only", async () => {
      await expect(
        controller.chat(makeReq(USER_ID) as never, { message: "   " }),
      ).rejects.toThrow(BadRequestException);
    });

    it("proceeds with default graph summary when kgService fails", async () => {
      kgService.getUserGraphOverview.mockRejectedValue(new Error("DB error"));
      aiChatService.chat.mockResolvedValue(mockChatResponse as never);

      const result = await controller.chat(makeReq(USER_ID) as never, {
        message: "What topics?",
      });

      expect(aiChatService.chat).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        reply: mockChatResponse.content,
        model: mockChatResponse.model,
      });
    });
  });
});
