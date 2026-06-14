import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { ResearchProjectController } from "../research-project.controller";
import type { ResearchProjectService } from "../research-project.service";
import type { ResearchProjectSourceService } from "../research-project-source.service";
import type { ResearchProjectChatService } from "../research-project-chat.service";
import type { ResearchProjectOutputService } from "../research-project-output.service";
import type { ResearchProjectTTSService } from "../research-project-tts.service";

function createMockStudioService() {
  return {
    createProject: jest.fn().mockResolvedValue({ id: "proj-1" }),
    getProjects: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getProject: jest.fn().mockResolvedValue({ id: "proj-1" }),
    updateProject: jest.fn().mockResolvedValue({ id: "proj-1" }),
    deleteProject: jest.fn().mockResolvedValue({ deleted: true }),
    archiveProject: jest.fn().mockResolvedValue({ archived: true }),
    restoreProject: jest.fn().mockResolvedValue({ restored: true }),
    sedimentToInsights: jest.fn().mockResolvedValue({ sedimented: true }),
  } as unknown as jest.Mocked<ResearchProjectService>;
}

function createMockSourceService() {
  return {
    addSource: jest.fn().mockResolvedValue({ id: "src-1" }),
    addSources: jest.fn().mockResolvedValue([{ id: "src-1" }]),
    uploadFiles: jest.fn().mockResolvedValue([{ id: "src-2" }]),
    getSources: jest.fn().mockResolvedValue([]),
    getSource: jest.fn().mockResolvedValue({ id: "src-1" }),
    removeSource: jest.fn().mockResolvedValue({ deleted: true }),
    searchSources: jest.fn().mockResolvedValue({ results: [] }),
  } as unknown as jest.Mocked<ResearchProjectSourceService>;
}

function createMockChatService() {
  return {
    getCurrentChat: jest.fn().mockResolvedValue({ messages: [] }),
    sendMessage: jest.fn().mockResolvedValue({ id: "msg-1" }),
    getChatHistory: jest.fn().mockResolvedValue([]),
    startNewChat: jest.fn().mockResolvedValue({ chatId: "chat-1" }),
    createNote: jest.fn().mockResolvedValue({ id: "note-1" }),
    getNotes: jest.fn().mockResolvedValue([]),
    updateNote: jest.fn().mockResolvedValue({ id: "note-1" }),
    deleteNote: jest.fn().mockResolvedValue({ deleted: true }),
  } as unknown as jest.Mocked<ResearchProjectChatService>;
}

function createMockOutputService() {
  return {
    getOutputTypes: jest.fn().mockResolvedValue(["SUMMARY", "REPORT"]),
    generateOutput: jest.fn().mockResolvedValue({ id: "out-1" }),
    getOutputs: jest.fn().mockResolvedValue([]),
    getOutput: jest.fn().mockResolvedValue({
      id: "out-1",
      type: "AUDIO_OVERVIEW",
      status: "COMPLETED",
      content: JSON.stringify({
        title: "Test",
        script: {
          segments: [{ speaker: "Host1", text: "Hello world" }],
          estimatedDuration: "5 min",
        },
      }),
    }),
    deleteOutput: jest.fn().mockResolvedValue({ deleted: true }),
    updateOutputProperties: jest.fn().mockResolvedValue({ id: "out-1" }),
    regenerateOutput: jest.fn().mockResolvedValue({ id: "out-1" }),
  } as unknown as jest.Mocked<ResearchProjectOutputService>;
}

function createMockTTSService() {
  return {
    isAvailable: jest.fn().mockReturnValue(true),
    getProvider: jest.fn().mockReturnValue("elevenlabs"),
    generateAudio: jest.fn().mockResolvedValue({
      audioUrl: "data:audio/mpeg;base64,abc",
      duration: 120,
    }),
    parseScript: jest.fn().mockReturnValue({
      title: "Test Script",
      script: {
        segments: [{ speaker: "Host1", text: "Hello" }],
        estimatedDuration: "2 min",
      },
    }),
  } as unknown as jest.Mocked<ResearchProjectTTSService>;
}

function createMockRequest(userId = "user-123") {
  return {
    user: { id: userId },
    headers: { authorization: "Bearer test-token" },
  };
}

