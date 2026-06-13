import { Test, TestingModule } from "@nestjs/testing";
import { TopicContextRetrievalService } from "../topic-context-retrieval.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RAGFacade } from "@/modules/ai-harness/facade";

// ── helpers ──────────────────────────────────────────────────────────────────

function buildMockPrisma() {
  return {
    topicMessage: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    topicMessageEmbedding: {
      count: jest.fn(),
    },
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  } as unknown as jest.Mocked<PrismaService>;
}

function buildMockFacade() {
  return {
    embeddingGenerate: jest.fn(),
    embeddingGetModel: jest.fn(),
  } as unknown as jest.Mocked<RAGFacade>;
}

const LONG_TEXT = "A".repeat(600); // > 500 chars threshold

// ── test suite ────────────────────────────────────────────────────────────────

describe("TopicContextRetrievalService", () => {
  let service: TopicContextRetrievalService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;
  let mockFacade: ReturnType<typeof buildMockFacade>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();
    mockFacade = buildMockFacade();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicContextRetrievalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RAGFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<TopicContextRetrievalService>(
      TopicContextRetrievalService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── embedMessage ──────────────────────────────────────────────────────────────

  describe("embedMessage", () => {
    it("should return false when message is not found", async () => {
      (mockPrisma.topicMessage.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.embedMessage("msg-not-found");

      expect(result).toBe(false);
    });

    it("should return false for short messages (below threshold)", async () => {
      (mockPrisma.topicMessage.findUnique as jest.Mock).mockResolvedValue({
        id: "msg-1",
        content: "Short message",
        embedding: null,
      });

      const result = await service.embedMessage("msg-1");

      expect(result).toBe(false);
      expect(mockFacade.embeddingGenerate).not.toHaveBeenCalled();
    });

    it("should return true without re-embedding when embedding already exists", async () => {
      (mockPrisma.topicMessage.findUnique as jest.Mock).mockResolvedValue({
        id: "msg-1",
        content: LONG_TEXT,
        embedding: { id: "emb-1" },
      });

      const result = await service.embedMessage("msg-1");

      expect(result).toBe(true);
      expect(mockFacade.embeddingGenerate).not.toHaveBeenCalled();
    });

    it("should generate embedding and store it for long messages", async () => {
      (mockPrisma.topicMessage.findUnique as jest.Mock).mockResolvedValue({
        id: "msg-1",
        content: LONG_TEXT,
        embedding: null,
      });
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
        tokenCount: 150,
      });
      (mockFacade.embeddingGetModel as jest.Mock).mockResolvedValue(
        "text-embedding-3-small",
      );
      (mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(1);

      const result = await service.embedMessage("msg-1");

      expect(result).toBe(true);
      expect(mockFacade.embeddingGenerate).toHaveBeenCalledWith(
        expect.any(String),
      );
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it("should return false when embedding service is unavailable", async () => {
      (mockPrisma.topicMessage.findUnique as jest.Mock).mockResolvedValue({
        id: "msg-1",
        content: LONG_TEXT,
        embedding: null,
      });
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue(null);

      const result = await service.embedMessage("msg-1");

      expect(result).toBe(false);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("should return false and not throw when an error occurs", async () => {
      (mockPrisma.topicMessage.findUnique as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.embedMessage("msg-1");

      expect(result).toBe(false);
    });
  });

  // ── embedTopicMessages ────────────────────────────────────────────────────────

  describe("embedTopicMessages", () => {
    it("should return 0 when there are no messages to embed", async () => {
      (mockPrisma.topicMessage.findMany as jest.Mock).mockResolvedValue([]);

      const count = await service.embedTopicMessages("topic-1");

      expect(count).toBe(0);
    });

    it("should skip short messages and messages already having embeddings", async () => {
      (mockPrisma.topicMessage.findMany as jest.Mock).mockResolvedValue([
        { id: "short", content: "Hi", embedding: null },
        { id: "already-embedded", content: LONG_TEXT, embedding: { id: "e1" } },
      ]);

      const count = await service.embedTopicMessages("topic-1");

      expect(count).toBe(0);
      expect(mockFacade.embeddingGenerate).not.toHaveBeenCalled();
    });

    it("should embed eligible long messages and return count", async () => {
      (mockPrisma.topicMessage.findMany as jest.Mock).mockResolvedValue([
        { id: "msg-1", content: LONG_TEXT, embedding: null },
        { id: "msg-2", content: LONG_TEXT, embedding: null },
      ]);

      // Stub embedMessage indirectly through its dependencies
      (mockPrisma.topicMessage.findUnique as jest.Mock).mockResolvedValue({
        id: "any",
        content: LONG_TEXT,
        embedding: null,
      });
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue({
        embedding: [0.5],
        tokenCount: 10,
      });
      (mockFacade.embeddingGetModel as jest.Mock).mockResolvedValue("model");
      (mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(1);

      const count = await service.embedTopicMessages("topic-1");

      expect(count).toBe(2);
    });

    it("should respect the limit parameter", async () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        id: `msg-${i}`,
        content: LONG_TEXT,
        embedding: null,
      }));
      (mockPrisma.topicMessage.findMany as jest.Mock).mockResolvedValue(
        messages,
      );
      (mockPrisma.topicMessage.findUnique as jest.Mock).mockResolvedValue({
        content: LONG_TEXT,
        embedding: null,
      });
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue({
        embedding: [0.1],
        tokenCount: 5,
      });
      (mockFacade.embeddingGetModel as jest.Mock).mockResolvedValue("model");
      (mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(1);

      const count = await service.embedTopicMessages("topic-1", 3);

      expect(count).toBeLessThanOrEqual(3);
    });
  });

  // ── retrieveContext ───────────────────────────────────────────────────────────

  describe("retrieveContext", () => {
    it("should return empty array when embedding service is unavailable", async () => {
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue(null);

      const result = await service.retrieveContext("topic-1", "query");

      expect(result).toEqual([]);
    });

    it("should return empty array when no matching embeddings found", async () => {
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue({
        embedding: [0.1, 0.2],
        tokenCount: 5,
      });
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const result = await service.retrieveContext("topic-1", "query");

      expect(result).toEqual([]);
    });

    it("should map raw DB rows to RetrievedContext objects", async () => {
      const queryEmb = [0.1, 0.2];
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue({
        embedding: queryEmb,
        tokenCount: 5,
      });

      const now = new Date();
      const rawRows = [
        {
          message_id: "msg-1",
          content_summary: "A summary",
          msg_content: "Full message content",
          msg_created_at: now,
          sender_full_name: "Alice",
          sender_username: "alice",
          ai_member_display_name: null,
          embedding: queryEmb, // identical → cosine similarity = 1.0
        },
      ];
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue(rawRows);

      const result = await service.retrieveContext("topic-1", "test query");

      expect(result).toHaveLength(1);
      const ctx = result[0];
      expect(ctx.messageId).toBe("msg-1");
      expect(ctx.contentSummary).toBe("A summary");
      expect(ctx.content).toBe("Full message content");
      expect(ctx.senderName).toBe("Alice");
      expect(ctx.similarity).toBeCloseTo(1.0);
      expect(ctx.createdAt).toEqual(now);
    });

    it("should fall back to username when full_name is absent", async () => {
      const queryEmb = [0.1];
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue({
        embedding: queryEmb,
        tokenCount: 2,
      });
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          message_id: "msg-2",
          content_summary: null,
          msg_content: "Hello",
          msg_created_at: new Date(),
          sender_full_name: null,
          sender_username: "bob",
          ai_member_display_name: null,
          embedding: queryEmb,
        },
      ]);

      const result = await service.retrieveContext("topic-1", "query");

      expect(result[0].senderName).toBe("bob");
    });

    it("should fall back to ai_member_display_name when user fields are absent", async () => {
      const queryEmb = [0.1];
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue({
        embedding: queryEmb,
        tokenCount: 2,
      });
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          message_id: "msg-3",
          content_summary: null,
          msg_content: "AI response",
          msg_created_at: new Date(),
          sender_full_name: null,
          sender_username: null,
          ai_member_display_name: "Research Agent",
          embedding: queryEmb,
        },
      ]);

      const result = await service.retrieveContext("topic-1", "query");

      expect(result[0].senderName).toBe("Research Agent");
    });

    it("should use Unknown when all sender fields are absent", async () => {
      const queryEmb = [0.1];
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue({
        embedding: queryEmb,
        tokenCount: 2,
      });
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          message_id: "msg-4",
          content_summary: null,
          msg_content: "Content",
          msg_created_at: new Date(),
          sender_full_name: null,
          sender_username: null,
          ai_member_display_name: null,
          embedding: queryEmb,
        },
      ]);

      const result = await service.retrieveContext("topic-1", "query");

      expect(result[0].senderName).toBe("Unknown");
    });

    it("should apply custom options (limit, threshold, excludeMessageIds)", async () => {
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue({
        embedding: [0.5],
        tokenCount: 3,
      });
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      await service.retrieveContext("topic-1", "query", {
        limit: 10,
        threshold: 0.7,
        excludeMessageIds: ["exclude-1", "exclude-2"],
        minContentLength: 200,
      });

      // Validate $queryRaw was called (options are embedded in the SQL)
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("should return empty array and not throw when DB query fails", async () => {
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue({
        embedding: [0.1],
        tokenCount: 2,
      });
      (mockPrisma.$queryRaw as jest.Mock).mockRejectedValue(
        new Error("pgvector error"),
      );

      const result = await service.retrieveContext("topic-1", "query");

      expect(result).toEqual([]);
    });
  });

  // ── buildEnhancedContext ──────────────────────────────────────────────────────

  describe("buildEnhancedContext", () => {
    it("should return empty string when no relevant context found", async () => {
      // embedTopicMessages → findMany returns []
      (mockPrisma.topicMessage.findMany as jest.Mock).mockResolvedValue([]);
      // retrieveContext → embeddingGenerate returns null
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue(null);

      const ctx = await service.buildEnhancedContext("topic-1", "query", []);

      expect(ctx).toBe("");
    });

    it("should return formatted context string when results are found", async () => {
      const queryEmb = [0.1, 0.2];
      // embedTopicMessages step: no messages to embed
      (mockPrisma.topicMessage.findMany as jest.Mock).mockResolvedValue([]);

      // retrieveContext step
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue({
        embedding: queryEmb,
        tokenCount: 5,
      });
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          message_id: "msg-r1",
          content_summary: "The summary text",
          msg_content: "Detailed content",
          msg_created_at: new Date(),
          sender_full_name: "Carol",
          sender_username: "carol",
          ai_member_display_name: null,
          embedding: queryEmb, // identical → cosine = 1.0
        },
      ]);

      const ctx = await service.buildEnhancedContext("topic-1", "test query", [
        "recent-msg",
      ]);

      expect(ctx).toContain("相关历史上下文");
      expect(ctx).toContain("Carol");
      expect(ctx).toContain("The summary text");
      expect(ctx).toContain("100.0%"); // cosine similarity = 1.0
    });

    it("should use content prefix when contentSummary is null", async () => {
      const queryEmb = [0.1];
      (mockPrisma.topicMessage.findMany as jest.Mock).mockResolvedValue([]);
      (mockFacade.embeddingGenerate as jest.Mock).mockResolvedValue({
        embedding: queryEmb,
        tokenCount: 2,
      });
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          message_id: "msg-r2",
          content_summary: null,
          msg_content: "Full content shown here",
          msg_created_at: new Date(),
          sender_full_name: "Dave",
          sender_username: "dave",
          ai_member_display_name: null,
          embedding: queryEmb,
        },
      ]);

      const ctx = await service.buildEnhancedContext("topic-1", "query", []);

      expect(ctx).toContain("Full content shown here");
    });
  });

  // ── getEmbeddingStats ─────────────────────────────────────────────────────────

  describe("getEmbeddingStats", () => {
    it("should return total and embedded message counts", async () => {
      (mockPrisma.topicMessage.count as jest.Mock).mockResolvedValue(100);
      (mockPrisma.topicMessageEmbedding.count as jest.Mock).mockResolvedValue(
        30,
      );

      const stats = await service.getEmbeddingStats("topic-1");

      expect(stats.totalMessages).toBe(100);
      expect(stats.embeddedMessages).toBe(30);
      expect(stats.longMessagesEstimate).toBe(30); // Math.floor(100 * 0.3)
    });

    it("should return zeros for empty topics", async () => {
      (mockPrisma.topicMessage.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.topicMessageEmbedding.count as jest.Mock).mockResolvedValue(
        0,
      );

      const stats = await service.getEmbeddingStats("empty-topic");

      expect(stats.totalMessages).toBe(0);
      expect(stats.embeddedMessages).toBe(0);
      expect(stats.longMessagesEstimate).toBe(0);
    });
  });
});
