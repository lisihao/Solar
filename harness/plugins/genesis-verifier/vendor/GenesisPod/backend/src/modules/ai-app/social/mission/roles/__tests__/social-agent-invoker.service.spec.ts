/**
 * Unit tests for SocialAgentInvoker
 * Covers invoke, emitLifecycle, tickCost, clearMissionRelayState paths.
 */

import { SocialAgentInvoker } from "../social-agent-invoker.service";
import type {
  AgentRunner,
  EventBus,
  MissionAbortRegistry,
  MissionBudgetPool,
} from "@/modules/ai-harness/facade";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockRunner() {
  return {
    run: jest.fn(),
  } as unknown as jest.Mocked<AgentRunner>;
}

function createMockEventBus() {
  return {
    emit: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<EventBus>;
}

function createMockAbortRegistry() {
  const controller = new AbortController();
  return {
    getSignal: jest.fn().mockReturnValue(controller.signal),
    abort: jest.fn(),
    register: jest.fn(),
    _controller: controller,
  } as unknown as jest.Mocked<MissionAbortRegistry> & {
    _controller: AbortController;
  };
}

function createMockPool() {
  return {
    snapshot: jest.fn().mockReturnValue({
      remainingCostUsd: 5.0,
      maxCostUsd: 10,
      poolCostUsd: 0,
      poolCostRemaining: 5.0,
      poolTokensUsed: 0,
      poolTokensRemaining: 100000,
      totalTokens: 0,
    }),
    tick: jest.fn(),
    recordSpend: jest.fn(),
    isExhausted: jest.fn().mockReturnValue(false),
  } as unknown as jest.Mocked<MissionBudgetPool>;
}

const MOCK_MISSION_ID = "mission-111";
const MOCK_USER_ID = "user-222";
const MOCK_AGENT_ID = "agent-leader";
const MOCK_ROLE = "leader";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SocialAgentInvoker", () => {
  let invoker: SocialAgentInvoker;
  let mockRunner: ReturnType<typeof createMockRunner>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;
  let mockAbortRegistry: ReturnType<typeof createMockAbortRegistry>;

  beforeEach(() => {
    mockRunner = createMockRunner();
    mockEventBus = createMockEventBus();
    mockAbortRegistry = createMockAbortRegistry();
    invoker = new SocialAgentInvoker(
      mockRunner as unknown as AgentRunner,
      mockEventBus as unknown as EventBus,
      mockAbortRegistry as unknown as MissionAbortRegistry,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // invoke
  // =========================================================================

  describe("invoke", () => {
    it("should call runner.run with userId and missionId billing meta", async () => {
      const mockAgentSpec = { agentId: MOCK_AGENT_ID } as Parameters<
        AgentRunner["run"]
      >[0];
      const mockInput = { task: "do something" } as Parameters<
        AgentRunner["run"]
      >[1];
      const mockRunResult = { output: "agent result", tokensUsed: 100 };
      (mockRunner.run as jest.Mock).mockResolvedValue(mockRunResult);

      const ctx = {
        missionId: MOCK_MISSION_ID,
        userId: MOCK_USER_ID,
        agentId: MOCK_AGENT_ID,
        role: MOCK_ROLE,
      };

      const result = await invoker.invoke(mockAgentSpec, mockInput, ctx);

      expect(mockRunner.run).toHaveBeenCalledWith(
        mockAgentSpec,
        mockInput,
        expect.objectContaining({
          userId: MOCK_USER_ID,
          billingMeta: expect.objectContaining({
            moduleType: "ai-social",
            operationType: MOCK_ROLE,
            referenceId: MOCK_MISSION_ID,
          }),
        }),
      );
      expect(result).toBe(mockRunResult);
    });

    it("should inject abort signal from abortRegistry", async () => {
      (mockRunner.run as jest.Mock).mockResolvedValue({ output: "ok" });
      const ctx = {
        missionId: MOCK_MISSION_ID,
        userId: MOCK_USER_ID,
        agentId: MOCK_AGENT_ID,
        role: MOCK_ROLE,
      };

      await invoker.invoke(
        {} as Parameters<AgentRunner["run"]>[0],
        {} as Parameters<AgentRunner["run"]>[1],
        ctx,
      );

      expect(mockAbortRegistry.getSignal).toHaveBeenCalledWith(MOCK_MISSION_ID);
      const runCallArgs = (mockRunner.run as jest.Mock).mock.calls[0][2];
      expect(runCallArgs.signal).toBeDefined();
    });

    it("should pass envAdapter and budgetMultiplier when provided", async () => {
      (mockRunner.run as jest.Mock).mockResolvedValue({ output: "done" });
      const mockEnvAdapter = {
        type: "billing-adapter",
      } as unknown as Parameters<typeof invoker.invoke>[2]["envAdapter"];

      const ctx = {
        missionId: MOCK_MISSION_ID,
        userId: MOCK_USER_ID,
        agentId: MOCK_AGENT_ID,
        role: MOCK_ROLE,
        envAdapter: mockEnvAdapter,
        budgetMultiplier: 1.6,
      };

      await invoker.invoke(
        {} as Parameters<AgentRunner["run"]>[0],
        {} as Parameters<AgentRunner["run"]>[1],
        ctx,
      );

      const runCallArgs = (mockRunner.run as jest.Mock).mock.calls[0][2];
      expect(runCallArgs.environment).toBe(mockEnvAdapter);
      expect(runCallArgs.budgetMultiplier).toBe(1.6);
    });

    it("should pass toolRecallHint when provided", async () => {
      (mockRunner.run as jest.Mock).mockResolvedValue({ output: "done" });
      const hint = { categories: ["search"], preferIds: ["tavily"] };

      const ctx = {
        missionId: MOCK_MISSION_ID,
        userId: MOCK_USER_ID,
        agentId: MOCK_AGENT_ID,
        role: MOCK_ROLE,
        toolRecallHint: hint,
      };

      await invoker.invoke(
        {} as Parameters<AgentRunner["run"]>[0],
        {} as Parameters<AgentRunner["run"]>[1],
        ctx,
      );

      const runCallArgs = (mockRunner.run as jest.Mock).mock.calls[0][2];
      expect(runCallArgs.toolRecallHint).toEqual(hint);
    });

    it("should pass loopOverride when provided", async () => {
      (mockRunner.run as jest.Mock).mockResolvedValue({ output: "done" });

      const ctx = {
        missionId: MOCK_MISSION_ID,
        userId: MOCK_USER_ID,
        agentId: MOCK_AGENT_ID,
        role: MOCK_ROLE,
        loopOverride: "react" as const,
      };

      await invoker.invoke(
        {} as Parameters<AgentRunner["run"]>[0],
        {} as Parameters<AgentRunner["run"]>[1],
        ctx,
      );

      const runCallArgs = (mockRunner.run as jest.Mock).mock.calls[0][2];
      expect(runCallArgs.loopOverride).toBe("react");
    });

    it("should invoke onEvent handler that relays events", async () => {
      let capturedOnEvent: ((event: unknown) => Promise<void>) | undefined;
      (mockRunner.run as jest.Mock).mockImplementation(
        (_spec: unknown, _input: unknown, options: unknown) => {
          capturedOnEvent = (
            options as { onEvent: (event: unknown) => Promise<void> }
          ).onEvent;
          return Promise.resolve({ output: "done" });
        },
      );

      const ctx = {
        missionId: MOCK_MISSION_ID,
        userId: MOCK_USER_ID,
        agentId: MOCK_AGENT_ID,
        role: MOCK_ROLE,
      };

      await invoker.invoke(
        {} as Parameters<AgentRunner["run"]>[0],
        {} as Parameters<AgentRunner["run"]>[1],
        ctx,
      );

      expect(capturedOnEvent).toBeDefined();
    });

    it("should propagate errors thrown by runner.run", async () => {
      (mockRunner.run as jest.Mock).mockRejectedValue(
        new Error("agent crashed"),
      );

      const ctx = {
        missionId: MOCK_MISSION_ID,
        userId: MOCK_USER_ID,
        agentId: MOCK_AGENT_ID,
        role: MOCK_ROLE,
      };

      await expect(
        invoker.invoke(
          {} as Parameters<AgentRunner["run"]>[0],
          {} as Parameters<AgentRunner["run"]>[1],
          ctx,
        ),
      ).rejects.toThrow("agent crashed");
    });
  });

  // =========================================================================
  // emitLifecycle
  // =========================================================================

  describe("emitLifecycle", () => {
    it("should emit lifecycle event via relay (started phase)", async () => {
      await invoker.emitLifecycle(
        MOCK_MISSION_ID,
        MOCK_USER_ID,
        MOCK_AGENT_ID,
        MOCK_ROLE,
        "started",
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: expect.stringContaining("social"),
          scope: expect.objectContaining({ missionId: MOCK_MISSION_ID }),
        }),
      );
    });

    it("should emit lifecycle event via relay (completed phase)", async () => {
      await invoker.emitLifecycle(
        MOCK_MISSION_ID,
        MOCK_USER_ID,
        MOCK_AGENT_ID,
        MOCK_ROLE,
        "completed",
        { tokensUsed: 42 },
      );

      expect(mockEventBus.emit).toHaveBeenCalled();
    });

    it("should emit lifecycle event via relay (failed phase)", async () => {
      await invoker.emitLifecycle(
        MOCK_MISSION_ID,
        MOCK_USER_ID,
        MOCK_AGENT_ID,
        MOCK_ROLE,
        "failed",
        { error: "timeout" },
      );

      expect(mockEventBus.emit).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // tickCost
  // =========================================================================

  describe("tickCost", () => {
    it("should emit token cost event via relay", async () => {
      const mockPool = createMockPool();

      await invoker.tickCost(
        MOCK_MISSION_ID,
        MOCK_USER_ID,
        "s3-content-transform",
        mockPool as unknown as MissionBudgetPool,
        1000,
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: expect.stringContaining("social"),
        }),
      );
    });

    it("should call relay.tickCost with delta tokens", async () => {
      const mockPool = createMockPool();

      await invoker.tickCost(
        MOCK_MISSION_ID,
        MOCK_USER_ID,
        "s6-body-compose",
        mockPool as unknown as MissionBudgetPool,
        500,
      );

      expect(mockEventBus.emit).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // clearMissionRelayState
  // =========================================================================

  describe("clearMissionRelayState", () => {
    it("should not throw when clearing relay state for a mission", () => {
      expect(() =>
        invoker.clearMissionRelayState(MOCK_MISSION_ID),
      ).not.toThrow();
    });

    it("should not throw when clearing relay state for unknown mission", () => {
      expect(() =>
        invoker.clearMissionRelayState("nonexistent-mission"),
      ).not.toThrow();
    });
  });
});
