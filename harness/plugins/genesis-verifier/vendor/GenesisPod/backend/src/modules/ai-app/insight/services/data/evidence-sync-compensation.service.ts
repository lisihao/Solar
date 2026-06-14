/**
 * Evidence Sync Compensation Service
 * 证据同步补偿服务
 *
 * 处理双写模式下 Engine Evidence 写入失败的补偿重试
 * ★ 策略：内存队列 + 定期重试
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { TeamFacade } from "@/modules/ai-harness/facade";
import type { SaveEvidenceRequest } from "@/modules/ai-harness/facade";

/**
 * 待补偿的证据记录
 */
interface PendingEvidenceSync {
  id: string;
  topicEvidenceId: string;
  request: SaveEvidenceRequest;
  retryCount: number;
  lastError: string;
  createdAt: Date;
  lastRetryAt?: Date;
}

/**
 * 补偿结果统计
 */
export interface CompensationStats {
  pendingCount: number;
  successCount: number;
  failedCount: number;
  permanentlyFailedCount: number;
}

@Injectable()
export class EvidenceSyncCompensationService implements OnModuleDestroy {
  private readonly logger = new Logger(EvidenceSyncCompensationService.name);

  /** 待补偿队列 */
  private readonly pendingQueue = new Map<string, PendingEvidenceSync>();
  /** 永久失败记录（超过最大重试次数） */
  private readonly permanentlyFailed = new Map<string, PendingEvidenceSync>();

  /** 最大重试次数 */
  private readonly MAX_RETRIES = 3;
  /** 重试间隔（毫秒） */
  private readonly RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟
  /** 队列最大容量 */
  private readonly MAX_QUEUE_SIZE = 1000;

  /** 补偿成功计数 */
  private successCount = 0;
  /** 补偿失败计数 */
  private failedCount = 0;

  /** 定时器 */
  private retryIntervalId?: NodeJS.Timeout;

  constructor(private readonly teamFacade: TeamFacade) {
    // 启动定期重试任务
    this.startRetryTask();
  }

  onModuleDestroy(): void {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
    }
  }

  /**
   * 启动定期重试任务
   */
  private startRetryTask(): void {
    this.retryIntervalId = setInterval(() => {
      void this.processRetryQueue();
    }, this.RETRY_INTERVAL_MS).unref();
  }

  /**
   * 添加待补偿记录
   */
  queueForRetry(
    topicEvidenceId: string,
    request: SaveEvidenceRequest,
    error: string,
  ): void {
    // 检查队列容量
    if (this.pendingQueue.size >= this.MAX_QUEUE_SIZE) {
      this.logger.warn(
        `Compensation queue is full (${this.MAX_QUEUE_SIZE}), dropping oldest entry`,
      );
      // 移除最旧的记录
      const oldestId = this.pendingQueue.keys().next().value;
      if (oldestId) {
        this.pendingQueue.delete(oldestId);
      }
    }

    const id = `${topicEvidenceId}_${Date.now()}`;
    this.pendingQueue.set(id, {
      id,
      topicEvidenceId,
      request,
      retryCount: 0,
      lastError: error,
      createdAt: new Date(),
    });

    this.logger.debug(
      `Queued evidence ${topicEvidenceId} for compensation, queue size: ${this.pendingQueue.size}`,
    );
  }

  /**
   * 处理重试队列
   */
  async processRetryQueue(): Promise<void> {
    if (this.pendingQueue.size === 0) return;

    this.logger.debug(
      `Processing compensation queue: ${this.pendingQueue.size} pending`,
    );

    const toRetry = Array.from(this.pendingQueue.values());
    let processed = 0;
    let succeeded = 0;

    for (const entry of toRetry) {
      try {
        const saveResult = this.teamFacade.evidenceSave(entry.request);
        if (!saveResult)
          throw new ServiceUnavailableException(
            "EvidenceManager not available",
          );
        await saveResult;

        // 成功：从队列中移除
        this.pendingQueue.delete(entry.id);
        this.successCount++;
        succeeded++;

        this.logger.debug(
          `Compensation succeeded for ${entry.topicEvidenceId} after ${entry.retryCount + 1} attempts`,
        );
      } catch (error) {
        entry.retryCount++;
        entry.lastRetryAt = new Date();
        entry.lastError =
          error instanceof Error ? error.message : String(error);

        if (entry.retryCount >= this.MAX_RETRIES) {
          // 超过最大重试次数，移入永久失败队列
          this.pendingQueue.delete(entry.id);
          this.permanentlyFailed.set(entry.id, entry);
          this.failedCount++;

          this.logger.error(
            `Compensation permanently failed for ${entry.topicEvidenceId} after ${this.MAX_RETRIES} attempts: ${entry.lastError}`,
          );
        }
      }

      processed++;
    }

    this.logger.log(
      `Compensation batch completed: ${succeeded}/${processed} succeeded, ` +
        `pending: ${this.pendingQueue.size}, permanently failed: ${this.permanentlyFailed.size}`,
    );
  }

  /**
   * 获取补偿统计
   */
  getStats(): CompensationStats {
    return {
      pendingCount: this.pendingQueue.size,
      successCount: this.successCount,
      failedCount: this.failedCount,
      permanentlyFailedCount: this.permanentlyFailed.size,
    };
  }

  /**
   * 获取待补偿队列详情（用于调试）
   */
  getPendingEntries(): PendingEvidenceSync[] {
    return Array.from(this.pendingQueue.values());
  }

  /**
   * 获取永久失败记录（用于调试）
   */
  getPermanentlyFailedEntries(): PendingEvidenceSync[] {
    return Array.from(this.permanentlyFailed.values());
  }

  /**
   * 手动触发重试
   */
  async triggerRetry(): Promise<void> {
    await this.processRetryQueue();
  }

  /**
   * 清空永久失败记录（手动确认后）
   */
  clearPermanentlyFailed(): void {
    const count = this.permanentlyFailed.size;
    this.permanentlyFailed.clear();
    this.logger.log(`Cleared ${count} permanently failed entries`);
  }
}
