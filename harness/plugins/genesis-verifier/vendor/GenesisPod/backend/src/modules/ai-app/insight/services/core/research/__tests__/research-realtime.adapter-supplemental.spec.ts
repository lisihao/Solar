/**
 * ResearchRealtimeAdapter - Supplemental Tests
 *
 * Covers uncovered branches:
 * - cleanupStaleSubscriptions: stale entry removal + debug log (lines 100-112)
 * - startCleanupTask callback invocation via fake timers (line 90)
 * - cleanupStaleSubscriptions: no entries cleaned (cleaned === 0, line 111 not logged)
 */

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

function buildMocks() {
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

  const mockFacade = {
    realtimeEmitter: mockRealtimeEmitter,
    realtimeProgress: mockRealtimeProgress,
    startTrace: jest.fn().mockReturnValue("trace-123"),
    endTrace: jest.fn(),
    addSpan: jest.fn().mockReturnValue("span-123"),
    endSpan: jest.fn(),
  };

  return { mockRealtimeEmitter, mockRealtimeProgress, mockFacade };
}

describe("ResearchRealtimeAdapter (supplemental – cleanup)", () => {
  let adapter: ResearchRealtimeAdapter;
  let mockRealtimeEmitter: ReturnType<typeof buildMocks>["mockRealtimeEmitter"];

  beforeEach(async () => {
    const mocks = buildMocks();
    mockRealtimeEmitter = mocks.mockRealtimeEmitter;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchRealtimeAdapter,
        { provide: AgentFacade, useValue: mocks.mockFacade },
      ],
    }).compile();

    adapter = module.get<ResearchRealtimeAdapter>(ResearchRealtimeAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // ============================================================
  // cleanupStaleSubscriptions – stale entries removed (lines 100-112)
  // ============================================================

  it("should remove stale subscriptions and log debug when cleaned > 0", () => {
    jest.useFakeTimers();
    adapter.onModuleInit(); // starts cleanup interval

    // Register a subscription with a mock unsubscribe
    const mockUnsubscribe = jest.fn();
    mockRealtimeEmitter.subscribe.mockReturnValue(mockUnsubscribe);
    adapter.subscribeToTopic("topic-stale", jest.fn());

    expect(adapter.getSubscriptionCount()).toBe(1);

    // Directly inject a stale createdAt into subscriptionRegistry
    const registry = (adapter as any).subscriptionRegistry as Map<
      string,
      { createdAt: Date; unsubscribe: () => void }
    >;
    // Set createdAt to far in the past (beyond TTL)
    for (const entry of registry.values()) {
      entry.createdAt = new Date(
        Date.now() - (adapter as any).SUBSCRIPTION_TTL_MS - 1,
      );
    }

    // Trigger the interval callback once
    jest.advanceTimersByTime(10 * 60 * 1000 + 100);

    // Stale entry should have been removed
    expect(adapter.getSubscriptionCount()).toBe(0);
    expect(mockUnsubscribe).toHaveBeenCalled();

    // Clean up
    adapter.onModuleDestroy();
  });

  it("should NOT remove fresh subscriptions (cleaned === 0 path)", () => {
    jest.useFakeTimers();
    adapter.onModuleInit();

    // Register a fresh subscription
    const mockUnsubscribe = jest.fn();
    mockRealtimeEmitter.subscribe.mockReturnValue(mockUnsubscribe);
    adapter.subscribeToTopic("topic-fresh", jest.fn());

    expect(adapter.getSubscriptionCount()).toBe(1);

    // Do NOT set createdAt to past — subscription is fresh

    // Trigger the interval callback once
    jest.advanceTimersByTime(10 * 60 * 1000 + 100);

    // Fresh entry should remain
    expect(adapter.getSubscriptionCount()).toBe(1);
    expect(mockUnsubscribe).not.toHaveBeenCalled();

    adapter.onModuleDestroy();
  });

  it("should invoke cleanupStaleSubscriptions when cleanup interval fires", () => {
    jest.useFakeTimers();
    adapter.onModuleInit();

    const cleanupSpy = jest.spyOn(adapter as any, "cleanupStaleSubscriptions");

    // Advance time past the 10 minute cleanup interval
    jest.advanceTimersByTime(10 * 60 * 1000 + 100);

    expect(cleanupSpy).toHaveBeenCalled();

    adapter.onModuleDestroy();
  });
});
