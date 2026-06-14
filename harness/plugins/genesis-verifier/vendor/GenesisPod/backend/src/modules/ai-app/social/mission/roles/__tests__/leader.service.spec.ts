/**
 * Unit tests for LeaderService
 *
 * LeaderAgent has 4 phases (plan / assess-transform / foreword / signoff).
 * tickCost label is `leader-${input.phase}`.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { LeaderService } from "../leader.service";
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
    missionId: "mission-leader",
    userId: "user-leader",
    agentId: "agent-leader",
    role: "leader",
    ...overrides,
  };
}

function makeInvokeResult(state = "completed") {
  return {
    state,
    output: {
      phase: "plan",
      decision: "proceed",
      platforms: ["WECHAT_MP"],
      reasoning: "Content quality is adequate.",
    },
    events: [{ type: "token_usage", tokensIn: 200, tokensOut: 400 }],
    iterations: 3,
    wallTimeMs: 6000,
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

describe("LeaderService", () => {
  let service: LeaderService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderService,
        { provide: SocialAgentInvoker, useValue: mockInvoker },
      ],
    }).compile();

    service = module.get<LeaderService>(LeaderService);
  });

  // -------------------------------------------------------------------------
  // Success path — no pool
  // -------------------------------------------------------------------------

  describe("run — success without pool", () => {
    it("should invoke LeaderAgent and return normalized result", async () => {
      const invokeResult = makeInvokeResult("completed");
      mockInvoker.invoke.mockResolvedValue(invokeResult);

      const result = await service.run({
        input: { phase: "plan", topic: "AI trends", platforms: ["WECHAT_MP"] },
        ctx: makeCtx(),
      });

      expect(mockInvoker.invoke).toHaveBeenCalledTimes(1);
      expect(result.state).toBe("completed");
      expect(result.output).toBe(invokeResult.output);
      expect(result.iterations).toBe(3);
    });

    it("should not call tickCost when pool is absent", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());

      await service.run({
        input: {
          phase: "signoff",
          topic: "Final review",
          platforms: ["WECHAT_MP"],
        },
        ctx: makeCtx(),
      });

      expect(mockInvoker.tickCost).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Success path — with pool (all 4 phases)
  // -------------------------------------------------------------------------

  describe("run — with pool, phase-specific label", () => {
    const phases = ["plan", "assess-transform", "foreword", "signoff"] as const;

    it.each(phases)(
      "should use leader-%s as tickCost stage label",
      async (phase) => {
        mockInvoker.invoke.mockResolvedValue(makeInvokeResult());
        mockInvoker.tickCost.mockResolvedValue(undefined);

        const pool = {} as Parameters<typeof service.run>[0]["pool"];

        await service.run({
          input: { phase, topic: "Topic", platforms: ["WECHAT_MP"] },
          ctx: makeCtx({ missionId: "m-leader", userId: "u-leader" }),
          pool,
        });

        expect(mockInvoker.tickCost).toHaveBeenCalledWith(
          "m-leader",
          "u-leader",
          `leader-${phase}`,
          pool,
          expect.any(Number),
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("run — error handling", () => {
    it("should return failed state when invoker fails", async () => {
      mockInvoker.invoke.mockResolvedValue({
        ...makeInvokeResult("failed"),
        output: undefined,
      });

      const result = await service.run({
        input: { phase: "plan", topic: "T", platforms: ["WECHAT_MP"] },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("failed");
      expect(result.output).toBeUndefined();
    });

    it("should propagate thrown error from invoker", async () => {
      mockInvoker.invoke.mockRejectedValue(
        new Error("context window exceeded"),
      );

      await expect(
        service.run({
          input: { phase: "foreword", topic: "T", platforms: ["WECHAT_MP"] },
          ctx: makeCtx(),
        }),
      ).rejects.toThrow("context window exceeded");
    });

    it("should return degraded state when invoker returns degraded", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult("degraded"));

      const result = await service.run({
        input: {
          phase: "assess-transform",
          topic: "T",
          platforms: ["WECHAT_MP"],
        },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("degraded");
    });
  });

  // -------------------------------------------------------------------------
  // Events passthrough
  // -------------------------------------------------------------------------

  describe("run — events passthrough", () => {
    it("should return events from invoker result unchanged", async () => {
      const events = [
        { type: "step", content: "leader planning" },
        { type: "token_usage", tokensIn: 300, tokensOut: 600 },
      ];
      mockInvoker.invoke.mockResolvedValue({ ...makeInvokeResult(), events });

      const result = await service.run({
        input: { phase: "plan", topic: "AI", platforms: ["WECHAT_MP"] },
        ctx: makeCtx(),
      });

      expect(result.events).toBe(events);
    });
  });
});
