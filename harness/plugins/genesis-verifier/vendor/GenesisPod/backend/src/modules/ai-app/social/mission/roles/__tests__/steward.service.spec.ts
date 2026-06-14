/**
 * Unit tests for StewardService
 *
 * S1 budget-eval — 4-gate guardian.
 * tickCost label is the fixed string "steward" (no platform suffix).
 */

import { Test, TestingModule } from "@nestjs/testing";
import { StewardService } from "../steward.service";
import {
  SocialAgentInvoker,
  type SocialInvocationContext,
} from "../social-agent-invoker.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(
  overrides: Partial<SocialInvocationContext> = {},
): SocialInvocationContext {
  return {
    missionId: "mission-steward",
    userId: "user-steward",
    agentId: "agent-steward",
    role: "steward",
    ...overrides,
  };
}

function makeInvokeResult(state = "completed") {
  return {
    state,
    output: {
      decision: "proceed",
      gateResults: {
        budget: "pass",
        session: "pass",
        concurrency: "pass",
        keyHealth: "pass",
      },
      reasoning: "All 4 gates passed; mission may proceed.",
    },
    events: [{ type: "token_usage", tokensIn: 120, tokensOut: 180 }],
    iterations: 1,
    wallTimeMs: 2200,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoker = {
  invoke: jest.fn(),
  tickCost: jest.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("StewardService", () => {
  let service: StewardService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StewardService,
        { provide: SocialAgentInvoker, useValue: mockInvoker },
      ],
    }).compile();

    service = module.get<StewardService>(StewardService);
  });

  // -------------------------------------------------------------------------
  // Success path — no pool
  // -------------------------------------------------------------------------

  describe("run — success without pool", () => {
    it("should invoke StewardAgent and return normalized result", async () => {
      const invokeResult = makeInvokeResult("completed");
      mockInvoker.invoke.mockResolvedValue(invokeResult);

      const result = await service.run({
        input: {
          userId: "user-steward",
          platforms: ["WECHAT_MP"],
          remainingCreditsUsd: 5.0,
          estimatedCostUsd: 0.3,
          sessionExpiresAt: { WECHAT_MP: "2026-06-01T00:00:00.000Z" },
          inProgressMissionCount: 1,
          keyCooldownCount1h: 0,
        },
        ctx: makeCtx(),
      });

      expect(mockInvoker.invoke).toHaveBeenCalledTimes(1);
      expect(result.state).toBe("completed");
      expect(result.output).toBe(invokeResult.output);
      expect(result.iterations).toBe(1);
    });

    it("should not call tickCost when pool is absent", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());

      await service.run({
        input: {
          userId: "user-steward",
          platforms: ["XIAOHONGSHU"],
          remainingCreditsUsd: 2.0,
          estimatedCostUsd: 0.1,
          sessionExpiresAt: {},
          inProgressMissionCount: 0,
          keyCooldownCount1h: 0,
        },
        ctx: makeCtx(),
      });

      expect(mockInvoker.tickCost).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Success path — with pool
  // -------------------------------------------------------------------------

  describe("run — success with pool", () => {
    it("should call tickCost with fixed label steward", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());
      mockInvoker.tickCost.mockResolvedValue(undefined);

      const pool = {} as Parameters<typeof service.run>[0]["pool"];

      await service.run({
        input: {
          userId: "u-s2",
          platforms: ["WECHAT_MP"],
          remainingCreditsUsd: 10.0,
          estimatedCostUsd: 0.5,
          sessionExpiresAt: {},
          inProgressMissionCount: 2,
          keyCooldownCount1h: 1,
        },
        ctx: makeCtx({ missionId: "m-steward", userId: "u-s2" }),
        pool,
      });

      expect(mockInvoker.tickCost).toHaveBeenCalledWith(
        "m-steward",
        "u-s2",
        "steward",
        pool,
        expect.any(Number),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("run — error handling", () => {
    it("should return failed state when invoker returns failed (gate blocked)", async () => {
      mockInvoker.invoke.mockResolvedValue({
        ...makeInvokeResult("failed"),
        output: {
          decision: "terminate",
          gateResults: {
            budget: "fail",
            session: "pass",
            concurrency: "pass",
            keyHealth: "pass",
          },
          reasoning: "Insufficient budget.",
        },
      });

      const result = await service.run({
        input: {
          userId: "user-low-budget",
          platforms: ["WECHAT_MP"],
          remainingCreditsUsd: 0.01,
          estimatedCostUsd: 0.5,
          sessionExpiresAt: {},
          inProgressMissionCount: 0,
          keyCooldownCount1h: 0,
        },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("failed");
    });

    it("should propagate thrown error from invoker", async () => {
      mockInvoker.invoke.mockRejectedValue(
        new Error("steward agent internal error"),
      );

      await expect(
        service.run({
          input: {
            userId: "user-err",
            platforms: ["WECHAT_MP"],
            remainingCreditsUsd: 5.0,
            estimatedCostUsd: 0.3,
            sessionExpiresAt: {},
            inProgressMissionCount: 0,
            keyCooldownCount1h: 0,
          },
          ctx: makeCtx(),
        }),
      ).rejects.toThrow("steward agent internal error");
    });

    it("should return cancelled state when invoker returns cancelled", async () => {
      mockInvoker.invoke.mockResolvedValue({
        ...makeInvokeResult("cancelled"),
        output: undefined,
      });

      const result = await service.run({
        input: {
          userId: "user-cancel",
          platforms: ["WECHAT_MP"],
          remainingCreditsUsd: 5.0,
          estimatedCostUsd: 0.3,
          sessionExpiresAt: {},
          inProgressMissionCount: 0,
          keyCooldownCount1h: 0,
        },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("cancelled");
    });
  });

  // -------------------------------------------------------------------------
  // Events passthrough
  // -------------------------------------------------------------------------

  describe("run — events passthrough", () => {
    it("should return events array unchanged from invoker", async () => {
      const events = [{ type: "step", content: "checking budget gate" }];
      mockInvoker.invoke.mockResolvedValue({ ...makeInvokeResult(), events });

      const result = await service.run({
        input: {
          userId: "user-steward",
          platforms: ["WECHAT_MP"],
          remainingCreditsUsd: 5.0,
          estimatedCostUsd: 0.3,
          sessionExpiresAt: {},
          inProgressMissionCount: 0,
          keyCooldownCount1h: 0,
        },
        ctx: makeCtx(),
      });

      expect(result.events).toBe(events);
    });
  });
});
