/**
 * Unit tests for PolishReviewerService
 *
 * tickCost label is `polish-review-${input.platform}`.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { PolishReviewerService } from "../polish-reviewer.service";
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
    missionId: "mission-pr",
    userId: "user-pr",
    agentId: "agent-pr",
    role: "polish-reviewer",
    ...overrides,
  };
}

function makeInvokeResult(state = "completed") {
  return {
    state,
    output: {
      platform: "WECHAT_MP",
      polishedTitle: "Polished Article Title",
      polishedBody: "<p>Polished content with corrections.</p>",
      polishedDigest: "Clean summary",
      critiques: ["grammar fix in paragraph 2", "tone adjusted"],
      qualityScore: 8.5,
    },
    events: [{ type: "token_usage", tokensIn: 250, tokensOut: 500 }],
    iterations: 2,
    wallTimeMs: 5200,
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

describe("PolishReviewerService", () => {
  let service: PolishReviewerService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolishReviewerService,
        { provide: SocialAgentInvoker, useValue: mockInvoker },
      ],
    }).compile();

    service = module.get<PolishReviewerService>(PolishReviewerService);
  });

  // -------------------------------------------------------------------------
  // Success path — no pool
  // -------------------------------------------------------------------------

  describe("run — success without pool", () => {
    it("should invoke PolishReviewerAgent and return normalized result", async () => {
      const invokeResult = makeInvokeResult("completed");
      mockInvoker.invoke.mockResolvedValue(invokeResult);

      const result = await service.run({
        input: {
          platform: "WECHAT_MP",
          title: "Draft Title",
          body: "<p>Draft body.</p>",
          digest: "Draft digest",
        },
        ctx: makeCtx(),
      });

      expect(mockInvoker.invoke).toHaveBeenCalledTimes(1);
      expect(result.state).toBe("completed");
      expect(result.output).toBe(invokeResult.output);
      expect(result.iterations).toBe(2);
      expect(result.wallTimeMs).toBe(5200);
    });

    it("should not call tickCost when pool is absent", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());

      await service.run({
        input: { platform: "XIAOHONGSHU", title: "T", body: "B", digest: "D" },
        ctx: makeCtx(),
      });

      expect(mockInvoker.tickCost).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Success path — with pool
  // -------------------------------------------------------------------------

  describe("run — success with pool", () => {
    it("should call tickCost with polish-review-<platform> label", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());
      mockInvoker.tickCost.mockResolvedValue(undefined);

      const pool = {} as Parameters<typeof service.run>[0]["pool"];

      await service.run({
        input: { platform: "WECHAT_MP", title: "T", body: "B", digest: "D" },
        ctx: makeCtx({ missionId: "m-pr", userId: "u-pr" }),
        pool,
      });

      expect(mockInvoker.tickCost).toHaveBeenCalledWith(
        "m-pr",
        "u-pr",
        "polish-review-WECHAT_MP",
        pool,
        expect.any(Number),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("run — error handling", () => {
    it("should return failed state and undefined output on invoker failure", async () => {
      mockInvoker.invoke.mockResolvedValue({
        ...makeInvokeResult("failed"),
        output: undefined,
      });

      const result = await service.run({
        input: { platform: "WECHAT_MP", title: "T", body: "B", digest: "D" },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("failed");
      expect(result.output).toBeUndefined();
    });

    it("should propagate thrown error from invoker", async () => {
      mockInvoker.invoke.mockRejectedValue(new Error("model overloaded"));

      await expect(
        service.run({
          input: { platform: "WECHAT_MP", title: "T", body: "B", digest: "D" },
          ctx: makeCtx(),
        }),
      ).rejects.toThrow("model overloaded");
    });

    it("should return degraded state when invoker returns degraded", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult("degraded"));

      const result = await service.run({
        input: { platform: "WECHAT_MP", title: "T", body: "B", digest: "D" },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("degraded");
    });
  });

  // -------------------------------------------------------------------------
  // Events passthrough
  // -------------------------------------------------------------------------

  describe("run — events passthrough", () => {
    it("should return events array unchanged from invoker", async () => {
      const events = [
        { type: "step", content: "critiquing paragraph 1" },
        { type: "token_usage", tokensIn: 300, tokensOut: 600 },
      ];
      mockInvoker.invoke.mockResolvedValue({ ...makeInvokeResult(), events });

      const result = await service.run({
        input: { platform: "WECHAT_MP", title: "T", body: "B", digest: "D" },
        ctx: makeCtx(),
      });

      expect(result.events).toBe(events);
    });
  });
});
