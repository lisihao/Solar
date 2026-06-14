/**
 * Tests for ResearchProjectChatService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { ResearchProjectChatService } from "../project/research-project-chat.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn().mockImplementation(() => ({
    chat: jest.fn(),
    getModelById: jest.fn(),
    getDefaultTextModel: jest.fn(),
  })),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn().mockImplementation(() => ({
    chat: jest.fn(),
    getModelById: jest.fn(),
    getDefaultTextModel: jest.fn(),
  })),
}));

jest.mock("../../../../common/prisma/prisma.service");

// Mock BillingContext to just call the provided fn
jest.mock("../../../platform/credits/billing-context.store", () => ({
  BillingContext: {
    run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()),
  },
}));

describe("ResearchProjectChatService", () => {
  let service: ResearchProjectChatService;
  let prisma: jest.Mocked<PrismaService>;
  let aiFacade: jest.Mocked<ChatFacade>;

  const userId = "user-123";
  const projectId = "project-456";
  const chatId = "chat-789";
  const noteId = "note-abc";

  const mockProject = {
    id: projectId,
    userId,
    name: "Test Project",
  };

  const mockChat = {
    id: chatId,
    projectId,
    messages: [],
    title: "New Chat",
    tokensUsed: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockNote = {
    id: noteId,
    projectId,
    title: "Test Note",
    content: "Test content",
    isPinned: false,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockModelConfig = {
    id: "model-1",
    modelId: "gemini-pro",
    displayName: "Gemini Pro",
    provider: "google",
  };

  beforeEach(async () => {
    const mockPrismaService = {
      researchProject: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      researchProjectChat: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      researchProjectNote: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      researchProjectSource: {
        findMany: jest.fn(),
      },
    };

    const mockFacadeInstance = {
      chat: jest.fn().mockResolvedValue({
        content: "AI response content",
        tokensUsed: 200,
      }),
      getModelById: jest.fn().mockResolvedValue(mockModelConfig),
      getDefaultTextModel: jest.fn().mockResolvedValue(mockModelConfig),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchProjectChatService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ChatFacade,
          useValue: mockFacadeInstance,
        },
      ],
    }).compile();

    service = module.get<ResearchProjectChatService>(
      ResearchProjectChatService,
    );
    prisma = module.get(PrismaService);
    aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getCurrentChat", () => {
    it("should return existing chat", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectChat.findFirst as jest.Mock).mockResolvedValue(
        mockChat,
      );

      const result = await service.getCurrentChat(userId, projectId);

      expect(result).toBe(mockChat);
    });

    it("should create new chat when none exists", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectChat.findFirst as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.researchProjectChat.create as jest.Mock).mockResolvedValue(
        mockChat,
      );
      (prisma.researchProject.update as jest.Mock).mockResolvedValue(
        mockProject,
      );

      const result = await service.getCurrentChat(userId, projectId);

      expect(result).toBe(mockChat);
      expect(prisma.researchProjectChat.create).toHaveBeenCalled();
    });

    it("should throw NotFoundException when project not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getCurrentChat(userId, projectId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when non-owner requests", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        userId: "other-user",
      });

      await expect(
        service.getCurrentChat("non-owner", projectId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("sendMessage", () => {
    it("should send message and get AI response", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectChat.findFirst as jest.Mock).mockResolvedValue(
        mockChat,
      );
      (prisma.researchProjectChat.update as jest.Mock).mockResolvedValue(
        mockChat,
      );
      (prisma.researchProjectSource.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      const result = await service.sendMessage(userId, projectId, {
        message: "What is AI?",
        model: "model-1",
      });

      expect(result.userMessage.content).toBe("What is AI?");
      expect(result.aiMessage.role).toBe("assistant");
      expect(aiFacade.chat).toHaveBeenCalled();
    });

    it("should handle AI failure and return error message", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectChat.findFirst as jest.Mock).mockResolvedValue(
        mockChat,
      );
      (prisma.researchProjectChat.update as jest.Mock).mockResolvedValue(
        mockChat,
      );
      (prisma.researchProjectSource.findMany as jest.Mock).mockResolvedValue(
        [],
      );
      (aiFacade.getModelById as jest.Mock).mockResolvedValue(null);
      (aiFacade.getDefaultTextModel as jest.Mock).mockResolvedValue(null);

      const result = await service.sendMessage(userId, projectId, {
        message: "Test message",
      });

      expect(result.error).toBeDefined();
      expect(result.aiMessage.role).toBe("assistant");
    });

    it("should include source context when selectedSourceIds provided", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectChat.findFirst as jest.Mock).mockResolvedValue(
        mockChat,
      );
      (prisma.researchProjectChat.update as jest.Mock).mockResolvedValue(
        mockChat,
      );
      (prisma.researchProjectSource.findMany as jest.Mock).mockResolvedValue([
        {
          id: "source-1",
          title: "Test Source",
          abstract: "Abstract",
          content: "Content",
          sourceType: "WEB",
          aiSummary: null,
        },
      ]);

      const result = await service.sendMessage(userId, projectId, {
        message: "Question about source",
        selectedSourceIds: ["source-1"],
      });

      expect(result.sourceContext).toHaveLength(1);
    });
  });

  describe("getChatHistory", () => {
    it("should return chat history", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectChat.findMany as jest.Mock).mockResolvedValue([
        mockChat,
      ]);

      const result = await service.getChatHistory(userId, projectId);

      expect(result).toHaveLength(1);
    });

    it("should throw NotFoundException when project not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getChatHistory(userId, projectId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("startNewChat", () => {
    it("should create a new chat session", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectChat.create as jest.Mock).mockResolvedValue(
        mockChat,
      );
      (prisma.researchProject.update as jest.Mock).mockResolvedValue(
        mockProject,
      );

      const result = await service.startNewChat(userId, projectId);

      expect(result).toBe(mockChat);
      expect(prisma.researchProjectChat.create).toHaveBeenCalled();
    });

    it("should throw ForbiddenException for non-owner", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue({
        ...mockProject,
        userId: "other-user",
      });

      await expect(
        service.startNewChat("non-owner", projectId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("addAIResponse", () => {
    it("should add AI response to chat", async () => {
      (prisma.researchProjectChat.findUnique as jest.Mock).mockResolvedValue(
        mockChat,
      );
      (prisma.researchProjectChat.update as jest.Mock).mockResolvedValue(
        mockChat,
      );

      await service.addAIResponse(
        chatId,
        "AI generated response",
        ["Source 1"],
        150,
      );

      expect(prisma.researchProjectChat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: chatId },
          data: expect.objectContaining({
            tokensUsed: 150,
          }),
        }),
      );
    });

    it("should throw NotFoundException when chat not found", async () => {
      (prisma.researchProjectChat.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.addAIResponse("nonexistent", "content"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("createNote", () => {
    it("should create a note", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectNote.create as jest.Mock).mockResolvedValue(
        mockNote,
      );
      (prisma.researchProject.update as jest.Mock).mockResolvedValue(
        mockProject,
      );

      const result = await service.createNote(userId, projectId, {
        title: "Test Note",
        content: "Test content",
      });

      expect(result).toBe(mockNote);
    });

    it("should use default sourceType when not provided", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectNote.create as jest.Mock).mockResolvedValue(
        mockNote,
      );
      (prisma.researchProject.update as jest.Mock).mockResolvedValue(
        mockProject,
      );

      await service.createNote(userId, projectId, {
        title: "Note",
        content: "Content",
      });

      expect(prisma.researchProjectNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceType: "manual",
          }),
        }),
      );
    });
  });

  describe("getNotes", () => {
    it("should return notes for a project", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectNote.findMany as jest.Mock).mockResolvedValue([
        mockNote,
      ]);

      const result = await service.getNotes(userId, projectId);

      expect(result).toHaveLength(1);
    });
  });

  describe("updateNote", () => {
    it("should update a note", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectNote.findUnique as jest.Mock).mockResolvedValue(
        mockNote,
      );
      (prisma.researchProjectNote.update as jest.Mock).mockResolvedValue({
        ...mockNote,
        title: "Updated",
      });

      const _result = await service.updateNote(userId, projectId, noteId, {
        title: "Updated",
      });

      expect(prisma.researchProjectNote.update).toHaveBeenCalled();
    });

    it("should throw NotFoundException when note belongs to different project", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectNote.findUnique as jest.Mock).mockResolvedValue({
        ...mockNote,
        projectId: "other-project",
      });

      await expect(
        service.updateNote(userId, projectId, noteId, {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("deleteNote", () => {
    it("should delete a note and decrement count", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectNote.findUnique as jest.Mock).mockResolvedValue(
        mockNote,
      );
      (prisma.researchProjectNote.delete as jest.Mock).mockResolvedValue(
        mockNote,
      );
      (prisma.researchProject.update as jest.Mock).mockResolvedValue(
        mockProject,
      );

      const result = await service.deleteNote(userId, projectId, noteId);

      expect(result).toEqual({ success: true });
      expect(prisma.researchProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { noteCount: { decrement: 1 } },
        }),
      );
    });

    it("should throw NotFoundException when note not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectNote.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.deleteNote(userId, projectId, "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("saveMessageAsNote", () => {
    it("should save a chat message as a note", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectNote.create as jest.Mock).mockResolvedValue(
        mockNote,
      );
      (prisma.researchProject.update as jest.Mock).mockResolvedValue(
        mockProject,
      );

      await service.saveMessageAsNote(
        userId,
        projectId,
        chatId,
        "Message content",
        "Custom Title",
      );

      expect(prisma.researchProjectNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceType: "ai-chat",
            chatId,
            title: "Custom Title",
          }),
        }),
      );
    });

    it("should use default title when not provided", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.researchProjectNote.create as jest.Mock).mockResolvedValue(
        mockNote,
      );
      (prisma.researchProject.update as jest.Mock).mockResolvedValue(
        mockProject,
      );

      await service.saveMessageAsNote(userId, projectId, chatId, "Content");

      expect(prisma.researchProjectNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Saved from chat",
          }),
        }),
      );
    });
  });
});
