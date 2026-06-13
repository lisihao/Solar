import {
  AUTO_RECOVERED_EVENT,
  MissionAutoRecoveryService,
} from "../mission-auto-recovery.service";
import type { PrismaService } from "../../../../../../common/prisma/prisma.service";
import type {
  EventBus,
  MissionCheckpointService,
} from "@/modules/ai-harness/facade";
import type { MissionRerunOrchestratorService } from "../mission-rerun-orchestrator.service";

describe("MissionAutoRecoveryService", () => {
  const count = jest.fn();
  const canResume = jest.fn();
  const emit = jest.fn().mockResolvedValue(undefined);
  const rerunFullMission = jest.fn().mockResolvedValue({ missionId: "m-1" });

  const prisma = {
    agentPlaygroundMissionEvent: { count },
  } as unknown as PrismaService;
  const checkpoint = { canResume } as unknown as MissionCheckpointService;
  const eventBus = { emit } as unknown as EventBus;
  const orchestrator = {
    rerunFullMission,
  } as unknown as MissionRerunOrchestratorService;

  const mk = (withOrchestrator = true) =>
    new MissionAutoRecoveryService(
      prisma,
      checkpoint,
      eventBus,
      withOrchestrator ? orchestrator : undefined,
    );

  beforeEach(() => {
    count.mockReset().mockResolvedValue(0);
    canResume.mockReset().mockResolvedValue({ canResume: true, reason: "ok" });
    emit.mockClear();
    rerunFullMission.mockClear().mockResolvedValue({ missionId: "m-1" });
    delete process.env.PLAYGROUND_AUTO_RECOVERY;
  });

  it("成功路径：incremental 原地续跑 + 发审计事件（计数 +1 的来源）", async () => {
    const ok = await mk().attemptAfterStaleKill("m-1", "u-1");
    expect(ok).toBe(true);
    expect(rerunFullMission).toHaveBeenCalledWith("m-1", "u-1", "incremental");
    const ev = emit.mock.calls[0][0];
    expect(ev.type).toBe(AUTO_RECOVERED_EVENT);
    expect(ev.payload).toMatchObject({ trigger: "liveness-stale", attempt: 1 });
  });

  it("护栏：终生最多 1 次 — 已有审计事件时不再恢复", async () => {
    count.mockResolvedValue(1);
    const ok = await mk().attemptAfterStaleKill("m-1", "u-1");
    expect(ok).toBe(false);
    expect(rerunFullMission).not.toHaveBeenCalled();
  });

  it("护栏：计数查询失败按已达上限处理（fail-closed，宁可不恢复不循环烧钱）", async () => {
    count.mockRejectedValue(new Error("db down"));
    const ok = await mk().attemptAfterStaleKill("m-1", "u-1");
    expect(ok).toBe(false);
    expect(rerunFullMission).not.toHaveBeenCalled();
  });

  it("护栏：canResume 不通过（无 checkpoint / 过窗）不恢复", async () => {
    canResume.mockResolvedValue({ canResume: false, reason: "expired" });
    const ok = await mk().attemptAfterStaleKill("m-1", "u-1");
    expect(ok).toBe(false);
    expect(rerunFullMission).not.toHaveBeenCalled();
  });

  it("护栏：PLAYGROUND_AUTO_RECOVERY=false 整体关闭", async () => {
    process.env.PLAYGROUND_AUTO_RECOVERY = "false";
    const ok = await mk().attemptAfterStaleKill("m-1", "u-1");
    expect(ok).toBe(false);
    expect(count).not.toHaveBeenCalled();
  });

  it("orchestrator 未装配时优雅跳过", async () => {
    const ok = await mk(false).attemptAfterStaleKill("m-1", "u-1");
    expect(ok).toBe(false);
  });

  it("续跑抛错（guard 拒绝 / 配置缺失）→ 返回 false 维持 failed，不发审计事件", async () => {
    rerunFullMission.mockRejectedValue(new Error("rerun guard rejected"));
    const ok = await mk().attemptAfterStaleKill("m-1", "u-1");
    expect(ok).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});
