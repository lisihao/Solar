// Mock modules with problematic transitive dependencies before any imports
jest.mock("../../../../../common/cache/cache.module", () => ({}));
jest.mock("../../../../../common/cache/cache.service", () => ({
  CacheService: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade");
jest.mock("@/modules/ai-harness/facade");
jest.mock("../../../../../common/prisma/prisma.service");

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { NotesService } from "../notes.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { CreateNoteDto, UpdateNoteDto, AddHighlightDto } from "../dto";

// ── Mock data ────────────────────────────────────────────────────────────────

const mockResource = {
  id: "res-1",
  type: "article",
  title: "Test Resource",
  abstract: "An abstract about the resource",
  thumbnailUrl: null,
};

const mockNote = {
  id: "note-1",
  content: "Test note content",
  title: "Test Note",
  userId: "user-1",
  resourceId: "res-1",
  source: null,
  isBookmarked: false,
  isPublic: false,
  highlights: [],
  graphNodes: [],
  aiInsights: null,
  tags: [],
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  resource: mockResource,
  user: { id: "user-1", username: "testuser", avatarUrl: null },
};

const mockDefaultModel = {
  id: "model-1",
  modelId: "test-model",
  displayName: "Test Model",
  provider: "openai",
  maxTokens: 4096,
};

// ── Mock Prisma ───────────────────────────────────────────────────────────────

const mockPrisma = {
  note: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  resource: {
    findUnique: jest.fn(),
  },
};

// ── Mock Facade ───────────────────────────────────────────────────────────────

const mockFacade = {
  getDefaultTextModel: jest.fn(),
  chat: jest.fn(),
};

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("NotesService", () => {
  let service: NotesService;

  beforeEach(async () => {
    // Set default mock implementations
    mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
    mockFacade.chat.mockResolvedValue({
      content:
        '{"keyPoints": [{"title": "Key Point", "insight": "Insight text", "importance": "high"}]}',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<NotesService>(NotesService);
    jest.clearAllMocks();

    // Re-set after clearAllMocks
    mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
    mockFacade.chat.mockResolvedValue({
      content:
        '{"keyPoints": [{"title": "Key Point", "insight": "Insight text", "importance": "high"}]}',
    });
  });

  // ── createNote ──────────────────────────────────────────────────────────────

  describe("createNote", () => {
    const dto: CreateNoteDto = {
      content: "Test note content",
      title: "Test Note",
    };

    it("creates a standalone note without resourceId", async () => {
      mockPrisma.note.create.mockResolvedValue({
        ...mockNote,
        resourceId: null,
        resource: null,
      });

      const result = await service.createNote("user-1", dto);

      expect(result).toMatchObject({ content: "Test note content" });
      expect(mockPrisma.resource.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.note.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user: { connect: { id: "user-1" } },
            content: "Test note content",
          }),
        }),
      );
    });

    it("creates a note linked to a valid resource", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue({ id: "res-1" });
      mockPrisma.note.create.mockResolvedValue(mockNote);

      const dtoWithResource: CreateNoteDto = { ...dto, resourceId: "res-1" };

      const result = await service.createNote("user-1", dtoWithResource);

      expect(result).toMatchObject({ id: "note-1", resourceId: "res-1" });
      expect(mockPrisma.resource.findUnique).toHaveBeenCalledWith({
        where: { id: "res-1" },
        select: { id: true },
      });
    });

    it("throws NotFoundException when resourceId points to non-existent resource", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(null);

      const dtoWithBadResource: CreateNoteDto = {
        ...dto,
        resourceId: "res-nonexistent",
      };

      await expect(
        service.createNote("user-1", dtoWithBadResource),
      ).rejects.toThrow(NotFoundException);
    });

    it("treats empty string resourceId as null (no FK lookup)", async () => {
      mockPrisma.note.create.mockResolvedValue({
        ...mockNote,
        resourceId: null,
        resource: null,
      });

      await service.createNote("user-1", { ...dto, resourceId: "" });

      expect(mockPrisma.resource.findUnique).not.toHaveBeenCalled();
    });

    it("sets isPublic to false by default", async () => {
      mockPrisma.note.create.mockResolvedValue(mockNote);

      await service.createNote("user-1", dto);

      expect(mockPrisma.note.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPublic: false }),
        }),
      );
    });

    it("initializes highlights as empty array when not provided", async () => {
      mockPrisma.note.create.mockResolvedValue(mockNote);

      await service.createNote("user-1", { content: "content" });

      expect(mockPrisma.note.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ highlights: [] }),
        }),
      );
    });
  });

  // ── getUserNotes ────────────────────────────────────────────────────────────

  describe("getUserNotes", () => {
    it("returns paginated notes with total count", async () => {
      mockPrisma.note.findMany.mockResolvedValue([mockNote]);
      mockPrisma.note.count.mockResolvedValue(1);

      const result = await service.getUserNotes("user-1");

      expect(result).toMatchObject({
        notes: [expect.objectContaining({ id: "note-1" })],
        total: 1,
        skip: 0,
        take: 50,
      });
    });

    it("applies skip and take parameters", async () => {
      mockPrisma.note.findMany.mockResolvedValue([]);
      mockPrisma.note.count.mockResolvedValue(20);

      await service.getUserNotes("user-1", 10, 5);

      expect(mockPrisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
    });

    it("filters by source when provided", async () => {
      mockPrisma.note.findMany.mockResolvedValue([]);
      mockPrisma.note.count.mockResolvedValue(0);

      await service.getUserNotes("user-1", 0, 50, "pdf");

      expect(mockPrisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-1", source: "pdf" }),
        }),
      );
    });

    it("returns empty notes array when user has no notes", async () => {
      mockPrisma.note.findMany.mockResolvedValue([]);
      mockPrisma.note.count.mockResolvedValue(0);

      const result = await service.getUserNotes("user-1");

      expect(result.notes).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ── getResourceNotes ────────────────────────────────────────────────────────

  describe("getResourceNotes", () => {
    it("returns only public notes when userId is not provided", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        { ...mockNote, isPublic: true },
      ]);

      const result = await service.getResourceNotes("res-1");

      expect(result).toHaveLength(1);
      expect(mockPrisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { resourceId: "res-1", isPublic: true },
        }),
      );
    });

    it("returns public notes and user's own notes when userId is provided", async () => {
      mockPrisma.note.findMany.mockResolvedValue([mockNote]);

      const result = await service.getResourceNotes("res-1", "user-1");

      expect(result).toHaveLength(1);
      expect(mockPrisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            resourceId: "res-1",
            OR: [{ isPublic: true }, { userId: "user-1" }],
          },
        }),
      );
    });

    it("returns empty array when no notes found for resource", async () => {
      mockPrisma.note.findMany.mockResolvedValue([]);

      const result = await service.getResourceNotes("res-x");

      expect(result).toHaveLength(0);
    });
  });

  // ── getNote ─────────────────────────────────────────────────────────────────

  describe("getNote", () => {
    it("returns note for owner", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(mockNote);

      const result = await service.getNote("note-1", "user-1");

      expect(result).toMatchObject({ id: "note-1" });
    });

    it("returns public note without userId", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        isPublic: true,
        userId: "other-user",
      });

      const result = await service.getNote("note-1");

      expect(result).toMatchObject({ id: "note-1", isPublic: true });
    });

    it("returns public note belonging to another user when authenticated", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        isPublic: true,
        userId: "other-user",
      });

      const result = await service.getNote("note-1", "user-1");

      expect(result).toMatchObject({ id: "note-1" });
    });

    it("throws NotFoundException when note does not exist", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(null);

      await expect(service.getNote("note-x", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when accessing private note of another user", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        isPublic: false,
        userId: "other-user",
      });

      await expect(service.getNote("note-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── updateNote ──────────────────────────────────────────────────────────────

  describe("updateNote", () => {
    const dto: UpdateNoteDto = { content: "Updated content" };

    it("updates note content for owner", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(mockNote);
      const updatedNote = { ...mockNote, content: "Updated content" };
      mockPrisma.note.update.mockResolvedValue(updatedNote);

      const result = await service.updateNote("note-1", "user-1", dto);

      expect(result.content).toBe("Updated content");
      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "note-1" },
          data: expect.objectContaining({ content: "Updated content" }),
        }),
      );
    });

    it("throws NotFoundException when note does not exist", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(null);

      await expect(service.updateNote("note-x", "user-1", dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when updating another user's note", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        userId: "other-user",
      });

      await expect(service.updateNote("note-1", "user-1", dto)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── deleteNote ──────────────────────────────────────────────────────────────

  describe("deleteNote", () => {
    it("deletes note for owner and returns success", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(mockNote);
      mockPrisma.note.delete.mockResolvedValue(mockNote);

      const result = await service.deleteNote("note-1", "user-1");

      expect(result).toEqual({ success: true });
      expect(mockPrisma.note.delete).toHaveBeenCalledWith({
        where: { id: "note-1" },
      });
    });

    it("throws NotFoundException when note does not exist", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(null);

      await expect(service.deleteNote("note-x", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when deleting another user's note", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        userId: "other-user",
      });

      await expect(service.deleteNote("note-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── addHighlight ────────────────────────────────────────────────────────────

  describe("addHighlight", () => {
    const dto: AddHighlightDto = {
      text: "selected text",
      startOffset: 10,
      endOffset: 23,
      color: "#ff0000",
    };

    it("appends a new highlight to the note's highlights array", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        highlights: [],
      });
      mockPrisma.note.update.mockResolvedValue(mockNote);

      await service.addHighlight("note-1", "user-1", dto);

      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "note-1" },
          data: expect.objectContaining({
            highlights: expect.arrayContaining([
              expect.objectContaining({
                text: "selected text",
                startOffset: 10,
                endOffset: 23,
              }),
            ]),
          }),
        }),
      );
    });

    it("defaults color to #ffeb3b when color not provided", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        highlights: [],
      });
      mockPrisma.note.update.mockResolvedValue(mockNote);

      await service.addHighlight("note-1", "user-1", {
        text: "text",
        startOffset: 0,
        endOffset: 4,
      });

      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            highlights: expect.arrayContaining([
              expect.objectContaining({ color: "#ffeb3b" }),
            ]),
          }),
        }),
      );
    });

    it("preserves existing highlights when adding a new one", async () => {
      const existingHighlight = {
        id: "hl-existing",
        text: "existing",
        startOffset: 0,
        endOffset: 8,
        color: "#yellow",
        createdAt: "2024-01-01T00:00:00.000Z",
      };
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        highlights: [existingHighlight],
      });
      mockPrisma.note.update.mockResolvedValue(mockNote);

      await service.addHighlight("note-1", "user-1", dto);

      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            highlights: expect.arrayContaining([
              expect.objectContaining({ id: "hl-existing" }),
              expect.objectContaining({ text: "selected text" }),
            ]),
          }),
        }),
      );
    });

    it("throws NotFoundException when note does not exist", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(null);

      await expect(
        service.addHighlight("note-x", "user-1", dto),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when modifying another user's note", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        userId: "other-user",
      });

      await expect(
        service.addHighlight("note-1", "user-1", dto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── removeHighlight ─────────────────────────────────────────────────────────

  describe("removeHighlight", () => {
    const highlightId = "hl-1";
    const noteWithHighlight = {
      ...mockNote,
      highlights: [
        { id: "hl-1", text: "highlighted", startOffset: 0, endOffset: 11 },
        { id: "hl-2", text: "another", startOffset: 20, endOffset: 27 },
      ],
    };

    it("removes the specified highlight by id", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(noteWithHighlight);
      mockPrisma.note.update.mockResolvedValue(mockNote);

      await service.removeHighlight("note-1", "user-1", highlightId);

      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            highlights: [expect.objectContaining({ id: "hl-2" })],
          }),
        }),
      );
    });

    it("handles gracefully when highlight id does not exist (no-op remove)", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(noteWithHighlight);
      mockPrisma.note.update.mockResolvedValue(mockNote);

      await service.removeHighlight("note-1", "user-1", "hl-nonexistent");

      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            highlights: expect.arrayContaining([
              expect.objectContaining({ id: "hl-1" }),
              expect.objectContaining({ id: "hl-2" }),
            ]),
          }),
        }),
      );
    });

    it("throws NotFoundException when note does not exist", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(null);

      await expect(
        service.removeHighlight("note-x", "user-1", highlightId),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when modifying another user's note", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...noteWithHighlight,
        userId: "other-user",
      });

      await expect(
        service.removeHighlight("note-1", "user-1", highlightId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── requestAIExplanation ────────────────────────────────────────────────────

  describe("requestAIExplanation", () => {
    it("returns AI explanation and persists it to aiInsights", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        aiInsights: null,
        resource: { ...mockResource },
      });
      mockFacade.chat.mockResolvedValue({
        content: "This text means XYZ in the context of the document.",
      });
      mockPrisma.note.update.mockResolvedValue(mockNote);

      const result = await service.requestAIExplanation(
        "note-1",
        "user-1",
        "selected text",
      );

      expect(result).toMatchObject({
        text: "selected text",
        explanation: "This text means XYZ in the context of the document.",
        timestamp: expect.any(String),
      });
      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "note-1" } }),
      );
    });

    it("uses pdf context when pdfContext is provided", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        resource: null,
      });
      mockFacade.chat.mockResolvedValue({
        content: "Explanation using PDF context.",
      });
      mockPrisma.note.update.mockResolvedValue(mockNote);

      await service.requestAIExplanation(
        "note-1",
        "user-1",
        "some text",
        "PDF content here",
      );

      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("PDF内容:"),
        }),
      );
    });

    it("truncates very long pdf context to 10000 characters", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        resource: null,
      });
      mockFacade.chat.mockResolvedValue({ content: "Explanation." });
      mockPrisma.note.update.mockResolvedValue(mockNote);

      const longPdfContent = "x".repeat(15000);
      await service.requestAIExplanation(
        "note-1",
        "user-1",
        "text",
        longPdfContent,
      );

      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("[内容已截断]"),
        }),
      );
    });

    it("falls back to resource context when no pdfContext", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        resource: { ...mockResource, abstract: "Resource abstract" },
      });
      mockFacade.chat.mockResolvedValue({
        content: "Explanation from resource.",
      });
      mockPrisma.note.update.mockResolvedValue(mockNote);

      await service.requestAIExplanation("note-1", "user-1", "text");

      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("资源标题:"),
        }),
      );
    });

    it("returns default message when AI service fails", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        resource: null,
      });
      mockFacade.chat.mockRejectedValue(new Error("AI service down"));
      mockPrisma.note.update.mockResolvedValue(mockNote);

      const result = await service.requestAIExplanation(
        "note-1",
        "user-1",
        "text",
      );

      expect(result.explanation).toBe("AI服务暂时不可用");
    });

    it("throws NotFoundException when note does not exist", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(null);

      await expect(
        service.requestAIExplanation("note-x", "user-1", "text"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when requesting explanation on another user's note", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        userId: "other-user",
      });

      await expect(
        service.requestAIExplanation("note-1", "user-1", "text"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── toggleBookmark ──────────────────────────────────────────────────────────

  describe("toggleBookmark", () => {
    it("toggles isBookmarked from false to true", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        isBookmarked: false,
      });
      mockPrisma.note.update.mockResolvedValue({
        ...mockNote,
        isBookmarked: true,
      });

      const result = await service.toggleBookmark("note-1", "user-1");

      expect(result.isBookmarked).toBe(true);
      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isBookmarked: true },
        }),
      );
    });

    it("toggles isBookmarked from true to false", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        isBookmarked: true,
      });
      mockPrisma.note.update.mockResolvedValue({
        ...mockNote,
        isBookmarked: false,
      });

      const result = await service.toggleBookmark("note-1", "user-1");

      expect(result.isBookmarked).toBe(false);
      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isBookmarked: false },
        }),
      );
    });

    it("throws NotFoundException when note does not exist", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(null);

      await expect(service.toggleBookmark("note-x", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when bookmarking another user's note", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        userId: "other-user",
      });

      await expect(service.toggleBookmark("note-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── linkGraphNode ───────────────────────────────────────────────────────────

  describe("linkGraphNode", () => {
    it("adds a new graph node to the note", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        graphNodes: [],
      });
      mockPrisma.note.update.mockResolvedValue(mockNote);

      await service.linkGraphNode("note-1", "user-1", "node-x", "concept");

      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            graphNodes: expect.arrayContaining([
              expect.objectContaining({ id: "node-x", type: "concept" }),
            ]),
          }),
        }),
      );
    });

    it("returns existing note without update when node already linked", async () => {
      const existingNode = {
        id: "node-x",
        type: "concept",
        linkedAt: "2024-01-01T00:00:00.000Z",
      };
      const noteWithNode = { ...mockNote, graphNodes: [existingNode] };
      mockPrisma.note.findUnique.mockResolvedValue(noteWithNode);

      const result = await service.linkGraphNode(
        "note-1",
        "user-1",
        "node-x",
        "concept",
      );

      expect(result).toMatchObject({ id: "note-1" });
      expect(mockPrisma.note.update).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when note does not exist", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(null);

      await expect(
        service.linkGraphNode("note-x", "user-1", "node-1", "topic"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when modifying another user's note", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        userId: "other-user",
        graphNodes: [],
      });

      await expect(
        service.linkGraphNode("note-1", "user-1", "node-1", "topic"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── unlinkGraphNode ─────────────────────────────────────────────────────────

  describe("unlinkGraphNode", () => {
    const existingNode = {
      id: "node-x",
      type: "concept",
      linkedAt: "2024-01-01T00:00:00.000Z",
    };
    const noteWithNode = { ...mockNote, graphNodes: [existingNode] };

    it("removes the specified graph node from the note", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(noteWithNode);
      mockPrisma.note.update.mockResolvedValue({
        ...mockNote,
        graphNodes: [],
      });

      await service.unlinkGraphNode("note-1", "user-1", "node-x");

      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ graphNodes: [] }),
        }),
      );
    });

    it("returns note without update when node does not exist (no-op)", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...mockNote,
        graphNodes: [existingNode],
      });

      const result = await service.unlinkGraphNode(
        "note-1",
        "user-1",
        "node-nonexistent",
      );

      expect(result).toMatchObject({ id: "note-1" });
      expect(mockPrisma.note.update).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when note does not exist", async () => {
      mockPrisma.note.findUnique.mockResolvedValue(null);

      await expect(
        service.unlinkGraphNode("note-x", "user-1", "node-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when modifying another user's note", async () => {
      mockPrisma.note.findUnique.mockResolvedValue({
        ...noteWithNode,
        userId: "other-user",
      });

      await expect(
        service.unlinkGraphNode("note-1", "user-1", "node-x"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── extractKeyPoints ────────────────────────────────────────────────────────

  describe("extractKeyPoints", () => {
    it("returns empty keyPoints message when user has no notes", async () => {
      mockPrisma.note.findMany.mockResolvedValue([]);

      const result = await service.extractKeyPoints("user-1");

      expect(result).toMatchObject({
        keyPoints: [],
        message: "No notes found to analyze",
      });
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });

    it("extracts key points from notes using AI", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        {
          id: "note-1",
          title: "ML Notes",
          content: "Deep learning is a subset of machine learning.",
        },
      ]);
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          keyPoints: [
            {
              title: "Deep Learning",
              insight: "It is a subset of ML",
              importance: "high",
              sourceNotes: ["note-1"],
            },
          ],
        }),
      });

      const result = await service.extractKeyPoints("user-1");

      expect(result).toHaveProperty("keyPoints");
      expect(result.keyPoints).toHaveLength(1);
      expect(result.keyPoints[0]).toMatchObject({ title: "Deep Learning" });
    });

    it("handles non-JSON AI response gracefully", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        { id: "note-1", title: "Title", content: "Content" },
      ]);
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockFacade.chat.mockResolvedValue({
        content: "Some raw non-JSON analysis text",
      });

      const result = await service.extractKeyPoints("user-1");

      expect(result).toHaveProperty("keyPoints");
      expect(result.keyPoints[0]).toMatchObject({ importance: "medium" });
    });

    it("throws when no default text model is available", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        { id: "note-1", title: "Title", content: "Content" },
      ]);
      mockFacade.getDefaultTextModel.mockResolvedValue(null);

      await expect(service.extractKeyPoints("user-1")).rejects.toThrow(
        "No default text model available",
      );
    });

    it("re-throws AI errors", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        { id: "note-1", title: "Title", content: "Content" },
      ]);
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockFacade.chat.mockRejectedValue(new Error("AI service unavailable"));

      await expect(service.extractKeyPoints("user-1")).rejects.toThrow(
        "AI service unavailable",
      );
    });
  });

  // ── findConnections ─────────────────────────────────────────────────────────

  describe("findConnections", () => {
    it("returns early message when user has fewer than 2 notes", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        { id: "note-1", title: "Solo Note", content: "content", tags: [] },
      ]);

      const result = await service.findConnections("user-1");

      expect(result).toMatchObject({
        connections: [],
        message: "Need at least 2 notes to find connections",
      });
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });

    it("finds connections between notes using AI", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        { id: "note-1", title: "ML Notes", content: "About ML", tags: ["ml"] },
        { id: "note-2", title: "AI Notes", content: "About AI", tags: ["ai"] },
      ]);
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          connections: [
            {
              noteIds: ["note-1", "note-2"],
              relationship: "Both are about AI/ML",
              strength: "strong",
              theme: "Artificial Intelligence",
            },
          ],
        }),
      });

      const result = await service.findConnections("user-1");

      expect(result).toHaveProperty("connections");
      expect(result.connections).toHaveLength(1);
      expect(result.connections[0]).toMatchObject({
        relationship: "Both are about AI/ML",
        note1Title: expect.any(String),
        note2Title: expect.any(String),
      });
    });

    it("handles JSON wrapped in markdown code blocks", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        { id: "note-1", title: "N1", content: "c1", tags: [] },
        { id: "note-2", title: "N2", content: "c2", tags: [] },
      ]);
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockFacade.chat.mockResolvedValue({
        content:
          '```json\n{"connections": [{"noteIds": ["note-1", "note-2"], "relationship": "related", "strength": "moderate", "theme": "topic"}]}\n```',
      });

      const result = await service.findConnections("user-1");

      expect(result.connections).toHaveLength(1);
    });

    it("returns rawAnalysis on JSON parse failure", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        { id: "note-1", title: "N1", content: "c1", tags: [] },
        { id: "note-2", title: "N2", content: "c2", tags: [] },
      ]);
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockFacade.chat.mockResolvedValue({
        content: "plain text no json here",
      });

      const result = await service.findConnections("user-1");

      expect(result).toMatchObject({ connections: [] });
      expect(result).toHaveProperty("rawAnalysis");
    });

    it("throws when no default text model is available", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        { id: "note-1", title: "N1", content: "c1", tags: [] },
        { id: "note-2", title: "N2", content: "c2", tags: [] },
      ]);
      mockFacade.getDefaultTextModel.mockResolvedValue(null);

      await expect(service.findConnections("user-1")).rejects.toThrow(
        "No default text model available",
      );
    });
  });

  // ── summarizeNotes ──────────────────────────────────────────────────────────

  describe("summarizeNotes", () => {
    it("returns default message when user has no notes", async () => {
      mockPrisma.note.findMany.mockResolvedValue([]);

      const result = await service.summarizeNotes("user-1");

      expect(result).toMatchObject({
        summary: "No notes found to summarize",
        highlights: [],
      });
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });

    it("summarizes notes using AI and returns structured result", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        {
          id: "note-1",
          title: "ML Notes",
          content: "About machine learning",
          createdAt: new Date("2024-01-01"),
        },
      ]);
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          summary: "Comprehensive summary of notes",
          themes: ["machine learning"],
          highlights: [{ point: "Key concept", category: "technology" }],
          suggestedActions: ["Read more about ML"],
        }),
      });

      const result = await service.summarizeNotes("user-1");

      expect(result).toMatchObject({
        summary: "Comprehensive summary of notes",
        themes: ["machine learning"],
        highlights: expect.any(Array),
      });
    });

    it("handles non-JSON AI response gracefully", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        {
          id: "note-1",
          title: "Title",
          content: "Content",
          createdAt: new Date(),
        },
      ]);
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockFacade.chat.mockResolvedValue({
        content: "Plain text summary that cannot be parsed as JSON",
      });

      const result = await service.summarizeNotes("user-1");

      expect(result).toMatchObject({
        summary: "Plain text summary that cannot be parsed as JSON",
        themes: [],
        highlights: [],
      });
    });

    it("throws when no default text model is available", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        { id: "note-1", title: "T", content: "C", createdAt: new Date() },
      ]);
      mockFacade.getDefaultTextModel.mockResolvedValue(null);

      await expect(service.summarizeNotes("user-1")).rejects.toThrow(
        "No default text model available",
      );
    });

    it("re-throws AI errors", async () => {
      mockPrisma.note.findMany.mockResolvedValue([
        { id: "note-1", title: "T", content: "C", createdAt: new Date() },
      ]);
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockFacade.chat.mockRejectedValue(new Error("AI unavailable"));

      await expect(service.summarizeNotes("user-1")).rejects.toThrow(
        "AI unavailable",
      );
    });
  });
});
