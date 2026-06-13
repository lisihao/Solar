import { MissionRuntimeShellFramework } from "../mission-runtime-shell.framework";
import type { IMissionRuntimeAdapter } from "../../abstractions/mission-runtime-shell.interface";

// Mock BillingRuntimeEnvAdapter so we can control listAvailableModels + getCreditState
jest.mock("@/modules/ai-harness/guardrails/billing/billing-adapter", () => {
  const mockInstance = {
    listAvailableModels: jest.fn().mockResolvedValue([
      { modelId: "a", available: true },
      { modelId: "b", available: true },
    ]),
    getCreditState: jest.fn().mockResolvedValue({ balance: 500, hardLimit: 0 }),
    suggestFallback: jest.fn().mockResolvedValue(undefined),
  };
  return {
    BillingRuntimeEnvAdapter: jest.fn(() => mockInstance),
    __mockInstance: mockInstance,
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const billingMock = require("@/modules/ai-harness/guardrails/billing/billing-adapter");
const mockBillingInstance = billingMock.__mockInstance as {
  listAvailableModels: jest.Mock;
  getCreditState: jest.Mock;
};

function makeAdapter(
  overrides: Partial<IMissionRuntimeAdapter<unknown>> = {},
): IMissionRuntimeAdapter<unknown> {
  return {
    resolveWallTimeCapMs: jest.fn().mockReturnValue(60_000),
    resolveMaxCredits: jest.fn().mockReturnValue(100),
    resolveBudgetMultiplier: jest.fn().mockReturnValue(1),
    createMissionRow: jest.fn().mockResolvedValue(undefined),
    refreshHeartbeat: jest.fn().mockResolvedValue(undefined),
    emitMissionEvent: jest.fn().mockResolvedValue(undefined),
    eventNamespace: "my-ns",
    billingModuleType: "my-ns",
    ...overrides,
  };
}

function makeAbortRegistry() {
  const controllers = new Map<string, AbortController>();
  return {
    register: jest.fn((id: string) => {
      const ac = new AbortController();
      controllers.set(id, ac);
      return ac;
    }),
    unregister: jest.fn(),
    abort: jest.fn(),
    get: jest.fn((id: string) => controllers.get(id)),
  };
}

function makeFramework() {
  const abortRegistry = makeAbortRegistry();
  const framework = new MissionRuntimeShellFramework(
    {} as never,
    {} as never,
    abortRegistry as never,
  );
  return { framework, abortRegistry };
}

async function openSession(
  framework: MissionRuntimeShellFramework,
  overrides: Partial<IMissionRuntimeAdapter<unknown>> = {},
) {
  return framework.openSession({
    missionId: "m1",
    input: {},
    userId: "u1",
    adapter: makeAdapter(overrides),
  });
}

describe("MissionRuntimeShellFramework", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset defaults
    mockBillingInstance.listAvailableModels.mockResolvedValue([
      { modelId: "a", available: true },
      { modelId: "b", available: true },
    ]);
    mockBillingInstance.getCreditState.mockResolvedValue({
      balance: 500,
      hardLimit: 0,
    });
  });

  describe("openSession — happy path", () => {
    it("returns session with correct missionId + userId", async () => {
      const { framework } = makeFramework();
      const session = await openSession(framework);
      expect(session.missionId).toBe("m1");
      expect(session.userId).toBe("u1");
      session.cleanup();
    });

    it("session has cleanup, billing, pool, missionAbort", async () => {
      const { framework } = makeFramework();
      const session = await openSession(framework);
      expect(typeof session.cleanup).toBe("function");
      expect(session.billing).toBeDefined();
      expect(session.pool).toBeDefined();
      expect(session.missionAbort).toBeDefined();
      session.cleanup();
    });

    it("createMissionRow is called with correct args", async () => {
      const { framework } = makeFramework();
      const adapter = makeAdapter();
      await framework.openSession({
        missionId: "m1",
        input: {},
        userId: "u1",
        adapter,
      });
      expect(adapter.createMissionRow).toHaveBeenCalledWith(
        expect.objectContaining({ missionId: "m1", userId: "u1" }),
      );
      (
        await framework
          .openSession({ missionId: "m1", input: {}, userId: "u1", adapter })
          .catch(() => ({ cleanup: () => {} }))
      ).cleanup();
    });
  });

  describe("validateModels", () => {
    it("throws with BYOK message when all models unavailable", async () => {
      const { framework } = makeFramework();
      mockBillingInstance.listAvailableModels.mockResolvedValue([
        { modelId: "bad", available: false },
      ]);

      await expect(openSession(framework)).rejects.toThrow("BYOK 配置");
    });

    it("emits mission:rejected on no-healthy-model", async () => {
      const { framework } = makeFramework();
      const adapter = makeAdapter();
      mockBillingInstance.listAvailableModels.mockResolvedValue([
        { modelId: "bad", available: false },
      ]);

      await framework
        .openSession({ missionId: "m1", input: {}, userId: "u1", adapter })
        .catch(() => {});

      expect(adapter.emitMissionEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "my-ns.mission:rejected",
          payload: expect.objectContaining({ reason: "no_healthy_model" }),
        }),
      );
    });

    it("does NOT throw when listAvailableModels fails with a non-BYOK error", async () => {
      const { framework } = makeFramework();
      mockBillingInstance.listAvailableModels.mockRejectedValue(
        new Error("network timeout"),
      );

      const session = await openSession(framework);
      expect(session.missionId).toBe("m1");
      session.cleanup();
    });
  });

  describe("cleanup idempotency", () => {
    it("calling cleanup twice only calls abortRegistry.unregister once", async () => {
      const { framework, abortRegistry } = makeFramework();
      const session = await openSession(framework);

      session.cleanup();
      session.cleanup();

      expect(abortRegistry.unregister).toHaveBeenCalledTimes(1);
      expect(abortRegistry.unregister).toHaveBeenCalledWith("m1");
    });
  });

  describe("openSession cleanup on failure", () => {
    it("calls abortRegistry.unregister when createMissionRow rejects", async () => {
      const { framework, abortRegistry } = makeFramework();

      await expect(
        openSession(framework, {
          createMissionRow: jest.fn().mockRejectedValue(new Error("DB fail")),
        }),
      ).rejects.toThrow("DB fail");

      expect(abortRegistry.unregister).toHaveBeenCalledWith("m1");
    });
  });

  describe("wall-timer abort (try-finally invariant)", () => {
    it("wall-timer fires and calls abort via AbortController", async () => {
      jest.useFakeTimers();
      const { framework } = makeFramework();

      // Short wall time so timer fires quickly
      const adapter = makeAdapter({
        resolveWallTimeCapMs: jest.fn().mockReturnValue(100),
      });
      const session = await framework.openSession({
        missionId: "m1",
        input: {},
        userId: "u1",
        adapter,
      });

      jest.advanceTimersByTime(200);

      // AbortController in abortRegistry should have been registered and abort() should be signaled
      expect(session.missionAbort.signal.aborted).toBe(true);
      session.cleanup();
      jest.useRealTimers();
    });
  });
});
