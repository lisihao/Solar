/**
 * Unit tests for PublishExecutorAgentService (roles/publish-executor-agent.service.ts)
 *
 * This tests the NEW agent-team variant (PublishExecutorAgentService) which
 * dispatches to PublishExecutorAgent via SocialAgentInvoker.
 * NOT the legacy services/publish-executor.service.ts.
 *
 * tickCost label is `publish-execute-${input.platform}`.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { PublishExecutorAgentService } from "../publish-executor-agent.service";
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
    missionId: "mission-pe",
    userId: "user-pe",
    agentId: "agent-pe",
    role: "publish-executor",
    ...overrides,
  };
}

function makeInvokeResult(state = "completed") {
  return {
    state,
    output: {
      platform: "WECHAT_MP",
      success: true,
      externalId: "art-xyz-789",
      externalUrl: "https://mp.weixin.qq.com/art/xyz",
      publishedAt: "2026-05-16T10:00:00.000Z",
    },
    events: [{ type: "token_usage", tokensIn: 100, tokensOut: 50 }],
    iterations: 1,
    wallTimeMs: 8000,
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

describe("PublishExecutorAgentService (roles/publish-executor.service.ts)", () => {
  let service: PublishExecutorAgentService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishExecutorAgentService,
        { provide: SocialAgentInvoker, useValue: mockInvoker },
      ],
    }).compile();

    service = module.get<PublishExecutorAgentService>(
      PublishExecutorAgentService,
    );
  });

  // -------------------------------------------------------------------------
  // Success path — no pool
  // -------------------------------------------------------------------------

  describe("run — success without pool", () => {
    it("should invoke PublishExecutorAgent and return normalized result", async () => {
      const invokeResult = makeInvokeResult("completed");
      mockInvoker.invoke.mockResolvedValue(invokeResult);

      const result = await service.run({
        input: {
          platform: "WECHAT_MP",
          contextId: "ctx-wc",
          contentId: "content-42",
          title: "Article Title",
          bodyHtml: "<p>Article body.</p>",
          digest: "Short digest",
        },
        ctx: makeCtx(),
      });

      expect(mockInvoker.invoke).toHaveBeenCalledTimes(1);
      expect(result.state).toBe("completed");
      expect(result.output).toBe(invokeResult.output);
      expect(result.wallTimeMs).toBe(8000);
    });

    it("should not call tickCost when pool is absent", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());

      await service.run({
        input: {
          platform: "XIAOHONGSHU",
          contextId: "ctx-xhs",
          contentId: "content-43",
          title: "Note Title",
          bodyHtml: "Note body",
          digest: "",
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
    it("should call tickCost with publish-execute-<platform> label", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());
      mockInvoker.tickCost.mockResolvedValue(undefined);

      const pool = {} as Parameters<typeof service.run>[0]["pool"];

      await service.run({
        input: {
          platform: "WECHAT_MP",
          contextId: "ctx-wc",
          contentId: "content-44",
          title: "T",
          bodyHtml: "B",
          digest: "D",
        },
        ctx: makeCtx({ missionId: "m-pe", userId: "u-pe" }),
        pool,
      });

      expect(mockInvoker.tickCost).toHaveBeenCalledWith(
        "m-pe",
        "u-pe",
        "publish-execute-WECHAT_MP",
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
          contentId: "c-1",
          title: "T",
          bodyHtml: "B",
          digest: "D",
        },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("failed");
      expect(result.output).toBeUndefined();
    });

    it("should propagate thrown error from invoker", async () => {
      mockInvoker.invoke.mockRejectedValue(
        new Error("publish API returned 500"),
      );

      await expect(
        service.run({
          input: {
            platform: "WECHAT_MP",
            contextId: "ctx-wc",
            contentId: "c-1",
            title: "T",
            bodyHtml: "B",
            digest: "D",
          },
          ctx: makeCtx(),
        }),
      ).rejects.toThrow("publish API returned 500");
    });

    it("should return cancelled state when invoker returns cancelled", async () => {
      mockInvoker.invoke.mockResolvedValue({
        ...makeInvokeResult("cancelled"),
        output: undefined,
      });

      const result = await service.run({
        input: {
          platform: "WECHAT_MP",
          contextId: "ctx-wc",
          contentId: "c-1",
          title: "T",
          bodyHtml: "B",
          digest: "D",
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
    it("should return events from invoker unchanged", async () => {
      const events = [
        { type: "step", content: "opening browser context" },
        { type: "token_usage", tokensIn: 120, tokensOut: 80 },
      ];
      mockInvoker.invoke.mockResolvedValue({ ...makeInvokeResult(), events });

      const result = await service.run({
        input: {
          platform: "WECHAT_MP",
          contextId: "ctx-wc",
          contentId: "c-1",
          title: "T",
          bodyHtml: "B",
          digest: "D",
        },
        ctx: makeCtx(),
      });

      expect(result.events).toBe(events);
    });
  });
});
