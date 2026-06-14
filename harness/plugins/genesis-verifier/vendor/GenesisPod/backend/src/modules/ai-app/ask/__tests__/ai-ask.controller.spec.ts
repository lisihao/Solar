import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { AiAskController } from "../ai-ask.controller";
import { AiAskService } from "../ai-ask.service";
import { ThrottlerModule } from "@nestjs/throttler";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";

const mockService = {
  createSession: jest.fn(),
  getSessions: jest.fn(),
  searchSessions: jest.fn(),
  getSession: jest.fn(),
  updateSession: jest.fn(),
  deleteSession: jest.fn(),
  sendMessage: jest.fn(),
  getMessages: jest.fn(),
  regenerateMessage: jest.fn(),
};

const mockRequest = { user: { id: "user-1" } };

describe("AiAskController", () => {
  let controller: AiAskController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ limit: 10, ttl: 60000 }])],
      controllers: [AiAskController],
      providers: [{ provide: AiAskService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AiAskController>(AiAskController);
  });

  describe("createSession()", () => {
    it("should call createSession and return result", async () => {
      const dto = { title: "New Session" };
      mockService.createSession.mockResolvedValue({ id: "session-1" });

      const result = await controller.createSession(mockRequest, dto as any);

      expect(mockService.createSession).toHaveBeenCalledWith("user-1", dto);
      expect(result).toEqual({ id: "session-1" });
    });
  });

  describe("getSessions()", () => {
    it("should call getSessions with default pagination", async () => {
      mockService.getSessions.mockResolvedValue({ data: [], total: 0 });

      const result = await controller.getSessions(mockRequest);

      expect(mockService.getSessions).toHaveBeenCalledWith("user-1", 1, 50);
      expect(result).toEqual({ data: [], total: 0 });
    });

    it("should parse page and limit from query params", async () => {
      mockService.getSessions.mockResolvedValue({ data: [], total: 0 });

      await controller.getSessions(mockRequest, "2", "10");

      expect(mockService.getSessions).toHaveBeenCalledWith("user-1", 2, 10);
    });

    it("should clamp page to minimum 1", async () => {
      mockService.getSessions.mockResolvedValue({ data: [], total: 0 });

      await controller.getSessions(mockRequest, "0", "10");

      expect(mockService.getSessions).toHaveBeenCalledWith("user-1", 1, 10);
    });

    it("should clamp limit to maximum 200", async () => {
      mockService.getSessions.mockResolvedValue({ data: [], total: 0 });

      await controller.getSessions(mockRequest, "1", "300");

      expect(mockService.getSessions).toHaveBeenCalledWith("user-1", 1, 200);
    });

    it("should default to 50 for invalid (zero) limit param", async () => {
      mockService.getSessions.mockResolvedValue({ data: [], total: 0 });

      // parseInt('0') returns 0 which is falsy, so || 50 fallback applies → 50
      await controller.getSessions(mockRequest, "1", "0");

      expect(mockService.getSessions).toHaveBeenCalledWith("user-1", 1, 50);
    });

    it("should default to page 1 for invalid page param", async () => {
      mockService.getSessions.mockResolvedValue({ data: [], total: 0 });

      await controller.getSessions(mockRequest, "invalid");

      expect(mockService.getSessions).toHaveBeenCalledWith("user-1", 1, 50);
    });
  });

  describe("searchSessions()", () => {
    it("should call searchSessions with query", async () => {
      mockService.searchSessions.mockResolvedValue([{ id: "session-1" }]);

      const result = await controller.searchSessions(mockRequest, "test query");

      expect(mockService.searchSessions).toHaveBeenCalledWith(
        "user-1",
        "test query",
        20,
      );
      expect(result).toEqual([{ id: "session-1" }]);
    });

    it("should return empty array for empty query", async () => {
      const result = await controller.searchSessions(mockRequest, "");

      expect(mockService.searchSessions).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("should return empty array for whitespace-only query", async () => {
      const result = await controller.searchSessions(mockRequest, "   ");

      expect(mockService.searchSessions).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("should use custom limit from query", async () => {
      mockService.searchSessions.mockResolvedValue([]);

      await controller.searchSessions(mockRequest, "query", "5");

      expect(mockService.searchSessions).toHaveBeenCalledWith(
        "user-1",
        "query",
        5,
      );
    });
  });

  describe("getSession()", () => {
    it("should call getSession and return result", async () => {
      mockService.getSession.mockResolvedValue({
        id: "session-1",
        messages: [],
      });

      const result = await controller.getSession(mockRequest, "session-1");

      expect(mockService.getSession).toHaveBeenCalledWith(
        "session-1",
        "user-1",
      );
      expect(result).toEqual({ id: "session-1", messages: [] });
    });
  });

  describe("updateSession()", () => {
    it("should call updateSession and return result", async () => {
      const dto = { title: "Updated Title" };
      mockService.updateSession.mockResolvedValue({
        id: "session-1",
        title: "Updated Title",
      });

      const result = await controller.updateSession(
        mockRequest,
        "session-1",
        dto as any,
      );

      expect(mockService.updateSession).toHaveBeenCalledWith(
        "session-1",
        "user-1",
        dto,
      );
      expect(result).toEqual({ id: "session-1", title: "Updated Title" });
    });
  });

  describe("deleteSession()", () => {
    it("should call deleteSession and return result", async () => {
      mockService.deleteSession.mockResolvedValue({ success: true });

      const result = await controller.deleteSession(mockRequest, "session-1");

      expect(mockService.deleteSession).toHaveBeenCalledWith(
        "session-1",
        "user-1",
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe("sendMessage()", () => {
    it("should call sendMessage and return result", async () => {
      const dto = { content: "Hello", modelId: "gpt-4o" };
      mockService.sendMessage.mockResolvedValue({ id: "msg-1" });

      const result = await controller.sendMessage(
        mockRequest,
        "session-1",
        dto as any,
      );

      expect(mockService.sendMessage).toHaveBeenCalledWith(
        "session-1",
        "user-1",
        dto,
      );
      expect(result).toEqual({ id: "msg-1" });
    });

    it("should throw BadRequestException for >10 knowledgeBaseIds", async () => {
      const dto = {
        content: "Hello",
        knowledgeBaseIds: Array(11).fill("kb-1"),
      };

      await expect(
        controller.sendMessage(mockRequest, "session-1", dto as any),
      ).rejects.toThrow(BadRequestException);
      expect(mockService.sendMessage).not.toHaveBeenCalled();
    });

    it("should allow exactly 10 knowledgeBaseIds", async () => {
      const dto = {
        content: "Hello",
        knowledgeBaseIds: Array(10).fill("kb-1"),
      };
      mockService.sendMessage.mockResolvedValue({ id: "msg-1" });

      await expect(
        controller.sendMessage(mockRequest, "session-1", dto as any),
      ).resolves.toBeDefined();
      expect(mockService.sendMessage).toHaveBeenCalled();
    });

    it("should allow no knowledgeBaseIds", async () => {
      const dto = { content: "Hello" };
      mockService.sendMessage.mockResolvedValue({ id: "msg-1" });

      await controller.sendMessage(mockRequest, "session-1", dto as any);

      expect(mockService.sendMessage).toHaveBeenCalled();
    });
  });

  describe("getMessages()", () => {
    it("should call getMessages with defaults", async () => {
      mockService.getMessages.mockResolvedValue([]);

      await controller.getMessages(mockRequest, "session-1");

      expect(mockService.getMessages).toHaveBeenCalledWith(
        "session-1",
        "user-1",
        50,
        undefined,
      );
    });

    it("should parse limit and before params", async () => {
      const _beforeDate = new Date("2024-01-01T00:00:00Z");
      mockService.getMessages.mockResolvedValue([]);

      await controller.getMessages(
        mockRequest,
        "session-1",
        "30",
        "2024-01-01T00:00:00Z",
      );

      expect(mockService.getMessages).toHaveBeenCalledWith(
        "session-1",
        "user-1",
        30,
        expect.any(Date),
      );
    });

    it("should pass undefined for no before param", async () => {
      mockService.getMessages.mockResolvedValue([]);

      await controller.getMessages(mockRequest, "session-1", "10");

      expect(mockService.getMessages).toHaveBeenCalledWith(
        "session-1",
        "user-1",
        10,
        undefined,
      );
    });
  });

  describe("regenerateMessage()", () => {
    it("should call regenerateMessage and return result", async () => {
      mockService.regenerateMessage.mockResolvedValue({ id: "msg-2" });

      const result = await controller.regenerateMessage(
        mockRequest,
        "session-1",
        "msg-1",
      );

      expect(mockService.regenerateMessage).toHaveBeenCalledWith(
        "session-1",
        "msg-1",
        "user-1",
      );
      expect(result).toEqual({ id: "msg-2" });
    });
  });
});
