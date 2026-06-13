// Mock BillingContext before any imports to avoid real async-local-storage usage
jest.mock("../../../../platform/credits/billing-context.store", () => ({
  BillingContext: {
    run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()),
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { NotesController } from "../notes.controller";
import { NotesService } from "../notes.service";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(userId: string | undefined): RequestWithUser {
  return {
    user: userId ? { id: userId } : undefined,
  } as RequestWithUser;
}

const USER_ID = "user-001";
const NOTE_ID = "note-001";

// ── Mock data ─────────────────────────────────────────────────────────────────

const mockNote = {
  id: NOTE_ID,
  content: "Test note content",
  userId: USER_ID,
  resourceId: "res-001",
  bookmarked: false,
  highlights: [],
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const mockHighlight = {
  id: "highlight-001",
  text: "highlighted text",
  noteId: NOTE_ID,
};

const mockPaginatedNotes = {
  items: [mockNote],
  total: 1,
  skip: 0,
  take: 20,
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe("NotesController", () => {
  let controller: NotesController;
  let notesService: jest.Mocked<NotesService>;

  beforeEach(async () => {
    const mockService = {
      createNote: jest.fn(),
      getUserNotes: jest.fn(),
      getResourceNotes: jest.fn(),
      getNote: jest.fn(),
      updateNote: jest.fn(),
      deleteNote: jest.fn(),
      toggleBookmark: jest.fn(),
      addHighlight: jest.fn(),
      removeHighlight: jest.fn(),
      requestAIExplanation: jest.fn(),
      linkGraphNode: jest.fn(),
      unlinkGraphNode: jest.fn(),
      extractKeyPoints: jest.fn(),
      findConnections: jest.fn(),
      summarizeNotes: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotesController],
      providers: [{ provide: NotesService, useValue: mockService }],
    }).compile();

    controller = module.get<NotesController>(NotesController);
    notesService = module.get(NotesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── createNote ────────────────────────────────────────────────────────────────

  describe("POST /notes", () => {
    const dto = { content: "Test note", resourceId: "res-001" };

    it("delegates to notesService.createNote with userId and dto", async () => {
      notesService.createNote.mockResolvedValue(mockNote as never);

      const result = await controller.createNote(
        makeReq(USER_ID),
        dto as never,
      );

      expect(notesService.createNote).toHaveBeenCalledWith(USER_ID, dto);
      expect(result).toEqual(mockNote);
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.createNote(makeReq(undefined), dto as never),
      ).rejects.toThrow(UnauthorizedException);

      expect(notesService.createNote).not.toHaveBeenCalled();
    });
  });

  // ── getUserNotes ──────────────────────────────────────────────────────────────

  describe("GET /notes", () => {
    it("delegates to notesService.getUserNotes with parsed pagination", async () => {
      notesService.getUserNotes.mockResolvedValue(mockPaginatedNotes as never);

      const result = await controller.getUserNotes(
        makeReq(USER_ID),
        "0",
        "20",
        "manual",
      );

      expect(notesService.getUserNotes).toHaveBeenCalledWith(
        USER_ID,
        0,
        20,
        "manual",
      );
      expect(result).toEqual(mockPaginatedNotes);
    });

    it("delegates with undefined pagination and source when not provided", async () => {
      notesService.getUserNotes.mockResolvedValue(mockPaginatedNotes as never);

      await controller.getUserNotes(makeReq(USER_ID));

      expect(notesService.getUserNotes).toHaveBeenCalledWith(
        USER_ID,
        expect.any(Number),
        expect.any(Number),
        undefined,
      );
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(controller.getUserNotes(makeReq(undefined))).rejects.toThrow(
        UnauthorizedException,
      );

      expect(notesService.getUserNotes).not.toHaveBeenCalled();
    });
  });

  // ── getResourceNotes ──────────────────────────────────────────────────────────

  describe("GET /notes/resource/:resourceId", () => {
    it("delegates to notesService.getResourceNotes with userId when authenticated", async () => {
      notesService.getResourceNotes.mockResolvedValue([mockNote] as never);

      const result = await controller.getResourceNotes(
        "res-001",
        makeReq(USER_ID),
      );

      expect(notesService.getResourceNotes).toHaveBeenCalledWith(
        "res-001",
        USER_ID,
      );
      expect(result).toEqual([mockNote]);
    });

    it("delegates with undefined userId for anonymous access", async () => {
      notesService.getResourceNotes.mockResolvedValue([] as never);

      await controller.getResourceNotes("res-001", makeReq(undefined));

      expect(notesService.getResourceNotes).toHaveBeenCalledWith(
        "res-001",
        undefined,
      );
    });
  });

  // ── getNote ───────────────────────────────────────────────────────────────────

  describe("GET /notes/:id", () => {
    it("delegates to notesService.getNote with id and userId when authenticated", async () => {
      notesService.getNote.mockResolvedValue(mockNote as never);

      const result = await controller.getNote(NOTE_ID, makeReq(USER_ID));

      expect(notesService.getNote).toHaveBeenCalledWith(NOTE_ID, USER_ID);
      expect(result).toEqual(mockNote);
    });

    it("delegates with undefined userId for anonymous access", async () => {
      notesService.getNote.mockResolvedValue(mockNote as never);

      await controller.getNote(NOTE_ID, makeReq(undefined));

      expect(notesService.getNote).toHaveBeenCalledWith(NOTE_ID, undefined);
    });
  });

  // ── updateNote ────────────────────────────────────────────────────────────────

  describe("PATCH /notes/:id", () => {
    const dto = { content: "Updated content" };

    it("delegates to notesService.updateNote with id, userId, and dto", async () => {
      const updated = { ...mockNote, content: "Updated content" };
      notesService.updateNote.mockResolvedValue(updated as never);

      const result = await controller.updateNote(
        NOTE_ID,
        makeReq(USER_ID),
        dto as never,
      );

      expect(notesService.updateNote).toHaveBeenCalledWith(
        NOTE_ID,
        USER_ID,
        dto,
      );
      expect(result).toEqual(updated);
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.updateNote(NOTE_ID, makeReq(undefined), dto as never),
      ).rejects.toThrow(UnauthorizedException);

      expect(notesService.updateNote).not.toHaveBeenCalled();
    });
  });

  // ── deleteNote ────────────────────────────────────────────────────────────────

  describe("DELETE /notes/:id", () => {
    it("delegates to notesService.deleteNote with id and userId", async () => {
      notesService.deleteNote.mockResolvedValue(undefined as never);

      await controller.deleteNote(NOTE_ID, makeReq(USER_ID));

      expect(notesService.deleteNote).toHaveBeenCalledWith(NOTE_ID, USER_ID);
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.deleteNote(NOTE_ID, makeReq(undefined)),
      ).rejects.toThrow(UnauthorizedException);

      expect(notesService.deleteNote).not.toHaveBeenCalled();
    });
  });

  // ── toggleBookmark ────────────────────────────────────────────────────────────

  describe("POST /notes/:id/bookmark", () => {
    it("delegates to notesService.toggleBookmark with id and userId", async () => {
      const toggled = { ...mockNote, bookmarked: true };
      notesService.toggleBookmark.mockResolvedValue(toggled as never);

      const result = await controller.toggleBookmark(NOTE_ID, makeReq(USER_ID));

      expect(notesService.toggleBookmark).toHaveBeenCalledWith(
        NOTE_ID,
        USER_ID,
      );
      expect(result).toEqual(toggled);
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.toggleBookmark(NOTE_ID, makeReq(undefined)),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── addHighlight ──────────────────────────────────────────────────────────────

  describe("POST /notes/:id/highlights", () => {
    const dto = { text: "highlighted text", startOffset: 10, endOffset: 25 };

    it("delegates to notesService.addHighlight with id, userId, and dto", async () => {
      notesService.addHighlight.mockResolvedValue(mockHighlight as never);

      const result = await controller.addHighlight(
        NOTE_ID,
        makeReq(USER_ID),
        dto as never,
      );

      expect(notesService.addHighlight).toHaveBeenCalledWith(
        NOTE_ID,
        USER_ID,
        dto,
      );
      expect(result).toEqual(mockHighlight);
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.addHighlight(NOTE_ID, makeReq(undefined), dto as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── removeHighlight ───────────────────────────────────────────────────────────

  describe("DELETE /notes/:id/highlights/:highlightId", () => {
    it("delegates to notesService.removeHighlight with ids and userId", async () => {
      notesService.removeHighlight.mockResolvedValue(undefined as never);

      await controller.removeHighlight(
        NOTE_ID,
        "highlight-001",
        makeReq(USER_ID),
      );

      expect(notesService.removeHighlight).toHaveBeenCalledWith(
        NOTE_ID,
        USER_ID,
        "highlight-001",
      );
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.removeHighlight(
          NOTE_ID,
          "highlight-001",
          makeReq(undefined),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── requestAIExplanation ─────────────────────────────────────────────────────

  describe("POST /notes/:id/ai-explain", () => {
    it("runs notesService.requestAIExplanation via BillingContext", async () => {
      const explanation = { explanation: "This means...", model: "gpt-4" };
      notesService.requestAIExplanation.mockResolvedValue(explanation as never);

      const result = await controller.requestAIExplanation(
        NOTE_ID,
        makeReq(USER_ID),
        "selected text",
        "surrounding context",
      );

      expect(notesService.requestAIExplanation).toHaveBeenCalledWith(
        NOTE_ID,
        USER_ID,
        "selected text",
        "surrounding context",
      );
      expect(result).toEqual(explanation);
    });

    it("runs without pdfContext when not provided", async () => {
      notesService.requestAIExplanation.mockResolvedValue({} as never);

      await controller.requestAIExplanation(
        NOTE_ID,
        makeReq(USER_ID),
        "text",
        undefined,
      );

      expect(notesService.requestAIExplanation).toHaveBeenCalledWith(
        NOTE_ID,
        USER_ID,
        "text",
        undefined,
      );
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.requestAIExplanation(NOTE_ID, makeReq(undefined), "text"),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── linkGraphNode ─────────────────────────────────────────────────────────────

  describe("POST /notes/:id/graph-nodes", () => {
    it("delegates to notesService.linkGraphNode with id, userId, nodeId, nodeType", async () => {
      const linked = {
        ...mockNote,
        graphNodes: [{ nodeId: "node-001", nodeType: "concept" }],
      };
      notesService.linkGraphNode.mockResolvedValue(linked as never);

      const result = await controller.linkGraphNode(
        NOTE_ID,
        makeReq(USER_ID),
        "node-001",
        "concept",
      );

      expect(notesService.linkGraphNode).toHaveBeenCalledWith(
        NOTE_ID,
        USER_ID,
        "node-001",
        "concept",
      );
      expect(result).toEqual(linked);
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.linkGraphNode(
          NOTE_ID,
          makeReq(undefined),
          "node-001",
          "concept",
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── unlinkGraphNode ───────────────────────────────────────────────────────────

  describe("DELETE /notes/:id/graph-nodes/:nodeId", () => {
    it("delegates to notesService.unlinkGraphNode with id, nodeId, userId", async () => {
      notesService.unlinkGraphNode.mockResolvedValue(undefined as never);

      await controller.unlinkGraphNode(NOTE_ID, "node-001", makeReq(USER_ID));

      expect(notesService.unlinkGraphNode).toHaveBeenCalledWith(
        NOTE_ID,
        USER_ID,
        "node-001",
      );
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.unlinkGraphNode(NOTE_ID, "node-001", makeReq(undefined)),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── extractKeyPoints ─────────────────────────────────────────────────────────

  describe("POST /notes/ai/extract-keypoints", () => {
    it("runs notesService.extractKeyPoints via BillingContext", async () => {
      const keyPoints = { keyPoints: ["Point 1", "Point 2"], model: "gpt-4" };
      notesService.extractKeyPoints.mockResolvedValue(keyPoints as never);

      const result = await controller.extractKeyPoints(makeReq(USER_ID));

      expect(notesService.extractKeyPoints).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual(keyPoints);
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.extractKeyPoints(makeReq(undefined)),
      ).rejects.toThrow(UnauthorizedException);

      expect(notesService.extractKeyPoints).not.toHaveBeenCalled();
    });
  });

  // ── findConnections ───────────────────────────────────────────────────────────

  describe("POST /notes/ai/find-connections", () => {
    it("runs notesService.findConnections via BillingContext", async () => {
      const connections = {
        connections: [
          { noteA: NOTE_ID, noteB: "note-002", reason: "similar topic" },
        ],
      };
      notesService.findConnections.mockResolvedValue(connections as never);

      const result = await controller.findConnections(makeReq(USER_ID));

      expect(notesService.findConnections).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual(connections);
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.findConnections(makeReq(undefined)),
      ).rejects.toThrow(UnauthorizedException);

      expect(notesService.findConnections).not.toHaveBeenCalled();
    });
  });

  // ── summarizeNotes ────────────────────────────────────────────────────────────

  describe("POST /notes/ai/summarize", () => {
    it("runs notesService.summarizeNotes via BillingContext", async () => {
      const summary = {
        summary: "Your notes cover AI and machine learning topics.",
        model: "gpt-4",
      };
      notesService.summarizeNotes.mockResolvedValue(summary as never);

      const result = await controller.summarizeNotes(makeReq(USER_ID));

      expect(notesService.summarizeNotes).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual(summary);
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.summarizeNotes(makeReq(undefined)),
      ).rejects.toThrow(UnauthorizedException);

      expect(notesService.summarizeNotes).not.toHaveBeenCalled();
    });
  });
});
