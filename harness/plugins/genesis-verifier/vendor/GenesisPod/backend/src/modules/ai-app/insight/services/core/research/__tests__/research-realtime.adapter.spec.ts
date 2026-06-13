/**
 * ResearchRealtimeAdapter Unit Tests
 *
 * Coverage targets:
 * - Graceful degradation when facade is unavailable
 * - startMissionTracking / progress phase methods
 * - Event emission (emitToTopic, emitToMission, emitToBoth)
 * - Subscription management (subscribeToTopic, subscribeToMission, unsubscribeAll)
 * - Cleanup (stale subscriptions, onModuleDestroy)
 * - Convenience methods (emitMissionStarted, emitMissionCompleted, etc.)
 */

// Break the circular dependency:
// research-realtime.adapter → research-event-emitter.service → research-realtime.adapter
// We mock the event emitter module so Jest does not need to evaluate it during module loading.
jest.mock("../research-event-emitter.service", () => ({
  ResearchEventType: {
    MISSION_STARTED: "MISSION_STARTED",
    MISSION_COMPLETED: "MISSION_COMPLETED",
    MISSION_FAILED: "MISSION_FAILED",
    MISSION_PROGRESS: "MISSION_PROGRESS",
    DIMENSION_PROGRESS: "DIMENSION_PROGRESS",
    AGENT_WORKING: "AGENT_WORKING",
    TASK_COMPLETED: "TASK_COMPLETED",
    TASK_FAILED: "TASK_FAILED",
  },
  ResearchEventEmitterService: jest.fn().mockImplementation(() => ({})),
  RESEARCH_INTERNAL_EVENTS: {},
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ResearchRealtimeAdapter } from "../research-realtime.adapter";
import { AgentFacade } from "@/modules/ai-harness/facade";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildRealtimeMocks() {
  const mockRealtimeEmitter = {
    emitToRoom: jest.fn(),
    subscribe: jest.fn().mockReturnValue(() => {}),
  };

  const mockRealtimeProgress = {
    create: jest.fn(),
    start: jest.fn(),
    startPhase: jest.fn(),
    updatePhaseProgress: jest.fn(),
    completePhase: jest.fn(),
    getProgress: jest.fn().mockReturnValue({ progress: 50 }),
    complete: jest.fn(),
    fail: jest.fn(),
  };

  const mockFacadeWithRealtime = {
    realtimeEmitter: mockRealtimeEmitter,
    realtimeProgress: mockRealtimeProgress,
    startTrace: jest.fn().mockReturnValue("trace-123"),
    endTrace: jest.fn(),
    addSpan: jest.fn().mockReturnValue("span-123"),
    endSpan: jest.fn(),
  };

  return { mockRealtimeEmitter, mockRealtimeProgress, mockFacadeWithRealtime };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests: Degraded mode (no facade)
// ──────────────────────────────────────────────────────────────────────────────

describe("ResearchRealtimeAdapter (degraded mode - no facade)", () => {
  let adapter: ResearchRealtimeAdapter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ResearchRealtimeAdapter],
    }).compile();

    adapter = module.get<ResearchRealtimeAdapter>(ResearchRealtimeAdapter);
  });

  afterEach(() => jest.clearAllMocks());

  it("should initialize without throwing when facade is not provided", () => {
    expect(adapter).toBeDefined();
  });

  it("onModuleInit should log warning in degraded mode", () => {
    // Should not throw
    expect(() => adapter.onModuleInit()).not.toThrow();
  });

  it("onModuleDestroy should not throw in degraded mode", () => {
    expect(() => adapter.onModuleDestroy()).not.toThrow();
  });

  it("startMissionTracking should silently return when not enabled", () => {
    expect(() =>
      adapter.startMissionTracking("topic-1", "mission-1", false),
    ).not.toThrow();
  });

  it("startPhase should silently return when not enabled", () => {
    expect(() => adapter.startPhase("mission-1", "planning")).not.toThrow();
  });

  it("updatePhaseProgress should return 0 when not enabled", () => {
    const result = adapter.updatePhaseProgress("mission-1", "planning", 50);
    expect(result).toBe(0);
  });

  it("completePhase should silently return when not enabled", () => {
    expect(() => adapter.completePhase("mission-1", "planning")).not.toThrow();
  });

  it("getMissionProgress should return 0 when not enabled", () => {
    expect(adapter.getMissionProgress("mission-1")).toBe(0);
  });

  it("completeMissionTracking should silently return when not enabled", () => {
    expect(() =>
      adapter.completeMissionTracking("mission-1", "done"),
    ).not.toThrow();
  });

  it("failMissionTracking should silently return when not enabled", () => {
    expect(() =>
      adapter.failMissionTracking("mission-1", "error message"),
    ).not.toThrow();
  });

  it("emitToTopic should silently return when not enabled", () => {
    expect(() =>
      adapter.emitToTopic("topic-1", "mission:started", { data: "test" }),
    ).not.toThrow();
  });

  it("emitToMission should silently return when not enabled", () => {
    expect(() =>
      adapter.emitToMission("mission-1", "mission:progress", { data: "test" }),
    ).not.toThrow();
  });

  it("emitToBoth should silently return when not enabled", () => {
    expect(() =>
      adapter.emitToBoth("topic-1", "mission-1", "mission:started", {}),
    ).not.toThrow();
  });

  it("subscribeToTopic should return a no-op function when not enabled", () => {
    const unsubscribe = adapter.subscribeToTopic("topic-1", jest.fn());
    expect(typeof unsubscribe).toBe("function");
    // Calling it should not throw
    expect(() => unsubscribe()).not.toThrow();
  });

  it("subscribeToMission should return a no-op function when not enabled", () => {
    const unsubscribe = adapter.subscribeToMission("mission-1", jest.fn());
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });

  it("getSubscriptionCount should return 0 when not enabled", () => {
    expect(adapter.getSubscriptionCount()).toBe(0);
  });

  it("unsubscribeAll should not throw when not enabled", () => {
    expect(() => adapter.unsubscribeAll("topic", "topic-1")).not.toThrow();
  });

  it("emitMissionStarted should silently return when not enabled", () => {
    expect(() =>
      adapter.emitMissionStarted("topic-1", "mission-1", "gpt-4o", false),
    ).not.toThrow();
  });

  it("emitMissionProgress should silently return when not enabled", () => {
    expect(() =>
      adapter.emitMissionProgress(
        "topic-1",
        "mission-1",
        "planning",
        50,
        "progress message",
      ),
    ).not.toThrow();
  });

  it("emitMissionCompleted should silently return when not enabled", () => {
    expect(() =>
      adapter.emitMissionCompleted("topic-1", "mission-1", {
        completedTasks: 5,
        totalTasks: 5,
        totalWords: 1000,
      }),
    ).not.toThrow();
  });

  it("emitMissionFailed should silently return when not enabled", () => {
    expect(() =>
      adapter.emitMissionFailed("topic-1", "mission-1", "something went wrong"),
    ).not.toThrow();
  });

  it("emitDimensionProgress should silently return when not enabled", () => {
    expect(() =>
      adapter.emitDimensionProgress(
        "topic-1",
        "mission-1",
        "技术发展",
        60,
        "searching",
      ),
    ).not.toThrow();
  });

  it("emitAgentWorking should silently return when not enabled", () => {
    expect(() =>
      adapter.emitAgentWorking("topic-1", "mission-1", {
        agentId: "agent-1",
        agentName: "研究员",
        agentRole: "researcher",
        status: "working",
        progress: 30,
      }),
    ).not.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: Enabled mode (with facade providing realtimeEmitter and realtimeProgress)
// ──────────────────────────────────────────────────────────────────────────────

describe("ResearchRealtimeAdapter (enabled mode - with facade)", () => {
  let adapter: ResearchRealtimeAdapter;
  let mockRealtimeEmitter: ReturnType<
    typeof buildRealtimeMocks
  >["mockRealtimeEmitter"];
  let mockRealtimeProgress: ReturnType<
    typeof buildRealtimeMocks
  >["mockRealtimeProgress"];
  let mockFacadeWithRealtime: ReturnType<
    typeof buildRealtimeMocks
  >["mockFacadeWithRealtime"];

  beforeEach(async () => {
    const mocks = buildRealtimeMocks();
    mockRealtimeEmitter = mocks.mockRealtimeEmitter;
    mockRealtimeProgress = mocks.mockRealtimeProgress;
    mockFacadeWithRealtime = mocks.mockFacadeWithRealtime;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchRealtimeAdapter,
        { provide: AgentFacade, useValue: mockFacadeWithRealtime },
      ],
    }).compile();

    adapter = module.get<ResearchRealtimeAdapter>(ResearchRealtimeAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("should be enabled when facade provides realtimeEmitter and realtimeProgress", () => {
    expect(adapter).toBeDefined();
    // Verify it's enabled by checking that it calls facade methods
    adapter.startMissionTracking("topic-1", "mission-1");
    expect(mockRealtimeProgress.create).toHaveBeenCalled();
  });

  it("onModuleInit should start cleanup task when enabled", () => {
    jest.useFakeTimers();
    // Should not throw
    expect(() => adapter.onModuleInit()).not.toThrow();
  });

  it("onModuleDestroy should clear interval and unsubscribe all", () => {
    adapter.onModuleInit();
    expect(() => adapter.onModuleDestroy()).not.toThrow();
  });

  // ── Progress tracking ──

  it("startMissionTracking should create and start progress tracking", () => {
    adapter.startMissionTracking("topic-1", "mission-1", false);

    expect(mockRealtimeProgress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mission-1",
        type: "research_mission",
        metadata: expect.objectContaining({
          topicId: "topic-1",
          isQuickMode: false,
        }),
      }),
    );
    expect(mockRealtimeProgress.start).toHaveBeenCalledWith("mission-1");
  });

  it("startMissionTracking uses QUICK_RESEARCH_PHASES when isQuickMode=true", () => {
    adapter.startMissionTracking("topic-1", "mission-1", true);

    expect(mockRealtimeProgress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ isQuickMode: true }),
      }),
    );
    // Quick mode has 3 phases vs standard 4
    const createCall = mockRealtimeProgress.create.mock.calls[0][0];
    expect(createCall.phases).toHaveLength(3);
  });

  it("startPhase should delegate to realtimeProgress", () => {
    adapter.startPhase("mission-1", "planning", "Phase started");
    expect(mockRealtimeProgress.startPhase).toHaveBeenCalledWith(
      "mission-1",
      "planning",
      "Phase started",
    );
  });

  it("updatePhaseProgress should return progress from getProgress", () => {
    mockRealtimeProgress.getProgress.mockReturnValue({ progress: 42 });

    const result = adapter.updatePhaseProgress(
      "mission-1",
      "researching",
      70,
      "msg",
    );

    expect(mockRealtimeProgress.updatePhaseProgress).toHaveBeenCalledWith(
      "mission-1",
      "researching",
      70,
      "msg",
    );
    expect(result).toBe(42);
  });

  it("updatePhaseProgress should return 0 when getProgress returns undefined", () => {
    mockRealtimeProgress.getProgress.mockReturnValue(undefined);
    const result = adapter.updatePhaseProgress("mission-1", "researching", 50);
    expect(result).toBe(0);
  });

  it("completePhase should delegate to realtimeProgress", () => {
    adapter.completePhase("mission-1", "planning", "done");
    expect(mockRealtimeProgress.completePhase).toHaveBeenCalledWith(
      "mission-1",
      "planning",
      "done",
    );
  });

  it("getMissionProgress should return progress value", () => {
    mockRealtimeProgress.getProgress.mockReturnValue({ progress: 75 });
    expect(adapter.getMissionProgress("mission-1")).toBe(75);
  });

  it("getMissionProgress should return 0 when no progress tracked", () => {
    mockRealtimeProgress.getProgress.mockReturnValue(null);
    expect(adapter.getMissionProgress("mission-1")).toBe(0);
  });

  it("completeMissionTracking should call progress complete", () => {
    adapter.completeMissionTracking("mission-1", "done");
    expect(mockRealtimeProgress.complete).toHaveBeenCalledWith(
      "mission-1",
      "done",
    );
  });

  it("failMissionTracking should call progress fail", () => {
    adapter.failMissionTracking("mission-1", "error details");
    expect(mockRealtimeProgress.fail).toHaveBeenCalledWith(
      "mission-1",
      "error details",
    );
  });

  // ── Event emission ──

  it("emitToTopic should emit to topic room via realtimeEmitter", () => {
    adapter.emitToTopic("topic-1", "mission:started", { key: "value" });

    expect(mockRealtimeEmitter.emitToRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "research:topic:topic-1",
        roomType: "topic",
        entityId: "topic-1",
      }),
      expect.objectContaining({
        type: "mission:started",
        payload: { key: "value" },
      }),
    );
  });

  it("emitToMission should emit to mission room via realtimeEmitter", () => {
    adapter.emitToMission("mission-1", "mission:progress", { progress: 50 });

    expect(mockRealtimeEmitter.emitToRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "research:mission:mission-1",
        roomType: "mission",
        entityId: "mission-1",
      }),
      expect.objectContaining({ type: "mission:progress" }),
    );
  });

  it("emitToBoth should emit to both topic and mission rooms", () => {
    adapter.emitToBoth("topic-1", "mission-1", "mission:update", { data: "x" });

    expect(mockRealtimeEmitter.emitToRoom).toHaveBeenCalledTimes(2);
  });

  // ── Convenience event methods ──

  it("emitMissionStarted should start tracking and emit event", () => {
    adapter.emitMissionStarted("topic-1", "mission-1", "gpt-4o", false);

    expect(mockRealtimeProgress.create).toHaveBeenCalled();
    expect(mockRealtimeProgress.start).toHaveBeenCalled();
    expect(mockRealtimeEmitter.emitToRoom).toHaveBeenCalled();
  });

  it("emitMissionCompleted should complete tracking and emit event", () => {
    adapter.emitMissionCompleted("topic-1", "mission-1", {
      completedTasks: 5,
      totalTasks: 5,
      totalWords: 2000,
    });

    expect(mockRealtimeProgress.complete).toHaveBeenCalledWith(
      "mission-1",
      "研究完成",
    );
    expect(mockRealtimeEmitter.emitToRoom).toHaveBeenCalled();
  });

  it("emitMissionFailed should fail tracking and emit event", () => {
    adapter.emitMissionFailed("topic-1", "mission-1", "AI error");

    expect(mockRealtimeProgress.fail).toHaveBeenCalledWith(
      "mission-1",
      "AI error",
    );
    expect(mockRealtimeEmitter.emitToRoom).toHaveBeenCalled();
  });

  it("emitDimensionProgress should update phase and emit event", () => {
    adapter.emitDimensionProgress(
      "topic-1",
      "mission-1",
      "技术分析",
      60,
      "分析中",
    );

    expect(mockRealtimeProgress.updatePhaseProgress).toHaveBeenCalledWith(
      "mission-1",
      "researching",
      60,
      "分析中",
    );
    expect(mockRealtimeEmitter.emitToRoom).toHaveBeenCalled();
  });

  it("emitAgentWorking should emit agent status event", () => {
    adapter.emitAgentWorking("topic-1", "mission-1", {
      agentId: "agent-01",
      agentName: "研究员A",
      agentRole: "researcher",
      status: "working",
      taskDescription: "分析市场",
      progress: 40,
      modelId: "gpt-4o",
    });

    expect(mockRealtimeEmitter.emitToRoom).toHaveBeenCalled();
  });

  it("emitMissionProgress should update phase and emit event with extras", () => {
    adapter.emitMissionProgress(
      "topic-1",
      "mission-1",
      "researching",
      75,
      "progress message",
      { extraKey: "extraValue" },
    );

    expect(mockRealtimeProgress.updatePhaseProgress).toHaveBeenCalled();
    expect(mockRealtimeEmitter.emitToRoom).toHaveBeenCalled();
  });

  // ── Subscription management ──

  it("subscribeToTopic should register subscription and return unsubscribe function", () => {
    const callback = jest.fn();
    const unsubscribe = adapter.subscribeToTopic("topic-1", callback);

    expect(adapter.getSubscriptionCount()).toBe(1);
    expect(typeof unsubscribe).toBe("function");
  });

  it("subscribeToMission should register subscription and return unsubscribe function", () => {
    const callback = jest.fn();
    const unsubscribe = adapter.subscribeToMission("mission-1", callback);

    expect(adapter.getSubscriptionCount()).toBe(1);
    expect(typeof unsubscribe).toBe("function");
  });

  it("unsubscribe function should remove subscription from registry", () => {
    const unsubscribe = adapter.subscribeToTopic("topic-1", jest.fn());
    expect(adapter.getSubscriptionCount()).toBe(1);

    unsubscribe();
    expect(adapter.getSubscriptionCount()).toBe(0);
  });

  it("unsubscribeAll should remove all subscriptions for an entity", () => {
    adapter.subscribeToTopic("topic-1", jest.fn());
    adapter.subscribeToTopic("topic-1", jest.fn());
    adapter.subscribeToMission("mission-1", jest.fn());

    expect(adapter.getSubscriptionCount()).toBe(3);

    adapter.unsubscribeAll("topic", "topic-1");
    expect(adapter.getSubscriptionCount()).toBe(1);
  });

  it("unsubscribeAll with mission type should only remove mission subscriptions", () => {
    adapter.subscribeToTopic("topic-1", jest.fn());
    adapter.subscribeToMission("mission-1", jest.fn());

    adapter.unsubscribeAll("mission", "mission-1");
    expect(adapter.getSubscriptionCount()).toBe(1);
  });

  it("subscribeToTopic callback should be triggered for matching topic events", () => {
    const callback = jest.fn();

    // Intercept the subscribe call to capture the inner callback
    let capturedHandler: ((event: unknown) => void) | undefined;
    mockRealtimeEmitter.subscribe.mockImplementation(
      (_eventType: string, handler: (event: unknown) => void) => {
        capturedHandler = handler;
        return () => {};
      },
    );

    adapter.subscribeToTopic("topic-1", callback);

    // Simulate an event for the correct topic
    if (capturedHandler) {
      capturedHandler({
        type: "mission:started",
        payload: { missionId: "mission-1" },
        metadata: { sessionId: "topic-1" }, // matches topicId
      });
    }

    expect(callback).toHaveBeenCalledWith("mission:started", {
      missionId: "mission-1",
    });
  });

  it("subscribeToTopic callback should NOT be triggered for non-matching topic", () => {
    const callback = jest.fn();

    let capturedHandler: ((event: unknown) => void) | undefined;
    mockRealtimeEmitter.subscribe.mockImplementation(
      (_eventType: string, handler: (event: unknown) => void) => {
        capturedHandler = handler;
        return () => {};
      },
    );

    adapter.subscribeToTopic("topic-1", callback);

    if (capturedHandler) {
      capturedHandler({
        type: "mission:started",
        payload: {},
        metadata: { sessionId: "topic-DIFFERENT" }, // different topic
      });
    }

    expect(callback).not.toHaveBeenCalled();
  });

  it("subscribeToMission callback should be triggered for matching mission events", () => {
    const callback = jest.fn();

    let capturedHandler: ((event: unknown) => void) | undefined;
    mockRealtimeEmitter.subscribe.mockImplementation(
      (_eventType: string, handler: (event: unknown) => void) => {
        capturedHandler = handler;
        return () => {};
      },
    );

    adapter.subscribeToMission("mission-1", callback);

    if (capturedHandler) {
      capturedHandler({
        type: "mission:progress",
        payload: { progress: 50 },
        metadata: { correlationId: "mission-1" },
      });
    }

    expect(callback).toHaveBeenCalledWith("mission:progress", { progress: 50 });
  });

  it("onModuleDestroy should call unsubscribe for all registered subscriptions", () => {
    const mockUnsubscribe1 = jest.fn();
    const mockUnsubscribe2 = jest.fn();
    let callCount = 0;

    mockRealtimeEmitter.subscribe.mockImplementation(() => {
      callCount++;
      return callCount <= 10 ? mockUnsubscribe1 : mockUnsubscribe2;
    });

    adapter.subscribeToTopic("topic-1", jest.fn());
    adapter.subscribeToMission("mission-1", jest.fn());

    adapter.onModuleDestroy();

    // unsubscribers should have been called
    expect(mockUnsubscribe1).toHaveBeenCalled();
    expect(adapter.getSubscriptionCount()).toBe(0);
  });

  it("getSubscriptionCount should accurately track multiple subscriptions", () => {
    expect(adapter.getSubscriptionCount()).toBe(0);

    adapter.subscribeToTopic("topic-1", jest.fn());
    expect(adapter.getSubscriptionCount()).toBe(1);

    adapter.subscribeToTopic("topic-2", jest.fn());
    expect(adapter.getSubscriptionCount()).toBe(2);

    adapter.subscribeToMission("mission-1", jest.fn());
    expect(adapter.getSubscriptionCount()).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: Partially available facade (only emitter, no progress)
// ──────────────────────────────────────────────────────────────────────────────

describe("ResearchRealtimeAdapter (partially available facade)", () => {
  it("should be in degraded mode when realtimeProgress is missing", async () => {
    const mockFacadeNoProgress = {
      realtimeEmitter: { emitToRoom: jest.fn(), subscribe: jest.fn() },
      realtimeProgress: undefined,
    };

    const module = await Test.createTestingModule({
      providers: [
        ResearchRealtimeAdapter,
        { provide: AgentFacade, useValue: mockFacadeNoProgress },
      ],
    }).compile();

    const adapter = module.get<ResearchRealtimeAdapter>(
      ResearchRealtimeAdapter,
    );

    // In degraded mode, should return 0
    expect(adapter.getMissionProgress("mission-1")).toBe(0);

    // emitToTopic should also silently return
    expect(() => adapter.emitToTopic("topic-1", "event", {})).not.toThrow();
  });

  it("should be in degraded mode when realtimeEmitter is missing", async () => {
    const mockFacadeNoEmitter = {
      realtimeEmitter: undefined,
      realtimeProgress: { create: jest.fn(), start: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        ResearchRealtimeAdapter,
        { provide: AgentFacade, useValue: mockFacadeNoEmitter },
      ],
    }).compile();

    const adapter = module.get<ResearchRealtimeAdapter>(
      ResearchRealtimeAdapter,
    );
    expect(adapter.getMissionProgress("mission-1")).toBe(0);
  });
});
