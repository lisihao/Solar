/**
 * Unit tests for PublishVerifierService
 *
 * tickCost label is `publish-verify-${input.platform}`.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { PublishVerifierService } from "../publish-verifier.service";
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
    missionId: "mission-pv",
    userId: "user-pv",
    agentId: "agent-pv",
    role: "publish-verifier",
    ...overrides,
  };
}

function makeInvokeResult(state = "completed") {
  return {
    state,
    output: {
      platform: "WECHAT_MP",
      verified: true,
      externalUrl: "https://mp.weixin.qq.com/art/verify-123",
      liveTitle: "Published Article Title",
      issues: [],
    },
    events: [{ type: "token_usage", tokensIn: 70, tokensOut: 90 }],
    iterations: 1,
    wallTimeMs: 3500,
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

describe("PublishVerifierService", () => {
  let service: PublishVerifierService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishVerifierService,
        { provide: SocialAgentInvoker, useValue: mockInvoker },
      ],
    }).compile();

    service = module.get<PublishVerifierService>(PublishVerifierService);
  });

  // -------------------------------------------------------------------------
  // Success path — no pool
  // -------------------------------------------------------------------------

  describe("run — success without pool", () => {
    it("should invoke PublishVerifierAgent and return normalized result", async () => {
      const invokeResult = makeInvokeResult("completed");
      mockInvoker.invoke.mockResolvedValue(invokeResult);

      const result = await service.run({
        input: {
          platform: "WECHAT_MP",
          contextId: "ctx-wc",
          externalId: "art-123",
          expectedTitle: "Published Article Title",
        },
        ctx: makeCtx(),
      });

      expect(mockInvoker.invoke).toHaveBeenCalledTimes(1);
      expect(result.state).toBe("completed");
      expect(result.output).toBe(invokeResult.output);
      expect(result.iterations).toBe(1);
      expect(result.wallTimeMs).toBe(3500);
    });

    it("should not call tickCost when pool is absent", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());

      await service.run({
        input: {
          platform: "XIAOHONGSHU",
          contextId: "ctx-xhs",
          externalId: "note-456",
          expectedTitle: "Note Title",
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
    it("should call tickCost with publish-verify-<platform> label", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());
      mockInvoker.tickCost.mockResolvedValue(undefined);

      const pool = {} as Parameters<typeof service.run>[0]["pool"];

      await service.run({
        input: {
          platform: "XIAOHONGSHU",
          contextId: "ctx-xhs",
          externalId: "note-789",
          expectedTitle: "Note Title",
        },
        ctx: makeCtx({ missionId: "m-pv", userId: "u-pv" }),
        pool,
      });

      expect(mockInvoker.tickCost).toHaveBeenCalledWith(
        "m-pv",
        "u-pv",
        "publish-verify-XIAOHONGSHU",
        pool,
        expect.any(Number),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("run — error handling", () => {
    it("should return failed state when invoker returns failed", async () => {
      mockInvoker.invoke.mockResolvedValue({
        ...makeInvokeResult("failed"),
        output: undefined,
      });

      const result = await service.run({
        input: {
          platform: "WECHAT_MP",
          contextId: "ctx-wc",
          externalId: "art-bad",
          expectedTitle: "T",
        },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("failed");
      expect(result.output).toBeUndefined();
    });

    it("should propagate thrown error from invoker", async () => {
      mockInvoker.invoke.mockRejectedValue(
        new Error("verification request timed out"),
      );

      await expect(
        service.run({
          input: {
            platform: "WECHAT_MP",
            contextId: "ctx-wc",
            externalId: "art-err",
            expectedTitle: "T",
          },
          ctx: makeCtx(),
        }),
      ).rejects.toThrow("verification request timed out");
    });

    it("should return degraded state when invoker returns degraded", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult("degraded"));

      const result = await service.run({
        input: {
          platform: "WECHAT_MP",
          contextId: "ctx-wc",
          externalId: "art-partial",
          expectedTitle: "T",
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
    it("should return events array from invoker unchanged", async () => {
      const events = [
        { type: "step", content: "fetching published article" },
        { type: "token_usage", tokensIn: 80, tokensOut: 100 },
      ];
      mockInvoker.invoke.mockResolvedValue({ ...makeInvokeResult(), events });

      const result = await service.run({
        input: {
          platform: "WECHAT_MP",
          contextId: "ctx-wc",
          externalId: "art-ok",
          expectedTitle: "T",
        },
        ctx: makeCtx(),
      });

      expect(result.events).toBe(events);
    });
  });
});
