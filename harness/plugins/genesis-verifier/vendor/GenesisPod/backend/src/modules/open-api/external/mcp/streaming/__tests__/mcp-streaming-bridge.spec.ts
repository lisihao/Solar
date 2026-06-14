import { Test, TestingModule } from "@nestjs/testing";
import { MCPStreamingBridge } from "../mcp-streaming-bridge";
import { ProgressTrackerService } from "../../../../../ai-harness/facade";
import { EngineEventEmitterService } from "../../../../../ai-harness/facade";
import { Response } from "express";

jest.mock("../../../../../ai-engine/facade", () => ({
  EngineEventEmitterService: jest.fn(),
  ProgressTrackerService: jest.fn(),
}));
jest.mock("../../../../../ai-harness/facade", () => ({
  EngineEventEmitterService: jest.fn(),
  ProgressTrackerService: jest.fn(),
}));

describe("MCPStreamingBridge", () => {
  let bridge: MCPStreamingBridge;
  let mockEventEmitter: { subscribe: jest.Mock };
  let mockProgressTracker: { getProgress: jest.Mock };

  const createMockResponse = (): jest.Mocked<Response> => {
    return {
      write: jest.fn(),
      end: jest.fn(),
      setHeader: jest.fn(),
    } as unknown as jest.Mocked<Response>;
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockEventEmitter = {
      subscribe: jest.fn().mockReturnValue(() => {}), // returns unsubscribe fn
    };

    mockProgressTracker = {
      getProgress: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MCPStreamingBridge,
        {
          provide: EngineEventEmitterService,
          useValue: mockEventEmitter,
        },
        {
          provide: ProgressTrackerService,
          useValue: mockProgressTracker,
        },
      ],
    }).compile();

    bridge = module.get<MCPStreamingBridge>(MCPStreamingBridge);
  });

  // =========================================================================
  // registerConnection
  // =========================================================================

  describe("registerConnection", () => {
    it("should register a new SSE connection", () => {
      const response = createMockResponse();
      bridge.registerConnection("session-1", response);

      const stats = bridge.getStats();
      expect(stats.activeConnections).toBe(1);
      expect(stats.connections[0].sessionId).toBe("session-1");
    });

    it("should subscribe to engine events on registration", () => {
      const response = createMockResponse();
      bridge.registerConnection("session-1", response);

      // Should subscribe to 3 events: task.progress, task.complete, task.error
      expect(mockEventEmitter.subscribe).toHaveBeenCalledWith(
        "task.progress",
        expect.any(Function),
      );
      expect(mockEventEmitter.subscribe).toHaveBeenCalledWith(
        "task.complete",
        expect.any(Function),
      );
      expect(mockEventEmitter.subscribe).toHaveBeenCalledWith(
        "task.error",
        expect.any(Function),
      );
    });

    it("should replace existing connection for same session", () => {
      const response1 = createMockResponse();
      const response2 = createMockResponse();

      bridge.registerConnection("session-1", response1);
      bridge.registerConnection("session-1", response2);

      const stats = bridge.getStats();
      expect(stats.activeConnections).toBe(1);
    });

    it("should register multiple different sessions", () => {
      bridge.registerConnection("session-1", createMockResponse());
      bridge.registerConnection("session-2", createMockResponse());
      bridge.registerConnection("session-3", createMockResponse());

      const stats = bridge.getStats();
      expect(stats.activeConnections).toBe(3);
    });
  });

  // =========================================================================
  // unregisterConnection
  // =========================================================================

  describe("unregisterConnection", () => {
    it("should unregister existing connection", () => {
      const response = createMockResponse();
      bridge.registerConnection("session-1", response);
      bridge.unregisterConnection("session-1");

      const stats = bridge.getStats();
      expect(stats.activeConnections).toBe(0);
    });

    it("should call all subscription cleanup functions", () => {
      const unsubFns = [jest.fn(), jest.fn(), jest.fn()];
      let callIdx = 0;
      mockEventEmitter.subscribe.mockImplementation(() => unsubFns[callIdx++]);

      bridge.registerConnection("session-1", createMockResponse());
      bridge.unregisterConnection("session-1");

      for (const unsub of unsubFns) {
        expect(unsub).toHaveBeenCalled();
      }
    });

    it("should silently ignore unregistering unknown session", () => {
      // Should not throw
      expect(() =>
        bridge.unregisterConnection("unknown-session"),
      ).not.toThrow();
    });

    it("should handle cleanup errors gracefully", () => {
      const errorUnsub = jest.fn().mockImplementation(() => {
        throw new Error("Cleanup error");
      });
      mockEventEmitter.subscribe.mockReturnValue(errorUnsub);

      bridge.registerConnection("session-1", createMockResponse());

      // Should not throw even if cleanup fails
      expect(() => bridge.unregisterConnection("session-1")).not.toThrow();
    });
  });

  // =========================================================================
  // sendEvent
  // =========================================================================

  describe("sendEvent", () => {
    it("should send progress event with correct format", () => {
      const response = createMockResponse();
      bridge.registerConnection("session-1", response);

      bridge.sendEvent("session-1", {
        type: "progress",
        taskId: "task-123",
        data: { stage: "searching", percent: 50, message: "Searching..." },
        timestamp: new Date("2026-01-01T00:00:00Z"),
      });

      expect(response.write).toHaveBeenCalledWith("event: message\n");
      const dataCall = (response.write as jest.Mock).mock.calls[1][0] as string;
      expect(dataCall).toContain("data:");

      const jsonData = JSON.parse(dataCall.replace("data: ", "").trim());
      expect(jsonData.jsonrpc).toBe("2.0");
      expect(jsonData.method).toBe("notifications/progress");
      expect(jsonData.params.taskId).toBe("task-123");
      expect(jsonData.params.type).toBe("progress");
    });

    it("should send error event with notifications/error method", () => {
      const response = createMockResponse();
      bridge.registerConnection("session-1", response);

      bridge.sendEvent("session-1", {
        type: "error",
        taskId: "task-123",
        data: { message: "Something failed" },
        timestamp: new Date(),
      });

      const dataCall = (response.write as jest.Mock).mock.calls[1][0] as string;
      const jsonData = JSON.parse(dataCall.replace("data: ", "").trim());
      expect(jsonData.method).toBe("notifications/error");
    });

    it("should send result event with notifications/message method", () => {
      const response = createMockResponse();
      bridge.registerConnection("session-1", response);

      bridge.sendEvent("session-1", {
        type: "result",
        taskId: "task-123",
        data: { result: "Done" },
        timestamp: new Date(),
      });

      const dataCall = (response.write as jest.Mock).mock.calls[1][0] as string;
      const jsonData = JSON.parse(dataCall.replace("data: ", "").trim());
      expect(jsonData.method).toBe("notifications/message");
    });

    it("should silently ignore unknown session", () => {
      // Should not throw
      expect(() =>
        bridge.sendEvent("unknown-session", {
          type: "progress",
          taskId: "task-1",
          data: {},
          timestamp: new Date(),
        }),
      ).not.toThrow();
    });

    it("should unregister connection when write fails", () => {
      const response = createMockResponse();
      (response.write as jest.Mock).mockImplementation(() => {
        throw new Error("Connection closed");
      });

      bridge.registerConnection("session-1", response);
      bridge.sendEvent("session-1", {
        type: "progress",
        taskId: "task-1",
        data: {},
        timestamp: new Date(),
      });

      // Connection should be removed after write failure
      const stats = bridge.getStats();
      expect(stats.activeConnections).toBe(0);
    });
  });

  // =========================================================================
  // sendResearchResult
  // =========================================================================

  describe("sendResearchResult", () => {
    it("should send research result with research_complete type", () => {
      const response = createMockResponse();
      bridge.registerConnection("session-1", response);

      bridge.sendResearchResult("session-1", "task-123", {
        report: "Research complete",
      });

      const dataCall = (response.write as jest.Mock).mock.calls[1][0] as string;
      const jsonData = JSON.parse(dataCall.replace("data: ", "").trim());
      expect(jsonData.method).toBe("notifications/message");
      expect(jsonData.params.type).toBe("research_complete");
      expect(jsonData.params.taskId).toBe("task-123");
      expect(jsonData.params.data).toEqual({ report: "Research complete" });
    });

    it("should warn when no connection found for session", () => {
      // Should not throw, just warn
      expect(() =>
        bridge.sendResearchResult("unknown-session", "task-123", {}),
      ).not.toThrow();
    });

    it("should unregister connection when research result write fails", () => {
      const response = createMockResponse();
      (response.write as jest.Mock).mockImplementation(() => {
        throw new Error("Connection reset");
      });

      bridge.registerConnection("session-1", response);
      bridge.sendResearchResult("session-1", "task-123", {});

      const stats = bridge.getStats();
      expect(stats.activeConnections).toBe(0);
    });
  });

  // =========================================================================
  // broadcast
  // =========================================================================

  describe("broadcast", () => {
    it("should send event to all connected sessions", () => {
      const resp1 = createMockResponse();
      const resp2 = createMockResponse();
      bridge.registerConnection("session-1", resp1);
      bridge.registerConnection("session-2", resp2);

      bridge.broadcast({
        type: "progress",
        taskId: "global-task",
        data: { message: "Broadcast" },
        timestamp: new Date(),
      });

      expect(resp1.write).toHaveBeenCalled();
      expect(resp2.write).toHaveBeenCalled();
    });

    it("should work with no connections", () => {
      expect(() =>
        bridge.broadcast({
          type: "progress",
          taskId: "task",
          data: {},
          timestamp: new Date(),
        }),
      ).not.toThrow();
    });
  });

  // =========================================================================
  // getTaskProgress
  // =========================================================================

  describe("getTaskProgress", () => {
    it("should return progress from progressTracker", () => {
      const mockProgress = { stage: "searching", percent: 50 };
      mockProgressTracker.getProgress.mockReturnValue(mockProgress);

      const result = bridge.getTaskProgress("task-123");
      expect(result).toEqual(mockProgress);
    });

    it("should return null when task not found in progressTracker", () => {
      mockProgressTracker.getProgress.mockReturnValue(null);
      const result = bridge.getTaskProgress("unknown-task");
      expect(result).toBeNull();
    });

    it("should return null when no progressTracker available", async () => {
      const moduleNoTracker = await Test.createTestingModule({
        providers: [MCPStreamingBridge],
      }).compile();

      const bridgeNoTracker =
        moduleNoTracker.get<MCPStreamingBridge>(MCPStreamingBridge);
      const result = bridgeNoTracker.getTaskProgress("task-123");
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe("getStats", () => {
    it("should return correct stats with connections", () => {
      bridge.registerConnection("session-1", createMockResponse());
      bridge.registerConnection("session-2", createMockResponse());

      const stats = bridge.getStats();
      expect(stats.activeConnections).toBe(2);
      expect(stats.connections).toHaveLength(2);
      expect(stats.connections[0]).toMatchObject({
        sessionId: expect.any(String),
        connectedAt: expect.any(Date),
        subscriptionCount: expect.any(Number),
      });
    });
  });

  // =========================================================================
  // Event handler integration
  // =========================================================================

  describe("event handler integration", () => {
    it("should forward engine events to SSE connection", () => {
      let capturedHandler: ((event: unknown) => void) | undefined;
      mockEventEmitter.subscribe.mockImplementation(
        (_event: string, handler: (event: unknown) => void) => {
          if (_event === "task.progress") {
            capturedHandler = handler;
          }
          return () => {};
        },
      );

      const response = createMockResponse();
      bridge.registerConnection("session-1", response);

      // Simulate engine event
      if (capturedHandler) {
        capturedHandler({
          data: { taskId: "task-123", stage: "searching", percent: 30 },
        });
      }

      expect(response.write).toHaveBeenCalled();
    });

    it("should handle event handler errors gracefully", () => {
      let capturedHandler: ((event: unknown) => void) | undefined;
      mockEventEmitter.subscribe.mockImplementation(
        (_event: string, handler: (event: unknown) => void) => {
          if (_event === "task.progress") {
            capturedHandler = handler;
          }
          return () => {};
        },
      );

      const response = createMockResponse();
      (response.write as jest.Mock).mockImplementation(() => {
        throw new Error("Write error");
      });

      bridge.registerConnection("session-1", response);

      // Should not throw
      expect(() => {
        if (capturedHandler) {
          capturedHandler({ data: { taskId: "task-123" } });
        }
      }).not.toThrow();
    });
  });

  // =========================================================================
  // No event emitter
  // =========================================================================

  describe("without event emitter", () => {
    it("should register connection without subscriptions when no emitter", async () => {
      const moduleNoEmitter = await Test.createTestingModule({
        providers: [MCPStreamingBridge],
      }).compile();

      const bridgeNoEmitter =
        moduleNoEmitter.get<MCPStreamingBridge>(MCPStreamingBridge);
      const response = createMockResponse();

      bridgeNoEmitter.registerConnection("session-1", response);

      const stats = bridgeNoEmitter.getStats();
      expect(stats.activeConnections).toBe(1);
      expect(stats.connections[0].subscriptionCount).toBe(0);
    });
  });
});
