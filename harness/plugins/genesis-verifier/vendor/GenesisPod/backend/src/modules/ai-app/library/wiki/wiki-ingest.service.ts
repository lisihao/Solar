import * as crypto from "crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  AIModelType,
  Prisma,
  WikiDiff,
  WikiDiffStatus,
  WikiKnowledgeBaseConfig,
} from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { KnowledgeBaseService } from "../rag/services/knowledge-base.service";
import { WikiDiffService } from "./wiki-diff.service";
import {
  WikiDiffItemsSchema,
  WikiDiffCreateItemSchema,
  WikiDiffUpdateItemSchema,
} from "./dto/wiki-diff-items.schema";
import {
  AiChatService,
  SkillLoaderService,
  wrapExternalContent,
} from "../../../ai-engine/facade";

export type WikiIngestCandidateState =
  | "READY_NEW"
  | "READY_STALE"
  | "READY_COVERED"
  | "BLOCKED";

/**
 * Observable metrics from the most recent ingest call (P1 commit 3 —
 * Reviewer D 建议 expose metric channel so spec/E2E can drive退场断言
 * without re-deriving从 LLM 原始 response).
 *
 * Set at the end of `ingestInternal()` (after WikiDiff persisted, before
 * return). Read-only consumer surface; mutation only from inside the
 * service. `null` when no successful ingest has run on this instance yet.
 */
export interface WikiIngestMetrics {
  /** sources soft-truncated to schema cap (oneLiner > 280 chars trimmed). */
  truncatedOneLiners: number;
  /** sources dropped by the 4-invariant soft-drop filter (not zod). */
  droppedSources: number;
  /** total sources observed across all items before soft-drop. */
  totalSourcesSeen: number;
  /** drop reasons breakdown (notObject / unknownDoc / spanInvalid / quoteInvalid). */
  droppedByReason: Record<string, number>;
  /** count of CREATE items in the validated diff. */
  pageCount: number;
  /** average body length (chars) across CREATE items; 0 when pageCount === 0. */
  avgBodyLength: number;
  /** fraction of CREATE pages whose body contains at least one `## ` H2 header. */
  h2CoverageRate: number;
}

/**
 * Sentinel value stored in `WikiDiff.createdByUserId` for diffs produced by
 * the auto-ingest scheduler (PR-1). Daily-budget queries filter by this so
 * user-triggered diffs are not counted against the cron quota and vice
 * versa. Not a foreign key — `createdByUserId` is a plain `String` column.
 */
export const AUTO_INGEST_SYSTEM_USER_ID = "__system_auto_ingest__";

export interface WikiIngestCandidate {
  id: string;
  title: string;
  sourceType: string;
  mimeType: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
  chunkCount: number;
  lastError: string | null;
  pageReferenceCount: number;
  lastCitedAt: Date | null;
  ingestState: WikiIngestCandidateState;
  recommended: boolean;
  reason: string;
}

/**
 * WikiIngestService — LLM orchestration for wiki diff proposal (v1.5.3 §5.1).
 *
 * Flow:
 *  1. Load + validate documents (must belong to kbId)
 *  2. Read WikiKnowledgeBaseConfig.ingestMaxTokens (default 80_000) and
 *     truncate raw context accordingly
 *  3. wrapExternalContent on every doc rawContent with explicit maxLength
 *     budgeted from remaining token capacity (security R2 P2)
 *  4. Compute baselineHash from current wiki index
 *  5. Resolve `wiki-ingest` skill prompt via SkillLoaderService (the SKILL.md
 *     lives at `skills/wiki-ingest.skill.md` and is bridged into the engine
 *     SkillRegistry from WikiModule.onModuleInit through
 *     `PromptSkillBridge.registerDomain("library")`); single-turn LLM call
 *     with structured JSON output, NO multi-turn agent loop
 *     (MECE rule 1: engine knows no agent/mission state).
 *  6. Parse LLM JSON response → zod validate → persist WikiDiff with
 *     status=PENDING and affectedSlugs computed from items
 *  7. Return diffId for subsequent /diffs/:diffId fetch + apply
 */
/**
 * 2026-05-19 fire-and-forget 进度感知：service 在 SINGLE / MULTI 各 stage 写
 * in-memory 进度，前端轮询 GET /library/wiki/:kbId/ingest-progress 拿真实状态。
 *
 * pod 重启会丢（accepted —— pod 重启 ingest pipeline 本身也丢；前端 controller
 * 会查不到 → banner 自动消失，用户 retry 即可）。
 *
 * 不写 DB 持久化的理由：避免 KB.progressJson 字段被 embedding（已使用）和
 * wiki ingest 双重写入冲突；新加 schema 字段又要 migration。in-memory 这一波
 * 足够支撑 UX。后续可上 Redis bridge 或独立 schema 列。
 */
export type WikiIngestStage =
  | "starting"
  | "load-docs"
  | "outline"
  | "section-fill"
  | "cross-link"
  | "persist"
  | "completed"
  | "failed";

export interface WikiIngestProgress {
  status: "running" | "completed" | "failed";
  stage: WikiIngestStage;
  startedAt: string; // ISO
  finishedAt?: string; // ISO；status=completed/failed 时填
  /** SINGLE / MULTI 取 config.ingestPassMode；前端展示用。 */
  passMode: "SINGLE" | "MULTI";
  /** section-fill 阶段：当前页完成数 / 总页数 */
  pagesDone?: number;
  pagesTotal?: number;
  /** persist 后写入；前端用 diffId 跳到 PENDING diff 详情 */
  diffId?: string;
  /** status=failed 时填，user-facing 简短原因 */
  errorMessage?: string;
  /**
   * section-fill 阶段失败的页 slug 列表（partial-success 场景）。
   * status=completed 且 failedSlugs.length>0 表示"部分成功"，前端可展示
   * "X 页成功 / Y 页失败 — slugs..."；用户对失败 slug 单独重试。
   */
  failedSlugs?: string[];
}

@Injectable()
export class WikiIngestService {
  private readonly logger = new Logger(WikiIngestService.name);

  /**
   * Snapshot of the most recent `ingestInternal()` run (P1 commit 3).
   * Reset to a fully-populated object whenever a diff is successfully
   * persisted. `null` until the first success. Used by spec / E2E /
   * future API exposure to gate on退场条件 without re-parsing LLM output.
   */
  public lastIngestMetrics: WikiIngestMetrics | null = null;

