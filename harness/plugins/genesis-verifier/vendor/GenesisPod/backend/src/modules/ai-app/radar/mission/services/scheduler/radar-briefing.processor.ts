/**
 * RadarBriefingProcessor — PR-DR2 P0-8 (X8 PM 评审整改)
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §8.3 K3 + §11.2 验收 1
 *
 * 职责：
 * - 消费 BullMQ queue 'radar-briefing' 的 'daily' 和 'weekly' job
 * - daily → DailyBriefingGeneratorService.generateForTopic
 * - weekly → RadarWeeklyBriefingService.generateAndPersist
 *
 * Worker concurrency = RadarBriefingQueueService.WORKER_CONCURRENCY (20)
 */
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "@/common/prisma/prisma.service";
import { withUserContext } from "@/common/context/with-user-context";
import { DailyBriefingGeneratorService } from "../briefing/daily-briefing-generator.service";
import { RadarBriefingQueueService } from "./radar-briefing-queue.service";

interface DailyJobPayload {
  type: "daily";
  topicId: string;
  briefingDate: string;
}

interface WeeklyJobPayload {
  type: "weekly";
  topicId: string;
}

type BriefingJobPayload = DailyJobPayload | WeeklyJobPayload;

@Processor(RadarBriefingQueueService.QUEUE_NAME, {
  concurrency: RadarBriefingQueueService.WORKER_CONCURRENCY,
})
export class RadarBriefingProcessor extends WorkerHost {
  private readonly log = new Logger(RadarBriefingProcessor.name);

  constructor(
    private readonly dailyGenerator: DailyBriefingGeneratorService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<BriefingJobPayload>): Promise<{
    status: string;
    selectedCount?: number;
  }> {
    const t0 = Date.now();
    const missionId = `briefing-job-${job.id ?? "no-id"}`;

    try {
      if (job.name === "daily" && job.data.type === "daily") {
        const { topicId, briefingDate } = job.data;
        // 需要 userId — 从 RadarDailyBriefingRepo upsert 内部已强制 userId from topic.userId
        // 这里查 topic.userId 注入给 generator
        const result = await this.handleDaily(missionId, topicId, briefingDate);
        this.log.log(
          `[${missionId}] daily ok topic=${topicId} status=${result.status} selected=${result.selectedCount} elapsed=${Date.now() - t0}ms`,
        );
        return result;
      }

      if (job.name === "weekly" && job.data.type === "weekly") {
        // weekly 由 sweepWeeklyBriefing 直接同步生成 + dispatch（B8）
        // 这里只是兜底入队场景：调 weeklyService（暂用 stub，PR-DR3 完善）
        this.log.warn(
          `[${missionId}] weekly via queue is rarely used — fallback path; topic=${job.data.topicId}`,
        );
        return { status: "skipped" };
      }

      this.log.warn(`[${missionId}] unknown job name=${job.name}`);
      return { status: "unknown" };
    } catch (err) {
      this.log.error(
        `[${missionId}] job failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err; // BullMQ retry (attempts:2 + exponential backoff per queue config)
    }
  }

  private async handleDaily(
    missionId: string,
    topicId: string,
    briefingDate: string,
  ): Promise<{ status: string; selectedCount: number }> {
    const topic = await this.prisma.radarTopic.findUnique({
      where: { id: topicId },
      select: { userId: true },
    });
    if (!topic) {
      this.log.warn(`[${missionId}] topic ${topicId} not found — skip`);
      return { status: "skipped", selectedCount: 0 };
    }
    // ★ 2026-05-28 BYOK：BullMQ worker 脱离 HTTP RequestContext，必须显式用
    //   job 里的 userId 重建上下文，否则下游 search/LLM 的 BYOK 解析（依赖
    //   RequestContext.getUserId()）拿不到 userId → STRICT 模式被绕过 / 静默退化。
    const result = await withUserContext(topic.userId, () =>
      this.dailyGenerator.generateForTopic({
        topicId,
        userId: topic.userId,
        briefingDate,
        missionId,
      }),
    );
    return { status: result.status, selectedCount: result.selectedCount };
  }
}
