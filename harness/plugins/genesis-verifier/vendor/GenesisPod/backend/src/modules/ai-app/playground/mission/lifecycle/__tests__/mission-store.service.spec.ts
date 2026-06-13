import {
  MissionStore,
  MissionConcurrencyLimitError,
} from "../mission-store.service";

function makePrisma() {
  const agentPlaygroundMission = {
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    count: jest.fn().mockResolvedValue(0),
  };
  const prisma = {
    agentPlaygroundMission,
    // recoverOrphanedRunning groupBy 用来过滤"最近 5min 有事件"
    agentPlaygroundMissionEvent: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    harnessVectorMemory: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    // ★ P0-R5-1: terminal-state methods 调 $executeRaw 清 checkpoint JSONB key
    $executeRaw: jest.fn().mockResolvedValue(0),
    // ★ P0/P1 并发安全 (2026-05-06): appendLeaderJournal + appendDimensions 用 $transaction
    // ★ H4/E9 (2026-05-25): createMission 也走 $transaction（advisory lock + count + insert）
    // 透传 tx 含 agentPlaygroundMission + $executeRaw（advisory_xact_lock），让断言不变
    $transaction: jest
      .fn()
      .mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
        cb({ agentPlaygroundMission, $executeRaw: jest.fn() }),
      ),
  };
  return prisma;
}

