/**
 * Unit tests for ContentTransformerAgentService (roles/content-transformer-agent.service.ts)
 *
 * Mirrors composer.service.spec.ts pattern.
 * SocialAgentInvoker is fully mocked.
 *
 * NOT the legacy services/content-transformer.service.ts (sync workflow).
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ContentTransformerAgentService } from "../content-transformer-agent.service";
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
    missionId: "mission-ct",
    userId: "user-ct",
    agentId: "agent-ct",
    role: "content-transformer",
    ...overrides,
  };
}

function makeInvokeResult(state = "completed") {
  return {
    state,
    output: {
      platform: "WECHAT_MP",
      transformedTitle: "WeChat Adapted Title",
      transformedBody: "Adapted content for WeChat.",
      transformedDigest: "Short summary",
      changes: ["tone adjusted", "length trimmed"],
    },
    events: [{ type: "token_usage", tokensIn: 150, tokensOut: 300 }],
    iterations: 1,
    wallTimeMs: 2500,
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

describe("ContentTransformerAgentService (roles/content-transformer-agent.service.ts)", () => {
  let service: ContentTransformerAgentService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentTransformerAgentService,
        { provide: SocialAgentInvoker, useValue: mockInvoker },
      ],
    }).compile();

    service = module.get<ContentTransformerAgentService>(
      ContentTransformerAgentService,
    );
  });

  // -------------------------------------------------------------------------
  // Success path — no pool
  // -------------------------------------------------------------------------

  describe("run — success without pool", () => {
    it("should invoke ContentTransformerAgent and return normalized result", async () => {
      const invokeResult = makeInvokeResult("completed");
      mockInvoker.invoke.mockResolvedValue(invokeResult);

      const result = await service.run({
        input: {
          platform: "WECHAT_MP",
          title: "Original Title",
          body: "Original body",
        },
        ctx: makeCtx(),
      });

      expect(mockInvoker.invoke).toHaveBeenCalledTimes(1);
      expect(result.state).toBe("completed");
      expect(result.output).toBe(invokeResult.output);
      expect(result.wallTimeMs).toBe(2500);
    });

    it("should not call tickCost when pool is absent", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());

      await service.run({
        input: { platform: "XIAOHONGSHU", title: "Title", body: "Body" },
        ctx: makeCtx(),
      });

      expect(mockInvoker.tickCost).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Success path — with pool
  // -------------------------------------------------------------------------

  describe("run — success with pool", () => {
    it("should call tickCost with content-transform-<platform> label", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());
      mockInvoker.tickCost.mockResolvedValue(undefined);

      const pool = {} as Parameters<typeof service.run>[0]["pool"];

      await service.run({
        input: { platform: "XIAOHONGSHU", title: "Title", body: "Body" },
        ctx: makeCtx({ missionId: "m-10", userId: "u-10" }),
        pool,
      });

      expect(mockInvoker.tickCost).toHaveBeenCalledWith(
        "m-10",
        "u-10",
        "content-transform-XIAOHONGSHU",
        pool,
        expect.any(Number),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("run — error handling", () => {
    it("should return failed state when invoker result state is failed", async () => {
      mockInvoker.invoke.mockResolvedValue({
        ...makeInvokeResult("failed"),
        output: undefined,
      });

      const result = await service.run({
        input: { platform: "WECHAT_MP", title: "T", body: "B" },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("failed");
      expect(result.output).toBeUndefined();
    });

    it("should propagate thrown error from invoker", async () => {
      mockInvoker.invoke.mockRejectedValue(new Error("network timeout"));

      await expect(
        service.run({
          input: { platform: "WECHAT_MP", title: "T", body: "B" },
          ctx: makeCtx(),
        }),
      ).rejects.toThrow("network timeout");
    });

    it("should return degraded state when invoker returns degraded", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult("degraded"));

      const result = await service.run({
        input: { platform: "WECHAT_MP", title: "T", body: "B" },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("degraded");
    });
  });

  // -------------------------------------------------------------------------
  // Events passthrough
  // -------------------------------------------------------------------------

  describe("run — events passthrough", () => {
    it("should return events with same content from invoker (new array ref)", async () => {
      const events = [{ type: "step", content: "analyzing content" }];
      mockInvoker.invoke.mockResolvedValue({ ...makeInvokeResult(), events });

      const result = await service.run({
        input: { platform: "WECHAT_MP", title: "T", body: "B" },
        ctx: makeCtx(),
      });

      // 现在 events 是新数组（为拼接重试事件），断结构相等而非引用相等
      expect(result.events).toEqual(events);
    });
  });

  // -------------------------------------------------------------------------
  // WeChat 字数/结构硬校验（不达标强制重写一次，取更优）
  // -------------------------------------------------------------------------

  describe("run — WeChat 字数/结构硬校验", () => {
    const longBody =
      "## 小标题一\n" +
      "字".repeat(700) +
      "\n## 小标题二\n" +
      "字".repeat(700) +
      "\n## 小标题三\n" +
      "字".repeat(400);

    function res(state: string, platform: string, body: string, evt: string) {
      return {
        state,
        output: { platform, title: "T", digest: "d", body },
        events: [{ type: evt }],
        iterations: 1,
        wallTimeMs: 100,
      };
    }

    it("re-invokes once and keeps the longer body when WeChat body too short/unstructured", async () => {
      mockInvoker.invoke
        .mockResolvedValueOnce(res("completed", "WECHAT_MP", "太短了", "u1"))
        .mockResolvedValueOnce(res("completed", "WECHAT_MP", longBody, "u2"));

      const result = await service.run({
        input: { platform: "WECHAT_MP", title: "T", body: "B" },
        ctx: makeCtx(),
      });

      expect(mockInvoker.invoke).toHaveBeenCalledTimes(2);
      expect((result.output as { body: string }).body).toBe(longBody);
      expect(result.events).toHaveLength(2); // 两次调用事件已拼接
    });

    it("does NOT re-invoke for non-WeChat platforms even if short", async () => {
      mockInvoker.invoke.mockResolvedValue(
        res("completed", "XIAOHONGSHU", "短", "u1"),
      );

      await service.run({
        input: { platform: "XIAOHONGSHU", title: "T", body: "B" },
        ctx: makeCtx(),
      });

      expect(mockInvoker.invoke).toHaveBeenCalledTimes(1);
    });

    it("does NOT re-invoke when WeChat body already meets floor", async () => {
      mockInvoker.invoke.mockResolvedValue(
        res("completed", "WECHAT_MP", longBody, "u1"),
      );

      await service.run({
        input: { platform: "WECHAT_MP", title: "T", body: "B" },
        ctx: makeCtx(),
      });

      expect(mockInvoker.invoke).toHaveBeenCalledTimes(1);
    });
  });
});
