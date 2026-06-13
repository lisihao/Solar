/**
 * StorageInventoryService — 数据存储位置清单
 *
 * 给 admin/数据管理界面提供"哪些数据存在 DB、哪些在 R2"的快照。
 *
 * 三类信息：
 * 1. DB 表级别：每张表的行数、heap+index+toast 尺寸
 * 2. 已 off-load 字段映射：哪个表的哪个字段 → R2 哪个 prefix（含 URI 统计）
 * 3. R2 bucket 清单：按 prefix 分组的对象数/总字节
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ObjectStorageService } from "../object-store/object-storage.service";
import { OFFLOAD_TARGETS } from "./storage-offload.registry";

export interface TableStat {
  table: string;
  rows: number;
  totalBytes: number;
  totalHuman: string;
  heapBytes: number;
  indexBytes: number;
  toastBytes: number;
}

export interface OffloadFieldStat {
  table: string;
  field: string; // 原字段名
  uriField: string; // _uri 字段名
  r2Prefix: string; // R2 里的 key 前缀
  totalRows: number; // 表总行数
  rowsWithUri: number; // 已 off-load 行数（URI 非空）
  rowsWithDbContent: number; // DB 字段仍有内容的行数
}

export interface R2PrefixStat {
  prefix: string;
  objects: number;
  bytes: number;
  bytesHuman: string;
}

export interface StorageInventory {
  database: {
    totalBytes: number;
    totalHuman: string;
    tables: TableStat[];
  };
  offloadFields: OffloadFieldStat[];
  r2: {
    configured: boolean;
    bucket: string | null;
    totalObjects: number;
    totalBytes: number;
    totalHuman: string;
    byPrefix: R2PrefixStat[];
  };
  generatedAt: string;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} kB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 每日采样
const SNAPSHOT_FIRST_DELAY_MS = 10 * 60 * 1000; // 启动 10 分钟后采第一次
const SNAPSHOT_RETENTION_DAYS = 90; // 保留 90 天，超出自动清理
const INVENTORY_CACHE_TTL_MS = 5 * 60 * 1000; // getInventory 缓存 5 分钟

@Injectable()
export class StorageInventoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageInventoryService.name);
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private inventoryCache: { data: StorageInventory; expiresAt: number } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  onModuleInit() {
    setTimeout(() => {
      void this.takeSnapshot();
      this.snapshotTimer = setInterval(
        () => void this.takeSnapshot(),
        SNAPSHOT_INTERVAL_MS,
      );
    }, SNAPSHOT_FIRST_DELAY_MS);
  }

  onModuleDestroy() {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
  }

  /** 采样当前存储状态，写入 storage_snapshots 表（趋势图数据源） */
  async takeSnapshot(): Promise<void> {
    try {
      const inv = await this.getInventory({ forceFresh: true });
      await this.prisma.storageSnapshot.create({
        data: {
          dbTotalBytes: BigInt(inv.database.totalBytes),
          r2TotalBytes: BigInt(inv.r2.totalBytes),
          r2TotalObjects: inv.r2.totalObjects,
          offloadFields: inv.offloadFields as unknown as Prisma.InputJsonValue,
          dbTopTables: inv.database.tables.slice(
            0,
            20,
          ) as unknown as Prisma.InputJsonValue,
        },
      });
      // ★ 2026-04-22 retention：删 90 天前的 snapshot 防止表无限增长
      const cutoff = new Date(
        Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const deleted = await this.prisma.storageSnapshot.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      this.logger.log(
        `[snapshot] db=${inv.database.totalHuman} r2=${inv.r2.totalHuman}` +
          (deleted.count > 0 ? ` (pruned ${deleted.count} old)` : ""),
      );
    } catch (error) {
      this.logger.warn(`[snapshot] failed: ${(error as Error).message}`);
    }
  }

  /** 读最近 N 天的 snapshot，前端画 trend */
  async getTrend(days = 30): Promise<
    Array<{
      at: string;
      dbMb: number;
      r2Mb: number;
      r2Objects: number;
    }>
  > {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.storageSnapshot.findMany({
      where: { createdAt: { gte: since } },
      select: {
        createdAt: true,
        dbTotalBytes: true,
        r2TotalBytes: true,
        r2TotalObjects: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      at: r.createdAt.toISOString(),
      dbMb: Math.round(Number(r.dbTotalBytes) / 1024 / 1024),
      r2Mb: Math.round(Number(r.r2TotalBytes) / 1024 / 1024),
      r2Objects: r.r2TotalObjects,
    }));
  }

  async getInventory(opts?: {
    forceFresh?: boolean;
  }): Promise<StorageInventory> {
    const now = Date.now();
    if (
      !opts?.forceFresh &&
      this.inventoryCache &&
      this.inventoryCache.expiresAt > now
    ) {
      return this.inventoryCache.data;
    }
    const [dbStats, offloadStats, r2Stats] = await Promise.all([
      this.queryDatabase(),
      this.queryOffloadFields(),
      this.queryR2().catch((error) => {
        this.logger.warn(
          `[inventory] R2 query failed: ${(error as Error).message}`,
        );
        return {
          configured: false,
          bucket: null,
          totalObjects: 0,
          totalBytes: 0,
          totalHuman: "0 B",
          byPrefix: [] as R2PrefixStat[],
        };
      }),
    ]);

    const snapshot: StorageInventory = {
      database: dbStats,
      offloadFields: offloadStats,
      r2: r2Stats,
      generatedAt: new Date().toISOString(),
    };
    this.inventoryCache = {
      data: snapshot,
      expiresAt: now + INVENTORY_CACHE_TTL_MS,
    };
    return snapshot;
  }

  private async queryDatabase() {
    const totalRaw = await this.prisma.$queryRawUnsafe<{ sz: bigint }[]>(
      `SELECT pg_database_size(current_database()) AS sz`,
    );
    const totalBytes = Number(totalRaw[0].sz);

    const tablesRaw = await this.prisma.$queryRawUnsafe<
      Array<{
        relname: string;
        rows: bigint;
        total_bytes: bigint;
        heap_bytes: bigint;
        index_bytes: bigint;
        toast_bytes: bigint;
      }>
    >(
      `SELECT
         c.relname,
         COALESCE(s.n_live_tup, 0)::bigint AS rows,
         pg_total_relation_size(c.oid)::bigint AS total_bytes,
         pg_relation_size(c.oid)::bigint AS heap_bytes,
         pg_indexes_size(c.oid)::bigint AS index_bytes,
         COALESCE(pg_total_relation_size(c.reltoastrelid), 0)::bigint AS toast_bytes
       FROM pg_class c
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE c.relkind='r' AND c.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
       ORDER BY pg_total_relation_size(c.oid) DESC`,
    );

    const tables: TableStat[] = tablesRaw.map((r) => ({
      table: r.relname,
      rows: Number(r.rows),
      totalBytes: Number(r.total_bytes),
      totalHuman: humanBytes(Number(r.total_bytes)),
      heapBytes: Number(r.heap_bytes),
      indexBytes: Number(r.index_bytes),
      toastBytes: Number(r.toast_bytes),
    }));

    return {
      totalBytes,
      totalHuman: humanBytes(totalBytes),
      tables,
    };
  }

  private async queryOffloadFields(): Promise<OffloadFieldStat[]> {
    const results: OffloadFieldStat[] = [];
    for (const def of OFFLOAD_TARGETS) {
      const dbContentCountSql =
        def.contentKind === "string"
          ? `SELECT COUNT(*)::bigint AS n FROM "${def.table}" WHERE char_length("${def.field}") > 0`
          : `SELECT COUNT(*)::bigint AS n FROM "${def.table}" WHERE NOT ("${def.field}" = 'null'::jsonb OR "${def.field}" IS NULL)`;
      const [total, withUri, withContent] = await Promise.all([
        this.prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT COUNT(*)::bigint AS n FROM "${def.table}"`,
        ),
        this.prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT COUNT(*)::bigint AS n FROM "${def.table}" WHERE "${def.uriField}" IS NOT NULL`,
        ),
        this.prisma.$queryRawUnsafe<{ n: bigint }[]>(dbContentCountSql),
      ]);
      results.push({
        table: def.table,
        field: def.field,
        uriField: def.uriField,
        r2Prefix: def.r2Prefix,
        totalRows: Number(total[0].n),
        rowsWithUri: Number(withUri[0].n),
        rowsWithDbContent: Number(withContent[0].n),
      });
    }
    return results;
  }

  private async queryR2(): Promise<StorageInventory["r2"]> {
    if (!this.storage.isEnabled()) {
      return {
        configured: false,
        bucket: null,
        totalObjects: 0,
        totalBytes: 0,
        totalHuman: "0 B",
        byPrefix: [],
      };
    }
    const bucket = this.storage.getBucketName();

    const byPrefixMap = new Map<string, { objects: number; bytes: number }>();
    let totalObjects = 0;
    let totalBytes = 0;
    let token: string | undefined;
    while (true) {
      const page = await this.storage.listObjects({
        continuationToken: token,
        maxKeys: 1000,
      });
      for (const obj of page.objects) {
        const top = obj.key.split("/")[0] + "/";
        const entry = byPrefixMap.get(top) ?? { objects: 0, bytes: 0 };
        entry.objects++;
        entry.bytes += obj.size;
        byPrefixMap.set(top, entry);
        totalObjects++;
        totalBytes += obj.size;
      }
      if (!page.isTruncated) break;
      token = page.nextContinuationToken;
    }

    const byPrefix: R2PrefixStat[] = Array.from(byPrefixMap.entries())
      .map(([prefix, v]) => ({
        prefix,
        objects: v.objects,
        bytes: v.bytes,
        bytesHuman: humanBytes(v.bytes),
      }))
      .sort((a, b) => b.bytes - a.bytes);

    return {
      configured: true,
      bucket,
      totalObjects,
      totalBytes,
      totalHuman: humanBytes(totalBytes),
      byPrefix,
    };
  }
}