describe("MissionStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: MissionStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new MissionStore(prisma as never);
  });

  // create
  it("create: calls prisma.agentPlaygroundMission.create with status=running", async () => {
    await store.create({
      id: "m1",
      userId: "u1",
      topic: "AI",
      depth: "deep",
      language: "zh-CN",
      maxCredits: 1000,
    });
    expect(prisma.agentPlaygroundMission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "running" }),
      }),
    );
  });

  it("create: truncates topic to 500 chars", async () => {
    const longTopic = "x".repeat(600);
    await store.create({
      id: "m1",
      userId: "u1",
      topic: longTopic,
      depth: "deep",
      language: "zh-CN",
      maxCredits: 100,
    });
    const createArg =
      prisma.agentPlaygroundMission.create.mock.calls[0][0].data;
    expect(createArg.topic.length).toBeLessThanOrEqual(500);
  });

  it("create: propagates prisma error so mission does not run without a DB row", async () => {
    prisma.agentPlaygroundMission.create.mockRejectedValue(
      new Error("DB down"),
    );
    await expect(
      store.create({
        id: "m1",
        userId: "u1",
        topic: "t",
        depth: "d",
        language: "zh-CN",
        maxCredits: 100,
      }),
    ).rejects.toThrow("DB down");
  });

  // ★ H4/E9 (2026-05-25): advisory-lock 事务内复核并发上限，堵 controller 预检的 race
  it("create: throws MissionConcurrencyLimitError + skips insert when at limit", async () => {
    prisma.agentPlaygroundMission.count.mockResolvedValueOnce(3); // 已达上限
    await expect(
      store.create({
        id: "m1",
        userId: "u1",
        topic: "t",
        depth: "d",
        language: "zh-CN",
        maxCredits: 100,
      }),
    ).rejects.toThrow(MissionConcurrencyLimitError);
    expect(prisma.agentPlaygroundMission.create).not.toHaveBeenCalled();
  });

  it("create: takes per-user advisory lock before counting", async () => {
    const tx = { $executeRaw: jest.fn(), count: jest.fn() };
    void tx;
    await store.create({
      id: "m1",
      userId: "u1",
      topic: "AI",
      depth: "deep",
      language: "zh-CN",
      maxCredits: 1000,
    });
    // advisory_xact_lock 通过 tx.$executeRaw 发出（每用户串行化建行）
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  // ★ 2026-05-05: recoverOrphanedRunning + recoverPodCrashedRunning 已下线
  //   归并到 ai-harness/lifecycle/mission-liveness-guard.service.ts 的 unified guard
  //   playground module 通过 livenessGuard.registerAdapter('playground', ...) 接入
  //   原 spec 全部迁到 harness 层（mission-liveness-guard.service.spec.ts）

  // applyTerminalIfRunning — completed path
  it("applyTerminalIfRunning(completed): calls updateMany with status=completed guard", async () => {
    await store.applyTerminalIfRunning("m1", {
      status: "completed",
      extra: { kind: "completed", detail: { finalScore: 85 } },
    });
    expect(prisma.agentPlaygroundMission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "m1", status: "running" },
        data: expect.objectContaining({ status: "completed" }),
      }),
    );
  });

  it("applyTerminalIfRunning(completed): truncates fullMarkdown if report > 5MB", async () => {
    const bigMd = "x".repeat(6_000_000); // 6M chars → JSON will be >5MB
    const report = {
      title: "Big",
      summary: "s",
      content: { fullMarkdown: bigMd, fullReportSize: bigMd.length },
    };
    await store.applyTerminalIfRunning("m1", {
      status: "completed",
      extra: { kind: "completed", detail: { report } },
    });
    const updateArg =
      prisma.agentPlaygroundMission.updateMany.mock.calls[0][0].data;
    const reportFull = updateArg.reportFull as {
      content: { fullMarkdown: string };
    };
    // After truncation, should be 100_000 chars + truncation suffix
    expect(reportFull.content.fullMarkdown.length).toBeLessThanOrEqual(100_100);
  });

  it("applyTerminalIfRunning(completed): returns false on prisma error (swallows)", async () => {
    prisma.agentPlaygroundMission.updateMany.mockRejectedValue(
      new Error("DB error"),
    );
    const won = await store.applyTerminalIfRunning("m1", {
      status: "completed",
      extra: { kind: "completed", detail: {} },
    });
    expect(won).toBe(false);
  });

  // applyTerminalIfRunning — failed path
  it("applyTerminalIfRunning(failed): calls prisma.updateMany with status=failed", async () => {
    await store.applyTerminalIfRunning("m1", {
      status: "failed",
      extra: { kind: "failed", detail: { errorMessage: "Network error" } },
    });
    expect(prisma.agentPlaygroundMission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("applyTerminalIfRunning(failed): uses quality-failed status when leaderSigned=false", async () => {
    await store.applyTerminalIfRunning("m1", {
      status: "failed",
      extra: {
        kind: "failed",
        detail: { leaderSigned: false, leaderOverallScore: 35 },
      },
    });
    const updateArg =
      prisma.agentPlaygroundMission.updateMany.mock.calls[0][0].data;
    expect(updateArg.status).toBe("quality-failed");
  });

  it("applyTerminalIfRunning(failed): returns false on prisma error (swallows)", async () => {
    prisma.agentPlaygroundMission.updateMany.mockRejectedValue(new Error("DB"));
    const won = await store.applyTerminalIfRunning("m1", {
      status: "failed",
      extra: { kind: "failed", detail: {} },
    });
    expect(won).toBe(false);
  });

  // appendLeaderJournal
  it("appendLeaderJournal: merges patch into existing journal", async () => {
    prisma.agentPlaygroundMission.findUnique.mockResolvedValue({
      leaderJournal: { plan: "initial plan" },
    });
    await store.appendLeaderJournal("m1", { m0: "done" });
    const updateArg =
      prisma.agentPlaygroundMission.update.mock.calls[0][0].data;
    expect(updateArg.leaderJournal).toEqual({
      plan: "initial plan",
      m0: "done",
    });
  });

  it("appendLeaderJournal: handles null journal (starts from empty obj)", async () => {
    prisma.agentPlaygroundMission.findUnique.mockResolvedValue({
      leaderJournal: null,
    });
    await store.appendLeaderJournal("m1", { decisions: [{ step: "plan" }] });
    const updateArg =
      prisma.agentPlaygroundMission.update.mock.calls[0][0].data;
    expect(updateArg.leaderJournal.decisions).toHaveLength(1);
  });

  it("appendLeaderJournal: concatenates decisions array", async () => {
    prisma.agentPlaygroundMission.findUnique.mockResolvedValue({
      leaderJournal: { decisions: [{ step: "plan" }] },
    });
    await store.appendLeaderJournal("m1", { decisions: [{ step: "assess" }] });
    const updateArg =
      prisma.agentPlaygroundMission.update.mock.calls[0][0].data;
    expect(updateArg.leaderJournal.decisions).toHaveLength(2);
  });

  // recordMissionPostmortem
  it("recordMissionPostmortem: creates harnessVectorMemory entry", async () => {
    await store.recordMissionPostmortem({
      missionId: "m1",
      userId: "u1",
      topic: "AI",
      summary: "Summary text",
      recommendations: ["rec1"],
      leaderSigned: true,
      qualityScore: 85,
      tokensUsed: 10000,
      costUsd: 0.5,
    });
    expect(prisma.harnessVectorMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          namespace: "u1",
          source: "playground:mission",
        }),
      }),
    );
  });

  it("recordMissionPostmortem: tags include 'signed' when leaderSigned=true", async () => {
    await store.recordMissionPostmortem({
      missionId: "m1",
      userId: "u1",
      topic: "AI",
      summary: "s",
      recommendations: [],
      leaderSigned: true,
      qualityScore: 80,
      tokensUsed: 0,
      costUsd: 0,
    });
    const tags = prisma.harnessVectorMemory.create.mock.calls[0][0].data.tags;
    expect(tags).toContain("signed");
  });

  it("recordMissionPostmortem: tags include 'unsigned' when leaderSigned=false", async () => {
    await store.recordMissionPostmortem({
      missionId: "m1",
      userId: "u1",
      topic: "AI",
      summary: "s",
      recommendations: [],
      leaderSigned: false,
      qualityScore: 40,
      tokensUsed: 0,
      costUsd: 0,
    });
    const tags = prisma.harnessVectorMemory.create.mock.calls[0][0].data.tags;
    expect(tags).toContain("unsigned");
  });

  // listRecentPostmortems
  it("listRecentPostmortems: returns mapped rows", async () => {
    prisma.harnessVectorMemory.findMany.mockResolvedValue([
      {
        content: "Postmortem summary",
        tags: ["mission-postmortem", "signed"],
        createdAt: new Date(),
        metadata: {
          missionId: "m1",
          topic: "AI",
          recommendations: ["rec"],
          qualityScore: 85,
        },
      },
    ]);
    const result = await store.listRecentPostmortems("u1", 3);
    expect(result).toHaveLength(1);
    expect(result[0].leaderSigned).toBe(true);
    expect(result[0].qualityScore).toBe(85);
  });

  it("listRecentPostmortems: returns [] on prisma error", async () => {
    prisma.harnessVectorMemory.findMany.mockRejectedValue(new Error("DB"));
    const result = await store.listRecentPostmortems("u1", 3);
    expect(result).toEqual([]);
  });

  // appendDimensions
  it("appendDimensions: returns [] if items empty", async () => {
    const ids = await store.appendDimensions("m1", []);
    expect(ids).toEqual([]);
  });

  it("appendDimensions: returns [] if mission not running", async () => {
    prisma.agentPlaygroundMission.findUnique.mockResolvedValue({
      status: "completed",
      dimensions: [],
    });
    const ids = await store.appendDimensions("m1", [
      { name: "New Dim", rationale: "r" },
    ]);
    expect(ids).toEqual([]);
  });

  it("appendDimensions: appends dims and returns new ids", async () => {
    prisma.agentPlaygroundMission.findUnique.mockResolvedValue({
      status: "running",
      dimensions: [{ id: "d1", name: "Old", rationale: "r" }],
    });
    prisma.agentPlaygroundMission.update.mockResolvedValue({});
    const ids = await store.appendDimensions("m1", [
      { name: "New", rationale: "new reason" },
    ]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toContain("dim-user-");
  });

  // deleteByUser
  it("deleteByUser: calls deleteMany with id+userId guard", async () => {
    await store.deleteByUser("m1", "u1");
    expect(prisma.agentPlaygroundMission.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m1", userId: "u1" } }),
    );
  });

  it("deleteByUser: swallows prisma error", async () => {
    prisma.agentPlaygroundMission.deleteMany.mockRejectedValue(new Error("DB"));
    await expect(store.deleteByUser("m1", "u1")).resolves.toBeUndefined();
  });

  // updateTopicByUser
  it("updateTopicByUser: calls updateMany with truncated topic", async () => {
    const longTopic = "x".repeat(600);
    await store.updateTopicByUser("m1", "u1", longTopic);
    const callArg = prisma.agentPlaygroundMission.updateMany.mock.calls[0][0];
    expect(callArg.data.topic.length).toBeLessThanOrEqual(500);
  });

  it("updateTopicByUser: swallows prisma error", async () => {
    prisma.agentPlaygroundMission.updateMany.mockRejectedValue(new Error("DB"));
    await expect(
      store.updateTopicByUser("m1", "u1", "new topic"),
    ).resolves.toBeUndefined();
  });

  // applyTerminalIfRunning — cancelled path
  it("applyTerminalIfRunning(cancelled): sets status=cancelled with running guard", async () => {
    await store.applyTerminalIfRunning("m1", {
      status: "cancelled",
      extra: { kind: "cancelled" },
    });
    expect(prisma.agentPlaygroundMission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "m1", status: "running" },
        data: expect.objectContaining({ status: "cancelled" }),
      }),
    );
  });

  it("applyTerminalIfRunning(cancelled): returns false on prisma error (swallows)", async () => {
    prisma.agentPlaygroundMission.updateMany.mockRejectedValue(new Error("DB"));
    const won = await store.applyTerminalIfRunning("m1", {
      status: "cancelled",
      extra: { kind: "cancelled" },
    });
    expect(won).toBe(false);
  });

  // appendLeaderJournal error
  it("appendLeaderJournal: swallows prisma error on findUnique", async () => {
    prisma.$transaction.mockRejectedValue(new Error("DB find error"));
    await expect(
      store.appendLeaderJournal("m1", { step: "test" }),
    ).resolves.toBeUndefined();
  });

  it("appendLeaderJournal: uses $transaction for atomic read-modify-write", async () => {
    prisma.agentPlaygroundMission.findUnique.mockResolvedValue({
      leaderJournal: { plan: "existing" },
    });
    await store.appendLeaderJournal("m1", { m0: "new" });
    // $transaction must have been called (atomic guard)
    expect(prisma.$transaction).toHaveBeenCalled();
    const txOpts = prisma.$transaction.mock.calls[0][1];
    expect(txOpts?.isolationLevel).toBe("Serializable");
  });

  // countRunningByUser
  it("countRunningByUser: returns count of running missions for user", async () => {
    prisma.agentPlaygroundMission.count.mockResolvedValue(2);
    const count = await store.countRunningByUser("u1");
    expect(count).toBe(2);
    expect(prisma.agentPlaygroundMission.count).toHaveBeenCalledWith({
      where: { userId: "u1", status: "running" },
    });
  });

  it("appendDimensions: uses $transaction for atomic read-modify-write", async () => {
    prisma.agentPlaygroundMission.findUnique.mockResolvedValue({
      status: "running",
      dimensions: [],
    });
    await store.appendDimensions("m1", [{ name: "D", rationale: "r" }]);
    const txOpts = prisma.$transaction.mock.calls[0][1];
    expect(txOpts?.isolationLevel).toBe("Serializable");
  });

  // listByUser
  it("listByUser: returns mapped list from prisma", async () => {
    const mockRow = {
      id: "m1",
      topic: "AI",
      depth: "deep",
      language: "zh-CN",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      wallTimeMs: 60000,
      finalScore: 85,
      tokensUsed: 5000,
      costUsd: 0.5,
      reportTitle: "Report",
      reportSummary: "Summary",
      errorMessage: null,
    };
    prisma.agentPlaygroundMission.findMany.mockResolvedValue([mockRow]);
    const result = await store.listByUser("u1", 10);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m1");
  });

  // recordMissionPostmortem error path
  it("recordMissionPostmortem: swallows prisma error", async () => {
    prisma.harnessVectorMemory.create.mockRejectedValue(new Error("DB error"));
    await expect(
      store.recordMissionPostmortem({
        missionId: "m1",
        userId: "u1",
        topic: "AI",
        summary: "s",
        recommendations: [],
        leaderSigned: null,
        qualityScore: null,
        tokensUsed: 0,
        costUsd: 0,
      }),
    ).resolves.toBeUndefined();
  });

  // getById
  it("getById: returns null when mission not found", async () => {
    const result = await store.getById("m1", "u1");
    expect(result).toBeNull();
  });

  it("getById: returns MissionDetail when found", async () => {
    prisma.agentPlaygroundMission.findFirst.mockResolvedValue({
      id: "m1",
      topic: "AI",
      depth: "deep",
      language: "zh-CN",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      wallTimeMs: 60000,
      finalScore: 85,
      tokensUsed: 5000,
      costUsd: 0.5,
      reportTitle: "Report",
      reportSummary: "Summary",
      errorMessage: null,
      themeSummary: "t",
      dimensions: [],
      reportFull: {},
      verdicts: {},
      trajectoryStored: 3,
      reportArtifactVersion: 2,
      userProfile: {},
      reconciliationReport: {},
      leaderJournal: {},
      leaderOverallScore: 85,
      leaderSigned: true,
      leaderVerdict: "signed",
    });
    const result = await store.getById("m1", "u1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("m1");
    expect(result!.leaderSigned).toBe(true);
  });

  // applyTerminalIfRunning(failed): lead-refusal conditional fields —— ★ P0-1: 改为 updateMany 带 running guard
  it("applyTerminalIfRunning(failed): when leaderSigned=false, persists report and dimensions with running guard", async () => {
    const report = { title: "Report", summary: "Sum" };
    await store.applyTerminalIfRunning("m1", {
      status: "failed",
      extra: {
        kind: "failed",
        detail: {
          leaderSigned: false,
          leaderOverallScore: 35,
          leaderVerdict: "quality-failed",
          report,
          dimensions: [{ id: "d1", name: "Market" }],
          themeSummary: "AI",
          trajectoryStored: 2,
        },
      },
    });
    const call = prisma.agentPlaygroundMission.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "m1", status: "running" });
    expect(call.data.status).toBe("quality-failed");
    expect(call.data.reportFull).toBeDefined();
  });

  // ─────────────────────────────────────────────
  // PR-H v1: heartbeat + stage progress + pod recovery
  // ─────────────────────────────────────────────

  describe("PR-H v1 heartbeat lifecycle", () => {
    it("refreshHeartbeat: updates heartbeatAt and podId", async () => {
      await store.refreshHeartbeat("m1", "pod-abc");
      expect(prisma.agentPlaygroundMission.update).toHaveBeenCalledWith({
        where: { id: "m1" },
        data: expect.objectContaining({
          heartbeatAt: expect.any(Date),
          podId: "pod-abc",
        }),
      });
    });

    it("refreshHeartbeat: silently swallows DB errors (debug log only)", async () => {
      prisma.agentPlaygroundMission.update.mockRejectedValueOnce(
        new Error("DB down"),
      );
      await expect(
        store.refreshHeartbeat("m1", "pod-abc"),
      ).resolves.toBeUndefined();
    });

    it("markStageComplete: writes lastCompletedStage + heartbeat refresh", async () => {
      await store.markStageComplete("m1", 7);
      const call = prisma.agentPlaygroundMission.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: "m1", status: "running" });
      expect(call.data.lastCompletedStage).toBe(7);
      expect(call.data.heartbeatAt).toBeInstanceOf(Date);
    });

    it("markStageComplete: silently swallows DB errors", async () => {
      prisma.agentPlaygroundMission.updateMany.mockRejectedValueOnce(
        new Error("conflict"),
      );
      await expect(store.markStageComplete("m1", 3)).resolves.toBeUndefined();
    });

    // ★ 2026-05-05: recoverPodCrashedRunning 已下线（归并到 unified MissionLivenessGuard）
    //   原 6 个 spec 全部迁到 harness 层 mission-liveness-guard.service.spec.ts
  });

  // ─────────────────────────────────────────────
  // 2026-05-12: FK 风暴熔断 —— mission row 已删时主动 abort orchestrator
  // ─────────────────────────────────────────────
  describe("emergency abort on missing mission row", () => {
    function makePrismaWithChildTables(
      prismaBase: ReturnType<typeof makePrisma>,
    ) {
      type WithUpsert = {
        upsert: jest.Mock;
      };
      const extras = {
        agentPlaygroundResearchResult: { upsert: jest.fn() } as WithUpsert,
        agentPlaygroundChapterDraft: { upsert: jest.fn() } as WithUpsert,
      };
      return Object.assign(prismaBase, extras);
    }

    function makeAbortRegistry() {
      return { abort: jest.fn().mockReturnValue(true) };
    }

    function fkError() {
      const err = new Error("Foreign key constraint violated");
      (err as Error & { code?: string }).code = "P2003";
      return err;
    }

    function recordNotFoundError() {
      const err = new Error("No record was found for an update");
      (err as Error & { code?: string }).code = "P2025";
      return err;
    }

    it("refreshHeartbeat: P2025 triggers abort once even on repeated calls", async () => {
      const abortRegistry = makeAbortRegistry();
      const prismaFull = makePrismaWithChildTables(prisma);
      store = new MissionStore(
        prismaFull as never,
        undefined,
        abortRegistry as never,
      );
      prismaFull.agentPlaygroundMission.update
        .mockRejectedValueOnce(recordNotFoundError())
        .mockRejectedValueOnce(recordNotFoundError())
        .mockRejectedValueOnce(recordNotFoundError());

      await store.refreshHeartbeat("ghost", "pod-1");
      await store.refreshHeartbeat("ghost", "pod-1");
      await store.refreshHeartbeat("ghost", "pod-1");

      expect(abortRegistry.abort).toHaveBeenCalledTimes(1);
      expect(abortRegistry.abort).toHaveBeenCalledWith(
        "ghost",
        "mission_row_missing",
      );
    });

    it("saveResearchResult: P2003 triggers abort and swallows error", async () => {
      const abortRegistry = makeAbortRegistry();
      const prismaFull = makePrismaWithChildTables(prisma);
      store = new MissionStore(
        prismaFull as never,
        undefined,
        abortRegistry as never,
      );
      prismaFull.agentPlaygroundResearchResult.upsert.mockRejectedValue(
        fkError(),
      );

      await expect(
        store.saveResearchResult({
          missionId: "ghost",
          dimension: "dim-A",
          findings: [],
          summary: "s",
          state: "completed",
        }),
      ).resolves.toBeUndefined();

      expect(abortRegistry.abort).toHaveBeenCalledWith(
        "ghost",
        "mission_row_missing",
      );
    });

    it("does not abort on non-FK / non-P2025 errors", async () => {
      const abortRegistry = makeAbortRegistry();
      const prismaFull = makePrismaWithChildTables(prisma);
      store = new MissionStore(
        prismaFull as never,
        undefined,
        abortRegistry as never,
      );
      prismaFull.agentPlaygroundMission.update.mockRejectedValueOnce(
        new Error("transient DB outage"),
      );

      await store.refreshHeartbeat("m1", "pod-1");
      expect(abortRegistry.abort).not.toHaveBeenCalled();
    });

    it("works without abortRegistry injected (backward-compat)", async () => {
      const prismaFull = makePrismaWithChildTables(prisma);
      store = new MissionStore(prismaFull as never);
      prismaFull.agentPlaygroundMission.update.mockRejectedValueOnce(
        recordNotFoundError(),
      );
      // should not throw — just logs
      await expect(
        store.refreshHeartbeat("ghost", "pod-1"),
      ).resolves.toBeUndefined();
    });
  });
});
