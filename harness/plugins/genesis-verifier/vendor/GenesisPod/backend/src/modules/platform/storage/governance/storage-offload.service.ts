/**
 * StorageOffloadService — 新数据 off-load 调度器
 *
 * 每天凌晨 02:00 UTC 扫以下 off-load 候选表，把新增的大字段搬到对象存储：
 * - topic_reports.full_report → `<consumer-report>s/{id}/v{version}.md`
 * - dimension_analyses.data_points → `dimension-analyses/{id}/data_points.json`
 * - research_tasks.result → `research-tasks/{id}/result.json`
 * - knowledge_base_documents.raw_content → `kb-documents/{id}/raw.txt`
 *   （仅 status=READY 行：避免 chunking pipeline 还在用 raw_content 时被搬走）
 * - wiki_page_revisions.body → `wiki-revisions/{revisionId}/body.md`
 *   （revision 是 append-only 极冷数据，写完即可迁；revert 走 hydrate）
 * - wiki_diffs.items → `wiki-diffs/{id}/items.json`
 *   （仅 status=APPLIED|DISMISSED 且 createdAt > OFFLOAD_GRACE_DAYS_WIKI_DIFF
 *    (env, default 30) 天的终态归档；PENDING 留 DB；items 非空字段 → 写 JSON null）
 *
 * 处理逻辑（每个表独立）：
 * 1. 扫 {uri} IS NULL AND {content} IS NOT NULL AND len > 2KB 的行
 * 2. 批量上传到对象存储（ObjectStorageService.uploadText）
 * 3. 写 URI 到 DB
 * 4. 清空 DB 里的 content 字段（文本 → ""，JSON → NULL）
 *
 * 运行时自动触发；不需要手动跑 scripts/backfill-*。
 * 失败降级：单行错误不阻塞其他行；next run 自动重试。
 *
 * 设计要点：
 * - 并发锁：run 单例，避免 24h 间隔内二次触发（启动 5min 后先跑一次做冷启动 bootstrap）
 * - 幂等：WHERE uri IS NULL 过滤已迁行
 * - 不做 VACUUM FULL（exclusive lock 影响业务），交给 postgres autovacuum
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ObjectStorageService } from "../object-store/object-storage.service";
import { OFFLOAD_PREFIXES } from "./offload-prefixes";
import {
  OFFLOAD_TARGETS,
  type OffloadRow,
  type OffloadTarget,
} from "./storage-offload.registry";

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000; // 启动 5 分钟后首次触发
const BATCH_SIZE = 50;
const CONCURRENCY = 4;
const OFFLOAD_THRESHOLD = 2048; // <2KB 不迁

// 孤儿清理批量枚举上限（每次 run 扫的 R2 对象数）
const ORPHAN_LIST_BATCH = 1000;

// pg_advisory_lock 键：任意 64bit 整数；取自 crc32("storage_offload") 便于唯一识别
const ADVISORY_LOCK_KEY = 834_612_099;

@Injectable()
export class StorageOffloadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageOffloadService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  onModuleInit() {
    if (!this.storage.isEnabled()) {
      this.logger.warn(
        "[StorageOffload] object storage not configured, scheduler disabled",
      );
      return;
    }
    this.logger.log(
      `[StorageOffload] scheduled: first run in ${FIRST_RUN_DELAY_MS / 60_000}min, then every 24h`,
    );
    setTimeout(() => {
      void this.runOnce();
      this.timer = setInterval(() => void this.runOnce(), INTERVAL_MS);
    }, FIRST_RUN_DELAY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private buildTargets(): OffloadTarget[] {
    return [...OFFLOAD_TARGETS];
  }

  /** 外部可手动触发（健康检查 / 手动测试） */
  async runOnce(): Promise<void> {
    if (this.running) {
      this.logger.warn("[StorageOffload] previous run still in progress, skip");
      return;
    }

    // ★ 2026-04-22 加固：跨实例 advisory lock
    // Railway 若横向扩容多 Pod，每个 Pod 都会在 02:00 UTC 触发 cron；
    // try_advisory_lock 保证同时只有一个 Pod 跑 offload，其他 Pod 直接跳过。
    // 如果本机被 SIGTERM，PostgreSQL 会话断开自动释放锁。
    const lockRows = await this.prisma.$queryRawUnsafe<{ locked: boolean }[]>(
      `SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked`,
    );
    const locked = lockRows[0]?.locked === true;
    if (!locked) {
      this.logger.log(
        "[StorageOffload] another instance holds advisory lock, skip",
      );
      return;
    }

    this.running = true;
    const start = Date.now();
    const summary: Record<
      string,
      { migrated: number; failed: number; mb: number }
    > = {};

    let orphansDeleted = 0;
    try {
      for (const target of this.buildTargets()) {
        summary[target.name] = await this.runTarget(target);
      }
      // 2026-05-09 (security review P0)：cascade delete 后 R2 残留对象清理。
      // 每天扫一批（ORPHAN_LIST_BATCH 个对象），按前缀提 ID 反查 DB，DB 不存在
      // 即认定为孤儿删除。每 R2 GET listObjects 是廉价操作，单 cron 跑足以覆盖。
      orphansDeleted = await this.cleanupOrphans();
      this.logger.log(
        `[StorageOffload] run complete in ${Math.round((Date.now() - start) / 1000)}s: ${JSON.stringify(summary)} orphansDeleted=${orphansDeleted}`,
      );
    } catch (error) {
      this.logger.error(
        `[StorageOffload] run failed: ${(error as Error).message}`,
      );
    } finally {
      this.running = false;
      try {
        await this.prisma.$queryRawUnsafe(
          `SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`,
        );
      } catch (error) {
        this.logger.warn(
          `[StorageOffload] unlock failed (conn may be closed already): ${(error as Error).message}`,
        );
      }
    }
  }

  private async runTarget(
    target: OffloadTarget,
  ): Promise<{ migrated: number; failed: number; mb: number }> {
    let migrated = 0;
    let failed = 0;
    let bytes = 0;

    while (true) {
      const rows = await target.list(this.prisma, BATCH_SIZE);
      if (rows.length === 0) break;

      await this.mapPool(rows, CONCURRENCY, async (r: OffloadRow) => {
        const size = Buffer.byteLength(r.content, "utf-8");
        if (size === 0) return;
        if (size < OFFLOAD_THRESHOLD) {
          try {
            await target.recordSmall(this.prisma, r.id, size);
          } catch {
            /* ignore */
          }
          return;
        }
        const key = target.keyFor(r.id, r.version);
        const res = await this.storage.uploadText(
          r.content,
          key,
          target.contentType,
        );
        if (!res.success) {
          failed++;
          this.logger.warn(
            `[StorageOffload] upload fail ${target.name} ${r.id}: ${res.error}`,
          );
          return;
        }
        try {
          await target.commit(this.prisma, r.id, key, size);
          migrated++;
          bytes += size;
        } catch (error) {
          failed++;
          this.logger.warn(
            `[StorageOffload] DB commit fail ${target.name} ${r.id}: ${(error as Error).message}`,
          );
        }
      });
    }

    return {
      migrated,
      failed,
      mb: Math.round(bytes / 1024 / 1024),
    };
  }

  private async mapPool<T>(
    items: T[],
    n: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    let idx = 0;
    await Promise.all(
      Array.from({ length: Math.min(n, items.length) }, async () => {
        while (idx < items.length) {
          const my = idx++;
          try {
            await fn(items[my]);
          } catch {
            /* isolated — don't bubble up */
          }
        }
      }),
    );
  }

  /**
   * 孤儿对象清理：每次 cron run 扫一批 R2 对象（最多 ORPHAN_LIST_BATCH），
   * 按前缀分组 → 提取 ID → 反查 DB 是否存在 → 不存在即删 R2 对象。
   *
   * 设计：
   * - 单次 run 不分页扫全 bucket，避免长跑；24h 间隔下迟早扫到全部对象
   * - 按 OFFLOAD_PREFIXES 分组反查 DB，每个表一次 IN 查询
   * - 单对象删除失败不阻塞其他对象（log warn 即可，下次 run 重试）
   */
  private async cleanupOrphans(): Promise<number> {
    if (!this.storage.isEnabled()) return 0;
    const list = await this.storage.listObjects({
      maxKeys: ORPHAN_LIST_BATCH,
    });
    if (list.objects.length === 0) return 0;

    // 按前缀分组：prefix -> Array<{ key, id }>
    const grouped = new Map<string, Array<{ key: string; id: string }>>();
    for (const obj of list.objects) {
      for (const reg of OFFLOAD_PREFIXES) {
        if (!obj.key.startsWith(reg.prefix)) continue;
        const id = reg.extractId(obj.key);
        if (!id) break;
        if (!grouped.has(reg.prefix)) grouped.set(reg.prefix, []);
        grouped.get(reg.prefix)!.push({ key: obj.key, id });
        break;
      }
    }

    let deleted = 0;
    for (const reg of OFFLOAD_PREFIXES) {
      const items = grouped.get(reg.prefix);
      if (!items || items.length === 0) continue;
      const ids = [...new Set(items.map((i) => i.id))];
      let live: Set<string>;
      try {
        live = await reg.listLiveIds(this.prisma, ids);
      } catch (error) {
        this.logger.warn(
          `[StorageOffload] orphan check failed for ${reg.prefix}: ${(error as Error).message}`,
        );
        continue;
      }
      const orphans = items.filter((i) => !live.has(i.id));
      for (const o of orphans) {
        const ok = await this.storage.deleteObject(o.key).catch(() => false);
        if (ok) deleted++;
      }
      if (orphans.length > 0) {
        this.logger.log(
          `[StorageOffload] orphan cleanup ${reg.prefix}: ${orphans.length} candidates (best-effort delete)`,
        );
      }
    }
    return deleted;
  }
}
