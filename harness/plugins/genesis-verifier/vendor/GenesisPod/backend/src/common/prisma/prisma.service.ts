import {
  Injectable,
  OnModuleInit,
  OnApplicationShutdown,
  Logger,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { isOffloadKeyAllowed } from "../storage/offload-key-allowlist";

// 慢查询阈值 (毫秒)
const SLOW_QUERY_THRESHOLD = parseInt(
  process.env.SLOW_QUERY_THRESHOLD || "1000",
  10,
);

// 是否启用查询日志
const ENABLE_QUERY_LOG = process.env.ENABLE_QUERY_LOG === "true";

// 数据库连接池配置
const DB_POOL_SIZE = parseInt(process.env.DB_POOL_SIZE || "10", 10);
const DB_POOL_TIMEOUT = parseInt(process.env.DB_POOL_TIMEOUT || "30", 10);

// 事务超时配置 (毫秒) - 降至 30 秒以避免长事务阻塞
const PRISMA_TRANSACTION_TIMEOUT = parseInt(
  process.env.PRISMA_TRANSACTION_TIMEOUT || "30000",
  10,
);

// ★ E14 (2026-05-25) Prisma in-flight query 无法被 client 主动 abort（平台限制：
//   AbortSignal 不穿透 Prisma）。唯一缓解是 DB 侧 statement_timeout——超时后
//   PostgreSQL 自动 cancel 该 query 并释放连接，即使 mission 已 abort/超时，卡死
//   的查询也不会一直占资源。
//   取值取舍：必须**远高于**任何合法查询（大报告 JSON 写入 / 向量批量 / 大聚合），
//   仅作"真卡死"兜底，不是性能闸。默认 120s，env 可调；设 0 关闭（沿用 PG 语义）。
const DB_STATEMENT_TIMEOUT_MS = parseInt(
  process.env.DB_STATEMENT_TIMEOUT_MS || "120000",
  10,
);

/**
 * 构建数据库 URL 并添加连接池参数
 * Prisma 使用 URL 中的 connection_limit 和 pool_timeout 参数控制连接池
 *
 * 推荐配置：
 * - DB_POOL_SIZE: 10 (默认) - 每个 Prisma 实例的最大连接数
 * - DB_POOL_TIMEOUT: 30 (默认) - 获取连接的超时时间（秒）
 *
 * PostgreSQL 连接池限制：
 * - Railway: max_connections = 100 (默认)
 * - 建议每个实例使用 10 个连接，支持最多 10 个并发实例
 */
function buildDatabaseUrl(): string | undefined {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) return undefined;

  try {
    const url = new URL(baseUrl);

    // 检查是否已有 connection_limit 参数
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", DB_POOL_SIZE.toString());
    }

    // 检查是否已有 pool_timeout 参数
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", DB_POOL_TIMEOUT.toString());
    }

    // ★ E14: DB 侧 statement_timeout 兜底（in-flight query 无法 client abort）。
    //   >0 才设；0 = 关闭（不限制）。已显式带该参数则尊重调用方。
    if (
      DB_STATEMENT_TIMEOUT_MS > 0 &&
      !url.searchParams.has("statement_timeout")
    ) {
      url.searchParams.set("statement_timeout", `${DB_STATEMENT_TIMEOUT_MS}`);
    }

    return url.toString();
  } catch {
    // 如果 URL 解析失败，返回原始值
    return baseUrl;
  }
}

/**
 * 获取日志配置（静态函数，在 super() 之前调用）
 *
 * ★ 2026-05-06 修：之前 short-form `["error", "warn"]` 默认 emit='stdout'，
 *   prisma error 通过 console.log 写到 stdout → Railway 把 stdout 全标 severity='info'，
 *   导致用户看到 prisma:error 显示 severity='info'，无法按级别过滤告警。
 *   改用 emit='event' + this.$on('error', ...) 走 NestJS Logger.error → stderr，
 *   Railway 会正确标 severity='error'。
 */
