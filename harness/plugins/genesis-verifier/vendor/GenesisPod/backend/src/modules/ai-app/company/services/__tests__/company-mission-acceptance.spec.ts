/**
 * 验收 gate（rubric 上运行路径）行为测试。
 *
 * 覆盖护城河命门 + react-runaway 看护：
 *   - 跑成功但 reviewVerdict.score < passThreshold → 重跑，但封顶 maxAttempts（不死循环）
 *   - 达封顶仍不达标 → 以 status=done + result.review.passed=false 收口（展示报告 + 低分）
 *   - 达标（score >= 阈值）→ 一次通过，passed=true
 *
 * 用最小 mock 直接驱动私有 runViaCapability（不接真 LLM / 真 DB）。
 */
import { CompanyMissionService } from "../company-mission.service";

interface FakeRunner {
  manifest: {
    id: string;
    rubric: { passThreshold: number; maxAttempts: number };
  };
  run: jest.Mock;
}

function makeRunner(score: number): FakeRunner {
  return {
    manifest: {
      id: "deep-insight",
      rubric: { passThreshold: 60, maxAttempts: 2 },
    },
    run: jest.fn().mockResolvedValue({
      status: "completed",
      report: "report-body",
      references: [],
      reviewVerdict: { score },
    }),
  };
}

function makeService(): {
  service: CompanyMissionService;
  updateMany: jest.Mock;
  findMany: jest.Mock;
} {
  const update = jest.fn().mockResolvedValue({});
  // ★ 终态走仲裁后：done/failed 终态写经 finalizeIfNotCancelled → updateMany。
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findUnique = jest.fn().mockResolvedValue({ result: {} });
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { companyMission: { update, updateMany, findUnique, findMany } };
  const eventBus = { emit: jest.fn().mockResolvedValue(undefined) };
  // 其余依赖在 runViaCapability 的本测试路径上不被触达 → 空对象兜底。
  //   第 9 参 persistenceAdapter：本测试 runner 为 mock，不触达 ctx.persistence → 空兜底。
  const service = new CompanyMissionService(
    prisma as never,
    eventBus as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, updateMany, findMany };
}

/** 取最后一次 status:"done" 终态写（updateMany）的 result.review。 */
function lastReview(write: jest.Mock): Record<string, unknown> | undefined {
  const doneCall = [...write.mock.calls]
    .reverse()
    .find((c) => c[0]?.data?.status === "done");
  return doneCall?.[0]?.data?.result?.review as
    | Record<string, unknown>
    | undefined;
}

function lastDoneResult(write: jest.Mock): Record<string, unknown> | undefined {
  const doneCall = [...write.mock.calls]
    .reverse()
    .find((c) => c[0]?.data?.status === "done");
  return doneCall?.[0]?.data?.result as Record<string, unknown> | undefined;
}

