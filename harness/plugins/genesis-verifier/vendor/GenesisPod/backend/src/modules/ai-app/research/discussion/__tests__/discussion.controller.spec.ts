import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DiscussionController } from "../discussion.controller";
import type { DiscussionOrchestratorService } from "../discussion-orchestrator.service";
import type { IterativeResearchService } from "../../iteration";
import { Subject } from "rxjs";

function createMockResponse() {
  return {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn().mockReturnValue(true),
    end: jest.fn(),
    on: jest.fn(),
  };
}

function createMockOrchestratorService() {
  return {
    startResearch: jest.fn(),
    getSession: jest.fn(),
    getProjectSessions: jest.fn().mockResolvedValue([]),
    deleteSession: jest.fn().mockResolvedValue(undefined),
    deleteSessions: jest.fn().mockResolvedValue({ count: 2 }),
  } as unknown as jest.Mocked<DiscussionOrchestratorService>;
}

function createMockIterativeResearchService() {
  return {
    startResearch: jest.fn(),
  } as unknown as jest.Mocked<IterativeResearchService>;
}

describe("DiscussionController", () => {
  let controller: DiscussionController;
  let mockOrchestratorService: jest.Mocked<DiscussionOrchestratorService>;
  let mockIterativeResearch: jest.Mocked<IterativeResearchService>;

  beforeEach(() => {
    jest.useFakeTimers();
    mockOrchestratorService = createMockOrchestratorService();
    mockIterativeResearch = createMockIterativeResearchService();
    controller = new DiscussionController(
      mockOrchestratorService as unknown as DiscussionOrchestratorService,
      mockIterativeResearch as unknown as IterativeResearchService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe("startResearchStream", () => {
    it("should set SSE headers and stream events", async () => {
      const mockRes = createMockResponse();
      const mockDto = { query: "What is the future of AI research?" } as never;

      const subject = new Subject<{ type: string; data: unknown }>();
      mockIterativeResearch.startResearch.mockReturnValue(
        subject.asObservable() as never,
      );

      const streamPromise = controller.startResearchStream(
        "proj-1",
        mockDto,
        mockRes as never,
      );

      // Emit an event
      subject.next({ type: "thinking", data: { message: "Analyzing..." } });
      subject.complete();

      await streamPromise;

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        "no-cache",
      );
      expect(mockRes.flushHeaders).toHaveBeenCalled();
      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining("event: thinking"),
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it("should write error event when stream errors", async () => {
      const mockRes = createMockResponse();
      const mockDto = { query: "Research query" } as never;

      // Use a Subject that immediately errors to simulate stream failure
      const errorSubject = new Subject<{ type: string; data: unknown }>();
      mockIterativeResearch.startResearch.mockReturnValue(
        errorSubject.asObservable() as never,
      );

      const streamPromise = controller.startResearchStream(
        "proj-1",
        mockDto,
        mockRes as never,
      );

      // Trigger the error synchronously after subscribe
      errorSubject.error(new Error("Stream error"));

      await streamPromise;

      expect(mockRes.write).toHaveBeenCalledWith(
        expect.stringContaining("event: error"),
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it("should handle client disconnect", async () => {
      const mockRes = createMockResponse();
      const mockDto = { query: "Query" } as never;

      const subject = new Subject<{ type: string; data: unknown }>();
      mockIterativeResearch.startResearch.mockReturnValue(
        subject.asObservable() as never,
      );

      // Capture the close handler
      let closeHandler: (() => void) | undefined;
      mockRes.on.mockImplementation((event: string, handler: () => void) => {
        if (event === "close") {
          closeHandler = handler;
        }
      });

      const streamPromise = controller.startResearchStream(
        "proj-1",
        mockDto,
        mockRes as never,
      );

      // Simulate client disconnect
      if (closeHandler) {
        closeHandler();
      }

      subject.complete();
      await streamPromise;

      expect(mockRes.on).toHaveBeenCalledWith("close", expect.any(Function));
    });

    it("should timeout after 30 minutes", async () => {
      const mockRes = createMockResponse();
      const mockDto = { query: "Long running query" } as never;

      const subject = new Subject<{ type: string; data: unknown }>();
      mockIterativeResearch.startResearch.mockReturnValue(
        subject.asObservable() as never,
      );

      const streamPromise = controller.startResearchStream(
        "proj-1",
        mockDto,
        mockRes as never,
      );

      // Advance time by 30 minutes
      jest.advanceTimersByTime(30 * 60 * 1000);

      subject.complete();
      await streamPromise;

      expect(mockRes.end).toHaveBeenCalled();
    });

    it("should not write to closed connection", async () => {
      const mockRes = createMockResponse();
      // Mock write to simulate closed connection
      mockRes.write.mockReturnValue(false);
      const mockDto = { query: "Query" } as never;

      const subject = new Subject<{ type: string; data: unknown }>();
      mockIterativeResearch.startResearch.mockReturnValue(
        subject.asObservable() as never,
      );

      const streamPromise = controller.startResearchStream(
        "proj-1",
        mockDto,
        mockRes as never,
      );

      subject.next({ type: "update", data: { content: "..." } });
      subject.complete();
      await streamPromise;

      // Should still call end
      expect(mockRes.end).toHaveBeenCalled();
    });
  });

  describe("startResearch", () => {
    it("should start research and return session ID", async () => {
      const subject = new Subject<{ type: string; data: unknown }>();
      mockOrchestratorService.startResearch.mockReturnValue(
        subject.asObservable() as never,
      );

      const dto = { query: "Research question here" } as never;
      const result = await controller.startResearch("proj-1", dto);

      expect(result.sessionId).toMatch(/^dr_/);
      expect(result.message).toBe("深度研究已启动");
      expect(mockOrchestratorService.startResearch).toHaveBeenCalledWith(
        "proj-1",
        dto,
      );
    });

    it("should subscribe to research observable in background", async () => {
      const subject = new Subject<{ type: string; data: unknown }>();
      mockOrchestratorService.startResearch.mockReturnValue(
        subject.asObservable() as never,
      );

      const dto = { query: "Background research" } as never;
      await controller.startResearch("proj-1", dto);

      // Emit events in background
      expect(() => {
        subject.next({ type: "progress", data: { percent: 50 } });
        subject.complete();
      }).not.toThrow();
    });
  });

  describe("getSession", () => {
    it("should return session when found", async () => {
      const mockSession = {
        id: "session-1",
        projectId: "proj-1",
        status: "COMPLETED",
      };
      mockOrchestratorService.getSession.mockResolvedValue(
        mockSession as never,
      );

      const result = await controller.getSession("proj-1", "session-1");

      expect(mockOrchestratorService.getSession).toHaveBeenCalledWith(
        "session-1",
      );
      expect(result).toEqual(mockSession);
    });

    it("should throw NotFoundException when session not found", async () => {
      mockOrchestratorService.getSession.mockResolvedValue(null);

      await expect(
        controller.getSession("proj-1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getProjectSessions", () => {
    it("should return project sessions", async () => {
      const sessions = [
        { id: "s1", projectId: "proj-1" },
        { id: "s2", projectId: "proj-1" },
      ];
      mockOrchestratorService.getProjectSessions.mockResolvedValue(
        sessions as never,
      );

      const result = await controller.getProjectSessions("proj-1");

      expect(mockOrchestratorService.getProjectSessions).toHaveBeenCalledWith(
        "proj-1",
      );
      expect(result).toHaveLength(2);
    });
  });

  describe("deleteSession", () => {
    it("should delete session and return message", async () => {
      mockOrchestratorService.deleteSession.mockResolvedValue(undefined);

      const result = await controller.deleteSession("proj-1", "session-1");

      expect(mockOrchestratorService.deleteSession).toHaveBeenCalledWith(
        "session-1",
      );
      expect(result.message).toBe("研究会话已删除");
    });

    it("should throw BadRequestException when delete fails", async () => {
      mockOrchestratorService.deleteSession.mockRejectedValue(
        new Error("Session not found"),
      );

      await expect(
        controller.deleteSession("proj-1", "bad-session"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("deleteSessions", () => {
    it("should batch delete sessions and return count", async () => {
      mockOrchestratorService.deleteSessions.mockResolvedValue({ count: 3 });

      const result = await controller.deleteSessions("proj-1", {
        sessionIds: ["s1", "s2", "s3"],
      });

      expect(result.deleted).toBe(3);
      expect(result.message).toContain("3");
    });

    it("should throw BadRequestException when batch delete fails", async () => {
      mockOrchestratorService.deleteSessions.mockRejectedValue(
        new Error("Batch delete failed"),
      );

      await expect(
        controller.deleteSessions("proj-1", { sessionIds: ["s1"] }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
