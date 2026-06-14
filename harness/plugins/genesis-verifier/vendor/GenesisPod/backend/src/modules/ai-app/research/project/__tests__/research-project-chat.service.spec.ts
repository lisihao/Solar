import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { ResearchProjectChatService } from "../research-project-chat.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("ResearchProjectChatService", () => {
  let service: ResearchProjectChatService;
  let prismaService: any;
  let aiFacade: any;

  const mockProject = {
    id: "project-123",
    userId: "user-123",
    name: "Test Project",
    chatCount: 0,
    noteCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockChat = {
    id: "chat-123",
    projectId: "project-123",
    messages: [],
    title: "New Chat",
    tokensUsed: 0,
    modelUsed: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockNote = {
    id: "note-123",
    projectId: "project-123",
    title: "Test Note",
    content: "Test content",
    sourceType: "manual",
    chatId: null,
    tags: [],
    isPinned: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockModelConfig = {
    id: "model-123",
    modelId: "gpt-4o",
    displayName: "GPT-4o",
    provider: "openai",
  };

  beforeEach(async () => {
    const mockPrismaService = {
      researchProject: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      researchProjectChat: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      researchProjectNote: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      researchProjectSource: {
        findMany: jest.fn(),
      },
    };

    const mockAiFacade = {
      chat: jest.fn(),
      getModelById: jest.fn(),
      getDefaultTextModel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchProjectChatService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ChatFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<ResearchProjectChatService>(
      ResearchProjectChatService,
    );
    prismaService = module.get(PrismaService);
    aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== getCurrentChat ====================

  describe("getCurrentChat", () => {
    it("should throw NotFoundException when project does not exist", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue(null);

      await expect(
        service.getCurrentChat("user-123", "project-999"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user does not own the project", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue({
        ...mockProject,
        userId: "other-user",
      });

      await expect(
        service.getCurrentChat("user-123", "project-123"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should return existing chat when found", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue(mockProject);
      prismaService.researchProjectChat.findFirst.mockResolvedValue(mockChat);

      const result = await service.getCurrentChat("user-123", "project-123");

      expect(result).toEqual(mockChat);
      expect(prismaService.researchProjectChat.create).not.toHaveBeenCalled();
    });

    it("should create a new chat when none exists", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue(mockProject);
      prismaService.researchProjectChat.findFirst.mockResolvedValue(null);
      prismaService.researchProjectChat.create.mockResolvedValue(mockChat);
      prismaService.researchProject.update.mockResolvedValue(mockProject);

      const result = await service.getCurrentChat("user-123", "project-123");

      expect(result).toEqual(mockChat);
      expect(prismaService.researchProjectChat.create).toHaveBeenCalledWith({
        data: {
          projectId: "project-123",
          messages: [],
          title: "New Chat",
        },
      });
      expect(prismaService.researchProject.update).toHaveBeenCalledWith({
        where: { id: "project-123" },
        data: { chatCount: { increment: 1 } },
      });
    });
  });

  // ==================== sendMessage ====================

  describe("sendMessage", () => {
    const dto = {
      message: "What is AI?",
      selectedSourceIds: [],
      model: "model-123",
    };

    beforeEach(() => {
      prismaService.researchProject.findUnique.mockResolvedValue(mockProject);
      prismaService.researchProjectChat.findFirst.mockResolvedValue(mockChat);
      prismaService.researchProjectChat.update.mockResolvedValue(mockChat);
      prismaService.researchProjectSource.findMany.mockResolvedValue([]);
      aiFacade.getModelById.mockResolvedValue(mockModelConfig);
      aiFacade.chat.mockResolvedValue({
        content: "AI is artificial intelligence.",
        tokensUsed: 100,
      });
    });

    it("should send a message and return AI response", async () => {
      const result = await service.sendMessage("user-123", "project-123", dto);

      expect(result).toHaveProperty("chatId", "chat-123");
      expect(result).toHaveProperty("userMessage");
      expect(result.userMessage.role).toBe("user");
      expect(result.userMessage.content).toBe("What is AI?");
      expect(result).toHaveProperty("aiMessage");
      expect(result.aiMessage.role).toBe("assistant");
    });

    it("should include citations when sources are selected", async () => {
      const dtoWithSources = {
        message: "Summarize these sources",
        selectedSourceIds: ["source-1", "source-2"],
        model: "model-123",
      };

      const mockSources = [
        {
          id: "source-1",
          title: "Paper A",
          abstract: "Abstract A",
          content: "Content A",
          sourceType: "paper",
          aiSummary: null,
        },
        {
          id: "source-2",
          title: "Paper B",
          abstract: null,
          content: null,
          sourceType: "blog",
          aiSummary: "AI Summary B",
        },
      ];

      prismaService.researchProjectSource.findMany.mockResolvedValue(
        mockSources,
      );

      const result = await service.sendMessage(
        "user-123",
        "project-123",
        dtoWithSources,
      );

      expect(result.aiMessage.citations).toEqual(["Paper A", "Paper B"]);
      expect(result.sourceContext).toHaveLength(2);
    });

    it("should handle AI failure gracefully and return error message", async () => {
      aiFacade.getModelById.mockResolvedValue(null);
      aiFacade.getDefaultTextModel.mockResolvedValue(null);

      const result = await service.sendMessage("user-123", "project-123", dto);

      expect(result.error).toBeDefined();
      expect(result.aiMessage.content).toContain("失败");
    });

    it("should fall back to default model when specified model not found", async () => {
      aiFacade.getModelById.mockResolvedValue(null);
      aiFacade.getDefaultTextModel.mockResolvedValue(mockModelConfig);

      const result = await service.sendMessage("user-123", "project-123", dto);

      expect(result.aiMessage.role).toBe("assistant");
      expect(aiFacade.getDefaultTextModel).toHaveBeenCalled();
    });

    it("should return error when no model is available", async () => {
      aiFacade.getModelById.mockResolvedValue(null);
      aiFacade.getDefaultTextModel.mockResolvedValue(null);

      const result = await service.sendMessage("user-123", "project-123", dto);

      expect(result.error).toBeDefined();
    });

    it("should store tokens used when AI responds successfully", async () => {
      aiFacade.chat.mockResolvedValue({
        content: "Response",
        tokensUsed: 250,
      });

      const result = await service.sendMessage("user-123", "project-123", dto);

      expect(result.tokensUsed).toBe(250);
    });

    it("should maintain source order matching selectedSourceIds order", async () => {
      const dtoWithSources = {
        message: "Compare these",
        selectedSourceIds: ["source-2", "source-1"],
        model: "model-123",
      };

      const mockSources = [
        {
          id: "source-1",
          title: "First Source",
          abstract: null,
          content: null,
          sourceType: "paper",
          aiSummary: null,
        },
        {
          id: "source-2",
          title: "Second Source",
          abstract: null,
          content: null,
          sourceType: "blog",
          aiSummary: null,
        },
      ];

      prismaService.researchProjectSource.findMany.mockResolvedValue(
        mockSources,
      );

      const result = await service.sendMessage(
        "user-123",
        "project-123",
        dtoWithSources,
      );

      // Order should follow selectedSourceIds: source-2 first, source-1 second
      expect(result.sourceContext[0].id).toBe("source-2");
      expect(result.sourceContext[1].id).toBe("source-1");
    });
  });

  // ==================== addAIResponse ====================

  describe("addAIResponse", () => {
    it("should add AI response to an existing chat", async () => {
      prismaService.researchProjectChat.findUnique.mockResolvedValue(mockChat);
      prismaService.researchProjectChat.update.mockResolvedValue({
        ...mockChat,
        messages: [{ role: "assistant", content: "Response" }],
      });

      await service.addAIResponse("chat-123", "Response", ["Citation 1"], 50);

      expect(prismaService.researchProjectChat.update).toHaveBeenCalledWith({
        where: { id: "chat-123" },
        data: expect.objectContaining({
          messages: expect.any(Array),
          tokensUsed: 50,
        }),
      });
    });

    it("should throw NotFoundException when chat does not exist", async () => {
      prismaService.researchProjectChat.findUnique.mockResolvedValue(null);

      await expect(
        service.addAIResponse("nonexistent-chat", "Content"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should accumulate tokens when tokensUsed is provided", async () => {
      const chatWithTokens = { ...mockChat, tokensUsed: 100 };
      prismaService.researchProjectChat.findUnique.mockResolvedValue(
        chatWithTokens,
      );
      prismaService.researchProjectChat.update.mockResolvedValue(
        chatWithTokens,
      );

      await service.addAIResponse("chat-123", "Response", [], 75);

      expect(prismaService.researchProjectChat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tokensUsed: 175 }),
        }),
      );
    });
  });

  // ==================== getChatHistory ====================

  describe("getChatHistory", () => {
    it("should return chat history for a project", async () => {
      const mockChats = [
        {
          id: "chat-1",
          title: "Chat 1",
          createdAt: new Date(),
          updatedAt: new Date(),
          modelUsed: "gpt-4o",
          tokensUsed: 100,
        },
        {
          id: "chat-2",
          title: "Chat 2",
          createdAt: new Date(),
          updatedAt: new Date(),
          modelUsed: null,
          tokensUsed: 0,
        },
      ];

      prismaService.researchProject.findUnique.mockResolvedValue(mockProject);
      prismaService.researchProjectChat.findMany.mockResolvedValue(mockChats);

      const result = await service.getChatHistory("user-123", "project-123");

      expect(result).toHaveLength(2);
      expect(prismaService.researchProjectChat.findMany).toHaveBeenCalledWith({
        where: { projectId: "project-123" },
        orderBy: { createdAt: "desc" },
        select: expect.objectContaining({
          id: true,
          title: true,
        }),
      });
    });

    it("should throw NotFoundException for non-existent project", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue(null);

      await expect(
        service.getChatHistory("user-123", "bad-project"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for unauthorized user", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue({
        ...mockProject,
        userId: "other-user",
      });

      await expect(
        service.getChatHistory("user-123", "project-123"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== startNewChat ====================

  describe("startNewChat", () => {
    it("should create a new chat and increment chat count", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue(mockProject);
      prismaService.researchProjectChat.create.mockResolvedValue({
        ...mockChat,
        id: "new-chat-456",
      });
      prismaService.researchProject.update.mockResolvedValue(mockProject);

      const result = await service.startNewChat("user-123", "project-123");

      expect(result.id).toBe("new-chat-456");
      expect(prismaService.researchProject.update).toHaveBeenCalledWith({
        where: { id: "project-123" },
        data: { chatCount: { increment: 1 } },
      });
    });

    it("should throw NotFoundException for non-existent project", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue(null);

      await expect(
        service.startNewChat("user-123", "bad-project"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for unauthorized user", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue({
        ...mockProject,
        userId: "different-user",
      });

      await expect(
        service.startNewChat("user-123", "project-123"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== createNote ====================

  describe("createNote", () => {
    const createNoteDto = {
      title: "New Note",
      content: "Note content here",
      sourceType: "manual",
      tags: ["tag1", "tag2"],
      isPinned: false,
    };

    beforeEach(() => {
      prismaService.researchProject.findUnique.mockResolvedValue(mockProject);
      prismaService.researchProjectNote.create.mockResolvedValue(mockNote);
      prismaService.researchProject.update.mockResolvedValue(mockProject);
    });

    it("should create a note and increment note count", async () => {
      const result = await service.createNote(
        "user-123",
        "project-123",
        createNoteDto,
      );

      expect(result).toEqual(mockNote);
      expect(prismaService.researchProjectNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: "project-123",
          title: "New Note",
          content: "Note content here",
          sourceType: "manual",
          tags: ["tag1", "tag2"],
          isPinned: false,
        }),
      });
      expect(prismaService.researchProject.update).toHaveBeenCalledWith({
        where: { id: "project-123" },
        data: { noteCount: { increment: 1 } },
      });
    });

    it("should use default values when optional fields are missing", async () => {
      const minimalDto = { content: "Just content" };

      await service.createNote("user-123", "project-123", minimalDto as any);

      expect(prismaService.researchProjectNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceType: "manual",
          tags: [],
          isPinned: false,
        }),
      });
    });

    it("should throw NotFoundException for non-existent project", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue(null);

      await expect(
        service.createNote("user-123", "bad-project", createNoteDto),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for unauthorized user", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue({
        ...mockProject,
        userId: "someone-else",
      });

      await expect(
        service.createNote("user-123", "project-123", createNoteDto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== getNotes ====================

  describe("getNotes", () => {
    it("should return notes sorted by pinned and createdAt", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue(mockProject);
      prismaService.researchProjectNote.findMany.mockResolvedValue([mockNote]);

      const result = await service.getNotes("user-123", "project-123");

      expect(result).toHaveLength(1);
      expect(prismaService.researchProjectNote.findMany).toHaveBeenCalledWith({
        where: { projectId: "project-123" },
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      });
    });

    it("should throw ForbiddenException when user is not project owner", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue({
        ...mockProject,
        userId: "another-user",
      });

      await expect(service.getNotes("user-123", "project-123")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ==================== updateNote ====================

  describe("updateNote", () => {
    const updateNoteDto = {
      title: "Updated Title",
      content: "Updated content",
    };

    beforeEach(() => {
      prismaService.researchProject.findUnique.mockResolvedValue(mockProject);
      prismaService.researchProjectNote.findUnique.mockResolvedValue(mockNote);
      prismaService.researchProjectNote.update.mockResolvedValue({
        ...mockNote,
        ...updateNoteDto,
      });
    });

    it("should update an existing note", async () => {
      const result = await service.updateNote(
        "user-123",
        "project-123",
        "note-123",
        updateNoteDto,
      );

      expect(result.title).toBe("Updated Title");
      expect(prismaService.researchProjectNote.update).toHaveBeenCalled();
    });

    it("should throw NotFoundException when note does not exist", async () => {
      prismaService.researchProjectNote.findUnique.mockResolvedValue(null);

      await expect(
        service.updateNote(
          "user-123",
          "project-123",
          "bad-note",
          updateNoteDto,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when note belongs to different project", async () => {
      prismaService.researchProjectNote.findUnique.mockResolvedValue({
        ...mockNote,
        projectId: "other-project",
      });

      await expect(
        service.updateNote(
          "user-123",
          "project-123",
          "note-123",
          updateNoteDto,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should only update provided fields", async () => {
      await service.updateNote("user-123", "project-123", "note-123", {
        isPinned: true,
      });

      expect(prismaService.researchProjectNote.update).toHaveBeenCalledWith({
        where: { id: "note-123" },
        data: { isPinned: true },
      });
    });
  });

  // ==================== deleteNote ====================

  describe("deleteNote", () => {
    beforeEach(() => {
      prismaService.researchProject.findUnique.mockResolvedValue(mockProject);
      prismaService.researchProjectNote.findUnique.mockResolvedValue(mockNote);
      prismaService.researchProjectNote.delete.mockResolvedValue(mockNote);
      prismaService.researchProject.update.mockResolvedValue(mockProject);
    });

    it("should delete a note and decrement note count", async () => {
      const result = await service.deleteNote(
        "user-123",
        "project-123",
        "note-123",
      );

      expect(result).toEqual({ success: true });
      expect(prismaService.researchProjectNote.delete).toHaveBeenCalledWith({
        where: { id: "note-123" },
      });
      expect(prismaService.researchProject.update).toHaveBeenCalledWith({
        where: { id: "project-123" },
        data: { noteCount: { decrement: 1 } },
      });
    });

    it("should throw NotFoundException when note does not exist", async () => {
      prismaService.researchProjectNote.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteNote("user-123", "project-123", "bad-note"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== saveMessageAsNote ====================

  describe("saveMessageAsNote", () => {
    it("should create a note from a chat message", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue(mockProject);
      prismaService.researchProjectNote.create.mockResolvedValue(mockNote);
      prismaService.researchProject.update.mockResolvedValue(mockProject);

      await service.saveMessageAsNote(
        "user-123",
        "project-123",
        "chat-123",
        "Message content",
        "My Note Title",
      );

      expect(prismaService.researchProjectNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceType: "ai-chat",
          chatId: "chat-123",
          content: "Message content",
          title: "My Note Title",
        }),
      });
    });

    it("should use default title when title is not provided", async () => {
      prismaService.researchProject.findUnique.mockResolvedValue(mockProject);
      prismaService.researchProjectNote.create.mockResolvedValue(mockNote);
      prismaService.researchProject.update.mockResolvedValue(mockProject);

      await service.saveMessageAsNote(
        "user-123",
        "project-123",
        "chat-123",
        "Message content",
      );

      expect(prismaService.researchProjectNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "Saved from chat",
        }),
      });
    });
  });
});
