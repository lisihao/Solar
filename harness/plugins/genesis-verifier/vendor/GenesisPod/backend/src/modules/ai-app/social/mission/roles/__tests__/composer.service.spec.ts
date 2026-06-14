/**
 * Unit tests for ComposerService
 *
 * Tests the run() dispatcher: invoke → optional tickCost → normalizeRunnerState.
 * SocialAgentInvoker is fully mocked; no real LLM or harness calls.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ComposerService } from "../composer.service";
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
    missionId: "mission-abc",
    userId: "user-1",
    agentId: "agent-composer",
    role: "composer",
    ...overrides,
  };
}

function makeInvokeResult(
  state = "completed",
  output?: Record<string, unknown>,
) {
  return {
    state,
    output: output ?? {
      platform: "WECHAT_MP",
      bodyHtml: "<p>Generated body</p>",
      imageUploadStats: { total: 2, uploaded: 2, failed: 0, fallback: 0 },
      bodyChars: 500,
    },
    events: [{ type: "token_usage", tokensIn: 100, tokensOut: 200 }],
    iterations: 2,
    wallTimeMs: 3000,
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

describe("ComposerService", () => {
  let service: ComposerService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComposerService,
        { provide: SocialAgentInvoker, useValue: mockInvoker },
      ],
    }).compile();

    service = module.get<ComposerService>(ComposerService);
  });

  // -------------------------------------------------------------------------
  // Success path — no pool
  // -------------------------------------------------------------------------

  describe("run — success without pool", () => {
    it("should invoke ComposerAgent and return normalized result", async () => {
      const invokeResult = makeInvokeResult("completed");
      mockInvoker.invoke.mockResolvedValue(invokeResult);

      const result = await service.run({
        input: {
          platform: "WECHAT_MP",
          body: "source body text",
          contextId: "ctx-1",
        },
        ctx: makeCtx(),
      });

      expect(mockInvoker.invoke).toHaveBeenCalledTimes(1);
      expect(result.state).toBe("completed");
      // output is not the same object reference as mock input
      expect(result.output).toBe(invokeResult.output);
      expect(result.iterations).toBe(2);
      expect(result.wallTimeMs).toBe(3000);
    });

    it("should not call tickCost when pool is not provided", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());

      await service.run({
        input: {
          platform: "XIAOHONGSHU",
          body: "xhs body",
          contextId: "ctx-2",
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
    it("should call tickCost with platform-scoped label when pool provided", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult("completed"));
      mockInvoker.tickCost.mockResolvedValue(undefined);

      const pool = {} as Parameters<typeof service.run>[0]["pool"];

      await service.run({
        input: {
          platform: "WECHAT_MP",
          body: "body content",
          contextId: "ctx-3",
        },
        ctx: makeCtx({ missionId: "m-99", userId: "u-5" }),
        pool,
      });

      expect(mockInvoker.tickCost).toHaveBeenCalledWith(
        "m-99",
        "u-5",
        "body-compose-WECHAT_MP",
        pool,
        expect.any(Number),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Degraded / failed states
  // -------------------------------------------------------------------------

  describe("run — degraded/failed states", () => {
    it("should return degraded state when invoker returns degraded", async () => {
      mockInvoker.invoke.mockResolvedValue(
        makeInvokeResult("degraded", undefined),
      );

      const result = await service.run({
        input: {
          platform: "WECHAT_MP",
          body: "partial body",
          contextId: "ctx-4",
        },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("degraded");
    });

    it("should return failed state when invoker returns failed", async () => {
      mockInvoker.invoke.mockResolvedValue({
        ...makeInvokeResult("failed"),
        output: undefined,
      });

      const result = await service.run({
        input: { platform: "WECHAT_MP", body: "body", contextId: "ctx-5" },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("failed");
      expect(result.output).toBeUndefined();
    });

    it("should propagate error when invoker rejects", async () => {
      mockInvoker.invoke.mockRejectedValue(new Error("agent runner crashed"));

      await expect(
        service.run({
          input: { platform: "WECHAT_MP", body: "body", contextId: "ctx-6" },
          ctx: makeCtx(),
        }),
      ).rejects.toThrow("agent runner crashed");
    });
  });

  // -------------------------------------------------------------------------
  // Events passthrough
  // -------------------------------------------------------------------------

  describe("run — events passthrough", () => {
    it("should return events array from invoker result", async () => {
      const events = [
        { type: "token_usage", tokensIn: 50, tokensOut: 120 },
        { type: "step", content: "step detail" },
      ];
      mockInvoker.invoke.mockResolvedValue({ ...makeInvokeResult(), events });

      const result = await service.run({
        input: { platform: "XIAOHONGSHU", body: "body", contextId: "ctx-7" },
        ctx: makeCtx(),
      });

      expect(result.events).toBe(events);
    });
  });
});
