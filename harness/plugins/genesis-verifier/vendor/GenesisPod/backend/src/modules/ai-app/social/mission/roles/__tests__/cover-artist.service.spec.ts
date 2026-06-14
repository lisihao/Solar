/**
 * Unit tests for CoverArtistService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { CoverArtistService } from "../cover-artist.service";
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
    missionId: "mission-ca",
    userId: "user-ca",
    agentId: "agent-ca",
    role: "cover-artist",
    ...overrides,
  };
}

function makeInvokeResult(state = "completed") {
  return {
    state,
    output: {
      platform: "WECHAT_MP",
      coverImageUrl: "https://cdn.example.com/cover.jpg",
      mediaId: "media-abc-123",
      method: "generated",
    },
    events: [{ type: "token_usage", tokensIn: 80, tokensOut: 60 }],
    iterations: 1,
    wallTimeMs: 4200,
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

describe("CoverArtistService", () => {
  let service: CoverArtistService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoverArtistService,
        { provide: SocialAgentInvoker, useValue: mockInvoker },
      ],
    }).compile();

    service = module.get<CoverArtistService>(CoverArtistService);
  });

  // -------------------------------------------------------------------------
  // Success path — no pool
  // -------------------------------------------------------------------------

  describe("run — success without pool", () => {
    it("should invoke CoverArtistAgent and return normalized result", async () => {
      const invokeResult = makeInvokeResult("completed");
      mockInvoker.invoke.mockResolvedValue(invokeResult);

      const result = await service.run({
        input: {
          platform: "WECHAT_MP",
          title: "Article Title",
          body: "Article body for cover",
        },
        ctx: makeCtx(),
      });

      expect(mockInvoker.invoke).toHaveBeenCalledTimes(1);
      expect(result.state).toBe("completed");
      expect(result.output).toBe(invokeResult.output);
      expect(result.iterations).toBe(1);
      expect(result.wallTimeMs).toBe(4200);
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
    it("should call tickCost with cover-craft-<platform> label", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());
      mockInvoker.tickCost.mockResolvedValue(undefined);

      const pool = {} as Parameters<typeof service.run>[0]["pool"];

      await service.run({
        input: { platform: "WECHAT_MP", title: "Title", body: "Body" },
        ctx: makeCtx({ missionId: "m-21", userId: "u-21" }),
        pool,
      });

      expect(mockInvoker.tickCost).toHaveBeenCalledWith(
        "m-21",
        "u-21",
        "cover-craft-WECHAT_MP",
        pool,
        expect.any(Number),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("run — error handling", () => {
    it("should return failed state and undefined output when invoker fails", async () => {
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
      mockInvoker.invoke.mockRejectedValue(new Error("image service down"));

      await expect(
        service.run({
          input: { platform: "WECHAT_MP", title: "T", body: "B" },
          ctx: makeCtx(),
        }),
      ).rejects.toThrow("image service down");
    });

    it("should return cancelled state when invoker returns cancelled", async () => {
      mockInvoker.invoke.mockResolvedValue({
        ...makeInvokeResult("cancelled"),
        output: undefined,
      });

      const result = await service.run({
        input: { platform: "WECHAT_MP", title: "T", body: "B" },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("cancelled");
    });
  });
});
