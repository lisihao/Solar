/**
 * AgentPlaygroundController unit tests
 *
 * Tests all endpoints: listMissions, getMission, exportMission,
 * devTriggerMission, runTeam, rerunMission, rerunTodo, cancelMission,
 * deleteMission, updateMission, replay, listLeaderChat, sendLeaderChat
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { AgentPlaygroundController } from "../api/controller/playground.controller";

function makeReq(userId?: string) {
  return { user: userId !== undefined ? { id: userId } : undefined } as never;
}

function _makeAuthReq() {
  return makeReq("user-1");
}

function makeOrchestrator() {
  return {
    runMission: jest.fn().mockResolvedValue({}),
  };
}

function makeBuffer() {
  return {
    read: jest.fn().mockReturnValue([]),
    readPersisted: jest.fn().mockResolvedValue([]),
    broadcast: jest.fn().mockResolvedValue(undefined),
  };
}

function makeOwnership() {
  return {
    assign: jest.fn(),
    getOwner: jest.fn(),
    release: jest.fn(),
  };
}

function makeStore() {
  return {
    listByUser: jest.fn().mockResolvedValue([]),
    getById: jest.fn().mockResolvedValue(null),
    // ★ P-IDOR2 (full): 按 id 查访问元信息（owner + visibility），不带 userId 过滤。
    //   默认 own（owner === 测试常用 requester "user-1"，PRIVATE）让既有读端点
    //   测试直接放行；需 404 / 跨用户场景的测试自行 mock 返回 null 或他人 meta。
    getAccessMetaById: jest.fn().mockResolvedValue({
      userId: "user-1",
      visibility: "PRIVATE",
      topicId: null,
    }),
    // ★ C0/G1：applyTerminalIfRunning 替代 markCancelled（条件写，首写赢，返回 boolean）
    applyTerminalIfRunning: jest.fn().mockResolvedValue(true),
    deleteByUser: jest.fn().mockResolvedValue(undefined),
    deleteTerminalByUser: jest.fn().mockResolvedValue(3),
    updateTopicByUser: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue(undefined),
    // ★ P0 并发限制 (2026-05-06): 默认返回 0（未超限）
    countRunningByUser: jest.fn().mockResolvedValue(0),
    // ★ auto-supersede (2026-06-07)：默认无可顶替 mission
    findOldestRunningMissionId: jest.fn().mockResolvedValue(null),
    // ★ 2026-05-06: 报告版本化 endpoint
    listReportVersions: jest.fn().mockResolvedValue([]),
    getReportVersion: jest.fn().mockResolvedValue(null),
  };
}

function makeLeaderChat() {
  return {
    list: jest.fn().mockResolvedValue([]),
    send: jest.fn().mockResolvedValue({ user: {}, assistant: {} }),
  };
}

function makeAbortRegistry() {
  return {
    abort: jest.fn(),
    register: jest.fn().mockReturnValue(new AbortController()),
    unregister: jest.fn(),
  };
}

function makePrisma() {
  return {
    userApiKey: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
}

function buildController() {
  // ★ R2-C 单轨化 (2026-05-04)：orchestrator (TeamMission) 已删除；
  //   保留 makeOrchestrator() helper 名称用于 mission-rerun-orchestrator
  //   构造（注入 PlaygroundPipelineDispatcher 替代 TeamMission）
  const orchestrator = makeOrchestrator();
  const buffer = makeBuffer();
  const ownership = makeOwnership();
  const store = makeStore();
  const leaderChat = makeLeaderChat();
  const abortRegistry = makeAbortRegistry();
  const prisma = makePrisma();
  const checkpoint = {
    cloneCheckpoint: jest.fn().mockResolvedValue(false),
    // ★ 2026-06-11 同-id 重跑：fresh 模式清自己的 checkpoint（原地从头跑）。
    clear: jest.fn().mockResolvedValue(undefined),
    // ★ 2026-06-12 修「更新全量重跑」：incremental 无 checkpoint 时 self-inherit
    //   兜底 —— orchestrator 现在查 canResume；缺省 mock 为不可续（走兜底分支）。
    canResume: jest
      .fn()
      .mockResolvedValue({ canResume: false, reason: "no-checkpoint" }),
  };
  // ★ 2026-05-04 PR-10c: MissionExportService 拆出 controller 后 spec 用真实
  //   service 构造（依赖 store mock），保证 export 行为与抽出前一致。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    MissionExportService,
  } = require("../mission/export/mission-export.service");
  const exportService = new MissionExportService(store as never);
  const localRerun = {
    execute: jest.fn(),
    isLocallyRerunable: jest.fn().mockReturnValue({ rerunable: false }),
  };
  // ★ 2026-05-04 PR-10d: MissionRerunOrchestratorService 拆出后 spec 用真实
  //   service 构造（依赖 store / buffer / ownership / checkpoint / orchestrator
  //   mock），保证 rerun 行为与抽出前一致。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    MissionRerunOrchestratorService,
  } = require("../mission/rerun/mission-rerun-orchestrator.service");
  // ★ 2026-05-07 rerun-overhaul v1.1: RerunGuardService 注入（缺省放过）
  const rerunGuardMock = {
    ensureRerunable: jest.fn().mockResolvedValue(undefined),
    checkInFlight: jest.fn().mockResolvedValue({
      inFlight: false,
      zombieDetected: false,
      status: "completed",
      heartbeatAgeMs: null,
      latestBusinessEventAgeMs: null,
    }),
  };
  const rerunOrchestrator = new MissionRerunOrchestratorService(
    orchestrator as never,
    store as never,
    buffer as never,
    ownership as never,
    checkpoint as never,
    rerunGuardMock as never,
  );

  // ★ R2-C 单轨化 (2026-05-04)：pipelineDispatcher 是唯一 mission orchestrator；
  //   orchestrator (TeamMission) + runtimeFlag 已从 controller 删除
  const pipelineDispatcher = orchestrator; // 复用 makeOrchestrator() 的 runMission stub
  const electionTracker = {
    clear: jest.fn(),
  };

  // ★ 2026-05-15 PR-C god-class 拆分：原 856 行 controller 拆 3 个聚焦 controller。
  //   spec 保持单 `controller` facade 入口（67 处测试用例不改），底下分发到
  //   AgentPlaygroundController (lifecycle) / MissionReadController / MissionRerunController。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    MissionReadController,
  } = require("../api/controller/mission-read.controller");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    MissionRerunController,
  } = require("../api/controller/mission-rerun.controller");

  // ★ C0/G1：lifecycleManager mock —— finalize 复刻真实语义（条件写 + onWon 吞异常）
  const lifecycleManager = {
    finalize: jest.fn(
      async <TExtra>(args: {
        missionId: string;
        intent: { status: string; extra?: TExtra };
        arbiter: {
          applyTerminalIfRunning: (
            id: string,
            intent: unknown,
          ) => Promise<boolean>;
        };
        abort?: () => void;
        onWon?: () => Promise<void>;
      }) => {
        const won = await args.arbiter.applyTerminalIfRunning(
          args.missionId,
          args.intent,
        );
        if (won && args.onWon) {
          try {
            await args.onWon();
          } catch {
            // swallow
          }
        }
        return { won };
      },
    ),
  };
  // ★ E32: EventBus mock（早爆补发终态事件）
  const eventBus = {
    publish: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
  };
  // ★ WS-Audit (2026-05-30): AuditLogService mock（mission 取消/删除留痕）
  const auditLog = {
    record: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  const mainCtrl = new AgentPlaygroundController(
    ownership as never,
    store as never,
    buffer as never,
    abortRegistry as never,
    prisma as never,
    electionTracker as never,
    pipelineDispatcher as never,
    lifecycleManager as never,
    eventBus as never,
    auditLog as never,
  );
  const readCtrl = new MissionReadController(
    ownership as never,
    store as never,
    checkpoint as never,
    exportService as never,
    buffer as never,
    leaderChat as never,
  );
  const rerunCtrl = new MissionRerunController(
    ownership as never,
    store as never,
    buffer as never,
    leaderChat as never,
    localRerun as never,
    rerunOrchestrator as never,
  );

  // Facade：method binding 到对应 controller，让旧 spec 不动
  const controller: any = {
    // read
    listMissions: readCtrl.listMissions.bind(readCtrl),
    listResumable: readCtrl.listResumable.bind(readCtrl),
    getMission: readCtrl.getMission.bind(readCtrl),
    exportMission: readCtrl.exportMission.bind(readCtrl),
    listMissionReportVersions:
      readCtrl.listMissionReportVersions.bind(readCtrl),
    getMissionReportVersion: readCtrl.getMissionReportVersion.bind(readCtrl),
    replay: readCtrl.replay.bind(readCtrl),
    listLeaderChat: readCtrl.listLeaderChat.bind(readCtrl),
    reportClientError: readCtrl.reportClientError.bind(readCtrl),
    // rerun
    rerunMission: rerunCtrl.rerunMission.bind(rerunCtrl),
    rerunTodo: rerunCtrl.rerunTodo.bind(rerunCtrl),
    localRerunTodo: rerunCtrl.localRerunTodo.bind(rerunCtrl),
    sendLeaderChat: rerunCtrl.sendLeaderChat.bind(rerunCtrl),
    // lifecycle
    runTeam: mainCtrl.runTeam.bind(mainCtrl),
    cancelMission: mainCtrl.cancelMission.bind(mainCtrl),
    deleteMission: mainCtrl.deleteMission.bind(mainCtrl),
    cleanupMissions: mainCtrl.cleanupMissions.bind(mainCtrl),
    updateMission: mainCtrl.updateMission.bind(mainCtrl),
    devTriggerMission: mainCtrl.devTriggerMission.bind(mainCtrl),
  };

  return {
    controller,
    orchestrator, // alias for pipelineDispatcher (back-compat for old assertions)
    buffer,
    ownership,
    store,
    checkpoint,
    leaderChat,
    abortRegistry,
    prisma,
    pipelineDispatcher,
    electionTracker,
    lifecycleManager,
    auditLog,
  };
}

const VALID_INPUT = {
  topic: "AI trends 2024",
  depth: "deep",
  language: "zh-CN",
  searchTimeRange: "365d",
  // ★ P0-K (2026-05-06): maxCredits + budgetMultiplierOverride 必填
  maxCredits: 1000,
  budgetMultiplierOverride: 1.4,
};

// ★ C5/G7:rerun 现读 configSnapshot;mock 统一带一个 valid snapshot(legacy 测试单独传 null)。
const SNAP = {
  schemaVersion: 1,
  snapshotRevision: 0,
  snapshotId: "snap-test",
  mutationReason: "fresh",
  resolvedAt: new Date().toISOString(),
  topic: "test",
  language: "zh-CN",
  businessInput: {
    depth: "standard",
    budgetProfile: "medium",
    styleProfile: "executive",
    lengthProfile: "standard",
    audienceProfile: "domain-expert",
    withFigures: true,
    auditLayers: "default",
    concurrency: 3,
    viewMode: "continuous",
    searchTimeRange: "365d",
  },
  budget: {
    maxCredits: 1000,
    maxTokens: 1000000,
    creditBudgetProxyUsd: 2,
    budgetMultiplier: 1,
    source: "default",
    resolvedAt: new Date().toISOString(),
  },
  runtimeLimits: { wallTimeCapMs: 3600000 },
} as unknown as Record<string, unknown>;

describe("AgentPlaygroundController", () => {
  describe("listMissions", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(controller.listMissions(makeReq(undefined))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("returns items from store", async () => {
      const { controller, store } = buildController();
      store.listByUser.mockResolvedValue([{ id: "m1" }]);
      const result = await controller.listMissions(makeReq("user-1"));
      expect(result).toEqual({ items: [{ id: "m1" }] });
    });
  });

  describe("getMission", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(
        controller.getMission("m-1", makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException when mission not found (assertReadAccess)", async () => {
      const { controller, store } = buildController();
      store.getAccessMetaById.mockResolvedValue(null);
      await expect(
        controller.getMission("m-1", makeReq("user-1")),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns mission when found (own)", async () => {
      const { controller, store } = buildController();
      store.getAccessMetaById.mockResolvedValue({
        userId: "user-1",
        visibility: "PRIVATE",
        topicId: null,
      });
      store.getById.mockResolvedValue({ id: "m-1", topic: "test" });
      const result = await controller.getMission("m-1", makeReq("user-1"));
      expect(result).toEqual({ mission: { id: "m-1", topic: "test" } });
    });

    it("returns mission when PUBLIC and requester is not owner", async () => {
      const { controller, store } = buildController();
      store.getAccessMetaById.mockResolvedValue({
        userId: "owner-x",
        visibility: "PUBLIC",
        topicId: null,
      });
      // fetched by owner id, not requester id
      store.getById.mockResolvedValue({ id: "m-1", topic: "test" });
      const result = await controller.getMission("m-1", makeReq("user-1"));
      expect(result).toEqual({ mission: { id: "m-1", topic: "test" } });
      expect(store.getById).toHaveBeenCalledWith("m-1", "owner-x");
    });

    it("throws NotFoundException when other-user PRIVATE", async () => {
      const { controller, store } = buildController();
      store.getAccessMetaById.mockResolvedValue({
        userId: "owner-x",
        visibility: "PRIVATE",
        topicId: null,
      });
      await expect(
        controller.getMission("m-1", makeReq("user-1")),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("exportMission", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(
        controller.exportMission("m-1", "csv-facts", makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException when mission not found (assertReadAccess)", async () => {
      const { controller, store } = buildController();
      store.getAccessMetaById.mockResolvedValue(null);
      await expect(
        controller.exportMission("m-1", "csv-facts", makeReq("user-1")),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when mission has no reportFull", async () => {
      const { controller, store } = buildController();
      store.getAccessMetaById.mockResolvedValue({
        userId: "user-1",
        visibility: "PRIVATE",
        topicId: null,
      });
      store.getById.mockResolvedValue({ id: "m-1", topic: "test" });
      await expect(
        controller.exportMission("m-1", "csv-facts", makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
    });

    it("exports csv-facts with correct MIME type", async () => {
      const { controller, store } = buildController();
      store.getAccessMetaById.mockResolvedValue({
        userId: "user-1",
        visibility: "PRIVATE",
        topicId: null,
      });
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "AI",
        reportFull: {
          factTable: [
            { entity: "E", attribute: "A", value: "V", sources: [1, 2] },
          ],
          metadata: { topic: "AI test" },
        },
      });
      const result = await controller.exportMission(
        "m-1",
        "csv-facts",
        makeReq("user-1"),
      );
      expect(result.mimeType).toContain("text/csv");
      expect(result.filename).toMatch(/\.csv$/);
      expect(result.content).toContain("entity,attribute,value");
    });

    it("exports csv-citations with correct MIME type", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "AI",
        reportFull: {
          citations: [
            {
              index: 1,
              title: "Test",
              url: "https://x.com",
              domain: "x.com",
              sourceType: "web",
              credibilityScore: 80,
              publishedAt: "2024-01-01",
            },
          ],
          metadata: {},
        },
      });
      const result = await controller.exportMission(
        "m-1",
        "csv-citations",
        makeReq("user-1"),
      );
      expect(result.mimeType).toContain("text/csv");
      expect(result.content).toContain("index,title");
    });

    it("exports markdown format", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "AI test",
        reportFull: {
          content: { fullMarkdown: "# Report\n\ncontent" },
          metadata: { topic: "AI test", generatedAt: "2024-01-01" },
          citations: [],
        },
      });
      const result = await controller.exportMission(
        "m-1",
        "markdown",
        makeReq("user-1"),
      );
      expect(result.mimeType).toContain("text/markdown");
      expect(result.filename).toMatch(/\.md$/);
      expect(result.content).toContain("# Report");
    });

    it("exports json format", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "AI",
        reportFull: { metadata: {}, content: {} },
      });
      const result = await controller.exportMission(
        "m-1",
        "json",
        makeReq("user-1"),
      );
      expect(result.mimeType).toContain("application/json");
      expect(result.filename).toMatch(/\.json$/);
    });

    it("throws BadRequestException for unsupported format", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        reportFull: { metadata: {} },
      });
      await expect(
        controller.exportMission("m-1", "excel", makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
    });

    it("includes L4 warnings section in markdown when l4- warnings present", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "AI",
        reportFull: {
          content: { fullMarkdown: "body" },
          metadata: {},
          quality: {
            warnings: [
              { dimension: "l4-blindspot", message: "Missing X" },
              { dimension: "l4-bias", message: "Confirmation bias" },
              { dimension: "l4-suggestion", message: "Add Y" },
              { dimension: "l4-critic", message: "Overall ok" },
            ],
          },
        },
      });
      const result = await controller.exportMission(
        "m-1",
        "markdown",
        makeReq("user-1"),
      );
      expect(result.content).toContain("独立审查（Critic L4）");
    });
  });

  describe("devTriggerMission", () => {
    const previousToken = process.env.AGENT_PLAYGROUND_DEV_TRIGGER_TOKEN;

    beforeEach(() => {
      process.env.AGENT_PLAYGROUND_DEV_TRIGGER_TOKEN = "test-dev-token";
    });

    afterEach(() => {
      if (previousToken === undefined) {
        delete process.env.AGENT_PLAYGROUND_DEV_TRIGGER_TOKEN;
      } else {
        process.env.AGENT_PLAYGROUND_DEV_TRIGGER_TOKEN = previousToken;
      }
    });

    it("throws ForbiddenException when internal token is missing", async () => {
      const { controller } = buildController();
      await expect(
        controller.devTriggerMission({
          userApiKeyId: "some-id",
          input: VALID_INPUT,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws BadRequestException when userApiKeyId is missing", async () => {
      const { controller } = buildController();
      await expect(
        controller.devTriggerMission({
          userApiKeyId: "",
          input: {},
          internalToken: "test-dev-token",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws ForbiddenException when apiKey not found in DB", async () => {
      const { controller, prisma } = buildController();
      prisma.userApiKey.findUnique.mockResolvedValue(null);
      await expect(
        controller.devTriggerMission({
          userApiKeyId: "some-id",
          input: VALID_INPUT,
          internalToken: "test-dev-token",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws BadRequestException for invalid input schema", async () => {
      const { controller, prisma } = buildController();
      prisma.userApiKey.findUnique.mockResolvedValue({ userId: "user-1" });
      await expect(
        controller.devTriggerMission({
          userApiKeyId: "some-id",
          input: { topic: "x" }, // topic < 2 chars at validation time? let's use empty
          internalToken: "test-dev-token",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns missionId without leaking userId for valid request", async () => {
      const { controller, prisma, orchestrator } = buildController();
      prisma.userApiKey.findUnique.mockResolvedValue({ userId: "user-42" });
      orchestrator.runMission.mockResolvedValue({});
      const result = await controller.devTriggerMission({
        userApiKeyId: "some-id",
        input: VALID_INPUT,
        internalToken: "test-dev-token",
      });
      expect(result.missionId).toBeDefined();
      expect(result).not.toHaveProperty("userId");
    });
  });

  describe("runTeam", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(
        controller.runTeam(VALID_INPUT, makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws BadRequestException for invalid input", async () => {
      const { controller } = buildController();
      await expect(
        controller.runTeam({ topic: "" }, makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns missionId and streamNamespace for valid input", async () => {
      const { controller } = buildController();
      const result = await controller.runTeam(VALID_INPUT, makeReq("user-1"));
      expect(result.missionId).toBeDefined();
      expect(result.streamNamespace).toBe("playground");
    });

    it("assigns ownership to the user", async () => {
      const { controller, ownership } = buildController();
      await controller.runTeam(VALID_INPUT, makeReq("user-1"));
      expect(ownership.assign).toHaveBeenCalledWith(
        expect.any(String),
        "user-1",
      );
    });

    it("auto-supersedes oldest running mission when at concurrency cap, then succeeds", async () => {
      const { controller, store, abortRegistry } = buildController();
      // 第一次查 3（满），顶替一个后降到 2
      store.countRunningByUser.mockResolvedValueOnce(3).mockResolvedValue(2);
      store.findOldestRunningMissionId.mockResolvedValueOnce("old-mission-1");
      const result = await controller.runTeam(VALID_INPUT, makeReq("user-1"));
      expect(store.findOldestRunningMissionId).toHaveBeenCalledWith("user-1");
      expect(abortRegistry.abort).toHaveBeenCalledWith(
        "old-mission-1",
        "user_cancelled",
      );
      expect(result.missionId).toBeDefined();
    });

    it("throws BadRequestException when at cap and no mission can be superseded", async () => {
      const { controller, store } = buildController();
      store.countRunningByUser.mockResolvedValue(3);
      store.findOldestRunningMissionId.mockResolvedValue(null); // 无可顶替
      await expect(
        controller.runTeam(VALID_INPUT, makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("rerunMission", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(
        controller.rerunMission("m-1", undefined, makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ForbiddenException when mission not found (ownership miss + store miss)", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue(undefined);
      store.getById.mockResolvedValue(null);
      await expect(
        controller.rerunMission("m-1", undefined, makeReq("user-1")),
      ).rejects.toThrow(ForbiddenException);
    });

    // ★ 2026-06-11 同-id 续跑/重跑：返回**源 missionId**（原地重跑，不再新建 id）。
    it("returns the SAME missionId in-place (default incremental)", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test",
        depth: "deep",
        language: "zh-CN",
        status: "completed",
        userProfile: null,
      });
      const result = await controller.rerunMission(
        "m-1",
        undefined,
        makeReq("user-1"),
      );
      expect(result.missionId).toBe("m-1"); // 同-id，不新建
      expect(result.streamNamespace).toBe("playground");
    });

    // ★ 2026-06-11 fresh：同 id + 清自己的 checkpoint（从头重跑），不分配新 id。
    it("mode='fresh' clears checkpoint, same id", async () => {
      const { controller, ownership, store, checkpoint } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test",
        depth: "deep",
        language: "zh-CN",
        status: "completed",
        userProfile: null,
      });
      const result = await controller.rerunMission(
        "m-1",
        "fresh",
        makeReq("user-1"),
      );
      expect(result.missionId).toBe("m-1");
      expect(checkpoint.clear).toHaveBeenCalledWith("m-1");
    });

    // ★ 2026-06-11 incremental：同 id + 保留 checkpoint（原地续跑），不清不新建。
    it("mode='incremental' keeps checkpoint, same id", async () => {
      const { controller, ownership, store, checkpoint } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test",
        depth: "deep",
        language: "zh-CN",
        status: "completed",
        userProfile: null,
      });
      const result = await controller.rerunMission(
        "m-1",
        "incremental",
        makeReq("user-1"),
      );
      expect(result.missionId).toBe("m-1");
      expect(checkpoint.clear).not.toHaveBeenCalled();
    });

    it("falls back to incremental when mode is invalid string", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test",
        depth: "deep",
        language: "zh-CN",
        status: "completed",
        userProfile: null,
      });
      // 非法 mode 字符串：controller 内 ternary 收敛到 'incremental'
      const result = await controller.rerunMission(
        "m-1",
        "garbage-mode",
        makeReq("user-1"),
      );
      expect(result.missionId).toBeDefined();
    });

    // ★ 2026-05-05 service-level running 拒绝分支（双重保护）
    it("rejects rerun when source mission is still running", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      // assertOwnership 路径 + rerunFullMission 路径都用同一 mock
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test",
        depth: "deep",
        language: "zh-CN",
        status: "running", // ← 关键：原 mission 还在跑
        userProfile: null,
      });
      // ★ 全覆盖审计修 (2026-05-06): orchestrator 改为白名单校验，错误消息含 "must be one of"
      await expect(
        controller.rerunMission("m-1", undefined, makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("rerunTodo", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(
        controller.rerunTodo("m-1", "todo-1", {}, makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws BadRequestException when source mission is still running", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test",
        depth: "deep",
        language: "zh-CN",
        status: "running",
        userProfile: null,
      });
      await expect(
        controller.rerunTodo("m-1", "todo-1", {}, makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException for leader-assess-abort origin", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test",
        depth: "deep",
        language: "zh-CN",
        status: "completed",
        userProfile: null,
      });
      await expect(
        controller.rerunTodo(
          "m-1",
          "todo-1",
          { origin: "leader-assess-abort" },
          makeReq("user-1"),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException for s11-persist system stage", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test",
        depth: "deep",
        language: "zh-CN",
        status: "completed",
        userProfile: null,
      });
      await expect(
        controller.rerunTodo(
          "m-1",
          "sys:s11-persist",
          { origin: "system-stage" },
          makeReq("user-1"),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns new missionId for valid rerun-todo request", async () => {
      const { controller, ownership, store, buffer } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test topic",
        depth: "deep",
        language: "zh-CN",
        status: "completed",
        userProfile: { depth: "deep", language: "zh-CN" },
      });
      buffer.broadcast.mockResolvedValue(undefined);
      const result = await controller.rerunTodo(
        "m-1",
        "todo-abc",
        { scope: "dimension", dimensionRef: "Finance" },
        makeReq("user-1"),
      );
      expect(result.missionId).toBeDefined();
      expect(result.streamNamespace).toBe("playground");
    });
  });

  describe("cancelMission", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(
        controller.cancelMission("m-1", makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ForbiddenException when mission not found", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue(undefined);
      store.getById.mockResolvedValue(null);
      await expect(
        controller.cancelMission("m-1", makeReq("user-1")),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws BadRequestException when mission is not running", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test",
        status: "completed",
      });
      await expect(
        controller.cancelMission("m-1", makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
    });

    it("cancels running mission successfully", async () => {
      const {
        controller,
        ownership,
        store,
        abortRegistry,
        buffer,
        electionTracker,
        lifecycleManager,
        auditLog,
      } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test",
        status: "running",
      });
      const result = await controller.cancelMission("m-1", makeReq("user-1"));
      expect(result).toEqual({ ok: true, status: "cancelled" });
      // ★ WS-Audit: mission 取消高敏操作 append-only 留痕
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: "user-1",
          action: "mission.cancel",
          resourceType: "agent_playground_mission",
          resourceId: "m-1",
          result: "success",
        }),
      );
      expect(abortRegistry.abort).toHaveBeenCalledWith("m-1", "user_cancelled");
      // ★ C0/G1：取消终态经 lifecycleManager.finalize 仲裁（不再直写 store.markCancelled）
      expect(lifecycleManager.finalize).toHaveBeenCalledWith(
        expect.objectContaining({
          missionId: "m-1",
          intent: expect.objectContaining({
            status: "cancelled",
            extra: expect.objectContaining({ kind: "cancelled" }),
          }),
          arbiter: store,
        }),
      );
      expect(electionTracker.clear).toHaveBeenCalledWith("m-1");
      expect(buffer.broadcast).toHaveBeenCalled();
    });
  });

  describe("deleteMission", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(
        controller.deleteMission("m-1", makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ForbiddenException when mission not found", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue(null);
      await expect(
        controller.deleteMission("m-1", makeReq("user-1")),
      ).rejects.toThrow(ForbiddenException);
    });

    it("deletes mission and returns ok when in terminal state", async () => {
      const { controller, store, ownership, electionTracker, auditLog } =
        buildController();
      // 终态（如 completed）允许直接删
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test",
        status: "completed",
      });
      const result = await controller.deleteMission("m-1", makeReq("user-1"));
      expect(result).toEqual({ ok: true });
      expect(store.deleteByUser).toHaveBeenCalledWith("m-1", "user-1");
      expect(electionTracker.clear).toHaveBeenCalledWith("m-1");
      expect(ownership.release).toHaveBeenCalledWith("m-1");
      // ★ WS-Audit: mission 删除高敏操作 append-only 留痕
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: "user-1",
          action: "mission.delete",
          resourceType: "agent_playground_mission",
          resourceId: "m-1",
          result: "success",
        }),
      );
    });

    // 2026-05-12 FK 事故修复：running mission 直接 DELETE 会让 background workers
    //   （saveResearchResult / refreshHeartbeat）撞 FK 违约 +"No record found
    //   for an update"，trace 漫天 error。block 在 controller，要求先 cancel。
    it("rejects DELETE when mission is still running (FK constraint protection)", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test",
        status: "running",
      });
      await expect(
        controller.deleteMission("m-1", makeReq("user-1")),
      ).rejects.toThrow(/running/);
      expect(store.deleteByUser).not.toHaveBeenCalled();
    });
  });

  describe("cleanupMissions", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(
        controller.cleanupMissions(makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("bulk-deletes terminal missions and returns deleted count", async () => {
      const { controller, store } = buildController();
      const result = await controller.cleanupMissions(makeReq("user-1"));
      expect(store.deleteTerminalByUser).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ ok: true, deleted: 3 });
    });
  });

  describe("updateMission", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(
        controller.updateMission("m-1", { topic: "new" }, makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws BadRequestException when topic is empty", async () => {
      const { controller } = buildController();
      await expect(
        controller.updateMission("m-1", { topic: "  " }, makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when topic exceeds 500 chars", async () => {
      const { controller } = buildController();
      await expect(
        controller.updateMission(
          "m-1",
          { topic: "a".repeat(501) },
          makeReq("user-1"),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws ForbiddenException when mission not found", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue(null);
      await expect(
        controller.updateMission(
          "m-1",
          { topic: "valid topic" },
          makeReq("user-1"),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("updates topic successfully", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "old",
      });
      const result = await controller.updateMission(
        "m-1",
        { topic: "new topic" },
        makeReq("user-1"),
      );
      expect(result).toEqual({ ok: true });
      expect(store.updateTopicByUser).toHaveBeenCalledWith(
        "m-1",
        "user-1",
        "new topic",
      );
    });
  });

  describe("replay", () => {
    it("returns in-memory events when available", async () => {
      const { controller, buffer, ownership } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      buffer.read.mockReturnValue([{ type: "evt", timestamp: 100 }]);
      const result = await controller.replay(
        "m-1",
        undefined,
        makeReq("user-1"),
      );
      expect(result.events).toHaveLength(1);
      expect(result.serverNow).toBeGreaterThan(0);
    });

    it("falls back to DB persisted events when memory empty", async () => {
      const { controller, buffer, ownership } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      buffer.read.mockReturnValue([]);
      buffer.readPersisted.mockResolvedValue([{ type: "evt", timestamp: 200 }]);
      const result = await controller.replay(
        "m-1",
        undefined,
        makeReq("user-1"),
      );
      expect(result.events).toHaveLength(1);
    });

    it("filters by sinceTs when provided", async () => {
      const { controller, buffer, ownership } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      buffer.read.mockReturnValue([]);
      buffer.readPersisted.mockResolvedValue([]);
      await controller.replay("m-1", "12345", makeReq("user-1"));
      expect(buffer.read).toHaveBeenCalledWith("m-1", 12345);
    });

    // ★ P-IDOR2 (full)：replay 走 assertReadAccess —— 非所有者，getAccessMetaById
    //   返回他人 PRIVATE mission → assertResourceAccess 判 PRIVATE → 404
    //   (NotFoundException，不泄露存在性)，而非旧的 403。
    it("throws NotFoundException when not owner and mission is PRIVATE", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue("other-user");
      store.getAccessMetaById.mockResolvedValue({
        userId: "other-user",
        visibility: "PRIVATE",
        topicId: null,
      });
      await expect(
        controller.replay("m-1", undefined, makeReq("user-1")),
      ).rejects.toThrow(NotFoundException);
    });

    // ★ P-IDOR2 (full)：他人 PUBLIC mission → 放行（真生效，不再 own+404）。
    it("allows replay for a non-owner when mission is PUBLIC", async () => {
      const { controller, ownership, store, buffer } = buildController();
      ownership.getOwner.mockReturnValue("other-user");
      store.getAccessMetaById.mockResolvedValue({
        userId: "other-user",
        visibility: "PUBLIC",
        topicId: null,
      });
      buffer.read.mockReturnValue([{ type: "evt", timestamp: 1 }]);
      const result = await controller.replay(
        "m-1",
        undefined,
        makeReq("user-1"),
      );
      expect(result.events).toHaveLength(1);
    });

    // ★ P-IDOR2 (full)：missing mission（meta=null）→ 404。
    it("throws NotFoundException when mission does not exist", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue(undefined);
      store.getAccessMetaById.mockResolvedValue(null);
      await expect(
        controller.replay("m-1", undefined, makeReq("user-1")),
      ).rejects.toThrow(NotFoundException);
    });

    // ★ P-IDOR2：own 放行 —— registry fast-path 命中所有者，直接通过。
    it("allows replay for the owner (registry fast-path)", async () => {
      const { controller, ownership, buffer } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      buffer.read.mockReturnValue([{ type: "evt", timestamp: 1 }]);
      const result = await controller.replay(
        "m-1",
        undefined,
        makeReq("user-1"),
      );
      expect(result.events).toHaveLength(1);
    });

    // ★ P-IDOR2 (full)：own 放行（DB fallback）—— registry miss 但 getAccessMetaById
    //   返回的 owner === requester，assertResourceAccess own 分支放行。
    it("allows replay for the owner via DB fallback (registry miss)", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue(undefined);
      store.getAccessMetaById.mockResolvedValue({
        userId: "user-1", // owner === requester
        visibility: "PRIVATE",
        topicId: null,
      });
      const result = await controller.replay(
        "m-1",
        undefined,
        makeReq("user-1"),
      );
      expect(result.events).toBeDefined();
      // own 命中 → 重新登记 in-memory ownership。
      expect(ownership.assign).toHaveBeenCalledWith("m-1", "user-1");
    });

    it("throws ForbiddenException when no userId (replay)", async () => {
      const { controller } = buildController();
      await expect(
        controller.replay("m-1", undefined, makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("listLeaderChat", () => {
    it("returns messages from leaderChat.list", async () => {
      const { controller, ownership, leaderChat } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      leaderChat.list.mockResolvedValue([{ id: "msg-1" }]);
      const result = await controller.listLeaderChat("m-1", makeReq("user-1"));
      expect(result).toEqual({ messages: [{ id: "msg-1" }] });
    });

    // ★ P-IDOR2 (full)：listLeaderChat 走 assertReadAccess —— 非所有者 PRIVATE → 404。
    it("throws NotFoundException when not owner and mission is PRIVATE", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue("other-user");
      store.getAccessMetaById.mockResolvedValue({
        userId: "other-user",
        visibility: "PRIVATE",
        topicId: null,
      });
      await expect(
        controller.listLeaderChat("m-1", makeReq("user-1")),
      ).rejects.toThrow(NotFoundException);
    });

    // ★ P-IDOR2 (full)：他人 PUBLIC mission 的 leader chat → 放行（真生效）。
    it("allows listLeaderChat for a non-owner when mission is PUBLIC", async () => {
      const { controller, ownership, store, leaderChat } = buildController();
      ownership.getOwner.mockReturnValue("other-user");
      store.getAccessMetaById.mockResolvedValue({
        userId: "other-user",
        visibility: "PUBLIC",
        topicId: null,
      });
      leaderChat.list.mockResolvedValue([{ id: "msg-1" }]);
      const result = await controller.listLeaderChat("m-1", makeReq("user-1"));
      expect(result).toEqual({ messages: [{ id: "msg-1" }] });
    });

    it("throws ForbiddenException when no userId (listLeaderChat)", async () => {
      const { controller } = buildController();
      await expect(
        controller.listLeaderChat("m-1", makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("sendLeaderChat", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(
        controller.sendLeaderChat(
          "m-1",
          { content: "hello" },
          makeReq(undefined),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws BadRequestException when content is empty", async () => {
      const { controller, ownership } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      await expect(
        controller.sendLeaderChat("m-1", { content: "  " }, makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when content exceeds 4000 chars", async () => {
      const { controller, ownership } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      await expect(
        controller.sendLeaderChat(
          "m-1",
          { content: "a".repeat(4001) },
          makeReq("user-1"),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns user and assistant messages from leaderChat.send", async () => {
      const { controller, ownership, leaderChat } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      leaderChat.send.mockResolvedValue({
        user: { id: "u1", content: "hello" },
        assistant: { id: "a1", content: "response" },
      });
      const result = await controller.sendLeaderChat(
        "m-1",
        { content: "hello" },
        makeReq("user-1"),
      );
      expect(result.user).toBeDefined();
      expect(result.assistant).toBeDefined();
    });
  });

  describe("exportMission — additional markdown coverage", () => {
    it("includes leaderForeword with whatWeAnswered in markdown export", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "AI",
        reportFull: {
          content: { fullMarkdown: "body" },
          metadata: {
            topic: "AI",
            audienceProfile: "expert",
            leaderForeword: {
              whatWeAnswered: [
                {
                  criterion: "ROI",
                  addressed: "yes",
                  evidence: "Data shows...",
                },
                {
                  criterion: "Risk",
                  addressed: "partial",
                  evidence: "Partially...",
                },
                {
                  criterion: "Unknown",
                  addressed: "no",
                  evidence: "Not found",
                },
              ],
              whatRemainsUnclear: ["Topic A", "Topic B"],
              howToRead: "Start with the executive summary",
              recommendedFollowUp: ["Deep dive on X", "Survey Y"],
            },
          },
        },
      });
      const result = await controller.exportMission(
        "m-1",
        "markdown",
        makeReq("user-1"),
      );
      expect(result.content).toContain("Foreword by Lead");
      expect(result.content).toContain("我们回答了什么");
      expect(result.content).toContain("没回答 / 证据不足");
      expect(result.content).toContain("如何阅读本报告");
      expect(result.content).toContain("建议的后续研究方向");
      expect(result.content).toContain("audienceProfile");
    });

    it("includes citations with sourceType and credibilityScore in markdown", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "AI",
        reportFull: {
          content: { fullMarkdown: "content" },
          metadata: {},
          citations: [
            {
              index: 1,
              title: "Report Title",
              url: "https://example.com/report",
              domain: "example.com",
              sourceType: "academic",
              credibilityScore: 90,
              publishedAt: "2024-06-15",
            },
          ],
        },
      });
      const result = await controller.exportMission(
        "m-1",
        "markdown",
        makeReq("user-1"),
      );
      expect(result.content).toContain("参考文献");
      expect(result.content).toContain("academic");
      expect(result.content).toContain("可信度 90/100");
    });

    it("includes reconciliation report in markdown export", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "AI",
        reportFull: {
          content: { fullMarkdown: "body" },
          metadata: {},
        },
        reconciliationReport: {
          reconciliationReport: "Full reconciliation text here",
          deduplicationStats: {
            duplicatesRemoved: 5,
            termVariantsUnified: 3,
            dataInconsistenciesFlagged: 1,
          },
          termGlossary: [
            { canonical: "AI", variants: ["Artificial Intelligence", "A.I."] },
          ],
        },
      });
      const result = await controller.exportMission(
        "m-1",
        "markdown",
        makeReq("user-1"),
      );
      expect(result.content).toContain("附录：对账总览");
      expect(result.content).toContain("去重统计");
      expect(result.content).toContain("术语对照表");
      expect(result.content).toContain("Full reconciliation text");
    });

    it("markdown export with no metadata does not include frontmatter", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "AI",
        reportFull: {
          content: { fullMarkdown: "minimal content" },
        },
      });
      const result = await controller.exportMission(
        "m-1",
        "markdown",
        makeReq("user-1"),
      );
      expect(result.content).not.toContain("---\n\ntopic:");
      expect(result.content).toContain("minimal content");
    });
  });

  describe("rerunMission — ownership fallback path", () => {
    it("re-registers ownership when found only in DB (railway recycle scenario)", async () => {
      const { controller, ownership, store } = buildController();
      // ownership cache miss
      ownership.getOwner.mockReturnValue(undefined);
      // DB hit (assertOwnership fallback)
      store.getById
        .mockResolvedValueOnce({ id: "m-1", topic: "test", userId: "user-1" }) // assertOwnership
        .mockResolvedValueOnce({
          id: "m-1",
          topic: "test",
          depth: "deep",
          language: "zh-CN",
          status: "completed",
          userProfile: null,
          configSnapshot: SNAP,
        }); // rerunMission body
      const result = await controller.rerunMission(
        "m-1",
        undefined,
        makeReq("user-1"),
      );
      expect(result.missionId).toBeDefined();
      // ownership.assign should have been called for re-registration + new mission
      expect(ownership.assign).toHaveBeenCalled();
    });
  });

  describe("rerunTodo — scope branches", () => {
    async function setupRerunTodo(overrides: Record<string, unknown> = {}) {
      const { controller, ownership, store, buffer } = buildController();
      ownership.getOwner.mockReturnValue("user-1");
      store.getById.mockResolvedValue({
        configSnapshot: SNAP,
        id: "m-1",
        topic: "test topic",
        depth: "deep",
        language: "zh-CN",
        status: "completed",
        userProfile: { depth: "deep", language: "zh-CN" },
        ...overrides,
      });
      buffer.broadcast.mockResolvedValue(undefined);
      return { controller, ownership, store, buffer };
    }

    it("scope=chapter adds chapter hint to topic", async () => {
      const { controller } = await setupRerunTodo();
      const result = await controller.rerunTodo(
        "m-1",
        "todo-1",
        { scope: "chapter", dimensionRef: "Finance", chapterIndex: 0 },
        makeReq("user-1"),
      );
      expect(result.missionId).toBeDefined();
    });

    it("scope=review adds review hint", async () => {
      const { controller } = await setupRerunTodo();
      const result = await controller.rerunTodo(
        "m-1",
        "todo-review",
        { scope: "review", todoTitle: "Fix citation" },
        makeReq("user-1"),
      );
      expect(result.missionId).toBeDefined();
    });

    it("scope=system adds system hint", async () => {
      const { controller } = await setupRerunTodo();
      const result = await controller.rerunTodo(
        "m-1",
        "todo-sys",
        { scope: "system", todoTitle: "Redo writer" },
        makeReq("user-1"),
      );
      expect(result.missionId).toBeDefined();
    });

    it("reasonText appended to hint lines when provided", async () => {
      const { controller } = await setupRerunTodo();
      // Should not throw - reasonText is purely additive
      const result = await controller.rerunTodo(
        "m-1",
        "todo-1",
        {
          scope: "dimension",
          dimensionRef: "Tech",
          reasonText: "More depth needed",
        },
        makeReq("user-1"),
      );
      expect(result.missionId).toBeDefined();
    });
  });

  describe("ownership — DB fallback registers in-memory", () => {
    it("assertReadAccess DB fallback calls ownership.assign for future hot path", async () => {
      const { controller, ownership, store } = buildController();
      ownership.getOwner.mockReturnValue(undefined); // cache miss
      // getAccessMetaById owner === requester → own 放行 + 重登记
      store.getAccessMetaById.mockResolvedValue({
        userId: "user-1",
        visibility: "PRIVATE",
        topicId: null,
      });
      // replay uses assertReadAccess
      const result = await controller.replay(
        "m-1",
        undefined,
        makeReq("user-1"),
      );
      expect(result.events).toBeDefined();
      expect(ownership.assign).toHaveBeenCalledWith("m-1", "user-1");
    });
  });

  // ★ 2026-05-06: 报告版本化 endpoints
  describe("listMissionReportVersions", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(
        controller.listMissionReportVersions("m-1", makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException when mission not accessible (other-user PRIVATE)", async () => {
      const { controller, store } = buildController();
      store.getAccessMetaById.mockResolvedValue({
        userId: "owner-x",
        visibility: "PRIVATE",
        topicId: null,
      });
      await expect(
        controller.listMissionReportVersions("m-1", makeReq("user-1")),
      ).rejects.toThrow(NotFoundException);
    });

    it("returns mapped version list with ISO timestamps", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({ configSnapshot: SNAP, id: "m-1" });
      const generatedAt = new Date("2026-05-06T10:00:00Z");
      store.listReportVersions.mockResolvedValue([
        {
          id: "v-2",
          version: 2,
          versionLabel: "rerun-fresh-2026-05-06",
          reportTitle: "title v2",
          reportSummary: "summary v2",
          finalScore: 78,
          leaderSigned: true,
          triggerType: "rerun-fresh",
          generatedAt,
        },
        {
          id: "v-1",
          version: 1,
          versionLabel: null,
          reportTitle: null,
          reportSummary: null,
          finalScore: null,
          leaderSigned: null,
          triggerType: "initial",
          generatedAt,
        },
      ]);
      const result = await controller.listMissionReportVersions(
        "m-1",
        makeReq("user-1"),
      );
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        version: 2,
        versionLabel: "rerun-fresh-2026-05-06",
        reportTitle: "title v2",
        reportSummary: "summary v2",
        finalScore: 78,
        leaderSigned: true,
        triggerType: "rerun-fresh",
        generatedAt: generatedAt.toISOString(),
      });
    });
  });

  describe("getMissionReportVersion", () => {
    it("throws ForbiddenException when no userId", async () => {
      const { controller } = buildController();
      await expect(
        controller.getMissionReportVersion("m-1", "1", makeReq(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws BadRequestException when version is not a positive integer", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({ configSnapshot: SNAP, id: "m-1" });
      await expect(
        controller.getMissionReportVersion("m-1", "abc", makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.getMissionReportVersion("m-1", "0", makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.getMissionReportVersion("m-1", "-1", makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws NotFoundException when mission not accessible (other-user PRIVATE)", async () => {
      const { controller, store } = buildController();
      store.getAccessMetaById.mockResolvedValue({
        userId: "owner-x",
        visibility: "PRIVATE",
        topicId: null,
      });
      await expect(
        controller.getMissionReportVersion("m-1", "1", makeReq("user-1")),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when version row not found", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({ configSnapshot: SNAP, id: "m-1" });
      store.getReportVersion.mockResolvedValue(null);
      await expect(
        controller.getMissionReportVersion("m-1", "99", makeReq("user-1")),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns full reportFull + meta for the requested version", async () => {
      const { controller, store } = buildController();
      store.getById.mockResolvedValue({ configSnapshot: SNAP, id: "m-1" });
      const generatedAt = new Date("2026-05-06T10:00:00Z");
      store.getReportVersion.mockResolvedValue({
        id: "row-1",
        version: 2,
        versionLabel: "rerun-fresh-2026-05-06",
        reportFull: { title: "report v2", body: "..." },
        reportTitle: "title",
        reportSummary: "summary",
        finalScore: 80,
        leaderSigned: true,
        triggerType: "rerun-fresh",
        changesFromPrev: [{ sectionId: "s1", type: "modified" }],
        generatedAt,
      });
      const result = await controller.getMissionReportVersion(
        "m-1",
        "2",
        makeReq("user-1"),
      );
      expect(result).toEqual({
        version: 2,
        versionLabel: "rerun-fresh-2026-05-06",
        triggerType: "rerun-fresh",
        generatedAt: generatedAt.toISOString(),
        reportFull: { title: "report v2", body: "..." },
        changesFromPrev: [{ sectionId: "s1", type: "modified" }],
      });
      expect(store.getReportVersion).toHaveBeenCalledWith("m-1", 2);
    });
  });
});
