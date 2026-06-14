/**
 * AgentFacade 单元测试
 *
 * Tests:
 * - executeAgent() delegation to AgentSubFacade
 * - isAgentAvailable()
 * - Trace/Span lifecycle (startTrace, addSpan, endSpan, endTrace)
 * - Memory coordinator (store, recall)
 * - Intent routing
 * - Realtime (progress, events, WebSocket)
 * - Orchestration service getters
 * - Graceful degradation with missing optional deps
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AgentFacade } from "../agent.facade";
import {
  ORCHESTRATION_FEATURE,
  OBSERVABILITY_FEATURE,
  REALTIME_FEATURE,
  REGISTRY_FEATURE,
} from "../../facade.providers";

describe("AgentFacade", () => {
  let facade: AgentFacade;
  let mockTraceCollector: any;
  let mockMemoryCoordinator: any;
  let mockProgressTracker: any;
  let mockEventEmitter: any;
  let mockAgentExecutor: any;
  let mockAgentRegistry: any;

  beforeEach(async () => {
    mockTraceCollector = {
      startTrace: jest.fn().mockReturnValue("trace-123"),
      addSpan: jest.fn().mockReturnValue("span-456"),
      endSpan: jest.fn(),
      endTrace: jest.fn(),
    };

    mockMemoryCoordinator = {
      store: jest.fn().mockResolvedValue(undefined),
      recall: jest
        .fn()
        .mockResolvedValue({ memories: [], relevantContext: "" }),
    };

    mockProgressTracker = {
      getProgress: jest.fn().mockReturnValue({
        taskId: "task-1",
        progress: 50,
        status: "running",
      }),
    };

    mockEventEmitter = {
      emitToRoom: jest.fn(),
      emitProgress: jest.fn(),
      setServer: jest.fn(),
    };

    mockAgentExecutor = {
      execute: jest.fn().mockResolvedValue({ success: true, output: "done" }),
    };

    mockAgentRegistry = {
      get: jest.fn(),
      has: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentFacade,
        {
          provide: ORCHESTRATION_FEATURE,
          useValue: {
            agentExecutor: mockAgentExecutor,
            intentDetector: {},
            execStateManager: {},
            outputReviewer: {},
            contextEvolution: {},
          },
        },
        // INTELLIGENCE_FEATURE 不再使用 (intentRouter 已删 2026-04-30)
        {
          provide: OBSERVABILITY_FEATURE,
          useValue: {
            traceCollector: mockTraceCollector,
            memoryCoordinator: mockMemoryCoordinator,
          },
        },
        {
          provide: REALTIME_FEATURE,
          useValue: {
            progressTracker: mockProgressTracker,
            eventEmitter: mockEventEmitter,
          },
        },
        {
          provide: REGISTRY_FEATURE,
          useValue: { agent: mockAgentRegistry },
        },
      ],
    }).compile();

    facade = module.get<AgentFacade>(AgentFacade);
  });

  // ==================== Trace/Span ====================

  describe("trace/span lifecycle", () => {
    it("should start a trace and return trace ID", () => {
      const traceId = facade.startTrace({
        name: "test-trace",
        type: "agent" as any,
      });

      expect(traceId).toBe("trace-123");
      expect(mockTraceCollector.startTrace).toHaveBeenCalledWith({
        name: "test-trace",
        type: "agent",
      });
    });

    it("should add a span to a trace", () => {
      const spanId = facade.addSpan("trace-123", {
        name: "llm-call",
        type: "llm" as any,
      });

      expect(spanId).toBe("span-456");
      expect(mockTraceCollector.addSpan).toHaveBeenCalledWith("trace-123", {
        name: "llm-call",
        type: "llm",
      });
    });

    it("should end a span", () => {
      facade.endSpan("span-456", { status: "success" } as any);

      expect(mockTraceCollector.endSpan).toHaveBeenCalledWith("span-456", {
        status: "success",
      });
    });

    it("should end a trace", () => {
      facade.endTrace("trace-123", { status: "completed" } as any);

      expect(mockTraceCollector.endTrace).toHaveBeenCalledWith("trace-123", {
        status: "completed",
      });
    });
  });

  // ==================== Memory Coordinator ====================

  describe("memory coordinator", () => {
    it("should store memory event", async () => {
      const event = { type: "conversation", content: "Hello" } as any;
      await facade.coordinatorStore(event, "user-1", "session-1");

      expect(mockMemoryCoordinator.store).toHaveBeenCalledWith(
        event,
        "user-1",
        "session-1",
      );
    });

    it("should recall memory context", async () => {
      const query = {
        type: "conversation",
        query: "What did we discuss?",
      } as any;
      const result = await facade.coordinatorRecall(
        query,
        "user-1",
        "session-1",
      );

      expect(result).toHaveProperty("memories");
      expect(mockMemoryCoordinator.recall).toHaveBeenCalledWith(
        query,
        "user-1",
        "session-1",
      );
    });
  });

  // routeIntent 已删 (2026-04-30) — IntentRouter 死代码链路

  // ==================== Realtime ====================

  describe("realtime operations", () => {
    it("should get progress for a task", () => {
      const progress = facade.getProgress("task-1");

      expect(progress).not.toBeNull();
      expect(progress!.progress).toBe(50);
    });

    it("should emit events to room", () => {
      const roomConfig = { roomId: "room-1" } as any;
      facade.emitToRoom(roomConfig, "update", { data: "test" });

      expect(mockEventEmitter.emitToRoom).toHaveBeenCalledWith(
        roomConfig,
        expect.objectContaining({
          type: "update",
          payload: { data: "test" },
        }),
      );
    });

    it("should emit progress events", () => {
      const roomConfig = { roomId: "room-1" } as any;
      const progress = { taskId: "t1", progress: 75 } as any;

      facade.emitProgress(roomConfig, progress);

      expect(mockEventEmitter.emitProgress).toHaveBeenCalledWith(
        roomConfig,
        progress,
      );
    });

    it("should set WebSocket server", () => {
      const mockServer = { listen: jest.fn() };
      facade.setWebSocketServer(mockServer);

      expect(mockEventEmitter.setServer).toHaveBeenCalledWith(mockServer);
    });

    it("should expose realtimeEmitter getter", () => {
      expect(facade.realtimeEmitter).toBe(mockEventEmitter);
    });

    it("should expose realtimeProgress getter", () => {
      expect(facade.realtimeProgress).toBe(mockProgressTracker);
    });
  });

  // ==================== Orchestration Getters ====================

  describe("orchestration service getters", () => {
    it("should expose agentExecutor", () => {
      expect(facade.agentExecutor).toBe(mockAgentExecutor);
    });

    it("should expose agentRegistry", () => {
      expect(facade.agentRegistry).toBe(mockAgentRegistry);
    });
  });

  // ==================== Additional orchestration getters ====================

  describe("additional orchestration getters", () => {
    // taskDecomposer 已删 (2026-04-30)

    it("should expose intentDetector", () => {
      expect(facade.intentDetector).toBeDefined();
    });

    it("should expose execStateManager", () => {
      expect(facade.execStateManager).toBeDefined();
    });

    it("should expose outputReviewer", () => {
      expect(facade.outputReviewer).toBeDefined();
    });

    it("should expose contextEvolution", () => {
      expect(facade.contextEvolution).toBeDefined();
    });
  });

  // ==================== Graceful degradation ====================

  describe("without optional dependencies", () => {
    let minimalFacade: AgentFacade;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [AgentFacade],
      }).compile();

      minimalFacade = module.get<AgentFacade>(AgentFacade);
    });

    it("should return undefined for startTrace", () => {
      const result = minimalFacade.startTrace({
        name: "test",
        type: "agent" as any,
      });
      expect(result).toBeUndefined();
    });

    it("should not throw for endSpan", () => {
      expect(() => minimalFacade.endSpan("span-1", {} as any)).not.toThrow();
    });

    it("should return undefined for coordinatorStore", () => {
      const result = minimalFacade.coordinatorStore({} as any, "user-1");
      expect(result).toBeUndefined();
    });

    it("should return null for getProgress", () => {
      const result = minimalFacade.getProgress("task-1");
      expect(result).toBeNull();
    });

    it("should not throw for emitToRoom without emitter", () => {
      expect(() =>
        minimalFacade.emitToRoom({} as any, "event", {}),
      ).not.toThrow();
    });

    it("should return undefined for orchestration getters", () => {
      expect(minimalFacade.agentExecutor).toBeUndefined();
      expect(minimalFacade.agentRegistry).toBeUndefined();
    });
  });
});
