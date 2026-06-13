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
} {
  const update = jest.fn().mockResolvedValue({});
  // ★ 终态走仲裁后：done/failed 终态写经 finalizeIfNotCancelled → updateMany。
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = { companyMission: { update, updateMany } };
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
  return { service, updateMany };
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

describe("CompanyMissionService acceptance gate", () => {
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
});