function getLogConfig(): Prisma.LogDefinition[] {
  const base: Prisma.LogDefinition[] = [
    { emit: "event", level: "error" },
    { emit: "event", level: "warn" },
  ];
  if (ENABLE_QUERY_LOG) {
    base.unshift({ emit: "event", level: "query" });
  }
  return base;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      // ★ 数据库 URL（包含连接池配置）
      datasources: {
        db: {
          url: buildDatabaseUrl(),
        },
      },
      // ★ 配置事务超时时间（可通过环境变量配置）
      transactionOptions: {
        maxWait: 10000, // 等待获取事务的最大时间 (10秒)
        timeout: PRISMA_TRANSACTION_TIMEOUT, // 事务执行的最大时间（默认 30 秒）
      },
      // ★ 启用查询日志（开发环境或明确启用时）
      log: getLogConfig(),
    });

    // ★ 设置查询事件监听器
    this.setupQueryLogging();
    // ★ 2026-05-06: 注册 prisma error/warn event 监听器，走 NestJS Logger 输出到
    //   stderr，让 Railway 正确标 severity='error' 而非 'info'
    this.setupErrorLogging();
  }

  /** prisma error/warn event → NestJS Logger.error/warn → stderr */
  private setupErrorLogging(): void {
    const client = this as unknown as {
      $on: (
        event: "error" | "warn",
        callback: (e: { message: string; target?: string }) => void,
      ) => void;
    };
    client.$on("error", (e) => {
      this.logger.error(
        `[Prisma] ${e.target ? `[${e.target}] ` : ""}${e.message}`,
      );
    });
    client.$on("warn", (e) => {
      this.logger.warn(
        `[Prisma] ${e.target ? `[${e.target}] ` : ""}${e.message}`,
      );
    });
  }

  /**
   * 设置查询日志和慢查询检测
   */
  private setupQueryLogging(): void {
    if (!ENABLE_QUERY_LOG) return;

    // 使用类型断言来访问 $on 方法
    const client = this as unknown as {
      $on: (event: string, callback: (e: QueryEvent) => void) => void;
    };

    interface QueryEvent {
      query: string;
      params: string;
      duration: number;
      target: string;
    }

    client.$on("query", (e: QueryEvent) => {
      const duration = e.duration;

      // 记录慢查询
      if (duration > SLOW_QUERY_THRESHOLD) {
        this.logger.warn(
          `[SlowQuery] ${duration}ms | ${e.query} | params: ${e.params}`,
        );
      }

      // 调试模式下记录所有查询
      if (process.env.DEBUG_QUERIES === "true") {
        this.logger.debug(`[Query] ${duration}ms | ${e.query}`);
      }
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log("[Prisma] Prisma connected to database");

    // 记录配置信息
    if (ENABLE_QUERY_LOG) {
      this.logger.log(
        `[Prisma] Query logging enabled, slow query threshold: ${SLOW_QUERY_THRESHOLD}ms`,
      );
    }

    // ★ 注入 TopicReport full_report 透明 hydrate（Phase 2）。
    // 当 full_report 字段为空 && full_report_uri 有值时，自动从对象存储拉正文。
    // 对所有 findUnique/findFirst/findMany/findUniqueOrThrow/findFirstOrThrow 生效。
    this.installTopicReportHydration();
  }

  // ────────────────────── TopicReport full_report 透明 hydrate ──────────────────────

  /** 对象存储 S3 客户端（按需初始化，只给 topicReport hydrate 用） */
  private objectStorage: { client: S3Client; bucket: string } | null = null;

  private initObjectStorage(): { client: S3Client; bucket: string } | null {
    if (this.objectStorage) return this.objectStorage;

    // 2026-04-22 全面 R2，彻底废弃 B2
    const r2AccountId = process.env.R2_ACCOUNT_ID;
    const r2AccessKey = process.env.R2_ACCESS_KEY_ID;
    const r2Secret = process.env.R2_SECRET_ACCESS_KEY;
    const r2Bucket = process.env.R2_BUCKET_NAME;
    if (r2AccountId && r2AccessKey && r2Secret && r2Bucket) {
      this.objectStorage = {
        client: new S3Client({
          region: "auto",
          endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId: r2AccessKey, secretAccessKey: r2Secret },
        }),
        bucket: r2Bucket,
      };
      return this.objectStorage;
    }
    return null;
  }

  private async downloadText(key: string): Promise<string | null> {
    // 安全防御 (2026-05-09 review P0)：拒绝白名单外的 key，避免恶意 row.uri
    // 让 hydrate 拉取 bucket 内任意路径（object substitution / SSRF-within-bucket）
    if (!isOffloadKeyAllowed(key)) {
      this.logger.warn(
        `[hydrate] downloadText rejected disallowed key prefix: ${key.slice(0, 80)}`,
      );
      return null;
    }
    const storage = this.initObjectStorage();
    if (!storage) return null;
    try {
      const res = await storage.client.send(
        new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
      );
      if (!res.Body) return null;
      return await res.Body.transformToString("utf-8");
    } catch (error) {
      const code = (error as { name?: string })?.name;
      if (code !== "NoSuchKey" && code !== "NotFound") {
        this.logger.warn(
          `[hydrate] downloadText failed for ${key}: ${(error as Error).message}`,
        );
      }
      return null;
    }
  }

  /** 追踪已警告的 (model, uriField) 组合，避免刷屏 */
  private readonly warnedMissingUri = new Set<string>();

  /**
   * 通用 hydrate：按 (uriField, contentField) 对检查并从对象存储拉回 content。
   * 当 DB content 为空串或 null 才拉，Phase 1 dual-write 期间直接用 DB 省 round-trip。
   *
   * ★ 2026-04-22 加固：partial select 未包含 uriField 或 contentField 时打警告，
   * 避免调用方 select: { fullReport: true } 静默读到空串。
   */
  private async hydrateRowField(
    row: Record<string, unknown> | null | undefined,
    uriField: string,
    contentField: string,
  ): Promise<void> {
    if (!row) return;
    const hasUri = uriField in row;
    const hasContent = contentField in row;
    // 两个字段都不在 → 调用方明确不需要 content，正常
    if (!hasUri && !hasContent) return;
    // 只 select 了 content 但没 select uri → 无法 hydrate，打警告
    if (hasContent && !hasUri) {
      const key = `${contentField}:without:${uriField}`;
      if (!this.warnedMissingUri.has(key)) {
        this.warnedMissingUri.add(key);
        this.logger.warn(
          `[hydrate] select contains '${contentField}' but not '${uriField}'. ` +
            `Off-loaded content will be empty. Add '${uriField}: true' to select.`,
        );
      }
      return;
    }
    const uri = row[uriField] as string | null | undefined;
    const current = row[contentField] as string | null | undefined;
    if (!uri) return;
    if (current && current.length > 0) return;
    const text = await this.downloadText(uri);
    if (text !== null) {
      row[contentField] = text;
    }
  }

  private async hydrateRow(
    row: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    await this.hydrateRowField(row, "fullReportUri", "fullReport");
  }

  private async hydrateAnalysisRow(
    row: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    // summary: 保留（大部分 <2KB，未 off-load）
    await this.hydrateRowField(row, "summaryUri", "summary");
    // dataPoints: JSON 字段。对象存储里存的是 JSON.stringify 结果，反序列化回对象
    await this.hydrateJsonField(row, "dataPointsUri", "dataPoints");
  }

  /**
   * JSON 字段版本的 hydrate：从对象存储拉回文本后 JSON.parse。
   * ★ 2026-04-22 修正：只在 DB 字段严格为 null/undefined 时 hydrate，
   * 不再误判合法的空对象 `{}`（业务有可能就是空结果）。
   */
  private async hydrateJsonField(
    row: Record<string, unknown> | null | undefined,
    uriField: string,
    contentField: string,
  ): Promise<void> {
    if (!row) return;
    const hasUri = uriField in row;
    const hasContent = contentField in row;
    if (!hasUri && !hasContent) return;
    if (hasContent && !hasUri) {
      const key = `${contentField}:without:${uriField}`;
      if (!this.warnedMissingUri.has(key)) {
        this.warnedMissingUri.add(key);
        this.logger.warn(
          `[hydrate] select contains JSON '${contentField}' but not '${uriField}'. ` +
            `Off-loaded content will be empty. Add '${uriField}: true' to select.`,
        );
      }
      return;
    }
    const uri = row[uriField] as string | null | undefined;
    if (!uri) return;
    const current = row[contentField];
    // 只在 null/undefined 时 hydrate（Phase 2 清空后状态），不再拿空对象误触发
    if (current !== null && current !== undefined) return;
    const text = await this.downloadText(uri);
    if (text !== null) {
      try {
        row[contentField] = JSON.parse(text);
      } catch (error) {
        this.logger.warn(
          `[hydrate-json] parse failed for ${uri}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async hydrateEvidenceRow(
    row: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    await this.hydrateRowField(row, "snippetUri", "snippet");
  }

  private async hydrateResearchTaskRow(
    row: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    await this.hydrateJsonField(row, "resultUri", "result");
  }

  private async hydrateKnowledgeBaseDocumentRow(
    row: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    await this.hydrateRowField(row, "rawContentUri", "rawContent");
  }

  private async hydrateWikiPageRevisionRow(
    row: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    await this.hydrateRowField(row, "bodyUri", "body");
  }

  private async hydrateWikiDiffRow(
    row: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    // items 是 JSON 字段。off-load 后 DB 存 JSON null（Prisma 反序列化为 JS null）。
    // hydrateJsonField 在 current === null 时拉 R2 并 JSON.parse。
    await this.hydrateJsonField(row, "itemsUri", "items");
  }

  private async hydrateAgentPlaygroundMissionRow(
    row: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    await this.hydrateJsonField(row, "reportFullUri", "reportFull");
    await this.hydrateJsonField(
      row,
      "reconciliationReportUri",
      "reconciliationReport",
    );
    await this.hydrateJsonField(row, "leaderJournalUri", "leaderJournal");
    await this.hydrateJsonField(row, "analystOutputUri", "analystOutput");
    await this.hydrateJsonField(row, "outlinePlanUri", "outlinePlan");
  }

  private async hydrateMissionReportVersionRow(
    row: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    await this.hydrateJsonField(row, "reportFullUri", "reportFull");
  }

  /**
   * 用 $extends 的 query 钩子拦截 topicReport 所有 find 操作，
   * 把扩展后的 topicReport model 替换回 this.topicReport 属性。
   *
   * TS 类型挑战：$extends 返回的客户端类型跟 PrismaClient 分叉，
   * 为了让所有已有 Service 注入的 PrismaService 不改代码就生效，
   * 这里用 Object.defineProperty 在运行时 shadow 掉 topicReport 属性。
   */
  /** findMany 结果中并发 hydrate 上限（避免 50 条并发 50 个 R2 GET） */
  private static readonly HYDRATE_CONCURRENCY = 8;

  private installTopicReportHydration(): void {
    const concurrency = PrismaService.HYDRATE_CONCURRENCY;
    const makeHydrator =
      (hydrateFn: (row: Record<string, unknown>) => Promise<void>) =>
      async (result: unknown) => {
        if (Array.isArray(result)) {
          // 带并发上限的池子式 hydrate（避免 findMany 50 条 → 50 个 R2 GET 并发）
          let idx = 0;
          await Promise.all(
            Array.from(
              { length: Math.min(concurrency, result.length) },
              async () => {
                while (idx < result.length) {
                  const my = idx++;
                  await hydrateFn(result[my] as Record<string, unknown>);
                }
              },
            ),
          );
        } else if (result && typeof result === "object") {
          await hydrateFn(result as Record<string, unknown>);
        }
      };

    const isFindOp = (op: string) =>
      op === "findUnique" ||
      op === "findUniqueOrThrow" ||
      op === "findFirst" ||
      op === "findFirstOrThrow" ||
      op === "findMany";

    const hydrateReport = makeHydrator((r) => this.hydrateRow(r));
    const hydrateAnalysis = makeHydrator((r) => this.hydrateAnalysisRow(r));
    const hydrateEvidence = makeHydrator((r) => this.hydrateEvidenceRow(r));
    const hydrateResearchTask = makeHydrator((r) =>
      this.hydrateResearchTaskRow(r),
    );
    const hydrateKbDocument = makeHydrator((r) =>
      this.hydrateKnowledgeBaseDocumentRow(r),
    );
    const hydrateWikiRevision = makeHydrator((r) =>
      this.hydrateWikiPageRevisionRow(r),
    );
    const hydrateWikiDiff = makeHydrator((r) => this.hydrateWikiDiffRow(r));
    const hydratePlaygroundMission = makeHydrator((r) =>
      this.hydrateAgentPlaygroundMissionRow(r),
    );
    const hydrateMissionReportVersion = makeHydrator((r) =>
      this.hydrateMissionReportVersionRow(r),
    );

    const extended = this.$extends({
      query: {
        topicReport: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async $allOperations({ operation, args, query }: any) {
            const result = await query(args);
            if (isFindOp(operation)) await hydrateReport(result);
            return result;
          },
        },
        dimensionAnalysis: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async $allOperations({ operation, args, query }: any) {
            const result = await query(args);
            if (isFindOp(operation)) await hydrateAnalysis(result);
            return result;
          },
        },
        topicEvidence: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async $allOperations({ operation, args, query }: any) {
            const result = await query(args);
            if (isFindOp(operation)) await hydrateEvidence(result);
            return result;
          },
        },
        researchTask: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async $allOperations({ operation, args, query }: any) {
            const result = await query(args);
            if (isFindOp(operation)) await hydrateResearchTask(result);
            return result;
          },
        },
        knowledgeBaseDocument: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async $allOperations({ operation, args, query }: any) {
            const result = await query(args);
            if (isFindOp(operation)) await hydrateKbDocument(result);
            return result;
          },
        },
        wikiPageRevision: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async $allOperations({ operation, args, query }: any) {
            const result = await query(args);
            if (isFindOp(operation)) await hydrateWikiRevision(result);
            return result;
          },
        },
        wikiDiff: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async $allOperations({ operation, args, query }: any) {
            const result = await query(args);
            if (isFindOp(operation)) await hydrateWikiDiff(result);
            return result;
          },
        },
        agentPlaygroundMission: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async $allOperations({ operation, args, query }: any) {
            const result = await query(args);
            if (isFindOp(operation)) await hydratePlaygroundMission(result);
            return result;
          },
        },
        missionReportVersion: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async $allOperations({ operation, args, query }: any) {
            const result = await query(args);
            if (isFindOp(operation)) await hydrateMissionReportVersion(result);
            return result;
          },
        },
      },
    });

    // ★ 2026-04-22 加固：同时 shadow $transaction 让 tx.topicReport 等也走扩展版
    // 不然 $transaction(async tx => tx.topicReport.findUnique(...)) 内会拿到原版 client，
    // hydrate 不生效，事务内读到空字段。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extendedTx = (extended as any).$transaction.bind(extended);
    Object.defineProperty(this, "$transaction", {
      value: extendedTx,
      writable: false,
      configurable: true,
    });

    for (const modelKey of [
      "topicReport",
      "dimensionAnalysis",
      "topicEvidence",
      "researchTask",
      "knowledgeBaseDocument",
      "wikiPageRevision",
      "wikiDiff",
      "agentPlaygroundMission",
      "missionReportVersion",
    ] as const) {
      Object.defineProperty(this, modelKey, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        value: (extended as any)[modelKey],
        writable: false,
        configurable: true,
      });
    }

    this.logger.log(
      `[Prisma] hydration installed for topicReport / dimensionAnalysis / topicEvidence / researchTask / knowledgeBaseDocument / wikiPageRevision / wikiDiff / agentPlaygroundMission / missionReportVersion (bucket=${this.objectStorage?.bucket ?? "lazy"})`,
    );
  }

  // ──────────────────────────────────────────────────────────────────────────────

  // ★ 2026-05-25 机制级修：在 onApplicationShutdown（生命周期最后一阶段）断开，
  //   而非 onModuleDestroy。NestJS 顺序为 onModuleDestroy → beforeApplicationShutdown
  //   → onApplicationShutdown，前一阶段对所有 provider 跑完才进下一阶段。这样所有
  //   服务在 onModuleDestroy 里的关停 DB 收尾（健康检查存 checkpoint、StorageOffload
  //   解锁、scheduler 收尾等）执行时 Prisma 仍连接，杜绝关停期 "Engine is not yet
  //   connected" / "Response from the Engine was empty" 批量报错。
  async onApplicationShutdown(_signal?: string) {
    await this.$disconnect();
  }

  /**
   * 数据库健康检查
   */
  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    latency: number;
    message?: string;
  }> {
    const start = Date.now();
    try {
      await this.$queryRaw`SELECT 1`;
      return {
        status: "healthy",
        latency: Date.now() - start,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        latency: Date.now() - start,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 获取数据库统计信息（用于监控）
   */
  async getPoolStats(): Promise<{
    activeConnections: number;
    idleConnections: number;
    waitingRequests: number;
  }> {
    // Prisma 不直接暴露连接池统计，通过 pg_stat_activity 获取
    try {
      const result = await this.$queryRaw<
        { state: string; count: bigint }[]
      >`SELECT state, COUNT(*) as count FROM pg_stat_activity WHERE datname = current_database() GROUP BY state`;

      let active = 0;
      let idle = 0;

      for (const row of result) {
        if (row.state === "active") active = Number(row.count);
        if (row.state === "idle") idle = Number(row.count);
      }

      return {
        activeConnections: active,
        idleConnections: idle,
        waitingRequests: 0, // Prisma 不暴露这个信息
      };
    } catch {
      return {
        activeConnections: 0,
        idleConnections: 0,
        waitingRequests: 0,
      };
    }
  }

  /**
   * Migration History (Moved to Prisma migrations):
   *
   * 1. ResourceUpvote table
   *    - Created via Prisma migration
   *    - Previously auto-created in runtime (removed 2025-01-24)
   *
   * 2. SystemSetting columns
   *    - encrypted: Added via Prisma migration
   *    - Previously auto-created in runtime (removed 2025-01-24)
   *
   * 3. WritingChapter columns
   *    - metadata: Added via Prisma migration
   *    - Previously auto-created in runtime (removed 2025-01-24)
   *
   * All schema changes should now be managed through Prisma migrations:
   * - Run: npx prisma migrate dev --name description
   * - Deploy: npx prisma migrate deploy
   */
}
