import {
  Injectable,
  Logger,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { USER_EVENT_NAME, type UserEventPayload } from "./user-event.types";

/**
 * UserEventListener —— 统一用户事件落库（运营看板 W1, PRD §4.2 / §4.6）
 *
 * 订阅 EventEmitter2 的 'user.event'（11 个 ai-app 业务节点 `void this.events.emit(...)` 发出），
 * 内存缓冲 + 批量 flush 到 user_events 表。挂在 @Global ObservabilityModule 的 providers，
 * 模块已全局加载 → listener 被 EventEmitter 自动注册，W1 真正零侵入（不碰 app.module.ts）。
 *
 * 落库范式参考 CostAttributionService（pendingEvents / FLUSH_INTERVAL_MS / FLUSH_BATCH_SIZE /
 * createMany / onModuleDestroy），但补齐它缺失的「背压三件套」（PRD §4.2 must-fix#7）：
 *   1. buffer 上限 5000：超限丢最旧 + warn 计数（保护进程不 OOM）。
 *   2. flush 失败重试有上限（MAX_FLUSH_RETRIES）：超限丢弃 + warn，不无限 unshift 递归 drain。
 *   3. 不用 skipDuplicates：随机 uuid 主键上是 no-op，去掉以免误导；可靠性靠 W3 业务表回填对账兜底。
 *
 * 韧性：落库失败只 logger.warn 不抛（运营埋点不得拖垮业务主链路）。
 */
@Injectable()
export class UserEventListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UserEventListener.name);

  private readonly buffer: UserEventPayload[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  /** 5min 定时 flush。 */
  private readonly FLUSH_INTERVAL_MS = 5 * 60 * 1000;
  /** 缓冲达 500 条触发 flush；单次 createMany 也以此为批大小。 */
  private readonly FLUSH_BATCH_SIZE = 500;
  /** buffer 上限：超限丢最旧（背压三件套 #1）。 */
  private readonly MAX_BUFFER_SIZE = 5000;
  /** flush 连续失败重试上限：超限丢弃当前批（背压三件套 #2）。 */
  private readonly MAX_FLUSH_RETRIES = 3;

  /** flush 互斥：避免定时器与达阈触发并发重复落库。 */
  private flushing = false;
  /** 累计因 buffer 满被丢弃的事件数（仅观测用）。 */
  private droppedByOverflow = 0;
  /** 当前批连续 flush 失败次数。 */
  private consecutiveFailures = 0;

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  onModuleInit(): void {
    if (!this.prisma) {
      this.logger.warn(
        "PrismaService unavailable — user.event persistence disabled",
      );
      return;
    }
    this.flushInterval = setInterval(() => {
      void this.flush();
    }, this.FLUSH_INTERVAL_MS).unref();
    this.logger.log(
      `UserEvent persistence enabled, flush interval ${this.FLUSH_INTERVAL_MS / 1000}s, batch ${this.FLUSH_BATCH_SIZE}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    // 收尾 flush（best-effort，失败只 warn）。
    if (this.prisma && this.buffer.length > 0) {
      await this.flush();
    }
  }

  @OnEvent(USER_EVENT_NAME)
  handle(payload: UserEventPayload): void {
    if (!this.prisma) return;

    // 背压三件套 #1：buffer 上限，超限丢最旧 + warn 计数。
    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      this.buffer.shift();
      this.droppedByOverflow++;
      if (this.droppedByOverflow % 100 === 1) {
        this.logger.warn(
          `user.event buffer full (${this.MAX_BUFFER_SIZE}), dropped oldest; total dropped=${this.droppedByOverflow}`,
        );
      }
    }

    this.buffer.push(payload);

    if (this.buffer.length >= this.FLUSH_BATCH_SIZE) {
      void this.flush();
    }
  }

  /**
   * 批量落库。一次最多取 FLUSH_BATCH_SIZE 条；不递归 drain（避免持续抖动时栈/内存失控）。
   * 失败：背压三件套 #2 —— 重试上限内 unshift 回缓冲等下次；超限直接丢弃当前批 + warn。
   */
  async flush(): Promise<number> {
    if (!this.prisma || this.flushing || this.buffer.length === 0) {
      return 0;
    }
    this.flushing = true;

    const batch = this.buffer.splice(0, this.FLUSH_BATCH_SIZE);
    try {
      await this.prisma.userEvent.createMany({
        data: batch.map((e) => ({
          userId: e.userId,
          module: e.module,
          action: e.action,
          resourceType: e.resourceType ?? null,
          resourceId: e.resourceId ?? null,
          topicKey: e.topicKey ?? null,
          success: e.success ?? null,
          metadata:
            e.metadata === undefined
              ? undefined
              : (e.metadata as Prisma.InputJsonValue),
          createdAt: e.createdAt ?? new Date(),
        })),
        // 不用 skipDuplicates：随机 uuid 主键上是 no-op（不去重），去掉以免误导。
        // 重启幂等靠 W3 业务表状态回填对账兜底。
      });
      this.consecutiveFailures = 0;
      this.flushing = false;
      return batch.length;
    } catch (error) {
      this.consecutiveFailures++;
      const msg = error instanceof Error ? error.message : String(error);

      if (this.consecutiveFailures <= this.MAX_FLUSH_RETRIES) {
        // 退回缓冲等下次定时/达阈重试；保持时序把这批放回队首。
        this.buffer.unshift(...batch);
        this.logger.warn(
          `user.event flush failed (retry ${this.consecutiveFailures}/${this.MAX_FLUSH_RETRIES}), ${batch.length} re-queued: ${msg}`,
        );
      } else {
        // 超限丢弃当前批，不无限 unshift 递归（DB 持续抖动时防 OOM）。
        this.logger.warn(
          `user.event flush failed > ${this.MAX_FLUSH_RETRIES} retries, dropping ${batch.length} events: ${msg}`,
        );
        this.consecutiveFailures = 0;
      }
      this.flushing = false;
      return 0;
    }
  }

  /** 当前缓冲事件数（观测/测试用）。 */
  getPendingCount(): number {
    return this.buffer.length;
  }
}