  /**
   * 2026-05-19 in-memory progress map for fire-and-forget UX (see type
   * comment above). Keys are knowledgeBaseId; entries automatically cleared
   * 5 min after completion / failure so stale rows don't accumulate.
   */
  private readonly progress = new Map<string, WikiIngestProgress>();
  private readonly progressCleanupTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly kbService: KnowledgeBaseService,
    private readonly diffService: WikiDiffService,
    private readonly chat: AiChatService,
    private readonly skillLoader: SkillLoaderService,
  ) {}

  /**
   * Read current progress for a KB; returns null if no run in flight or
   * the entry already cleaned up (5 min after completion/failure).
   */
  getIngestProgress(knowledgeBaseId: string): WikiIngestProgress | null {
    return this.progress.get(knowledgeBaseId) ?? null;
  }

  /**
   * Public marker for fire-and-forget catch path (controller wraps the
   * async pipeline in a .catch; service内 throw 后 progress 仍停在最后
   * stage='running'，需要 controller 兜底写 failed 状态). user-facing
   * errorMessage is truncated to 200 chars to keep banner UI tidy.
   */
  markIngestFailed(knowledgeBaseId: string, errorMessage: string): void {
    this.setProgress(knowledgeBaseId, {
      status: "failed",
      stage: "failed",
      finishedAt: new Date().toISOString(),
      errorMessage: errorMessage.slice(0, 200),
    });
  }

  private setProgress(
    knowledgeBaseId: string,
    patch: Partial<WikiIngestProgress>,
  ): void {
    const prev = this.progress.get(knowledgeBaseId);
    const next: WikiIngestProgress = {
      // 防 partial-only patches without base 字段
      status: "running",
      stage: "starting",
      startedAt: new Date().toISOString(),
      passMode: "SINGLE",
      ...prev,
      ...patch,
    };
    this.progress.set(knowledgeBaseId, next);
    // 清理已有 cleanup timer，重新跑时不要被旧 timer 提前清掉
    const oldTimer = this.progressCleanupTimers.get(knowledgeBaseId);
    if (oldTimer) clearTimeout(oldTimer);
    // 状态终结时安排 5 min 后清理
    if (next.status === "completed" || next.status === "failed") {
      const timer = setTimeout(() => {
        this.progress.delete(knowledgeBaseId);
        this.progressCleanupTimers.delete(knowledgeBaseId);
      }, 5 * 60_000);
      this.progressCleanupTimers.set(knowledgeBaseId, timer);
    }
  }

  /**
   * Trigger ingest. Returns the persisted PENDING WikiDiff for user review.
   * Does NOT apply — apply requires a separate explicit user action.
   */
  async ingest(
    userId: string,
    knowledgeBaseId: string,
    documentIds: string[],
  ): Promise<WikiDiff> {
    if (!documentIds || documentIds.length === 0) {
      this.logger.warn(
        `[ingest pre] userId=${userId} kb=${knowledgeBaseId} reason=empty-documentIds`,
      );
      throw new BadRequestException("documentIds must not be empty");
    }

    await this.assertEditorAccessAndWikiEnabled(userId, knowledgeBaseId);
    return this.ingestInternal(userId, knowledgeBaseId, documentIds);
  }

  /**
   * Cron entry for auto-ingest after raw refresh (PR-1). Bypasses user
   * auth — caller is the trusted internal scheduler.
   *
   * ★ 2026-05-11 BYOK 一致性原则：知识库相关 LLM 调用必须用 KB owner 的 BYOK
   *   key，不退回系统 key。Records 的 createdByUserId 用哨兵字符串只是为了
   *   按 cron / user 分类查每日预算，跟 LLM key 解析完全解耦。
   *
   * @param ownerUserId KB.userId — 真实用户 id，作为 chat.chat 的 BYOK 上下文
   */
  async ingestAsCron(
    knowledgeBaseId: string,
    documentIds: string[],
    ownerUserId: string,
  ): Promise<WikiDiff> {
    if (!documentIds || documentIds.length === 0) {
      this.logger.warn(
        `[ingest pre cron] kb=${knowledgeBaseId} owner=${ownerUserId} reason=empty-documentIds`,
      );
      throw new BadRequestException("documentIds must not be empty");
    }
    if (!ownerUserId) {
      this.logger.warn(
        `[ingest pre cron] kb=${knowledgeBaseId} docs=${documentIds.length} reason=missing-ownerUserId`,
      );
      throw new BadRequestException(
        "ownerUserId is required for cron ingest (BYOK-only mode)",
      );
    }
    return this.ingestInternal(
      AUTO_INGEST_SYSTEM_USER_ID,
      knowledgeBaseId,
      documentIds,
      ownerUserId,
    );
  }

  /**
   * @param recordUserId 写入 WikiDiff.createdByUserId（用户路径=真实 userId；
   *   cron 路径=AUTO_INGEST_SYSTEM_USER_ID 哨兵）
   * @param chatUserId chat.chat({ userId }) 的 BYOK 解析上下文。默认 =
   *   recordUserId（用户路径）；cron 路径要传 KB owner 的真实 userId
   *   覆盖哨兵字符串，否则 strict BYOK 预检会 fail。
   */
  private async ingestInternal(
    recordUserId: string,
    knowledgeBaseId: string,
    documentIds: string[],
    chatUserId: string = recordUserId,
  ): Promise<WikiDiff> {
    const userId = recordUserId;
    // Entry log — emit BEFORE any throwable so future grep can correlate
    // start ↔ failure / success on a single ingest run.
    this.logger.log(
      `[ingest start] userId=${userId} chatUserId=${chatUserId} kb=${knowledgeBaseId} docs=${documentIds.length}`,
    );
    // 2026-05-19 fire-and-forget UX：在 SINGLE / MULTI pass mode 之前先初始化
    // progress 为 'starting'。后续 dispatcher 会 patch passMode + stage。
    this.setProgress(knowledgeBaseId, {
      status: "running",
      stage: "starting",
      startedAt: new Date().toISOString(),
      passMode: "SINGLE", // 默认值；下方读 config 后 patch
    });
    // Load + validate documents (must belong to this KB).
    const documents = await this.prisma.knowledgeBaseDocument.findMany({
      where: { id: { in: documentIds }, knowledgeBaseId },
      // rawContentUri 必须同 select：off-load 后 rawContent 列为 ""，
      // PrismaService hydrate hook 用 rawContentUri 透明回填 R2 内容。
      // W2 v2.0 rebuild：metadata.preparse.mediaUrls 用于 prompt 图片注入
      select: {
        id: true,
        title: true,
        rawContent: true,
        rawContentUri: true,
        metadata: true,
      },
    });
    if (documents.length !== documentIds.length) {
      const missing = documentIds.filter(
        (id) => !documents.some((d) => d.id === id),
      );
      this.logger.warn(
        `[ingest load-docs] userId=${userId} kb=${knowledgeBaseId} requested=${documentIds.length} found=${documents.length} missing=${missing.slice(0, 5).join(",")}${missing.length > 5 ? "..." : ""}`,
      );
      throw new NotFoundException(
        `Some documents not found or do not belong to KB ${knowledgeBaseId}`,
      );
    }

    // Read config (default fallback if config row absent).
    const config = await this.prisma.wikiKnowledgeBaseConfig.findUnique({
      where: { knowledgeBaseId },
    });
    const ingestMaxTokens = config?.ingestMaxTokens ?? 80_000;

    // ★ MULTI pass dispatcher (2026-05-12 §P2): when admin set
    //   WikiKnowledgeBaseConfig.ingestPassMode='MULTI', run the 3-stage
    //   pipeline (outline → section-fill parallel → cross-link). Each
    //   page gets its own LLM call with 8K maxTokens → page bodies grow
    //   from ~800 chars (stub) to ~24K chars (Wikipedia mid-tier depth).
    //   SINGLE remains the default (safe fallback) and 100% backward
    //   compatible — old KBs see no behavior change.
    if (config?.ingestPassMode === "MULTI") {
      this.setProgress(knowledgeBaseId, {
        passMode: "MULTI",
        stage: "outline",
      });
      return this.runMultiPassPipeline(
        userId,
        knowledgeBaseId,
        documents,
        config,
        chatUserId,
      );
    }
    this.setProgress(knowledgeBaseId, { passMode: "SINGLE" });

    // Approximate char budget per doc (~4 chars per token). NOTE: gap #1
    // fix (2026-05-12) removes the `/ 2` halving — earlier code sent only
    // half the source material to the LLM, which directly capped wiki
    // page depth. Now LLM sees the full doc up to the token budget.
    const totalCharBudget = ingestMaxTokens * 4;
    const perDocMaxLength = Math.max(
      500,
      Math.floor(totalCharBudget / Math.max(documents.length, 1)),
    );

    // Wrap each doc's rawContent with explicit maxLength (security R2 P2).
    // Prefix each wrapped block with the documentId so the LLM can quote it
    // verbatim in `sources[].documentId` (otherwise it hallucinates UUIDs).
    const wrappedDocs = documents.map(
      (d) =>
        `[documentId: ${d.id}]\n` +
        wrapExternalContent(d.rawContent ?? "", {
          source: "kb_document",
          title: d.title,
          maxLength: perDocMaxLength,
        }),
    );
    const allowedDocumentIds = new Set(documents.map((d) => d.id));

    // Compute baseline hash from current wiki index.
    const baselineHash =
      await this.diffService.computeKbBaselineHash(knowledgeBaseId);

    // Load current wiki index for the LLM.
    const currentIndex = await this.prisma.wikiPage.findMany({
      where: { knowledgeBaseId },
      select: {
        slug: true,
        title: true,
        category: true,
        oneLiner: true,
      },
      orderBy: { slug: "asc" },
    });

    // Resolve the system prompt from the registered `wiki-ingest` skill
    // (skills/wiki-ingest.skill.md → PromptSkillBridge.registerDomain("library")
    // wired in WikiModule.onModuleInit). Single-turn LLM call + structured
    // JSON output — no tool calling loop, no agent/mission semantics.
    const skillDef = await this.skillLoader.getSkillById("wiki-ingest");
    if (!skillDef) {
      this.logger.error(
        `[ingest skill] userId=${userId} kb=${knowledgeBaseId} reason=wiki-ingest-skill-not-loaded — check WikiModule.onModuleInit`,
      );
      throw new BadRequestException(
        "Wiki ingest skill is not available; please retry",
      );
    }
    const systemPrompt = skillDef.content;

    // W2 v2.0 rebuild：聚合所有文档的 preparse mediaUrls（W1 产出），让 prompt 携带
    //   源图 URL 让 LLM 写 page body 时引用 → 图文并茂。
    //   metadata.preparse 仅 URL/YT 类源文档有；手贴文本 metadata.preparse=undefined，
    //   此处合并去重即可，空数组时 buildUserPrompt 不渲染 MEDIA_URLS 块。
    const aggregatedMediaUrls = this.collectPreparseMediaUrls(documents);
    // gap #1 + #4 (2026-05-12): pass enabledLocales as TARGET_LOCALES (single
    // or bilingual) + per-doc sourceLocale hints from W1 preparse.
    const targetLocales = (config?.enabledLocales ?? ["zh"]).filter(
      (v): v is "zh" | "en" => v === "zh" || v === "en",
    );
    const sourceLocaleHints = this.collectSourceLocaleHints(documents);
    const userPrompt = this.buildUserPrompt(
      currentIndex,
      wrappedDocs,
      aggregatedMediaUrls,
      targetLocales.length > 0 ? targetLocales : ["zh"],
      sourceLocaleHints,
    );

    let llmResponse!: Awaited<ReturnType<AiChatService["chat"]>>;
    try {
      // Use semantic TaskProfile per .claude/rules/ai-engine.md — never hardcode
      // model/temperature/maxTokens. deterministic+long fits structured JSON
      // extraction (was temperature 0.2 / maxTokens 8000).
      //
      // ★ 2026-05-11 BYOK 一致性原则：知识库 LLM 调用必须用真实 user 的 BYOK
      //   key，不退回系统 key。
      //   - user 触发：chatUserId = recordUserId = 真实用户 id（默认值）
      //   - cron 触发：chatUserId = KB.userId（KB owner）；recordUserId = 哨兵
      //     字符串（仅写 WikiDiff.createdByUserId 用于分类记账）
      // W2 v2.0 rebuild：creativity 由 deterministic 改 low。
      //   - deterministic (temp 0.1) 偏保守，LLM 几乎只产 SOURCE 类页面
      //     (Screenshot_64 用户反馈"为什么只有 SOURCE")
      //   - low (temp 0.3) 仍可控但允许 LLM 主动产 ENTITY/CONCEPT/SUMMARY，
      //     符合更新的 skill prompt 强制 fan-out 要求
      //   全 3-pass DAG (outline → section-fill → cross-link) 见 v2-rebuild-plan
      //   §4.W2 + 2026-05-12-multi-pass-and-locale-consensus.md（后续 PR 落地）。
      llmResponse = await this.chat.chat({
        messages: [{ role: "user", content: userPrompt }],
        systemPrompt,
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "low",
          outputLength: "long",
        },
        responseFormat: "json_object",
        operationName: "library-wiki-ingest",
        userId: chatUserId,
        // 2026-05-12 真因：KB 内文档（含 Playground 报告里的 critic L4 /
        // leader signoff 评分内容）被 prompt-injection-detector 误判 Jailbreak。
        // wiki-ingest 输入来自**用户自己已写入 KB 的可信文档**，不是用户裸输入，
        // 跳过 input guardrails；输出 guardrails 仍照走（默认）。
        skipGuardrails: true,
      });
    } catch (error) {
      this.logger.error(
        `[ingest llm] userId=${userId} chatUserId=${chatUserId} kb=${knowledgeBaseId} docs=${documentIds.length} reason=llm-call-failed err=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException(
        "Wiki ingest LLM call failed; please retry",
      );
    }

    // Parse LLM JSON into items shape.
    const rawItems = this.extractJson(llmResponse.content);

    // Pre-clean: drop sources that fail any of the 4 source-schema invariants
    // (one bad cite must not 400 the whole diff — per feedback_llm_id_must_be_
    // in_prompt_and_whitelist three-prong rule: prompt explicit + service soft-
    // drop + zod is last-resort net). Mutates the parsed JSON in place; zod
    // runs after to enforce the rest of the shape.
    let droppedSources = 0;
    const droppedByReason = {
      notObject: 0,
      unknownDoc: 0,
      spanInvalid: 0,
      quoteInvalid: 0,
    };
    let totalSourcesSeen = 0;
    let truncatedOneLiners = 0;
    if (rawItems && typeof rawItems === "object" && !Array.isArray(rawItems)) {
      const obj = rawItems as Record<string, unknown>;
      const filterArr = (arr: unknown[]) => {
        for (const it of arr) {
          if (it && typeof it === "object" && "sources" in it) {
            const sources = (it as { sources?: unknown }).sources;
            if (Array.isArray(sources)) {
              totalSourcesSeen += sources.length;
              const kept = sources.filter((s) => {
                if (!s || typeof s !== "object") {
                  droppedSources += 1;
                  droppedByReason.notObject += 1;
                  return false;
                }
                const o = s as Record<string, unknown>;
                // documentId: must be a known id in the supplied whitelist
                if (
                  typeof o.documentId !== "string" ||
                  !allowedDocumentIds.has(o.documentId)
                ) {
                  droppedSources += 1;
                  droppedByReason.unknownDoc += 1;
                  return false;
                }
                // spanStart / spanEnd: required non-negative integers with
                // spanStart <= spanEnd (LLMs frequently omit these or emit
                // floats / negatives — drop rather than blow up zod).
                if (
                  typeof o.spanStart !== "number" ||
                  !Number.isInteger(o.spanStart) ||
                  o.spanStart < 0
                ) {
                  droppedSources += 1;
                  droppedByReason.spanInvalid += 1;
                  return false;
                }
                if (
                  typeof o.spanEnd !== "number" ||
                  !Number.isInteger(o.spanEnd) ||
                  o.spanEnd < o.spanStart
                ) {
                  droppedSources += 1;
                  droppedByReason.spanInvalid += 1;
                  return false;
                }
                // quote: required 1-2000 char string
                if (
                  typeof o.quote !== "string" ||
                  o.quote.length < 1 ||
                  o.quote.length > 2000
                ) {
                  droppedSources += 1;
                  droppedByReason.quoteInvalid += 1;
                  return false;
                }
                return true;
              });
              (it as { sources: unknown[] }).sources = kept;
            }
          }
        }
      };
      if (Array.isArray(obj.creates)) filterArr(obj.creates);
      if (Array.isArray(obj.updates)) filterArr(obj.updates);

      // Soft-truncate oneLiner / newOneLiner to schema max (280) instead of
      // letting one bloated summary 400 the entire diff. Same three-prong
      // logic as sources: prompt says "≤ 280", service trims defensively,
      // zod is the last-resort net (per
      // feedback_llm_id_must_be_in_prompt_and_whitelist).
      const trimOneLiner = (
        arr: unknown[],
        field: "oneLiner" | "newOneLiner",
      ) => {
        for (const it of arr) {
          if (!it || typeof it !== "object") continue;
          const o = it as Record<string, unknown>;
          const v = o[field];
          if (typeof v === "string" && v.length > 280) {
            o[field] = v.slice(0, 277).trimEnd() + "...";
            truncatedOneLiners += 1;
          }
        }
      };
      if (Array.isArray(obj.creates)) trimOneLiner(obj.creates, "oneLiner");
      if (Array.isArray(obj.updates)) trimOneLiner(obj.updates, "newOneLiner");
      if (truncatedOneLiners > 0) {
        this.logger.warn(
          `[ingest] kb=${knowledgeBaseId} soft-truncated ${truncatedOneLiners} oneLiner(s) over 280 chars`,
        );
      }
    }

    // If the LLM tried to cite at all but every single citation was
    // hallucinated, the diff has zero provenance — refuse it rather than
    // silently persist evidence-less changes (per v1.5.3 §11.1 sources are
    // evidence). Items that legitimately cite zero sources are still allowed.
    if (totalSourcesSeen > 0 && droppedSources === totalSourcesSeen) {
      this.logger.warn(
        `[ingest sources] userId=${userId} kb=${knowledgeBaseId} reason=all-sources-hallucinated seen=${totalSourcesSeen} dropped=${droppedSources} reasons=${JSON.stringify(droppedByReason)}`,
      );
      throw new BadRequestException(
        "LLM ingest produced no valid source citations; please retry",
      );
    }

    const validated = WikiDiffItemsSchema.safeParse(rawItems);
    if (!validated.success) {
      this.logger.warn(
        `[ingest schema] userId=${userId} kb=${knowledgeBaseId} reason=zod-validation-failed err=${validated.error.message.slice(0, 300)}`,
      );
      throw new BadRequestException(
        "LLM ingest output failed schema validation; please retry",
      );
    }
    const items = validated.data;
    if (droppedSources > 0) {
      const breakdown = Object.entries(droppedByReason)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}=${n}`)
        .join(", ");
      this.logger.warn(
        `[ingest] kb=${knowledgeBaseId} dropped ${droppedSources}/${totalSourcesSeen} sources (${breakdown})`,
      );
    }

    // Compute affectedKeys (slug:locale) from validated items.
    // P3 BLOCKER C2 — collision detection 跨 locale 用 slug:locale 联合 key。
    // W3 v2.0 rebuild：DEFAULT_LOCALE 来自 KB config.enabledLocales[0]（admin 选择），
    //   不再硬编码 'zh'。单语 KB → 该语种；双语 KB → 优先 zh，跨语种翻译走多 pass。
    //   config 缺失或 enabledLocales 为空 → fallback 'zh' 保 backward compat。
    const DEFAULT_LOCALE =
      (config?.enabledLocales?.[0] as "zh" | "en" | undefined) ?? "zh";
    const affectedKeys = [
      ...new Set([
        ...items.creates.map(
          (c) =>
            `${c.slug}:${(c as { locale?: string }).locale ?? DEFAULT_LOCALE}`,
        ),
        ...items.updates.map(
          (u) =>
            `${u.slug}:${(u as { locale?: string }).locale ?? DEFAULT_LOCALE}`,
        ),
        ...items.deletes.map((s) => `${s}:${DEFAULT_LOCALE}`),
      ]),
    ];

    // Persist PENDING diff.
    this.setProgress(knowledgeBaseId, { stage: "persist" });
    const diff = await this.prisma.wikiDiff.create({
      data: {
        knowledgeBaseId,
        status: WikiDiffStatus.PENDING,
        items: items as unknown as Prisma.InputJsonValue,
        baselineHash,
        affectedKeys,
        createdByUserId: userId,
      },
    });

    this.setProgress(knowledgeBaseId, {
      status: "completed",
      stage: "completed",
      finishedAt: new Date().toISOString(),
      diffId: diff.id,
    });
    this.logger.log(
      `[ingest] kb=${knowledgeBaseId} diff=${diff.id} creates=${items.creates.length} updates=${items.updates.length} deletes=${items.deletes.length}`,
    );

    // W2 v2.0 rebuild：observability — SOURCE-only 输出告警（Screenshot_64 痛点）
    this.logCategoryDistribution(items.creates, knowledgeBaseId);

    // P1 commit 3 — Reviewer D 建议 expose 可观测 metric so spec / future
    // E2E can gate on退场条件 without re-parsing the persisted JSON. Only
    // CREATE items contribute to body / H2 stats (UPDATE 只携带 newBody
    // delta, P1 baseline 不在 update path 衡量).
    const pages = [...items.creates];
    const avgBodyLength =
      pages.length === 0
        ? 0
        : Math.round(
            pages.reduce((s, p) => s + (p.body?.length ?? 0), 0) / pages.length,
          );
    const h2CoverageRate =
      pages.length === 0
        ? 0
        : pages.filter((p) => /^## /m.test(p.body ?? "")).length / pages.length;
    this.lastIngestMetrics = {
      truncatedOneLiners,
      droppedSources,
      totalSourcesSeen,
      droppedByReason,
      pageCount: pages.length,
      avgBodyLength,
      h2CoverageRate,
    };

    return diff;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MULTI PASS PIPELINE (2026-05-12 §P2)
  //
  // Three sequential LLM calls instead of one god-call. Each call is
  // independent and stateless; we orchestrate state through service-layer
  // variables and the WikiIngestDraft checkpoint table.
  //
  //   Pass 1 (OUTLINE)      : 1 call, ~3K out tokens
  //                            → page proposals (slug/title/category/skeleton)
  //   Pass 2 (SECTION-FILL) : N calls, 8K out each, K-way concurrent
  //                            → one full page body per call
  //                            → fail-tolerant per ingestSectionFailureToleranceRatio
  //                            → partial-progress checkpoint to WikiIngestDraft
  //   Pass 3 (CROSS-LINK)   : 1 call, ~3K out tokens
  //                            → [[slug]] insertions across all bodies
  //
  // After 3 passes, assemble final WikiDiffItems shape and reuse the same
  // soft-drop + zod validation + persist path as SINGLE mode (see
  // commitMultiPassItems below).
  // ═══════════════════════════════════════════════════════════════════════

  private async runMultiPassPipeline(
    userId: string,
    knowledgeBaseId: string,
    documents: Array<{
      id: string;
      title: string;
      rawContent: string | null;
      rawContentUri: string | null;
      metadata: Prisma.JsonValue;
    }>,
    config: WikiKnowledgeBaseConfig,
    chatUserId: string,
  ): Promise<WikiDiff> {
    const ingestMaxTokens = config.ingestMaxTokens ?? 80_000;
    const totalCharBudget = ingestMaxTokens * 4;
    const perDocMaxLength = Math.max(
      500,
      Math.floor(totalCharBudget / Math.max(documents.length, 1)),
    );
    const wrappedDocs = documents.map(
      (d) =>
        `[documentId: ${d.id}]\n` +
        wrapExternalContent(d.rawContent ?? "", {
          source: "kb_document",
          title: d.title,
          maxLength: perDocMaxLength,
        }),
    );
    const allowedDocumentIds = new Set(documents.map((d) => d.id));
    const baselineHash =
      await this.diffService.computeKbBaselineHash(knowledgeBaseId);
    const currentIndex = await this.prisma.wikiPage.findMany({
      where: { knowledgeBaseId },
      select: { slug: true, title: true, category: true, oneLiner: true },
      orderBy: { slug: "asc" },
    });
    const targetLocales = (config.enabledLocales ?? ["zh"]).filter(
      (v): v is "zh" | "en" => v === "zh" || v === "en",
    );
    const aggregatedMediaUrls = this.collectPreparseMediaUrls(documents);

    const diffSessionId = crypto.randomUUID();

    this.logger.log(
      `[ingest/MULTI] kb=${knowledgeBaseId} session=${diffSessionId} docs=${documents.length} target=${targetLocales.join(",")}`,
    );

    // ── Pass 1: OUTLINE ─────────────────────────────────────────────
    const outline = await this.runOutlinePass({
      wrappedDocs,
      currentIndex,
      targetLocales: targetLocales.length > 0 ? targetLocales : ["zh"],
      chatUserId,
      knowledgeBaseId,
      ingestOutlineMaxPages: config.ingestOutlineMaxPages ?? undefined,
    });

    if (outline.creates.length === 0 && outline.updates.length === 0) {
      this.logger.warn(
        `[ingest/MULTI outline] userId=${userId} kb=${knowledgeBaseId} reason=outline-empty creates=0 updates=0 deletes=${outline.deletes.length}`,
      );
      throw new BadRequestException(
        "Wiki ingest outline produced 0 pages; please retry",
      );
    }

    // Resolve groupLabel → translationGroupId (UUID v4) at service layer.
    // LLM cannot mint UUIDs reliably (BLOCKER #9 of 2026-05-12 consensus).
    const groupLabelToUuid = new Map<string, string>();
    const resolveTranslationGroupId = (label?: string): string | undefined => {
      if (!label) return undefined;
      const cached = groupLabelToUuid.get(label);
      if (cached) return cached;
      const uuid = crypto.randomUUID();
      groupLabelToUuid.set(label, uuid);
      return uuid;
    };

    // ── Pass 2: SECTION-FILL (parallel, fail-tolerant, checkpointed) ──
    const concurrency = Math.max(1, config.ingestSectionConcurrency ?? 3);
    // ★ 2026-05-13 P-#14: tolerance 默认 0.2 → 0.5。section-fill 是 per-page
    //   LLM 调用，rate-limit / content-too-large / 429 单页失败 20-30% 是常
    //   见噪声；20% 阈值会把 10 个成功页连同 3 个失败页一起 throw 掉，让用户
    //   重跑整批（再付一遍 LLM 成本）。0.5 仍能拦"模型整体崩了"的真异常。
    const failureToleranceRatio =
      config.ingestSectionFailureToleranceRatio ?? 0.5;
    this.setProgress(knowledgeBaseId, {
      stage: "section-fill",
      pagesDone: 0,
      pagesTotal: outline.creates.length + outline.updates.length,
    });
    const allOutlineItems: Array<{
      kind: "create" | "update";
      slug: string;
      locale: "zh" | "en";
      title?: string;
      category?: "ENTITY" | "CONCEPT" | "SUMMARY" | "SOURCE";
      sectionSkeleton: string[];
      translationGroupId?: string;
      priorBody?: string;
    }> = [
      ...outline.creates.map((c) => ({
        kind: "create" as const,
        slug: c.slug,
        locale: c.locale,
        title: c.title,
        category: c.category,
        sectionSkeleton: c.sectionSkeleton,
        translationGroupId: resolveTranslationGroupId(c.groupLabel),
      })),
      ...outline.updates.map((u) => ({
        kind: "update" as const,
        slug: u.slug,
        locale: u.locale,
        sectionSkeleton: u.sectionSkeleton,
      })),
    ];

    // Load priorBody for UPDATEs so section-fill can edit surgically.
    // 2026-05-14 P0-A: index by `slug:locale` to handle bilingual KBs where
    // the same slug owns two pages (zh + en).
    if (outline.updates.length > 0) {
      const priorBodies = await this.prisma.wikiPage.findMany({
        where: {
          knowledgeBaseId,
          slug: { in: outline.updates.map((u) => u.slug) },
        },
        select: { slug: true, locale: true, body: true },
      });
      const bodyByKey = new Map(
        priorBodies.map((p) => [`${p.slug}:${p.locale}`, p.body]),
      );
      for (const item of allOutlineItems) {
        if (item.kind === "update") {
          item.priorBody = bodyByKey.get(`${item.slug}:${item.locale}`);
        }
      }
    }

    const sectionResults: Array<{
      kind: "create" | "update";
      slug: string;
      locale: "zh" | "en";
      title?: string;
      category?: "ENTITY" | "CONCEPT" | "SUMMARY" | "SOURCE";
      body: string;
      oneLiner: string;
      sources: Array<{
        documentId: string;
        spanStart: number;
        spanEnd: number;
        quote: string;
      }>;
      translationGroupId?: string;
    }> = [];
    const failedSlugs: string[] = [];

    for (let i = 0; i < allOutlineItems.length; i += concurrency) {
      const batch = allOutlineItems.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        batch.map((item) =>
          this.runSectionFillPass({
            item,
            documents,
            allowedDocumentIds,
            wrappedDocs,
            mediaUrls: aggregatedMediaUrls,
            chatUserId,
            knowledgeBaseId,
          }),
        ),
      );
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j];
        const item = batch[j];
        if (r.status === "fulfilled" && r.value.body.length > 0) {
          // ★ 2026-05-13: 早断 zod 验证 —— 在 section-fill 完成时立即按
          //   WikiDiffCreateItem / WikiDiffUpdateItem schema 验，让 LLM
          //   非法输出（slug 大写 / category 自创 / span 越界）当场进
          //   failedSlugs，不要堆到 assemble 阶段才发现"6m+ 工作里这页是坏的"。
          //   Cross-link 阶段也省去给坏页跑无用流量。
          const earlyDraft =
            item.kind === "create"
              ? {
                  slug: item.slug,
                  locale: item.locale,
                  title: item.title ?? item.slug,
                  category: (item.category ?? "ENTITY") as
                    | "ENTITY"
                    | "CONCEPT"
                    | "SUMMARY"
                    | "SOURCE",
                  body: r.value.body,
                  oneLiner: r.value.oneLiner,
                  sources: r.value.sources,
                  ...(item.translationGroupId
                    ? { translationGroupId: item.translationGroupId }
                    : {}),
                }
              : {
                  slug: item.slug,
                  locale: item.locale,
                  newBody: r.value.body,
                  newOneLiner: r.value.oneLiner,
                  sources: r.value.sources,
                };
          const earlyCheck =
            item.kind === "create"
              ? WikiDiffCreateItemSchema.safeParse(earlyDraft)
              : WikiDiffUpdateItemSchema.safeParse(earlyDraft);
          if (!earlyCheck.success) {
            failedSlugs.push(item.slug);
            this.logger.warn(
              `[ingest/MULTI early-zod] dropping invalid ${item.kind} slug=${item.slug} errors=${JSON.stringify(
                earlyCheck.error.issues.map((iss) => ({
                  path: iss.path.join("."),
                  msg: iss.message,
                })),
              ).slice(0, 500)}`,
            );
            continue;
          }
          sectionResults.push({
            kind: item.kind,
            slug: item.slug,
            locale: item.locale,
            title: item.title,
            category: item.category,
            body: r.value.body,
            oneLiner: r.value.oneLiner,
            sources: r.value.sources,
            translationGroupId: item.translationGroupId,
          });
          // Partial-progress checkpoint — mid-pass crash can recover
          // already-done pages (lifecycle: 24h TTL cron reaps).
          // 2026-05-14 P0-A: use per-item locale (was targetLocales[0]),
          // so bilingual KB checkpoints two rows for the same slug.
          await this.prisma.wikiIngestDraft
            .upsert({
              where: {
                diffSessionId_pageSlug_locale: {
                  diffSessionId,
                  pageSlug: item.slug,
                  locale: item.locale,
                },
              },
              create: {
                knowledgeBaseId,
                diffSessionId,
                pageSlug: item.slug,
                locale: item.locale,
                body: r.value as unknown as Prisma.InputJsonValue,
              },
              update: {
                body: r.value as unknown as Prisma.InputJsonValue,
              },
            })
            .catch((err) =>
              this.logger.warn(
                `[ingest/MULTI] checkpoint failed slug=${item.slug}: ${err instanceof Error ? err.message : String(err)}`,
              ),
            );
        } else {
          failedSlugs.push(item.slug);
          this.logger.warn(
            `[ingest/MULTI] section-fill failed slug=${item.slug}: ${
              r.status === "rejected"
                ? r.reason instanceof Error
                  ? r.reason.message
                  : String(r.reason)
                : "empty body returned"
            }`,
          );
        }
      }
      // 每批结束更新真实进度（pagesDone = success + failed = i+batch 大小）
      this.setProgress(knowledgeBaseId, {
        stage: "section-fill",
        pagesDone: sectionResults.length + failedSlugs.length,
        pagesTotal: allOutlineItems.length,
      });
    }

    const totalItems = allOutlineItems.length;
    const failRate = totalItems === 0 ? 0 : failedSlugs.length / totalItems;

    // ★ 2026-05-13 P-#14: 0 成功才 throw（无内容可提交）。否则 partial-success：
    //   提交成功页 + 把 failedSlugs 暴露到 progress，前端展示"X/Y 页失败"+单
    //   slug 重试入口。原 all-or-nothing 会把 10 个成功页连同 3 个失败页一起
    //   throw，用户重跑整批再付一遍 LLM 成本。
    if (sectionResults.length === 0) {
      this.logger.warn(
        `[ingest/MULTI section-fill] userId=${userId} kb=${knowledgeBaseId} reason=zero-successful-pages totalItems=${totalItems} failed=${failedSlugs.length}`,
      );
      throw new BadRequestException(
        "Wiki ingest section-fill produced 0 successful pages; please retry",
      );
    }

    if (failRate > failureToleranceRatio) {
      // 超 tolerance 但有部分成功 → warn 不 throw，让 caller 走完 cross-link
      // + persist 路径提交已成功的页。
      this.logger.warn(
        `[ingest/MULTI section-fill] userId=${userId} kb=${knowledgeBaseId} reason=high-failure-rate-partial-commit failRate=${failRate.toFixed(2)} tolerance=${failureToleranceRatio} failed=${failedSlugs.length}/${totalItems} success=${sectionResults.length} slugs=${failedSlugs.slice(0, 5).join(",")}${failedSlugs.length > 5 ? "..." : ""}`,
      );
    }

    // ── Pass 3: CROSS-LINK ──────────────────────────────────────────
    // 2026-05-14 P0-A: run cross-link per locale. Bilingual bodies of the
    // same slug have different char offsets; applying one insertions list to
    // both would shift positions and break bodies. linkableSlugs is shared
    // (slug is locale-agnostic in [[slug]] syntax — the reader picks the
    // correct locale at render time).
    this.setProgress(knowledgeBaseId, { stage: "cross-link" });
    const linkableSlugs = Array.from(
      new Set([
        ...sectionResults.map((s) => s.slug),
        ...currentIndex.map((p) => p.slug),
      ]),
    );
    const sectionByLocale = new Map<"zh" | "en", typeof sectionResults>();
    for (const s of sectionResults) {
      const list = sectionByLocale.get(s.locale) ?? [];
      list.push(s);
      sectionByLocale.set(s.locale, list);
    }
    const bodyByKey = new Map(
      sectionResults.map((s) => [`${s.slug}:${s.locale}`, s.body]),
    );
    for (const [locale, results] of sectionByLocale) {
      const linkedBodies = await this.runCrossLinkPass({
        pages: results.map((s) => ({ slug: s.slug, body: s.body })),
        linkableSlugs,
        chatUserId,
        knowledgeBaseId,
      });
      for (const page of linkedBodies.pages) {
        const key = `${page.slug}:${locale}`;
        const original = bodyByKey.get(key);
        if (!original) continue;
        const sorted = [...page.insertions].sort(
          (a, b) => b.position - a.position,
        );
        let body = original;
        for (const ins of sorted) {
          if (
            typeof ins.position !== "number" ||
            ins.position < 0 ||
            ins.position > body.length
          ) {
            continue;
          }
          const linkText = ins.surfaceText
            ? `[[${ins.linkSlug}|${ins.surfaceText}]]`
            : `[[${ins.linkSlug}]]`;
          body =
            body.slice(0, ins.position) + linkText + body.slice(ins.position);
        }
        bodyByKey.set(key, body);
      }
    }

    // ── Assemble final WikiDiffItems ────────────────────────────────
    // 2026-05-14 P0-A: each item carries its OWN locale (outline emits one
    // create per locale for bilingual KBs). Was hardcoded to targetLocales[0]
    // → bilingual KB ended up with all pages mis-tagged as zh.
    const items = {
      creates: sectionResults
        .filter((s) => s.kind === "create")
        .map((s) => ({
          slug: s.slug,
          locale: s.locale,
          title: s.title ?? s.slug,
          category: s.category ?? ("ENTITY" as const),
          body: bodyByKey.get(`${s.slug}:${s.locale}`) ?? s.body,
          oneLiner: s.oneLiner,
          sources: s.sources,
          ...(s.translationGroupId
            ? { translationGroupId: s.translationGroupId }
            : {}),
        })),
      updates: sectionResults
        .filter((s) => s.kind === "update")
        .map((s) => ({
          slug: s.slug,
          locale: s.locale,
          newBody: bodyByKey.get(`${s.slug}:${s.locale}`) ?? s.body,
          newOneLiner: s.oneLiner,
          sources: s.sources,
        })),
      deletes: outline.deletes ?? [],
    };

    // Reuse the same commit path as SINGLE (zod validation + persist +
    // metrics). Pre-clean already happened inside each section-fill call.
    let validated = WikiDiffItemsSchema.safeParse(items);
    if (!validated.success) {
      // ★ 2026-05-13 P0 (Screenshot_79): assemble 阶段单项 zod 失败导致
      //   6m+ 的 section-fill 工作全部丢弃 —— 同 #14 partial-success 反模式。
      //   修复：逐项 safeParse，剔除单项失败的（log 完整 path+message），
      //   只要还剩 ≥1 个 valid item 就继续 commit。否则才整体 fail。
      //
      //   ★ 2026-05-13 (review): assemble 阶段失败的 slug 必须并入外层
      //   failedSlugs，否则前端 progress.failedSlugs 不完整（只包含
      //   section-fill 阶段失败的，不包含 assemble 阶段被剔的）。
      const assembleFailedSlugs: string[] = [];
      const validCreates: unknown[] = [];
      for (const c of items.creates) {
        const r = WikiDiffCreateItemSchema.safeParse(c);
        if (r.success) {
          validCreates.push(c);
        } else {
          assembleFailedSlugs.push(c.slug ?? "(no-slug)");
          this.logger.warn(
            `[ingest/MULTI assemble] dropping invalid create slug=${c.slug} errors=${JSON.stringify(
              r.error.issues.map((i) => ({
                path: i.path.join("."),
                msg: i.message,
              })),
            ).slice(0, 500)}`,
          );
        }
      }
      const validUpdates: unknown[] = [];
      for (const u of items.updates) {
        const r = WikiDiffUpdateItemSchema.safeParse(u);
        if (r.success) {
          validUpdates.push(u);
        } else {
          assembleFailedSlugs.push(u.slug ?? "(no-slug)");
          this.logger.warn(
            `[ingest/MULTI assemble] dropping invalid update slug=${u.slug} errors=${JSON.stringify(
              r.error.issues.map((i) => ({
                path: i.path.join("."),
                msg: i.message,
              })),
            ).slice(0, 500)}`,
          );
        }
      }
      // 把 assemble 阶段失败的 slug 合并到外层 failedSlugs，
      // 让最终 progress.failedSlugs 既包含 section-fill 阶段失败的，
      // 又包含 assemble 阶段被剔的，前端 banner 显示完整失败清单。
      failedSlugs.push(...assembleFailedSlugs);
      const recovered = {
        creates: validCreates,
        updates: validUpdates,
        deletes: items.deletes,
      };
      validated = WikiDiffItemsSchema.safeParse(recovered);
      if (
        !validated.success ||
        (validCreates.length === 0 && validUpdates.length === 0)
      ) {
        this.logger.error(
          `[ingest/MULTI assemble] userId=${userId} kb=${knowledgeBaseId} reason=assembled-zod-failed-all creates=${items.creates.length} updates=${items.updates.length} deletes=${items.deletes.length} failedSlugs=${assembleFailedSlugs.slice(0, 10).join(",")}`,
        );
        throw new BadRequestException(
          `Wiki MULTI ingest assembled output failed schema validation (${assembleFailedSlugs.length} pages had invalid fields); please retry. Failed slugs: ${assembleFailedSlugs.slice(0, 5).join(", ")}${assembleFailedSlugs.length > 5 ? "…" : ""}`,
        );
      }
      this.logger.warn(
        `[ingest/MULTI assemble] partial recovery: dropped ${assembleFailedSlugs.length} invalid items, committing ${validCreates.length} creates + ${validUpdates.length} updates`,
      );
    }

    // 2026-05-14 P0-A: deletes are slug-only at the outline contract; expand
    // to slug:locale across all configured locales so bilingual KBs revoke
    // both translation pairs atomically.
    const deleteKeys = validated.data.deletes.flatMap((s) =>
      targetLocales.map((l) => `${s}:${l}`),
    );
    const affectedKeys = [
      ...new Set([
        ...validated.data.creates.map((c) => `${c.slug}:${c.locale}`),
        ...validated.data.updates.map((u) => `${u.slug}:${u.locale}`),
        ...deleteKeys,
      ]),
    ];

    this.setProgress(knowledgeBaseId, { stage: "persist" });
    const diff = await this.prisma.wikiDiff.create({
      data: {
        knowledgeBaseId,
        status: WikiDiffStatus.PENDING,
        items: validated.data as unknown as Prisma.InputJsonValue,
        baselineHash,
        affectedKeys,
        createdByUserId: userId,
      },
    });

    this.setProgress(knowledgeBaseId, {
      status: "completed",
      stage: "completed",
      finishedAt: new Date().toISOString(),
      diffId: diff.id,
      ...(failedSlugs.length > 0 ? { failedSlugs } : {}),
    });
    this.logger.log(
      `[ingest/MULTI] kb=${knowledgeBaseId} diff=${diff.id} creates=${validated.data.creates.length} updates=${validated.data.updates.length} deletes=${validated.data.deletes.length} sectionFails=${failedSlugs.length}/${totalItems}`,
    );
    this.logCategoryDistribution(validated.data.creates, knowledgeBaseId);

    const pagesAll = validated.data.creates;
    const avgBodyLength =
      pagesAll.length === 0
        ? 0
        : Math.round(
            pagesAll.reduce((s, p) => s + (p.body?.length ?? 0), 0) /
              pagesAll.length,
          );
    const h2CoverageRate =
      pagesAll.length === 0
        ? 0
        : pagesAll.filter((p) => /^## /m.test(p.body ?? "")).length /
          pagesAll.length;
    this.lastIngestMetrics = {
      truncatedOneLiners: 0,
      droppedSources: 0,
      totalSourcesSeen: 0,
      droppedByReason: {},
      pageCount: pagesAll.length,
      avgBodyLength,
      h2CoverageRate,
    };

    // Reap session-scoped drafts after diff persisted — they served their
    // mid-pass-recovery purpose. Failure here is non-fatal (a 24h TTL
    // cron eventually cleans up).
    await this.prisma.wikiIngestDraft
      .deleteMany({ where: { diffSessionId } })
      .catch((err) =>
        this.logger.warn(
          `[ingest/MULTI] draft cleanup failed session=${diffSessionId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    return diff;
  }

  private async runOutlinePass(args: {
    wrappedDocs: string[];
    currentIndex: Array<{
      slug: string;
      title: string;
      category: string;
      oneLiner: string;
    }>;
    targetLocales: Array<"zh" | "en">;
    chatUserId: string;
    knowledgeBaseId: string;
    /** 2026-05-14: KB 配置的 outline maxPages floor (动态实际值由 service 算) */
    ingestOutlineMaxPages?: number;
  }): Promise<{
    creates: Array<{
      slug: string;
      title: string;
      category: "ENTITY" | "CONCEPT" | "SUMMARY" | "SOURCE";
      locale: "zh" | "en";
      sectionSkeleton: string[];
      groupLabel?: string;
    }>;
    updates: Array<{
      slug: string;
      locale: "zh" | "en";
      sectionSkeleton: string[];
    }>;
    deletes: string[];
  }> {
    const skill = await this.skillLoader.getSkillById("wiki-ingest-outline");
    if (!skill) {
      this.logger.error(
        `[ingest/MULTI outline] kb=${args.knowledgeBaseId} reason=outline-skill-not-loaded — check WikiModule.onModuleInit`,
      );
      throw new BadRequestException(
        "Wiki MULTI outline skill not loaded — check WikiModule.onModuleInit",
      );
    }
    const indexBlock =
      args.currentIndex.length === 0
        ? "(empty wiki — every doc will produce CREATE items)"
        : args.currentIndex
            .map(
              (p) =>
                `- [[${p.slug}]] (${p.category}) "${p.title}" — ${p.oneLiner}`,
            )
            .join("\n");
    // 2026-05-14 P2 fix: 动态 maxPages 让信息密集文档不被强行压成 30 页.
    // 算法: max(配置值 ?? 60, ceil(charCount / 2000)) 上限 200.
    // 2000 chars/page 是中文 wiki 单页平均含量的保守经验值.
    const totalChars = args.wrappedDocs.reduce((s, d) => s + d.length, 0);
    const configuredMin = args.ingestOutlineMaxPages ?? 60;
    const dynamicMax = Math.min(
      200,
      Math.max(configuredMin, Math.ceil(totalChars / 2000)),
    );
    // 2026-05-14 P0-A: bilingual MULTI pass — instruct LLM to emit per-page
    // locale + dual emission for bilingual KBs. Single-locale KB just gets a
    // hard-assertion to prevent locale drift.
    const localeBlock =
      args.targetLocales.length === 1
        ? [
            "## TARGET_LOCALES (single-locale KB)",
            `Configured: \`${args.targetLocales[0]}\`.`,
            `EVERY \`creates\` and \`updates\` item MUST set \`locale: "${args.targetLocales[0]}"\`.`,
            `Title / body / oneLiner (written later by section-fill) MUST be in ${
              args.targetLocales[0] === "zh" ? "Chinese" : "English"
            }.`,
          ].join("\n")
        : [
            "## TARGET_LOCALES (W3 v2.0 — bilingual KB)",
            `Configured: \`${args.targetLocales.join("`, `")}\`.`,
            "For EACH page concept, emit TWO `creates` items (one per locale) with:",
            "  - the SAME `slug` (slug is locale-agnostic)",
            "  - the SAME `groupLabel` (the service pairs locale variants via this label)",
            "  - locale-specific `locale`, `title`, `sectionSkeleton`",
            "  - identical section ordering (same H2 structure, heading text translated)",
            "Note: do NOT emit a `translationGroupId` field — the service mints the UUID",
            "from the shared `groupLabel`. Translation quality is enforced by section-fill,",
            "not by the outline pass.",
          ].join("\n");
    const userPrompt = [
      localeBlock,
      "",
      "## MAX_PAGES",
      `${dynamicMax}`,
      "",
      "## Current wiki index",
      indexBlock,
      "",
      "## New documents to ingest",
      ...args.wrappedDocs,
    ].join("\n\n");

    let raw!: Awaited<ReturnType<AiChatService["chat"]>>;
    try {
      raw = await this.chat.chat({
        messages: [{ role: "user", content: userPrompt }],
        systemPrompt: skill.content,
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "low", outputLength: "long" },
        responseFormat: "json_object",
        operationName: "library-wiki-ingest-outline",
        userId: args.chatUserId,
        skipGuardrails: true, // 2026-05-12: 输入来自可信 KB 文档，见 SINGLE 入口注释
      });
    } catch (error) {
      this.logger.error(
        `[ingest/MULTI outline] chatUserId=${args.chatUserId} kb=${args.knowledgeBaseId} reason=outline-llm-failed err=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException(
        "Wiki MULTI outline pass LLM call failed; please retry",
      );
    }
    const parsed = this.extractJson(raw.content) as Record<string, unknown>;
    const creates = Array.isArray(parsed.creates)
      ? (parsed.creates as Array<Record<string, unknown>>)
      : [];
    const updates = Array.isArray(parsed.updates)
      ? (parsed.updates as Array<Record<string, unknown>>)
      : [];
    const deletes = Array.isArray(parsed.deletes)
      ? (parsed.deletes as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [];
    // 2026-05-14 P0-A: per-item locale extraction. Default to targetLocales[0]
    // when LLM omits the field (single-locale KB does not strictly need it,
    // but the contract is stricter going forward).
    const defaultLocale = args.targetLocales[0] ?? "zh";
    const normalizeLocale = (raw: unknown): "zh" | "en" =>
      raw === "zh" || raw === "en" ? raw : defaultLocale;
    return {
      creates: creates
        .filter(
          (c) =>
            typeof c.slug === "string" &&
            typeof c.title === "string" &&
            typeof c.category === "string" &&
            Array.isArray(c.sectionSkeleton),
        )
        .map((c) => ({
          slug: c.slug as string,
          title: c.title as string,
          category: c.category as "ENTITY" | "CONCEPT" | "SUMMARY" | "SOURCE",
          locale: normalizeLocale(c.locale),
          sectionSkeleton: (c.sectionSkeleton as unknown[]).filter(
            (s): s is string => typeof s === "string",
          ),
          groupLabel:
            typeof c.groupLabel === "string" ? c.groupLabel : undefined,
        })),
      updates: updates
        .filter(
          (u) => typeof u.slug === "string" && Array.isArray(u.sectionSkeleton),
        )
        .map((u) => ({
          slug: u.slug as string,
          locale: normalizeLocale(u.locale),
          sectionSkeleton: (u.sectionSkeleton as unknown[]).filter(
            (s): s is string => typeof s === "string",
          ),
        })),
      deletes,
    };
  }

  private async runSectionFillPass(args: {
    item: {
      kind: "create" | "update";
      slug: string;
      locale: "zh" | "en";
      title?: string;
      category?: "ENTITY" | "CONCEPT" | "SUMMARY" | "SOURCE";
      sectionSkeleton: string[];
      priorBody?: string;
    };
    documents: Array<{
      id: string;
      title: string;
      rawContent: string | null;
      rawContentUri: string | null;
      metadata: Prisma.JsonValue;
    }>;
    allowedDocumentIds: Set<string>;
    wrappedDocs: string[];
    mediaUrls: string[];
    chatUserId: string;
    knowledgeBaseId: string;
  }): Promise<{
    body: string;
    oneLiner: string;
    sources: Array<{
      documentId: string;
      spanStart: number;
      spanEnd: number;
      quote: string;
    }>;
  }> {
    const skill = await this.skillLoader.getSkillById("wiki-ingest-section");
    if (!skill) {
      this.logger.error(
        `[ingest/MULTI section-fill] kb=${args.knowledgeBaseId} slug=${args.item.slug} reason=section-skill-not-loaded — check WikiModule.onModuleInit`,
      );
      throw new BadRequestException(
        "Wiki MULTI section skill not loaded — check WikiModule.onModuleInit",
      );
    }
    // 2026-05-14 P0-A: hard-assert TARGET_LOCALE per page so section-fill
    // never silently drifts. The skill prompt already declares this slot.
    const localeName = args.item.locale === "zh" ? "Chinese" : "English";
    const parts = [
      `## TARGET_LOCALE`,
      `${args.item.locale} (${localeName})`,
      `Write title / body / oneLiner ENTIRELY in ${localeName}. Heading text in ${localeName}. Do NOT switch languages mid-page.`,
      "",
      `## Page identity (do not rename / re-slug)`,
      `- slug: ${args.item.slug}`,
      `- locale: ${args.item.locale}`,
      `- title: ${args.item.title ?? "(see priorBody)"}`,
      `- category: ${args.item.category ?? "(see priorBody)"}`,
      "",
      `## Section skeleton (emit exactly these H2 in order)`,
      args.item.sectionSkeleton.map((s) => `- ${s}`).join("\n"),
    ];
    if (args.item.priorBody) {
      parts.push(
        "",
        "## priorBody (UPDATE — edit surgically, preserve good prose)",
        args.item.priorBody.slice(0, 50_000),
      );
    }
    if (args.mediaUrls.length > 0) {
      parts.push(
        "",
        "## MEDIA_URLS (pre-extracted images from source docs)",
        "Use these URLs in page body via `![alt](url)` when describing visual content. Do NOT invent URLs.",
        ...args.mediaUrls.map((u) => `- ${u}`),
      );
    }
    parts.push("", "## Relevant source documents", ...args.wrappedDocs);
    const userPrompt = parts.join("\n\n");

    let raw!: Awaited<ReturnType<AiChatService["chat"]>>;
    try {
      raw = await this.chat.chat({
        messages: [{ role: "user", content: userPrompt }],
        systemPrompt: skill.content,
        modelType: AIModelType.CHAT,
        // 2026-05-14 P2 fix: long (8K) 让 LLM 实际 output ~3-4K → 每页 body
        // 被压短 → "wiki 内容稀疏" 投诉. extended (16K) 让单页能写到 6-10K 字.
        taskProfile: { creativity: "low", outputLength: "extended" },
        responseFormat: "json_object",
        operationName: "library-wiki-ingest-section",
        skipGuardrails: true, // 2026-05-12: 输入来自可信 KB 文档，见 SINGLE 入口注释
        userId: args.chatUserId,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[ingest/MULTI section-fill] chatUserId=${args.chatUserId} kb=${args.knowledgeBaseId} slug=${args.item.slug} reason=section-llm-failed err=${errMsg.slice(0, 300)}`,
      );
      // Throw plain Error (not BadRequestException): outer Promise.allSettled
      // wraps this in `rejected` and the per-page failRate gate decides whether
      // to abort the whole pass — one slow page must not 400 the whole batch.
      throw new Error(`section-fill LLM call failed: ${errMsg}`);
    }
    const parsed = this.extractJson(raw.content) as Record<string, unknown>;
    const body = typeof parsed.body === "string" ? parsed.body : "";
    const oneLinerRaw =
      typeof parsed.oneLiner === "string" ? parsed.oneLiner : "";
    const oneLiner =
      oneLinerRaw.length > 280
        ? oneLinerRaw.slice(0, 277).trimEnd() + "..."
        : oneLinerRaw;
    const rawSources = Array.isArray(parsed.sources)
      ? (parsed.sources as Array<Record<string, unknown>>)
      : [];
    const sources = rawSources
      .filter((s) => {
        if (!s || typeof s !== "object") return false;
        const o = s;
        if (
          typeof o.documentId !== "string" ||
          !args.allowedDocumentIds.has(o.documentId)
        )
          return false;
        if (
          typeof o.spanStart !== "number" ||
          !Number.isInteger(o.spanStart) ||
          o.spanStart < 0
        )
          return false;
        if (
          typeof o.spanEnd !== "number" ||
          !Number.isInteger(o.spanEnd) ||
          o.spanEnd < o.spanStart
        )
          return false;
        if (
          typeof o.quote !== "string" ||
          o.quote.length < 1 ||
          o.quote.length > 2000
        )
          return false;
        return true;
      })
      .map((o) => ({
        documentId: o.documentId as string,
        spanStart: o.spanStart as number,
        spanEnd: o.spanEnd as number,
        quote: o.quote as string,
      }));
    return { body, oneLiner, sources };
  }

  private async runCrossLinkPass(args: {
    pages: Array<{ slug: string; body: string }>;
    linkableSlugs: string[];
    chatUserId: string;
    knowledgeBaseId: string;
  }): Promise<{
    pages: Array<{
      slug: string;
      insertions: Array<{
        position: number;
        linkSlug: string;
        surfaceText?: string;
      }>;
    }>;
  }> {
    if (args.pages.length === 0) {
      return { pages: [] };
    }
    const skill = await this.skillLoader.getSkillById("wiki-ingest-crosslink");
    if (!skill) {
      this.logger.error(
        `[ingest/MULTI cross-link] kb=${args.knowledgeBaseId} pages=${args.pages.length} reason=crosslink-skill-not-loaded — check WikiModule.onModuleInit`,
      );
      throw new BadRequestException(
        "Wiki MULTI cross-link skill not loaded — check WikiModule.onModuleInit",
      );
    }
    const userPrompt = [
      "## linkableSlugs (only link to slugs in this list)",
      args.linkableSlugs.map((s) => `- ${s}`).join("\n"),
      "",
      "## pages (slug + body)",
      ...args.pages.map(
        (p) => `### slug: ${p.slug}\n\n\`\`\`markdown\n${p.body}\n\`\`\``,
      ),
    ].join("\n\n");

    let raw!: Awaited<ReturnType<AiChatService["chat"]>>;
    try {
      raw = await this.chat.chat({
        messages: [{ role: "user", content: userPrompt }],
        systemPrompt: skill.content,
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "low", outputLength: "medium" },
        responseFormat: "json_object",
        skipGuardrails: true, // 2026-05-12: 输入来自可信 KB 文档，见 SINGLE 入口注释
        operationName: "library-wiki-ingest-crosslink",
        userId: args.chatUserId,
      });
    } catch (error) {
      // Cross-link failure is recoverable: skip linking, keep bodies as-is.
      this.logger.warn(
        `[ingest/MULTI cross-link] chatUserId=${args.chatUserId} kb=${args.knowledgeBaseId} pages=${args.pages.length} reason=crosslink-llm-failed-soft err=${error instanceof Error ? error.message : String(error)} — bodies committed without cross-link`,
      );
      return { pages: [] };
    }
    const parsed = this.extractJson(raw.content) as Record<string, unknown>;
    const linkableSet = new Set(args.linkableSlugs);
    const pages = Array.isArray(parsed.pages)
      ? (parsed.pages as Array<Record<string, unknown>>)
      : [];
    return {
      pages: pages
        .filter(
          (p) => typeof p.slug === "string" && Array.isArray(p.insertions),
        )
        .map((p) => ({
          slug: p.slug as string,
          insertions: (p.insertions as Array<Record<string, unknown>>)
            .filter(
              (ins) =>
                typeof ins.position === "number" &&
                Number.isInteger(ins.position) &&
                ins.position >= 0 &&
                typeof ins.linkSlug === "string" &&
                linkableSet.has(ins.linkSlug),
            )
            .map((ins) => ({
              position: ins.position as number,
              linkSlug: ins.linkSlug as string,
              surfaceText:
                typeof ins.surfaceText === "string"
                  ? ins.surfaceText
                  : undefined,
            })),
        })),
    };
  }

  /**
   * Return KB documents enriched with wiki-specific ingest state so the
   * frontend can present a professional candidate picker instead of the raw
   * RAG document list.
   */
  async listIngestCandidates(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<WikiIngestCandidate[]> {
    await this.assertViewerAccessAndWikiEnabled(userId, knowledgeBaseId);

    const documents = await this.prisma.knowledgeBaseDocument.findMany({
      where: { knowledgeBaseId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        sourceType: true,
        mimeType: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        processedAt: true,
        chunkCount: true,
        lastError: true,
        // metadata.pendingFetch=true marks docs whose rawContent is still
        // a "[Pending content fetch from X]" placeholder — those genuinely
        // have no text to ingest. rawContentUri is included so we can
        // recognize off-loaded content (always real) without paying the R2
        // hydrate roundtrip in this list endpoint.
        metadata: true,
        rawContentUri: true,
      },
    });

    const usageRows = await this.prisma.$queryRaw<
      Array<{
        document_id: string;
        page_reference_count: bigint;
        last_cited_at: Date | null;
      }>
    >`
      SELECT
        s.document_id,
        COUNT(DISTINCT s.page_id) AS page_reference_count,
        MAX(p.updated_at) AS last_cited_at
      FROM wiki_page_sources s
      JOIN wiki_pages p ON p.id = s.page_id
      WHERE p.knowledge_base_id = ${knowledgeBaseId}::text
      GROUP BY s.document_id
    `;

    const usageMap = new Map(
      usageRows.map((row) => [
        row.document_id,
        {
          pageReferenceCount: Number(row.page_reference_count),
          lastCitedAt: row.last_cited_at,
        },
      ]),
    );

    return documents.map((doc) => {
      const usage = usageMap.get(doc.id);
      const pageReferenceCount = usage?.pageReferenceCount ?? 0;
      const lastCitedAt = usage?.lastCitedAt ?? null;

      let ingestState: WikiIngestCandidateState;
      let recommended = false;
      let reason = "";

      // Wiki ingest only consumes `rawContent` — it does NOT consume the
      // RAG chunks or embeddings produced by the "向量化" button. So the
      // BLOCKED gate is on content availability, not on doc.status===READY
      // (which historically meant "chunking finished"). A PENDING doc with
      // real rawContent is perfectly ingestable.
      if (doc.status === "ERROR") {
        ingestState = "BLOCKED";
        reason = "Document processing failed; repair the source before ingest.";
      } else if (this.isContentPending(doc.metadata, doc.rawContentUri)) {
        ingestState = "BLOCKED";
        reason =
          "Document content has not been fetched yet from the external source.";
      } else if (pageReferenceCount === 0) {
        ingestState = "READY_NEW";
        recommended = true;
        reason = "Ready and not yet represented in the wiki.";
      } else if (lastCitedAt && doc.updatedAt > lastCitedAt) {
        ingestState = "READY_STALE";
        recommended = true;
        reason =
          "Document changed after the last wiki citation; re-ingest recommended.";
      } else {
        ingestState = "READY_COVERED";
        reason = "Already represented in current wiki pages.";
      }

      return {
        id: doc.id,
        title: doc.title,
        sourceType: doc.sourceType,
        mimeType: doc.mimeType,
        status: doc.status,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        processedAt: doc.processedAt,
        chunkCount: doc.chunkCount,
        lastError: doc.lastError,
        pageReferenceCount,
        lastCitedAt,
        ingestState,
        recommended,
        reason,
      };
    });
  }

  // ─── Internal ───

  /**
   * Detect docs whose `rawContent` is still a placeholder (e.g.
   * `[Pending content fetch from NOTION]`). These have no real text for the
   * wiki LLM to ingest, so they stay BLOCKED until the upstream fetcher
   * fills them in.
   *
   * Two signals — either is sufficient:
   *  - `metadata.pendingFetch === true` (set by the bookmark-import path
   *    in rag.controller.ts when content fetch is deferred)
   *  - rawContentUri is null AND we have no other proof of content
   *    (we don't read rawContent here to avoid the R2 hydrate roundtrip;
   *    off-loaded docs always have real content by construction)
   *
   * Off-loaded docs (`rawContentUri != null`) are always considered ready —
   * the off-load step only runs after content is materialized.
   */
  private isContentPending(
    metadata: Prisma.JsonValue,
    rawContentUri: string | null,
  ): boolean {
    if (rawContentUri) return false;
    if (
      metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>).pendingFetch === true
    ) {
      return true;
    }
    return false;
  }

  private buildUserPrompt(
    index: Array<{
      slug: string;
      title: string;
      category: string;
      oneLiner: string;
    }>,
    wrappedDocs: string[],
    /**
     * W2 v2.0 rebuild：W1 preparse 提取的图片 URL（来自 YT 缩略图 +
     * HTML <img> + cover image）。注入到 user prompt 让 LLM 写 page body 时
     * 用 `![](url)` 引用源图，实现"图文并茂"。
     * 来自 KbDocument.metadata.preparse.mediaUrls，可能为空数组。
     */
    mediaUrls: string[] = [],
    /**
     * gap #1 + #4 v2.0 rebuild (2026-05-12):
     *  - `targetLocales` = KB.enabledLocales 全集。LLM 必须为每个 target locale
     *    各产一份 page（CREATE 项含 locale + translationGroupId 关联）。
     *  - `sourceLocaleHints` = W1 PreparseService detectLocale 结果，per doc
     *    指引"本文档源语种为 X"，LLM 翻译时保信达雅。
     */
    targetLocales: Array<"zh" | "en"> = ["zh"],
    sourceLocaleHints: Array<{ docOrdinal: number; locale: "zh" | "en" }> = [],
  ): string {
    const indexBlock =
      index.length === 0
        ? "(empty wiki — every doc will produce CREATE items)"
        : index
            .map(
              (p) =>
                `- [[${p.slug}]] (${p.category}) "${p.title}" — ${p.oneLiner}`,
            )
            .join("\n");

    const mediaBlock =
      mediaUrls.length === 0
        ? null
        : [
            "## MEDIA_URLS (W2 v2.0: pre-extracted images from source docs)",
            "Use these URLs in page bodies via `![alt](url)` when describing visual content.",
            "Do NOT invent image URLs not in this list.",
            ...mediaUrls.map((u) => `- ${u}`),
          ].join("\n");

    // gap #1: locale routing block — when KB enables zh+en, the LLM must
    // emit each page TWICE (once per locale) with the SAME translationGroupId
    // so frontend can pair them. When KB enables a single locale, this just
    // hard-asserts the output language so the LLM doesn't drift.
    const localeBlock = (() => {
      if (targetLocales.length === 1) {
        return [
          "## TARGET_LOCALES (W3 v2.0)",
          `This KB is configured for a single locale: \`${targetLocales[0]}\`.`,
          `EVERY page in your output MUST have \`locale: "${targetLocales[0]}"\` and`,
          `the entire body / title / oneLiner MUST be written in ${
            targetLocales[0] === "zh" ? "Chinese" : "English"
          }.`,
        ].join("\n");
      }
      return [
        "## TARGET_LOCALES (W3 v2.0 — bilingual KB)",
        `This KB is configured for multiple locales: \`${targetLocales.join("`, `")}\`.`,
        "For EACH page concept, emit TWO CREATE items (one per locale) with:",
        "  - the SAME `slug` (slug is locale-agnostic)",
        "  - the SAME `translationGroupId` (any stable UUID v4; use one fresh UUID per concept)",
        "  - locale-specific `locale`, `title`, `body`, `oneLiner`",
        "  - identical structural skeleton (same H2 sections, same [[slug]] refs, same image embeds)",
        "Translation quality bar: not literal word-for-word — preserve meaning, idiom,",
        "and technical terminology while writing in native style for each locale.",
      ].join("\n");
    })();

    // gap #4: per-doc source locale hints — let the LLM know that doc[3] is
    // English so it doesn't mistakenly think it should be paraphrased into
    // Chinese as the "primary" page. The hint is advisory; the binding
    // constraint remains TARGET_LOCALES above.
    const sourceLocaleBlock =
      sourceLocaleHints.length === 0
        ? null
        : [
            "## SOURCE_LOCALES (W1 detected, per doc)",
            "Per-document detected source language (helps preserve idiom / terminology):",
            ...sourceLocaleHints.map(
              (h) => `- doc[${h.docOrdinal}]: ${h.locale}`,
            ),
          ].join("\n");

    const parts = [
      "## Current wiki index",
      indexBlock,
      "",
      "## New documents to ingest",
      ...wrappedDocs,
      "",
      localeBlock,
    ];
    if (sourceLocaleBlock) parts.push("", sourceLocaleBlock);
    if (mediaBlock) parts.push("", mediaBlock);
    return parts.join("\n\n");
  }

  /**
   * gap #4 v2.0 rebuild (2026-05-12): collect per-doc source locale from
   * KbDocument.metadata.preparse.sourceLocale (W1 PreparseService writes it).
   * docOrdinal mirrors wrappedDocs index order; absent → omitted (LLM falls
   * back to its own heuristic which is fine for fully-untagged docs).
   */
  private collectSourceLocaleHints(
    documents: Array<{ metadata: Prisma.JsonValue }>,
  ): Array<{ docOrdinal: number; locale: "zh" | "en" }> {
    const hints: Array<{ docOrdinal: number; locale: "zh" | "en" }> = [];
    documents.forEach((doc, i) => {
      const meta = doc.metadata;
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) return;
      const preparse = (meta as Record<string, unknown>).preparse;
      if (!preparse || typeof preparse !== "object") return;
      const sl = (preparse as Record<string, unknown>).sourceLocale;
      if (sl === "zh" || sl === "en") {
        hints.push({ docOrdinal: i, locale: sl });
      }
    });
    return hints;
  }

  /**
   * W2 v2.0 rebuild：从 documents 的 metadata.preparse.mediaUrls 聚合所有源图 URL。
   *
   * preparse 是 W1 落地的 KbDocument.metadata 子键，仅 URL/YT 类源文档有；手贴文本
   * doc 没有 preparse → 跳过。聚合后去重 + 截断到 50 张防 prompt 爆 token。
   */
  private collectPreparseMediaUrls(
    documents: Array<{ metadata: Prisma.JsonValue }>,
  ): string[] {
    const all = new Set<string>();
    for (const doc of documents) {
      const meta = doc.metadata;
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) continue;
      const preparse = (meta as Record<string, unknown>).preparse;
      if (!preparse || typeof preparse !== "object") continue;
      const urls = (preparse as Record<string, unknown>).mediaUrls;
      if (!Array.isArray(urls)) continue;
      for (const u of urls) {
        if (typeof u === "string" && /^https?:\/\//i.test(u)) {
          all.add(u);
        }
      }
    }
    // 防 prompt token 爆：最多 50 张图（实践中单 doc 一般 1-10 张）
    return Array.from(all).slice(0, 50);
  }

  /**
   * W2 v2.0 rebuild：分类配比观察日志。
   *
   * 全 SOURCE 输出是 v1.5.3 的核心质量痛点（Screenshot_64）。本方法在 LLM 返回后
   * 统计 creates[].category 分布，命中 SOURCE-only 输出时 log.warn 让 Railway
   * stderr 可见，便于后续 prompt 调优 / 触发 retry 逻辑。
   *
   * 不抛错——v2.0 这一版只观察不强拒；后续 PR (consensus 17-commit) 会接 retry。
   */
  private logCategoryDistribution(
    creates: Array<{ category?: string }>,
    knowledgeBaseId: string,
  ): void {
    if (creates.length === 0) return;
    const counts: Record<string, number> = {};
    for (const c of creates) {
      const cat = c.category ?? "UNKNOWN";
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    const total = creates.length;
    const sourceOnly = total >= 2 && (counts.SOURCE ?? 0) === total;
    if (sourceOnly) {
      this.logger.warn(
        `[ingest kb=${knowledgeBaseId}] SOURCE-only output detected ` +
          `(${total} creates, all SOURCE) — prompt fan-out rule not satisfied. ` +
          `Consider retrying with stronger CATEGORY FAN-OUT enforcement.`,
      );
    } else {
      this.logger.log(
        `[ingest kb=${knowledgeBaseId}] category distribution: ` +
          Object.entries(counts)
            .map(([k, v]) => `${k}=${v}`)
            .join(" "),
      );
    }
  }

  private extractJson(content: string): unknown {
    // LLMs sometimes wrap JSON in fenced code blocks. Strip and try parse.
    const cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }

  private async assertEditorAccessAndWikiEnabled(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<void> {
    const ok = await this.kbService.hasAccess(
      knowledgeBaseId,
      userId,
      "EDITOR",
    );
    if (!ok) throw new ForbiddenException("Editor access required");
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { wikiEnabled: true },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");
    if (!kb.wikiEnabled) {
      throw new ForbiddenException("Wiki is not enabled for this KB");
    }
  }

  private async assertViewerAccessAndWikiEnabled(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<void> {
    const ok = await this.kbService.hasAccess(
      knowledgeBaseId,
      userId,
      "VIEWER",
    );
    if (!ok) throw new ForbiddenException("Viewer access required");
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { wikiEnabled: true },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");
    if (!kb.wikiEnabled) {
      throw new ForbiddenException("Wiki is not enabled for this KB");
    }
  }
}