describe("ResearchProjectController", () => {
  let controller: ResearchProjectController;
  let mockStudioService: jest.Mocked<ResearchProjectService>;
  let mockSourceService: jest.Mocked<ResearchProjectSourceService>;
  let mockChatService: jest.Mocked<ResearchProjectChatService>;
  let mockOutputService: jest.Mocked<ResearchProjectOutputService>;
  let mockTTSService: jest.Mocked<ResearchProjectTTSService>;
  let mockReq: ReturnType<typeof createMockRequest>;

  beforeEach(() => {
    mockStudioService = createMockStudioService();
    mockSourceService = createMockSourceService();
    mockChatService = createMockChatService();
    mockOutputService = createMockOutputService();
    mockTTSService = createMockTTSService();

    controller = new ResearchProjectController(
      mockStudioService as unknown as ResearchProjectService,
      mockSourceService as unknown as ResearchProjectSourceService,
      mockChatService as unknown as ResearchProjectChatService,
      mockOutputService as unknown as ResearchProjectOutputService,
      mockTTSService as unknown as ResearchProjectTTSService,
    );

    mockReq = createMockRequest();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createProject", () => {
    it("should create a project", async () => {
      const dto = { name: "Test Project", description: "Desc" } as never;
      const result = await controller.createProject(mockReq as never, dto);
      expect(mockStudioService.createProject).toHaveBeenCalledWith(
        "user-123",
        dto,
      );
      expect(result).toEqual({ id: "proj-1" });
    });

    it("should throw UnauthorizedException if user is missing", async () => {
      const reqNoUser = { user: { id: undefined }, headers: {} };
      await expect(
        controller.createProject(reqNoUser as never, {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("getProjects", () => {
    it("should return projects for user", async () => {
      await controller.getProjects(mockReq as never);
      expect(mockStudioService.getProjects).toHaveBeenCalledWith(
        "user-123",
        expect.objectContaining({}),
      );
    });

    it("should pass filter params", async () => {
      await controller.getProjects(
        mockReq as never,
        "ACTIVE",
        "DEEP",
        "AI",
        "10",
        "0",
      );
      expect(mockStudioService.getProjects).toHaveBeenCalledWith(
        "user-123",
        expect.objectContaining({
          status: "ACTIVE",
          researchType: "DEEP",
          search: "AI",
        }),
      );
    });

    it("should throw UnauthorizedException if user is missing", async () => {
      const reqNoUser = { user: { id: undefined }, headers: {} };
      await expect(controller.getProjects(reqNoUser as never)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("getProject", () => {
    it("should return a project", async () => {
      await controller.getProject(mockReq as never, "proj-1");
      expect(mockStudioService.getProject).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
      );
    });
  });

  describe("updateProject", () => {
    it("should update a project", async () => {
      const dto = { name: "Updated Name" } as never;
      await controller.updateProject(mockReq as never, "proj-1", dto);
      expect(mockStudioService.updateProject).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        dto,
      );
    });
  });

  describe("deleteProject", () => {
    it("should delete a project", async () => {
      await controller.deleteProject(mockReq as never, "proj-1");
      expect(mockStudioService.deleteProject).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
      );
    });
  });

  describe("archiveProject", () => {
    it("should archive a project", async () => {
      await controller.archiveProject(mockReq as never, "proj-1");
      expect(mockStudioService.archiveProject).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
      );
    });
  });

  describe("restoreProject", () => {
    it("should restore a project", async () => {
      await controller.restoreProject(mockReq as never, "proj-1");
      expect(mockStudioService.restoreProject).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
      );
    });
  });

  describe("Sources endpoints", () => {
    it("should add a source", async () => {
      const dto = { url: "https://example.com" } as never;
      await controller.addSource(mockReq as never, "proj-1", dto);
      expect(mockSourceService.addSource).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        dto,
      );
    });

    it("should add multiple sources", async () => {
      const dto = { sources: [{ url: "u1" }, { url: "u2" }] } as never;
      await controller.addSources(mockReq as never, "proj-1", dto);
      expect(mockSourceService.addSources).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        [{ url: "u1" }, { url: "u2" }],
      );
    });

    it("should get sources", async () => {
      await controller.getSources(mockReq as never, "proj-1");
      expect(mockSourceService.getSources).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
      );
    });

    it("should get single source", async () => {
      await controller.getSource(mockReq as never, "proj-1", "src-1");
      expect(mockSourceService.getSource).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        "src-1",
      );
    });

    it("should remove source", async () => {
      await controller.removeSource(mockReq as never, "proj-1", "src-1");
      expect(mockSourceService.removeSource).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        "src-1",
      );
    });

    it("should search sources", async () => {
      const dto = { query: "AI research" } as never;
      await controller.searchSources(mockReq as never, dto);
      expect(mockSourceService.searchSources).toHaveBeenCalledWith(
        "user-123",
        dto,
      );
    });

    it("should upload files", async () => {
      const files = [
        {
          buffer: Buffer.from("content"),
          originalname: "test.pdf",
          mimetype: "application/pdf",
          size: 100,
        },
      ] as Express.Multer.File[];
      await controller.uploadSources(mockReq as never, "proj-1", files);
      expect(mockSourceService.uploadFiles).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        files,
      );
    });
  });

  describe("Chat endpoints", () => {
    it("should get current chat", async () => {
      await controller.getCurrentChat(mockReq as never, "proj-1");
      expect(mockChatService.getCurrentChat).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
      );
    });

    it("should send chat message", async () => {
      const dto = { message: "What is AI?" } as never;
      await controller.sendChatMessage(mockReq as never, "proj-1", dto);
      expect(mockChatService.sendMessage).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        dto,
      );
    });

    it("should get chat history", async () => {
      await controller.getChatHistory(mockReq as never, "proj-1");
      expect(mockChatService.getChatHistory).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
      );
    });

    it("should start new chat", async () => {
      await controller.startNewChat(mockReq as never, "proj-1");
      expect(mockChatService.startNewChat).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
      );
    });
  });

  describe("Notes endpoints", () => {
    it("should create note", async () => {
      const dto = { content: "Note content" } as never;
      await controller.createNote(mockReq as never, "proj-1", dto);
      expect(mockChatService.createNote).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        dto,
      );
    });

    it("should get notes", async () => {
      await controller.getNotes(mockReq as never, "proj-1");
      expect(mockChatService.getNotes).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
      );
    });

    it("should update note", async () => {
      const dto = { content: "Updated note" } as never;
      await controller.updateNote(mockReq as never, "proj-1", "note-1", dto);
      expect(mockChatService.updateNote).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        "note-1",
        dto,
      );
    });

    it("should delete note", async () => {
      await controller.deleteNote(mockReq as never, "proj-1", "note-1");
      expect(mockChatService.deleteNote).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        "note-1",
      );
    });
  });

  describe("Outputs endpoints", () => {
    it("should get output types", async () => {
      await controller.getOutputTypes();
      expect(mockOutputService.getOutputTypes).toHaveBeenCalled();
    });

    it("should generate output", async () => {
      const dto = { type: "SUMMARY" } as never;
      await controller.generateOutput(mockReq as never, "proj-1", dto);
      expect(mockOutputService.generateOutput).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        dto,
      );
    });

    it("should get outputs", async () => {
      await controller.getOutputs(mockReq as never, "proj-1");
      expect(mockOutputService.getOutputs).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
      );
    });

    it("should get single output", async () => {
      await controller.getOutput(mockReq as never, "proj-1", "out-1");
      expect(mockOutputService.getOutput).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        "out-1",
      );
    });

    it("should delete output", async () => {
      await controller.deleteOutput(mockReq as never, "proj-1", "out-1");
      expect(mockOutputService.deleteOutput).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        "out-1",
      );
    });

    it("should update output", async () => {
      await controller.updateOutput(mockReq as never, "proj-1", "out-1", {
        title: "New Title",
      });
      expect(mockOutputService.updateOutputProperties).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        "out-1",
        { title: "New Title" },
      );
    });

    it("should regenerate output", async () => {
      await controller.regenerateOutput(mockReq as never, "proj-1", "out-1");
      expect(mockOutputService.regenerateOutput).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        "out-1",
      );
    });
  });

  describe("generateAudio", () => {
    it("should generate audio when TTS is available", async () => {
      const result = await controller.generateAudio(
        mockReq as never,
        "proj-1",
        "out-1",
      );

      expect(result.available).toBe(true);
      expect(result.provider).toBe("elevenlabs");
      expect(result.audioUrl).toBe("data:audio/mpeg;base64,abc");
      expect(result.duration).toBe(120);
    });

    it("should return unavailable response when TTS is not configured", async () => {
      mockTTSService.isAvailable.mockReturnValue(false);
      mockTTSService.getProvider.mockReturnValue("none");

      const result = await controller.generateAudio(
        mockReq as never,
        "proj-1",
        "out-1",
      );

      expect(result.available).toBe(false);
      expect(result.provider).toBe("none");
      expect(result.script).toBeDefined();
    });

    it("should throw BadRequestException when output is not AUDIO_OVERVIEW", async () => {
      mockOutputService.getOutput.mockResolvedValue({
        id: "out-1",
        type: "SUMMARY",
        status: "COMPLETED",
        content: "Content",
      } as never);

      await expect(
        controller.generateAudio(mockReq as never, "proj-1", "out-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when output is not COMPLETED", async () => {
      mockOutputService.getOutput.mockResolvedValue({
        id: "out-1",
        type: "AUDIO_OVERVIEW",
        status: "PENDING",
        content: null,
      } as never);

      await expect(
        controller.generateAudio(mockReq as never, "proj-1", "out-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when script parsing fails", async () => {
      mockTTSService.parseScript.mockReturnValue(null);

      await expect(
        controller.generateAudio(mockReq as never, "proj-1", "out-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when audio generation fails", async () => {
      mockTTSService.generateAudio.mockResolvedValue(null);

      await expect(
        controller.generateAudio(mockReq as never, "proj-1", "out-1"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("getTTSStatus", () => {
    it("should return TTS availability and provider", async () => {
      const result = await controller.getTTSStatus();
      expect(result).toEqual({ available: true, provider: "elevenlabs" });
    });

    it("should reflect when TTS is unavailable", async () => {
      mockTTSService.isAvailable.mockReturnValue(false);
      mockTTSService.getProvider.mockReturnValue("none");

      const result = await controller.getTTSStatus();
      expect(result).toEqual({ available: false, provider: "none" });
    });
  });

  describe("sedimentToInsights", () => {
    it("should call sedimentToInsights with user and token", async () => {
      const dto = { outputId: "out-1" } as never;
      await controller.sedimentToInsights(mockReq as never, "proj-1", dto);
      expect(mockStudioService.sedimentToInsights).toHaveBeenCalledWith(
        "user-123",
        "proj-1",
        dto,
        "test-token",
      );
    });
  });
});