describe("CompanyMissionService acceptance gate", () => {
  it("运行中进度写必须带 running 状态条件，不能污染已终态 mission", async () => {
    const { service, updateMany } = makeService();

    await (
      service as unknown as {
        updateMission: (id: string, data: Record<string, unknown>) => Promise<void>;
      }
    ).updateMission("m-live", {
      progress: 5,
      result: { live: true, steps: [{ status: "running" }] },
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "m-live",
          status: { in: ["queued", "running", "review"] },
        },
      }),
    );
  });

  it("低分 → 重跑但封顶 maxAttempts（不死循环），最终 passed=false 收口", async () => {
    const { service, updateMany } = makeService();
    const runner = makeRunner(40); // < passThreshold 60

    await (
      service as unknown as {
        runViaCapability: (...a: unknown[]) => Promise<void>;
      }
    ).runViaCapability("m1", "u1", "topic", runner);

    // 封顶：恰好跑 maxAttempts(2) 次，不无限重跑
    expect(runner.run).toHaveBeenCalledTimes(2);
    const review = lastReview(updateMany);
    expect(review?.passed).toBe(false);
    expect(review?.attempts).toBe(2);
    expect(review?.score).toBe(40);
  });

  it("达标分 → 一次通过，passed=true，不重跑", async () => {
    const { service, updateMany } = makeService();
    const runner = makeRunner(80); // >= 60

    await (
      service as unknown as {
        runViaCapability: (...a: unknown[]) => Promise<void>;
      }
    ).runViaCapability("m2", "u2", "topic", runner);

    expect(runner.run).toHaveBeenCalledTimes(1);
    const review = lastReview(updateMany);
    expect(review?.passed).toBe(true);
    expect(review?.score).toBe(80);
    expect(review?.attempts).toBe(1);
  });

  it("完成报告后不让中间维度失败污染最终任务列表", async () => {
    const { service, updateMany } = makeService();
    const runner: FakeRunner = {
      manifest: {
        id: "deep-insight-solar",
        rubric: { passThreshold: 60, maxAttempts: 2 },
      },
      run: jest.fn().mockResolvedValue({
        status: "completed",
        report: "final report",
        references: [],
        reviewVerdict: { score: 90 },
        dimensionPipelines: {
          "维度 A": { state: "failed" },
          "维度 B": { state: "completed" },
        },
        stageOutputs: {
          researcherResults: [{ dimension: "维度 B" }],
        },
      }),
    };

    await (
      service as unknown as {
        runViaCapability: (...a: unknown[]) => Promise<void>;
      }
    ).runViaCapability("m3", "u3", "topic", runner);

    const result = lastDoneResult(updateMany);
    const steps = result?.steps as Array<{
      status?: string;
      sourceStatus?: string;
      statusLabel?: string;
    }>;
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.status)).toEqual(["degraded", "done"]);
    expect(steps[0]?.sourceStatus).toBe("failed");
    expect(steps[0]?.statusLabel).toBe("报告已交付，原始研究维度降级");
  });

  it("运行中 dimension:graded failed 不能被投影成 done", async () => {
    const { service, updateMany } = makeService();

    await (
      service as unknown as {
        bridgeCapabilityEvent: (
          missionId: string,
          userId: string,
          event: Record<string, unknown>,
        ) => Promise<void>;
      }
    ).bridgeCapabilityEvent("m4", "u4", {
      type: "domain",
      payload: {
        event: "dimension:graded",
        data: {
          dimension: "维度失败",
          state: "failed",
          action: "failed",
          grade: "F",
          overall: 0,
        },
      },
    });

    const liveWrite = [...updateMany.mock.calls]
      .reverse()
      .find((c) => c[0]?.data?.result?.live === true);
    const steps = liveWrite?.[0]?.data?.result?.steps as
      | Array<{ status?: string; dimension?: string }>
      | undefined;
    expect(steps).toEqual([
      { label: "维度失败", role: "Researcher", dimension: "维度失败", status: "failed" },
    ]);
  });

  it("运行中旧脏 steps 全 done 时按 checkpoint 追加当前 in-flight 阶段", async () => {
    const { service, findMany } = makeService();
    findMany.mockResolvedValue([
      {
        id: "m5",
        userId: "u5",
        status: "running",
        result: {
          steps: [
            { label: "维度 A", role: "Researcher", status: "done" },
            { label: "维度 B", role: "Researcher", status: "done" },
          ],
          __checkpoint: {
            lastStepId: "s5-reconciler",
            inFlightStepId: "s6-analyst",
          },
        },
      },
    ]);

    const missions = await service.listMissions("u5");
    const result = missions[0]?.result as {
      steps?: Array<{ status?: string; stepId?: string }>;
    };
    expect(result.steps?.map((s) => s.status)).toEqual([
      "done",
      "done",
      "running",
    ]);
    expect(result.steps?.at(-1)?.stepId).toBe("s6-analyst");
  });
});
