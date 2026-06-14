import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { CacheService } from "../../../../../../common/cache/cache.service";

/**
 * RadarBriefingQueueService — K3 限流闸（X5）
 *
 * 来源：docs/architecture/ai-app/radar/daily-briefing-redesign-2026-05-18.md §8.3 K3
 *
 * 三层闸：
 * 1. BullMQ queue 'radar-briefing' 全局 concurrency=20（worker limiter）
 * 2. 每用户每天 <=10 briefing（Redis INCR + EXPIRE 24h）
 * 3. weekly + daily 共享同 queue 避免 SMTP 风暴
 *
 * 用法：caller scheduler 调 enqueue()，超额返回 'rate-limited'
 * 配套 worker 由 caller 注册（本 service 只管 queue + quota）
 */
@Injectable()
export class RadarBriefingQueueService {
  static readonly QUEUE_NAME = "radar-briefing";
  static readonly USER_DAILY_QUOTA = 10;
  static readonly WORKER_CONCURRENCY = 20;

  private readonly log = new Logger(RadarBriefingQueueService.name);

  constructor(
    @InjectQueue(RadarBriefingQueueService.QUEUE_NAME)
    private readonly queue: Queue,
    private readonly cache: CacheService,
  ) {}

  /**
   * 入队前用户配额校验 + 入队
   * @returns { enqueued: boolean; reason?: 'rate-limited'; jobId?: string }
   */
  async enqueue(
    userId: string,
    payload: {
      type: "daily" | "weekly";
      topicId: string;
      briefingDate?: string;
    },
  ): Promise<{ enqueued: boolean; reason?: "rate-limited"; jobId?: string }> {
    const today = new Date().toISOString().slice(0, 10);
    const key = `radar:briefing:user-quota:${userId}:${today}`;
    let count: number;
    try {
      count = await this.cache.incrby(key, 1);
      if (count === 1) await this.cache.expire(key, 86400);
    } catch (err) {
      // fail-open: Redis 故障不阻塞 briefing
      this.log.warn(
        `quota incrby failed (fail-open): ${(err as Error).message}`,
      );
      count = 0;
    }
    if (count > RadarBriefingQueueService.USER_DAILY_QUOTA) {
      this.log.warn(
        `radar-briefing rate-limited: user=${userId} count=${count}`,
      );
      return { enqueued: false, reason: "rate-limited" };
    }
    const job = await this.queue.add(payload.type, payload, {
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 86400 * 7 },
    });
    return { enqueued: true, jobId: job.id };
  }

  /** 当前 queue 健康（测试 + observability 用） */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    failed: number;
  }> {
    const [waiting, active, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getFailedCount(),
    ]);
    return { waiting, active, failed };
  }
}
