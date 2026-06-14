import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../common/prisma/prisma.service";

import { LINK_HEALTH } from "./link-health.constants";
import { ResourceLifecycleService } from "./resource-lifecycle.service";

interface CheckResult {
  ok: boolean;
  reason: string;
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

function isYoutubeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return YOUTUBE_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * 资源链接健康检查调度器
 * 定期通过 HTTP HEAD 请求检查资源 sourceUrl/pdfUrl 的可访问性
 */
@Injectable()
export class ResourceHealthCheckScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ResourceHealthCheckScheduler.name);
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  private readonly CHECK_INTERVAL_MS: number;
  private readonly BATCH_SIZE = 100;
  private readonly BATCH_DELAY_MS = 500;
  private readonly HEAD_TIMEOUT_MS = 15000;
  private readonly FAIL_THRESHOLD = 3;
  // YouTube 删除/私有信号确定（oEmbed 401/404），单次失败即可定性，无需 3 次冗余确认
  private readonly YOUTUBE_FAIL_THRESHOLD = 1;
  private readonly ARCHIVE_AFTER_DAYS = 30;
  private readonly RECHECK_AFTER_DAYS = 7;
  // 新入库 YouTube 资源在 24h 内强制回查一次，捕获"刚发不久就被删/审核下架"
  private readonly YOUTUBE_RECHECK_NEW_HOURS = 24;
  private readonly INITIAL_DELAY_MS = 10 * 60 * 1000; // 10 minutes
  // 手动"立即清理"扫描：有界并发 + 上限，保证在网关超时内返回
  private readonly MANUAL_SCAN_LIMIT = 300;
  private readonly MANUAL_SCAN_CONCURRENCY = 8;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly lifecycle: ResourceLifecycleService,
  ) {
    const intervalHours = this.configService.get<number>(
      "RESOURCE_HEALTH_CHECK_INTERVAL_HOURS",
      6,
    );
    this.CHECK_INTERVAL_MS = intervalHours * 60 * 60 * 1000;
  }

  onModuleInit() {
    // 默认开启：失效链接清理是常态运维能力，不应依赖部署时记得配 flag。
    // 仅 HTTP HEAD/oEmbed 探活 + DB，无 LLM 成本。显式设 =false 可关闭。
    const enabled = this.configService.get<boolean>(
      "RESOURCE_HEALTH_CHECK_ENABLED",
      true,
    );

    if (enabled) {
      this.logger.log("Resource health check scheduler initialized");
      this.startScheduler();
    } else {
      this.logger.log(
        "Resource health check scheduler is disabled via RESOURCE_HEALTH_CHECK_ENABLED=false.",
      );
    }
  }

  onModuleDestroy() {
    this.stopScheduler();
  }

  /**
   * 启动调度器
   */
  private startScheduler(): void {
    setTimeout(() => {
      void this.runHealthCheck();
    }, this.INITIAL_DELAY_MS).unref();

    this.intervalId = setInterval(() => {
      void this.runHealthCheck();
    }, this.CHECK_INTERVAL_MS).unref();

    this.logger.log(
      `Scheduler started: first check in 10 minutes, then every ${this.CHECK_INTERVAL_MS / 3600000}h`,
    );
  }

  /**
   * 停止调度器
   */
  private stopScheduler(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.log("Scheduler stopped");
    }
  }

  /**
   * 主健康检查循环
   * 优先级：UNKNOWN → 7天未检查 → BROKEN（恢复检查）
   */
  async runHealthCheck(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Health check already in progress, skipping...");
      return;
    }

    this.isRunning = true;
    this.logger.log("Starting resource link health check...");

    try {
      // 先处理过期 BROKEN 资源的自动归档
      await this.archiveStaleResources();

      // 按优先级分批查询资源
      const now = new Date();
      const recheckThreshold = new Date(
        now.getTime() - this.RECHECK_AFTER_DAYS * 24 * 60 * 60 * 1000,
      );

      // 0. 新入库 24h 内未检查的 YouTube（最高优先级 — 捕获"刚发不久就被删"）
      const youtubeRecheckThreshold = new Date(
        now.getTime() - this.YOUTUBE_RECHECK_NEW_HOURS * 60 * 60 * 1000,
      );
      const newYoutubeResources = await this.prisma.resource.findMany({
        where: {
          createdAt: { gt: youtubeRecheckThreshold },
          lastHealthCheckAt: null,
          sourceUrl: {
            contains: "youtube.com",
          },
        },
        select: {
          id: true,
          sourceUrl: true,
          pdfUrl: true,
          linkHealth: true,
          linkCheckFailCount: true,
          title: true,
          type: true,
        },
        take: this.BATCH_SIZE,
      });

      // 1. UNKNOWN 优先
      const unknownResources = await this.prisma.resource.findMany({
        where: {
          linkHealth: LINK_HEALTH.UNKNOWN,
          sourceUrl: { not: "" },
          // 排除上面已选取的新 YouTube，避免重复检查
          NOT: { id: { in: newYoutubeResources.map((r) => r.id) } },
        },
        select: {
          id: true,
          sourceUrl: true,
          pdfUrl: true,
          linkHealth: true,
          linkCheckFailCount: true,
          title: true,
          type: true,
        },
        take: this.BATCH_SIZE,
      });

      // 2. 超过7天未检查的 HEALTHY
      const staleResources = await this.prisma.resource.findMany({
        where: {
          linkHealth: LINK_HEALTH.HEALTHY,
          OR: [
            { lastHealthCheckAt: null },
            { lastHealthCheckAt: { lt: recheckThreshold } },
          ],
          sourceUrl: { not: "" },
        },
        select: {
          id: true,
          sourceUrl: true,
          pdfUrl: true,
          linkHealth: true,
          linkCheckFailCount: true,
          title: true,
          type: true,
        },
        take: this.BATCH_SIZE,
        orderBy: { lastHealthCheckAt: "asc" },
      });

      // 3. BROKEN（恢复检查）
      const brokenResources = await this.prisma.resource.findMany({
        where: {
          linkHealth: LINK_HEALTH.BROKEN,
          sourceUrl: { not: "" },
        },
        select: {
          id: true,
          sourceUrl: true,
          pdfUrl: true,
          linkHealth: true,
          linkCheckFailCount: true,
          title: true,
          type: true,
        },
        take: this.BATCH_SIZE,
        orderBy: { lastHealthCheckAt: "asc" },
      });

      const allResources = [
        ...newYoutubeResources,
        ...unknownResources,
        ...staleResources,
        ...brokenResources,
      ];

      if (allResources.length === 0) {
        this.logger.log("No resources to check at this time");
        return;
      }

      this.logger.log(
        `Checking ${allResources.length} resources (newYoutube: ${newYoutubeResources.length}, unknown: ${unknownResources.length}, stale: ${staleResources.length}, broken: ${brokenResources.length})`,
      );

      await this.checkBatch(allResources);

      // 检查跑完后，物理删除"BROKEN 且无 notes/comments"的孤儿资源
      // —— 把脏数据从库里清出去，而不是只标记后让它躺着
      await this.deleteOrphanedBrokenResources();

      this.logger.log("Resource link health check completed");
    } catch (error) {
      this.logger.error(`Health check run failed: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 手动触发的"探活 + 标记 BROKEN"扫描（管理员"立即清理"按钮用）。
   *
   * 与定时 runHealthCheck 的区别：
   *  - 只挑非 BROKEN 候选（UNKNOWN / 超期未检查的 HEALTHY），目标是"立刻发现新失效"
   *  - 有界并发、无 per-item sleep —— 让按钮在反向代理网关超时内返回
   *  - 只标记，不删除/归档（删除交给 cleanupBrokenResources，避免重复处理 + 计数失真）
   *
   * 返回本次扫描条数与扫描后处于 BROKEN 的条数；capped=true 表示候选超过上限、
   * 本次只扫了一部分（再次点击可继续）。
   */
  async scanAndMarkBroken(): Promise<{
    scanned: number;
    broken: number;
    capped: boolean;
  }> {
    if (this.isRunning) {
      this.logger.warn("Health check already in progress, manual scan skipped");
      return { scanned: 0, broken: 0, capped: false };
    }

    this.isRunning = true;
    try {
      const candidates = await this.collectScanCandidates(
        this.MANUAL_SCAN_LIMIT,
      );
      if (candidates.length === 0) {
        this.logger.log("Manual scan: no candidate resources to check");
        return { scanned: 0, broken: 0, capped: false };
      }

      const ids = candidates.map((r) => r.id);
      await this.runConcurrent(
        candidates,
        this.MANUAL_SCAN_CONCURRENCY,
        async (r) => {
          try {
            await this.checkSingleResource(r);
          } catch (e) {
            this.logger.error(
              `Manual scan failed for resource ${r.id}: ${(e as Error).message}`,
            );
          }
        },
      );

      const broken = await this.prisma.resource.count({
        where: { id: { in: ids }, linkHealth: LINK_HEALTH.BROKEN },
      });

      const capped = candidates.length >= this.MANUAL_SCAN_LIMIT;
      this.logger.log(
        `Manual scan complete: ${candidates.length} checked, ${broken} now BROKEN${capped ? " (capped, more remain)" : ""}`,
      );
      return { scanned: candidates.length, broken, capped };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 收集手动扫描候选：优先从未验证的 UNKNOWN（默认态），其次超期未检查的 HEALTHY。
   * 不含 BROKEN（已是目标态，无需重复探活），不含 ARCHIVED。
   */
  private async collectScanCandidates(limit: number): Promise<
    Array<{
      id: string;
      sourceUrl: string | null;
      pdfUrl: string | null;
      linkHealth: string | null;
      linkCheckFailCount: number;
      title: string | null;
      type: string | null;
    }>
  > {
    const select = {
      id: true,
      sourceUrl: true,
      pdfUrl: true,
      linkHealth: true,
      linkCheckFailCount: true,
      title: true,
      type: true,
    } as const;

    const unknown = await this.prisma.resource.findMany({
      where: { linkHealth: LINK_HEALTH.UNKNOWN, sourceUrl: { not: "" } },
      select,
      take: limit,
    });
    if (unknown.length >= limit) return unknown;

    const recheckThreshold = new Date(
      Date.now() - this.RECHECK_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );
    const stale = await this.prisma.resource.findMany({
      where: {
        linkHealth: LINK_HEALTH.HEALTHY,
        OR: [
          { lastHealthCheckAt: null },
          { lastHealthCheckAt: { lt: recheckThreshold } },
        ],
        sourceUrl: { not: "" },
      },
      select,
      take: limit - unknown.length,
      orderBy: { lastHealthCheckAt: "asc" },
    });

    return [...unknown, ...stale];
  }

  /**
   * 有界并发执行：固定 worker 数从队列取任务，无 per-item sleep。
   */
  private async runConcurrent<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    let idx = 0;
    const runners = Array.from(
      { length: Math.min(concurrency, items.length) },
      async () => {
        while (idx < items.length) {
          const current = items[idx++];
          await worker(current);
        }
      },
    );
    await Promise.all(runners);
  }

  /**
   * 批量检查资源链接
   */
  private async checkBatch(
    resources: Array<{
      id: string;
      sourceUrl: string | null;
      pdfUrl: string | null;
      linkHealth: string | null;
      linkCheckFailCount: number;
    }>,
  ): Promise<void> {
    let checkedCount = 0;
    let healthyCount = 0;
    let brokenCount = 0;

    for (const resource of resources) {
      try {
        await this.checkSingleResource(resource);

        checkedCount++;
        if (resource.linkHealth === LINK_HEALTH.HEALTHY) {
          healthyCount++;
        } else if (resource.linkHealth === LINK_HEALTH.BROKEN) {
          brokenCount++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to check resource ${resource.id}: ${(error as Error).message}`,
        );
      }

      await this.sleep(this.BATCH_DELAY_MS);
    }

    this.logger.log(
      `Batch complete: ${checkedCount} checked, ${healthyCount} healthy, ${brokenCount} broken`,
    );
  }

  /**
   * 检查单个资源的链接可访问性
   */
  private async checkSingleResource(resource: {
    id: string;
    sourceUrl: string | null;
    pdfUrl: string | null;
    linkHealth: string | null;
    linkCheckFailCount: number;
    title?: string | null;
    type?: string | null;
  }): Promise<void> {
    const urlsToCheck: string[] = [];

    if (resource.sourceUrl) {
      urlsToCheck.push(resource.sourceUrl);
    }
    if (resource.pdfUrl) {
      urlsToCheck.push(resource.pdfUrl);
    }

    if (urlsToCheck.length === 0) {
      return;
    }

    // 任意一个 URL 可达即认为健康；记录最后一个失败原因（若全部失败）
    let isHealthy = false;
    let lastReason = "no-url";
    for (const url of urlsToCheck) {
      const result = await this.checkUrlSmart(url);
      lastReason = result.reason;
      if (result.ok) {
        isHealthy = true;
        break;
      }
    }

    await this.updateResourceHealth(resource, isHealthy, lastReason);
  }

  /**
   * 智能 URL 检查：按 host 选择策略。
   * - YouTube 视频（youtube.com/watch?v= / youtu.be）：页面 200 不代表视频活，
   *   走 oEmbed API（https://www.youtube.com/oembed?url=...）— 视频删除返回 404
   * - 其他：走原有的 HTTP HEAD/GET Range 检查
   */
  private async checkUrlSmart(url: string): Promise<CheckResult> {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (
        host === "youtube.com" ||
        host === "www.youtube.com" ||
        host === "m.youtube.com" ||
        host === "youtu.be"
      ) {
        return await this.checkYoutubeUrl(url);
      }
    } catch {
      // 非法 URL 交给 HEAD 检查
    }
    return this.checkUrl(url);
  }

  /**
   * 走 YouTube oEmbed 判断视频是否还存在
   * https://www.youtube.com/oembed?url={}&format=json
   *
   * 状态码解读：
   * - 200 → 视频还在，HEALTHY
   * - 400 → 视频 ID 损坏（曾经的 lowercase bug），BROKEN
   * - 401 → 视频被设为私有，BROKEN
   * - 404 → 视频已删除，BROKEN
   * - 429 / 503 / 网络超时 → 临时故障，保守返回 ok=true（不递增失败计数），
   *   避免 YouTube 限流 / 出口 IP 被封导致批量误标 BROKEN
   */
  private async checkYoutubeUrl(url: string): Promise<CheckResult> {
    try {
      const axios = (await import("axios")).default;
      const res = await axios.get(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        {
          timeout: this.HEAD_TIMEOUT_MS,
          validateStatus: () => true,
        },
      );
      if (res.status === 200) return { ok: true, reason: "oembed-200" };
      if (res.status === 400) {
        this.logger.debug(`[youtube oembed] 400 for ${url} → malformed id`);
        return { ok: false, reason: "oembed-400-malformed-id" };
      }
      if (res.status === 401) {
        this.logger.debug(`[youtube oembed] 401 for ${url} → private`);
        return { ok: false, reason: "oembed-401-private" };
      }
      if (res.status === 404) {
        this.logger.debug(`[youtube oembed] 404 for ${url} → deleted`);
        return { ok: false, reason: "oembed-404-deleted" };
      }
      this.logger.warn(
        `[youtube oembed] ambiguous status ${res.status} for ${url}, treating as healthy`,
      );
      return { ok: true, reason: `oembed-${res.status}-ambiguous` };
    } catch (error) {
      this.logger.warn(
        `[youtube oembed] network error for ${url}: ${(error as Error).message}, treating as healthy`,
      );
      return { ok: true, reason: "oembed-network-error" };
    }
  }

  /**
   * 更新资源健康状态到数据库
   */
  private async updateResourceHealth(
    resource: {
      id: string;
      sourceUrl: string | null;
      linkHealth: string | null;
      linkCheckFailCount: number;
      title?: string | null;
      type?: string | null;
    },
    isHealthy: boolean,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    const snapshot = {
      sourceUrl: resource.sourceUrl,
      title: resource.title ?? null,
      type: resource.type ?? null,
    };

    if (isHealthy) {
      const wasRecovered = resource.linkHealth === LINK_HEALTH.BROKEN;
      await this.prisma.resource.update({
        where: { id: resource.id },
        data: {
          linkHealth: LINK_HEALTH.HEALTHY,
          lastHealthCheckAt: now,
          linkCheckFailCount: 0,
        },
      });
      if (wasRecovered) {
        this.logger.log(`Resource ${resource.id} recovered: BROKEN -> HEALTHY`);
        await this.lifecycle.record({
          resourceId: resource.id,
          action: "RECOVERED",
          reason,
          actor: "SCHEDULER",
          snapshot,
        });
      }
    } else {
      const threshold = isYoutubeUrl(resource.sourceUrl)
        ? this.YOUTUBE_FAIL_THRESHOLD
        : this.FAIL_THRESHOLD;
      const newFailCount = resource.linkCheckFailCount + 1;
      const newHealth =
        newFailCount >= threshold
          ? LINK_HEALTH.BROKEN
          : (resource.linkHealth ?? LINK_HEALTH.UNKNOWN);

      const becameBroken =
        newHealth === LINK_HEALTH.BROKEN &&
        resource.linkHealth !== LINK_HEALTH.BROKEN;

      await this.prisma.resource.update({
        where: { id: resource.id },
        data: {
          linkHealth: newHealth,
          lastHealthCheckAt: now,
          linkCheckFailCount: newFailCount,
        },
      });

      if (becameBroken) {
        this.logger.warn(
          `Resource ${resource.id} marked BROKEN after ${newFailCount} failures (threshold=${threshold}, reason=${reason})`,
        );
        await this.lifecycle.record({
          resourceId: resource.id,
          action: "HEALTH_CHECK_BROKEN",
          reason,
          actor: "SCHEDULER",
          snapshot,
          metadata: { failCount: newFailCount, threshold },
        });
      }
    }
  }

  /**
   * 将长时间 BROKEN 且无关联内容的资源自动归档
   *
   * 注意：此方法实际上不会触发——`deleteOrphanedBrokenResources` 在
   * runHealthCheck 末尾已经把"无 notes/comments 的 BROKEN"物理删除了，
   * 留给这里的只剩"有附件的 BROKEN"，但它们因为附件存在不满足下面的过滤。
   * 保留此方法作为安全网，以防 hard-delete 路径未来被禁用。
   */
  private async archiveStaleResources(): Promise<void> {
    const archiveThreshold = new Date(
      Date.now() - this.ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );

    const staleResources = await this.prisma.resource.findMany({
      where: {
        linkHealth: LINK_HEALTH.BROKEN,
        lastHealthCheckAt: { lt: archiveThreshold },
        notes: { none: {} },
        comments: { none: {} },
      },
      select: { id: true, sourceUrl: true, title: true, type: true },
      take: 200,
    });

    if (staleResources.length === 0) {
      return;
    }

    const ids = staleResources.map((r) => r.id);

    await this.prisma.resource.updateMany({
      where: { id: { in: ids } },
      data: { linkHealth: LINK_HEALTH.ARCHIVED },
    });

    await this.lifecycle.recordBatch(
      staleResources.map((r) => ({
        resourceId: r.id,
        action: "ARCHIVED" as const,
        reason: "stale-broken-30d",
        actor: "SCHEDULER" as const,
        snapshot: { sourceUrl: r.sourceUrl, title: r.title, type: r.type },
      })),
    );

    this.logger.log(
      `Archived ${staleResources.length} stale broken resources (broken >30d, no notes/comments)`,
    );
  }

  /**
   * 物理删除孤儿 BROKEN 资源（无 notes/comments），并写入 lifecycle 事件快照。
   * 与 archiveStaleResources 互补：归档保留行，删除清空空间——后者只对真正"无人问津"的执行。
   */
  private async deleteOrphanedBrokenResources(): Promise<void> {
    const orphans = await this.prisma.resource.findMany({
      where: {
        linkHealth: LINK_HEALTH.BROKEN,
        notes: { none: {} },
        comments: { none: {} },
      },
      select: { id: true, sourceUrl: true, title: true, type: true },
      take: 500,
    });

    if (orphans.length === 0) return;

    // 先写审计事件，再删除——这样即使 deleteMany 异常也有记录
    await this.lifecycle.recordBatch(
      orphans.map((r) => ({
        resourceId: r.id,
        action: "HARD_DELETED" as const,
        reason: "orphaned-broken-no-attachments",
        actor: "SCHEDULER" as const,
        snapshot: { sourceUrl: r.sourceUrl, title: r.title, type: r.type },
      })),
    );

    const deleted = await this.prisma.resource.deleteMany({
      where: { id: { in: orphans.map((r) => r.id) } },
    });

    this.logger.log(
      `Hard-deleted ${deleted.count} orphaned BROKEN resources (no notes/comments)`,
    );
  }

  /**
   * 发送 HTTP HEAD 请求检查 URL 可达性
   * 回退策略：HEAD 被拒绝时尝试 GET Range
   */
  private async checkUrl(url: string): Promise<CheckResult> {
    // ★ R-LIVE-2 (2026-04-30): 429 / 503 / 网络超时 是临时故障（rate limit /
    //   出口 IP 被封），不能让批量爬虫式 health check 把 5 个 resource 集中
    //   标 BROKEN。HEAD 真错 / 4xx 真错才 → ok=false，transient 一律 fail-open。
    const TRANSIENT_STATUSES = new Set([408, 429, 502, 503, 504]);
    const isTransientError = (e: Error): boolean => {
      const msg = e.message || "";
      return /timeout|ECONNRESET|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(
        msg,
      );
    };
    const tryGetRange = async (): Promise<CheckResult> => {
      try {
        const axios = (await import("axios")).default;
        const r = await axios.get(url, {
          timeout: this.HEAD_TIMEOUT_MS,
          maxRedirects: 5,
          validateStatus: (status: number) => status < 400,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Range: "bytes=0-0",
          },
        });
        return { ok: true, reason: `get-range-${r.status}` };
      } catch (e) {
        const err = e as Error;
        if (isTransientError(err)) {
          return { ok: true, reason: "get-network-transient" };
        }
        const msg = err.message || "unknown";
        const m = msg.match(/status code (\d+)/i);
        if (m && TRANSIENT_STATUSES.has(parseInt(m[1], 10))) {
          return { ok: true, reason: `get-${m[1]}-transient` };
        }
        return { ok: false, reason: `http-error:${msg.slice(0, 50)}` };
      }
    };
    try {
      const axios = (await import("axios")).default;
      const response = await axios.head(url, {
        timeout: this.HEAD_TIMEOUT_MS,
        maxRedirects: 5,
        validateStatus: (status: number) => status < 400,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "*/*",
        },
      });
      return { ok: true, reason: `head-${response.status}` };
    } catch (headErr) {
      const err = headErr as Error;
      const msg = err.message || "";
      const statusMatch = msg.match(/status code (\d+)/i);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : null;
      if (status != null && TRANSIENT_STATUSES.has(status)) {
        return { ok: true, reason: `head-${status}-transient` };
      }
      if (isTransientError(err)) {
        return { ok: true, reason: "head-network-transient" };
      }
      return tryGetRange();
    }
  }

  /**
   * 辅助：延时
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
