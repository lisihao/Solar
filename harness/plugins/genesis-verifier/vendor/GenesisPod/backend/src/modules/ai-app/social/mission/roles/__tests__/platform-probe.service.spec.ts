/**
 * Unit tests for PlatformProbeService
 *
 * tickCost label is the fixed string "platform-probe" (no platform suffix).
 */

import { Test, TestingModule } from "@nestjs/testing";
import { PlatformProbeService } from "../platform-probe.service";
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
    missionId: "mission-probe",
    userId: "user-probe",
    agentId: "agent-probe",
    role: "platform-probe",
    ...overrides,
  };
}

function makeInvokeResult(state = "completed") {
  return {
    state,
    output: {
      probeResults: [
        {
          platform: "WECHAT_MP",
          endpoint: "/api/saveDraft",
          requiredFields: ["title", "content"],
          isHealthy: true,
          schemaVersion: "v2",
        },
      ],
    },
    events: [{ type: "token_usage", tokensIn: 60, tokensOut: 120 }],
    iterations: 1,
    wallTimeMs: 1800,
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

describe("PlatformProbeService", () => {
  let service: PlatformProbeService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformProbeService,
        { provide: SocialAgentInvoker, useValue: mockInvoker },
      ],
    }).compile();

    service = module.get<PlatformProbeService>(PlatformProbeService);
  });

  // -------------------------------------------------------------------------
  // Success path — no pool
  // -------------------------------------------------------------------------

  describe("run — success without pool", () => {
    it("should invoke PlatformProbeAgent and return normalized result", async () => {
      const invokeResult = makeInvokeResult("completed");
      mockInvoker.invoke.mockResolvedValue(invokeResult);

      const result = await service.run({
        input: {
          platforms: ["WECHAT_MP"],
          contextIds: { WECHAT_MP: "ctx-wc-1" },
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
        input: { platforms: ["XIAOHONGSHU"], contextIds: {} },
        ctx: makeCtx(),
      });

      expect(mockInvoker.tickCost).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Success path — with pool
  // -------------------------------------------------------------------------

  describe("run — success with pool", () => {
    it("should call tickCost with fixed label platform-probe", async () => {
      mockInvoker.invoke.mockResolvedValue(makeInvokeResult());
      mockInvoker.tickCost.mockResolvedValue(undefined);

      const pool = {} as Parameters<typeof service.run>[0]["pool"];

      await service.run({
        input: { platforms: ["WECHAT_MP"], contextIds: {} },
        ctx: makeCtx({ missionId: "m-probe", userId: "u-probe" }),
        pool,
      });

      expect(mockInvoker.tickCost).toHaveBeenCalledWith(
        "m-probe",
        "u-probe",
        "platform-probe",
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
        input: { platforms: ["WECHAT_MP"], contextIds: {} },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("failed");
      expect(result.output).toBeUndefined();
    });

    it("should propagate thrown error from invoker", async () => {
      mockInvoker.invoke.mockRejectedValue(new Error("probe browser crash"));

      await expect(
        service.run({
          input: { platforms: ["WECHAT_MP"], contextIds: {} },
          ctx: makeCtx(),
        }),
      ).rejects.toThrow("probe browser crash");
    });

    it("should return cancelled state when invoker returns cancelled", async () => {
      mockInvoker.invoke.mockResolvedValue({
        ...makeInvokeResult("cancelled"),
        output: undefined,
      });

      const result = await service.run({
        input: { platforms: ["WECHAT_MP"], contextIds: {} },
        ctx: makeCtx(),
      });

      expect(result.state).toBe("cancelled");
    });
  });
});
