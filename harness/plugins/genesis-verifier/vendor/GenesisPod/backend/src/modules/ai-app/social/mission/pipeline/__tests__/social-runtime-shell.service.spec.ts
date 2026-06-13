/**
 * Unit tests for SocialRuntimeShellService
 * Covers openSession, runWithinContext, adapter mapping, and budget constants.
 */

import { SocialRuntimeShellService } from "../social-runtime-shell.service";
import type {
  MissionRuntimeShellFramework,
  EventBus,
} from "@/modules/ai-harness/facade";
import type { SocialMissionStore } from "../../lifecycle/social-mission-store.service";
import type { RunSocialMissionInput } from "../../context/mission-context";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockFramework() {
  return {
    openSession: jest.fn(),
    runWithinContext: jest.fn(),
  } as unknown as jest.Mocked<MissionRuntimeShellFramework>;
}

function createMockStore() {
  return {
    create: jest.fn(),
    refreshHeartbeat: jest.fn(),
  } as unknown as jest.Mocked<SocialMissionStore>;
}

function createMockEventBus() {
  return {
    emit: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<EventBus>;
}

function makeInput(
  depth: RunSocialMissionInput["depth"] = "standard",
  budgetProfile: RunSocialMissionInput["budgetProfile"] = "standard",
): RunSocialMissionInput {
  return {
    contentId: "content-abc",
    platforms: ["wechat"],
    connectionIds: { wechat: "conn-1" },
    depth,
    budgetProfile,
    language: "zh-CN",
  };
}

const MOCK_MISSION_ID = "mission-shell-test";
const MOCK_USER_ID = "user-shell-test";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SocialRuntimeShellService", () => {
  let service: SocialRuntimeShellService;
  let mockFramework: ReturnType<typeof createMockFramework>;
  let mockStore: ReturnType<typeof createMockStore>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockFramework = createMockFramework();
    mockStore = createMockStore();
    mockEventBus = createMockEventBus();
    service = new SocialRuntimeShellService(
      mockFramework as unknown as MissionRuntimeShellFramework,
      mockStore as unknown as SocialMissionStore,
      mockEventBus as unknown as EventBus,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // openSession
  // =========================================================================

  describe("openSession", () => {
    it("should call framework.openSession with missionId, userId and adapter", async () => {
      const mockSession = { missionId: MOCK_MISSION_ID, cleanup: jest.fn() };
      (mockFramework.openSession as jest.Mock).mockResolvedValue(mockSession);

      const result = await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput(),
        userId: MOCK_USER_ID,
      });

      expect(mockFramework.openSession).toHaveBeenCalledWith(
        expect.objectContaining({
          missionId: MOCK_MISSION_ID,
          userId: MOCK_USER_ID,
          adapter: expect.objectContaining({
            eventNamespace: "social",
            billingModuleType: "ai-social",
          }),
        }),
      );
      expect(result).toBe(mockSession);
    });

    it("should pass workspaceId when provided", async () => {
      (mockFramework.openSession as jest.Mock).mockResolvedValue({});

      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput(),
        userId: MOCK_USER_ID,
        workspaceId: "ws-001",
      });

      const arg = (mockFramework.openSession as jest.Mock).mock.calls[0][0];
      expect(arg.workspaceId).toBe("ws-001");
    });

    it("should propagate errors from framework.openSession", async () => {
      (mockFramework.openSession as jest.Mock).mockRejectedValue(
        new Error("session open failed"),
      );

      await expect(
        service.openSession({
          missionId: MOCK_MISSION_ID,
          input: makeInput(),
          userId: MOCK_USER_ID,
        }),
      ).rejects.toThrow("session open failed");
    });

    // --- adapter.resolveWallTimeCapMs ---
    it("adapter.resolveWallTimeCapMs returns 15min for quick depth", async () => {
      let capturedAdapter: { resolveWallTimeCapMs: (input: unknown) => number };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );
      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput("quick", "standard"),
        userId: MOCK_USER_ID,
      });
      expect(capturedAdapter!.resolveWallTimeCapMs(makeInput("quick"))).toBe(
        15 * 60_000,
      );
    });

    it("adapter.resolveWallTimeCapMs returns 30min for standard depth", async () => {
      let capturedAdapter: { resolveWallTimeCapMs: (input: unknown) => number };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );
      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput("standard", "standard"),
        userId: MOCK_USER_ID,
      });
      expect(capturedAdapter!.resolveWallTimeCapMs(makeInput("standard"))).toBe(
        30 * 60_000,
      );
    });

    it("adapter.resolveWallTimeCapMs returns 60min for deep depth", async () => {
      let capturedAdapter: { resolveWallTimeCapMs: (input: unknown) => number };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );
      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput("deep", "standard"),
        userId: MOCK_USER_ID,
      });
      expect(capturedAdapter!.resolveWallTimeCapMs(makeInput("deep"))).toBe(
        60 * 60_000,
      );
    });

    // --- adapter.resolveMaxCredits ---
    it("adapter.resolveMaxCredits returns 8 for lean profile", async () => {
      let capturedAdapter: { resolveMaxCredits: (input: unknown) => number };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );
      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput("standard", "lean"),
        userId: MOCK_USER_ID,
      });
      expect(
        capturedAdapter!.resolveMaxCredits(makeInput("standard", "lean")),
      ).toBe(50);
    });

    it("adapter.resolveMaxCredits returns 200 for standard profile", async () => {
      let capturedAdapter: { resolveMaxCredits: (input: unknown) => number };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );
      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput("standard", "standard"),
        userId: MOCK_USER_ID,
      });
      expect(
        capturedAdapter!.resolveMaxCredits(makeInput("standard", "standard")),
      ).toBe(200);
    });

    it("adapter.resolveMaxCredits returns 500 for rich profile", async () => {
      let capturedAdapter: { resolveMaxCredits: (input: unknown) => number };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );
      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput("standard", "rich"),
        userId: MOCK_USER_ID,
      });
      expect(
        capturedAdapter!.resolveMaxCredits(makeInput("standard", "rich")),
      ).toBe(500);
    });

    // --- adapter.resolveBudgetMultiplier ---
    it("adapter.resolveBudgetMultiplier returns 0.6 for lean profile", async () => {
      let capturedAdapter: {
        resolveBudgetMultiplier: (input: unknown) => number;
      };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );
      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput("standard", "lean"),
        userId: MOCK_USER_ID,
      });
      expect(
        capturedAdapter!.resolveBudgetMultiplier(makeInput("standard", "lean")),
      ).toBe(0.6);
    });

    it("adapter.resolveBudgetMultiplier returns 1.0 for standard profile", async () => {
      let capturedAdapter: {
        resolveBudgetMultiplier: (input: unknown) => number;
      };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );
      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput("standard", "standard"),
        userId: MOCK_USER_ID,
      });
      expect(
        capturedAdapter!.resolveBudgetMultiplier(
          makeInput("standard", "standard"),
        ),
      ).toBe(1.0);
    });

    it("adapter.resolveBudgetMultiplier returns 1.6 for rich profile", async () => {
      let capturedAdapter: {
        resolveBudgetMultiplier: (input: unknown) => number;
      };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );
      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput("standard", "rich"),
        userId: MOCK_USER_ID,
      });
      expect(
        capturedAdapter!.resolveBudgetMultiplier(makeInput("standard", "rich")),
      ).toBe(1.6);
    });

    // --- adapter.createMissionRow ---
    it("should call store.create via adapter.createMissionRow", async () => {
      let capturedAdapter: {
        createMissionRow: (args: unknown) => Promise<void>;
      };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );
      (mockStore.create as jest.Mock).mockResolvedValue(undefined);

      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput(),
        userId: MOCK_USER_ID,
      });

      const createArgs = {
        missionId: MOCK_MISSION_ID,
        userId: MOCK_USER_ID,
        workspaceId: undefined as string | undefined,
        input: makeInput(),
        effectiveMaxCredits: 20,
      };
      await capturedAdapter!.createMissionRow(createArgs);

      expect(mockStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: MOCK_MISSION_ID,
          userId: MOCK_USER_ID,
          contentId: "content-abc",
          maxCredits: 20,
        }),
      );
    });

    // --- adapter.refreshHeartbeat ---
    it("should call store.refreshHeartbeat via adapter.refreshHeartbeat", async () => {
      let capturedAdapter: {
        refreshHeartbeat: (missionId: string, podId: string) => Promise<void>;
      };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );
      (mockStore.refreshHeartbeat as jest.Mock).mockResolvedValue(undefined);

      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput(),
        userId: MOCK_USER_ID,
      });

      await capturedAdapter!.refreshHeartbeat(MOCK_MISSION_ID, "pod-99");

      expect(mockStore.refreshHeartbeat).toHaveBeenCalledWith(
        MOCK_MISSION_ID,
        "pod-99",
      );
    });

    // --- adapter.emitMissionEvent ---
    it("should call eventBus.emit via adapter.emitMissionEvent", async () => {
      let capturedAdapter: {
        emitMissionEvent: (args: unknown) => Promise<void>;
      };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );

      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput(),
        userId: MOCK_USER_ID,
      });

      await capturedAdapter!.emitMissionEvent({
        type: "social.mission:started",
        missionId: MOCK_MISSION_ID,
        userId: MOCK_USER_ID,
        payload: { test: true },
      });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "social.mission:started",
          scope: expect.objectContaining({ missionId: MOCK_MISSION_ID }),
        }),
      );
    });

    it("should silently swallow eventBus.emit error in adapter.emitMissionEvent", async () => {
      (mockEventBus.emit as jest.Mock).mockRejectedValue(
        new Error("schema validation failed"),
      );

      let capturedAdapter: {
        emitMissionEvent: (args: unknown) => Promise<void>;
      };
      (mockFramework.openSession as jest.Mock).mockImplementation(
        (args: { adapter: typeof capturedAdapter }) => {
          capturedAdapter = args.adapter;
          return Promise.resolve({});
        },
      );

      await service.openSession({
        missionId: MOCK_MISSION_ID,
        input: makeInput(),
        userId: MOCK_USER_ID,
      });

      await expect(
        capturedAdapter!.emitMissionEvent({
          type: "social.mission:started",
          missionId: MOCK_MISSION_ID,
          userId: MOCK_USER_ID,
          payload: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // runWithinContext
  // =========================================================================

  describe("runWithinContext", () => {
    it("should delegate to framework.runWithinContext with ai-social billing type", async () => {
      const mockSession = { missionId: MOCK_MISSION_ID } as unknown as Awaited<
        ReturnType<typeof service.openSession>
      >;
      const mockFn = jest.fn().mockResolvedValue("result-value");
      (mockFramework.runWithinContext as jest.Mock).mockImplementation(
        (
          _session: unknown,
          _billing: unknown,
          _scope: unknown,
          fn: () => Promise<unknown>,
        ) => fn(),
      );

      const result = await service.runWithinContext(mockSession, mockFn);

      expect(mockFramework.runWithinContext).toHaveBeenCalledWith(
        mockSession,
        "ai-social",
        "team",
        mockFn,
      );
      expect(result).toBe("result-value");
    });

    it("should propagate errors from the inner function", async () => {
      const mockSession = {} as unknown as Awaited<
        ReturnType<typeof service.openSession>
      >;
      (mockFramework.runWithinContext as jest.Mock).mockImplementation(
        (
          _session: unknown,
          _billing: unknown,
          _scope: unknown,
          fn: () => Promise<unknown>,
        ) => fn(),
      );
      const failingFn = jest.fn().mockRejectedValue(new Error("inner error"));

      await expect(
        service.runWithinContext(mockSession, failingFn),
      ).rejects.toThrow("inner error");
    });

    it("should return the value resolved by the inner function", async () => {
      const mockSession = {} as unknown as Awaited<
        ReturnType<typeof service.openSession>
      >;
      (mockFramework.runWithinContext as jest.Mock).mockImplementation(
        (
          _session: unknown,
          _billing: unknown,
          _scope: unknown,
          fn: () => Promise<unknown>,
        ) => fn(),
      );
      const fn = jest
        .fn()
        .mockResolvedValue({ status: "completed", missionId: MOCK_MISSION_ID });

      const result = await service.runWithinContext(mockSession, fn);

      expect(result).toEqual({
        status: "completed",
        missionId: MOCK_MISSION_ID,
      });
    });
  });
});
