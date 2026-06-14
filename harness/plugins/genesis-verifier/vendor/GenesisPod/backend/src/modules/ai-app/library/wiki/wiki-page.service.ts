import * as crypto from "crypto";
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, WikiPage, WikiPageEditedBy } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  parseMarkdownWikiLinks,
  normalizeMarkdownSlug,
  sanitizeMarkdownBody,
} from "../../../ai-engine/facade";
import { KnowledgeBaseService } from "../rag/services/knowledge-base.service";
import { CreateWikiPageDto, UpdateWikiPageDto } from "./dto/wiki-page.dto";

/**
 * P3 (2026-05-12): default locale for legacy single-locale callers. The
 * column gained a DB default of 'zh' in P3 commit 1; this constant
 * mirrors that for explicit composite-key reads where Prisma cannot
 * fall back to the column default.
 */
const DEFAULT_WIKI_LOCALE: "zh" | "en" = "zh";

/**
 * Link info attached to a page response (2026-05-14 multi-locale title rebuild).
 *
 * `title` 是 display 用，按目标 page 的 locale 取真 title；目标缺失（lint
 * 报 MISSING_XREF）时 fallback 到 slug 以保留可点击的链接形态。`exists` 让
 * 前端能区分"已建立的关系"和"待补全的占位引用"。
 */
export interface WikiPageLinkInfo {
  slug: string;
  title: string;
  locale: string;
  exists: boolean;
}

/**
 * WikiPageService — page CRUD, link parsing, revision writing, and revert.
 *
 * v1.5.3 P1 scope:
 *  - Body sanitization on every write (engine sanitizeMarkdownBody, double
 *    defense with frontend rehype-sanitize per §11)
 *  - [[slug]] parsing → WikiPageLink upsert (engine parseMarkdownWikiLinks)
 *  - WikiPageRevision snapshot on apply / edit / revert (3 sites per v1.4)
 *  - Revert with cross-page IDOR protection: service-layer 404 on mismatch
 *    (v1.5.3 §6 / §7.3 unified resource cross-KB IDOR semantics)
 *  - hasAccess + wikiEnabled gate enforced at every write
 */
@Injectable()
export class WikiPageService {
  private readonly logger = new Logger(WikiPageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kbService: KnowledgeBaseService,
  ) {}

  /** List pages by KB scope, optionally filtered by category + locale. */
  async listPages(
    userId: string,
    knowledgeBaseId: string,
    options: {
      category?: WikiPage["category"];
      limit?: number;
      /**
       * W3-P0 v2.0 rebuild gap #2 (2026-05-12): per-locale page listing for
       * double-locale KBs. Undefined → list all locales (legacy single-locale
       * KBs see no behavior change). `__index__` system page is always
       * locale='zh' today so filtering by 'en' will exclude it.
       */
      locale?: "zh" | "en";
    } = {},
  ): Promise<WikiPage[]> {
    await this.assertViewerAccess(userId, knowledgeBaseId);
    return this.prisma.wikiPage.findMany({
      where: {
        knowledgeBaseId,
        ...(options.category ? { category: options.category } : {}),
        ...(options.locale ? { locale: options.locale } : {}),
      },
      orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
      take: options.limit ?? 100,
    });
  }

  /**
   * Get single page including outbound links + backlinks.
   *
   * W3-P0 gap #2 (2026-05-12): accepts optional `locale` so frontend can
   * switch between zh / en for bilingual KBs. When omitted, falls back to
   * 'zh' for backward-compat with legacy single-locale callers.
   *
   * 2026-05-14: outbound/back links 改返 {slug, title, locale, exists}。
   * 旧版只回 slug → 前端 [[slug]] render 直接显示拼音 → 用户截图 7 反馈
   * "REFERENCED PAGES 全拼音"。现在 JOIN wiki_pages 拿真 title。
   * - outbound 目标 page 不存在 (lint 报 MISSING_XREF) → exists=false, title=slug
   * - backlink 来源 page 总存在 (FK 保证) → exists 永 true
   */
  async getPage(
    userId: string,
    knowledgeBaseId: string,
    slug: string,
    locale: "zh" | "en" = DEFAULT_WIKI_LOCALE,
  ): Promise<{
    page: WikiPage;
    outboundLinks: WikiPageLinkInfo[];
    backlinks: WikiPageLinkInfo[];
  }> {
    await this.assertViewerAccess(userId, knowledgeBaseId);

    const page = await this.prisma.wikiPage.findUnique({
      where: {
        knowledgeBaseId_slug_locale: {
          knowledgeBaseId,
          slug,
          locale,
        },
      },
    });
    if (!page) throw new NotFoundException("Wiki page not found");

    const [outboundRows, inboundRows] = await Promise.all([
      this.prisma.wikiPageLink.findMany({
        where: { fromPageId: page.id },
        select: { toSlug: true, toLocale: true },
      }),
      this.prisma.wikiPageLink.findMany({
        where: {
          toSlug: page.slug,
          toLocale: page.locale,
          fromPage: { knowledgeBaseId },
        },
        select: {
          fromPage: { select: { slug: true, title: true, locale: true } },
        },
      }),
    ]);

    // Hydrate outbound: JOIN wiki_pages on (kbId, toSlug, toLocale) 拿 title
    const outboundKeys = outboundRows.map((l) => ({
      slug: l.toSlug,
      locale: l.toLocale,
    }));
    const outboundTargets = outboundKeys.length
      ? await this.prisma.wikiPage.findMany({
          where: {
            knowledgeBaseId,
            OR: outboundKeys.map((k) => ({
              slug: k.slug,
              locale: k.locale,
            })),
          },
          select: { slug: true, title: true, locale: true },
        })
      : [];
    const targetByKey = new Map<string, { title: string; locale: string }>();
    for (const t of outboundTargets) {
      targetByKey.set(`${t.slug}::${t.locale}`, {
        title: t.title,
        locale: t.locale,
      });
    }

    const outboundLinks: WikiPageLinkInfo[] = outboundRows.map((l) => {
      const hit = targetByKey.get(`${l.toSlug}::${l.toLocale}`);
      return {
        slug: l.toSlug,
        title: hit?.title ?? l.toSlug, // missing target → fallback to slug
        locale: l.toLocale,
        exists: !!hit,
      };
    });

    const backlinks: WikiPageLinkInfo[] = inboundRows.map((row) => ({
      slug: row.fromPage.slug,
      title: row.fromPage.title,
      locale: row.fromPage.locale,
      exists: true, // FK guarantee
    }));

    return { page, outboundLinks, backlinks };
  }

  /** Create a new page (manual user creation; ingest path goes through diff apply). */
  async createPage(
    userId: string,
    knowledgeBaseId: string,
    dto: CreateWikiPageDto,
  ): Promise<WikiPage> {
    await this.assertEditorAccessAndWikiEnabled(userId, knowledgeBaseId);

    // Defense in depth: even though DTO validates slug regex, run normalize
    // so that downstream consumers see a canonical form.
    const slug = normalizeMarkdownSlug(dto.slug);
    if (slug !== dto.slug) {
      throw new ForbiddenException(
        "slug must already be in canonical normalized form",
      );
    }

    const sanitizedBody = sanitizeMarkdownBody(dto.body).body;
    const contentHash = this.hashBody(sanitizedBody);

    const page = await this.prisma.$transaction(async (tx) => {
      const created = await tx.wikiPage.create({
        data: {
          knowledgeBaseId,
          slug,
          title: dto.title,
          category: dto.category,
          body: sanitizedBody,
          oneLiner: dto.oneLiner,
          contentHash,
          lastEditedBy: WikiPageEditedBy.USER,
        },
      });

      await this.replaceOutboundLinks(
        tx,
        created.id,
        sanitizedBody,
        created.locale,
      );

      return created;
    });

    this.logger.log(
      `[createPage] kb=${knowledgeBaseId} slug=${slug} by user=${userId}`,
    );
    return page;
  }

  /**
   * Update page — supports two actions:
   *  - 'edit' (default): write new body/title/etc + snapshot WikiPageRevision
   *  - 'revert': restore body from a target WikiPageRevision (must belong to
   *    this page; cross-page revisionId returns 404 per v1.5.3 §6)
   */
  async updatePage(
    userId: string,
    knowledgeBaseId: string,
    slug: string,
    dto: UpdateWikiPageDto,
  ): Promise<WikiPage> {
    await this.assertEditorAccessAndWikiEnabled(userId, knowledgeBaseId);

    const action = dto.action ?? "edit";
    const current = await this.prisma.wikiPage.findUnique({
      where: {
        knowledgeBaseId_slug_locale: {
          knowledgeBaseId,
          slug,
          locale: DEFAULT_WIKI_LOCALE,
        },
      },
    });
    if (!current) throw new NotFoundException("Wiki page not found");

    if (action === "revert") {
      return this.revertPage(userId, current, dto.toRevisionId);
    }
    return this.editPage(userId, current, dto);
  }

  /** Delete a page. Cascade clears revisions / links / sources / embeddings. */
  async deletePage(
    userId: string,
    knowledgeBaseId: string,
    slug: string,
  ): Promise<void> {
    await this.assertEditorAccessAndWikiEnabled(userId, knowledgeBaseId);

    const page = await this.prisma.wikiPage.findUnique({
      where: {
        knowledgeBaseId_slug_locale: {
          knowledgeBaseId,
          slug,
          locale: DEFAULT_WIKI_LOCALE,
        },
      },
      select: { id: true },
    });
    if (!page) throw new NotFoundException("Wiki page not found");

    await this.prisma.wikiPage.delete({ where: { id: page.id } });
    this.logger.log(`[deletePage] kb=${knowledgeBaseId} slug=${slug}`);
  }

  // ─── Helpers (also used by WikiDiffService for apply transactions) ───

  /**
   * Recompute outbound links for a page after a body change.
   * Caller passes a transaction client to keep delete+insert atomic.
   *
   * 2026-05-14: toLocale 默认 source page 的 locale,而非历史硬编码 'zh'。
   * 旧实现导致 en page 的 [[slug]] 链接全部被记成 toLocale='zh' →
   * 前端切换到 en 模式点击链接时跳转去 zh page → 双语 UI 失效。
   *
   * 假设：page 内 [[slug]] 引用同语言的 page (合理默认,跨语言引用是少数情况
   * 由 translationGroupId 处理)。
   */
  async replaceOutboundLinks(
    tx: Prisma.TransactionClient,
    pageId: string,
    body: string,
    sourceLocale: string = "zh",
  ): Promise<void> {
    await tx.wikiPageLink.deleteMany({ where: { fromPageId: pageId } });
    const slugs = parseMarkdownWikiLinks(body);
    if (slugs.length === 0) return;
    await tx.wikiPageLink.createMany({
      data: slugs.map((toSlug) => ({
        fromPageId: pageId,
        toSlug,
        toLocale: sourceLocale,
      })),
      skipDuplicates: true,
    });
  }

  hashBody(body: string): string {
    return crypto.createHash("sha256").update(body, "utf8").digest("hex");
  }

  // ─── Internal ───

  private async editPage(
    _userId: string,
    current: WikiPage,
    dto: UpdateWikiPageDto,
  ): Promise<WikiPage> {
    const newBodyRaw = dto.body ?? current.body;
    const sanitizedBody = sanitizeMarkdownBody(newBodyRaw).body;
    const contentHash = this.hashBody(sanitizedBody);
    const bodyChanged = sanitizedBody !== current.body;

    return this.prisma.$transaction(async (tx) => {
      // Snapshot before edit (only when body actually changes)
      if (bodyChanged) {
        await tx.wikiPageRevision.create({
          data: {
            pageId: current.id,
            body: current.body,
            contentHash: current.contentHash,
          },
        });
      }

      const updated = await tx.wikiPage.update({
        where: { id: current.id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.oneLiner !== undefined ? { oneLiner: dto.oneLiner } : {}),
          ...(bodyChanged
            ? {
                body: sanitizedBody,
                contentHash,
                lastEditedBy: WikiPageEditedBy.USER,
              }
            : {}),
        },
      });

      if (bodyChanged) {
        await this.replaceOutboundLinks(
          tx,
          updated.id,
          sanitizedBody,
          updated.locale,
        );
      }

      return updated;
    });
  }

  private async revertPage(
    _userId: string,
    current: WikiPage,
    toRevisionId: string | undefined,
  ): Promise<WikiPage> {
    if (!toRevisionId) {
      throw new NotFoundException("Revision not found");
    }
    const revision = await this.prisma.wikiPageRevision.findUnique({
      where: { id: toRevisionId },
    });
    // v1.5.3 §6: cross-page revisionId returns 404 (not 403) to defeat
    // existence oracle on revisionId
    if (!revision || revision.pageId !== current.id) {
      throw new NotFoundException("Revision not found");
    }

    const sanitizedBody = sanitizeMarkdownBody(revision.body).body;
    const contentHash = this.hashBody(sanitizedBody);

    return this.prisma.$transaction(async (tx) => {
      // Snapshot the current state before revert (so revert itself is
      // reversible; per v1.4 R2 #3 + tester edge #3)
      await tx.wikiPageRevision.create({
        data: {
          pageId: current.id,
          body: current.body,
          contentHash: current.contentHash,
        },
      });

      const updated = await tx.wikiPage.update({
        where: { id: current.id },
        data: {
          body: sanitizedBody,
          contentHash,
          lastEditedBy: WikiPageEditedBy.USER,
        },
      });

      await this.replaceOutboundLinks(
        tx,
        updated.id,
        sanitizedBody,
        updated.locale,
      );

      return updated;
    });
  }

  /**
   * Read WikiKnowledgeBaseConfig for the KB. VIEWER+ access required.
   * Returns the row directly (auto-created on enable per WikiKbAdminService).
   */
  async getConfig(userId: string, knowledgeBaseId: string) {
    await this.assertViewerAccess(userId, knowledgeBaseId);
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { wikiEnabled: true },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");
    const config = await this.prisma.wikiKnowledgeBaseConfig.findUnique({
      where: { knowledgeBaseId },
    });
    // If somehow missing (e.g. legacy KB enabled before defaults landed),
    // synthesize the schema defaults so the UI always has values to show.
    return (
      config ?? {
        knowledgeBaseId,
        autoIngestEnabled: true,
        inlinePageCount: 200,
        inlineTokenBudget: 500_000,
        ingestMaxTokens: 80_000,
        cronLintEnabled: true,
        cronLintDailyBudgetCalls: 50,
        // W3 v2.0 rebuild：兜底默认 ['zh']（与 migration backfill 一致）
        enabledLocales: ["zh"],
        updatedAt: new Date(),
      }
    );
  }

  /**
   * Update WikiKnowledgeBaseConfig (numeric / boolean fields). VIEWER+ access
   * required (matches the relaxed wiki-toggle policy: shared-with-me KBs
   * editable). Numeric fields clamped to safe ranges to prevent abuse.
   */
  async updateConfig(
    userId: string,
    knowledgeBaseId: string,
    patch: {
      /** Master on/off for the per-KB wiki auto-ingest cron. When false the
       *  scheduler skips this KB entirely (no LLM spend). Default true. */
      autoIngestEnabled?: boolean;
      inlinePageCount?: number;
      inlineTokenBudget?: number;
      ingestMaxTokens?: number;
      cronLintEnabled?: boolean;
      cronLintDailyBudgetCalls?: number;
      /** W3 v2.0 rebuild：KB 启用语种集合（zh / en / 二者）。controller 已过滤白名单。*/
      enabledLocales?: Array<"zh" | "en">;
      /** W7 MULTI pass v2.0：'SINGLE' = 单次 LLM 产 N 页（每页 ~300 字硬上限）；
       * 'MULTI' = outline + section-fill (K 路并发, 每页独立 8K tokens output)
       * + cross-link 三段。大文档（>20K 字）一律建议 MULTI。 */
      ingestPassMode?: "SINGLE" | "MULTI";
      ingestSectionConcurrency?: number;
      ingestSectionFailureToleranceRatio?: number;
      ingestOutlineMaxPages?: number;
    },
  ) {
    await this.assertViewerAccess(userId, knowledgeBaseId);
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { wikiEnabled: true },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");
    if (!kb.wikiEnabled) {
      throw new ForbiddenException("Wiki is not enabled for this KB");
    }

    const clamp = (v: number | undefined, min: number, max: number) =>
      v === undefined ? undefined : Math.max(min, Math.min(max, Math.floor(v)));

    const update: Prisma.WikiKnowledgeBaseConfigUpdateInput = {};
    // Defaults match wiki.prisma schema; create branch is only hit if the
    // config row was somehow never written (upsert from a pre-existing KB).
    const create: Prisma.WikiKnowledgeBaseConfigUncheckedCreateInput = {
      knowledgeBaseId,
      inlinePageCount: 200,
      inlineTokenBudget: 500_000,
      ingestMaxTokens: 80_000,
      cronLintEnabled: true,
      cronLintDailyBudgetCalls: 50,
    };

    const ipc = clamp(patch.inlinePageCount, 1, 5_000);
    if (ipc !== undefined) {
      update.inlinePageCount = ipc;
      create.inlinePageCount = ipc;
    }
    const itb = clamp(patch.inlineTokenBudget, 10_000, 5_000_000);
    if (itb !== undefined) {
      update.inlineTokenBudget = itb;
      create.inlineTokenBudget = itb;
    }
    const imt = clamp(patch.ingestMaxTokens, 1_000, 500_000);
    if (imt !== undefined) {
      update.ingestMaxTokens = imt;
      create.ingestMaxTokens = imt;
    }
    if (patch.autoIngestEnabled !== undefined) {
      update.autoIngestEnabled = patch.autoIngestEnabled;
      create.autoIngestEnabled = patch.autoIngestEnabled;
    }
    if (patch.cronLintEnabled !== undefined) {
      update.cronLintEnabled = patch.cronLintEnabled;
      create.cronLintEnabled = patch.cronLintEnabled;
    }
    const cdb = clamp(patch.cronLintDailyBudgetCalls, 0, 5_000);
    if (cdb !== undefined) {
      update.cronLintDailyBudgetCalls = cdb;
      create.cronLintDailyBudgetCalls = cdb;
    }
    // W3 v2.0 rebuild：enabledLocales 写入。空数组拒绝（不允许"无语种"）。
    if (patch.enabledLocales !== undefined && patch.enabledLocales.length > 0) {
      // 去重 + 排序保 deterministic（'en' < 'zh' 按字典序）
      const sorted = Array.from(new Set(patch.enabledLocales)).sort();
      update.enabledLocales = { set: sorted };
      create.enabledLocales = sorted;
    }
    // W7 MULTI pass v2.0：暴露 pass mode + 节流参数到 UI
    if (patch.ingestPassMode === "SINGLE" || patch.ingestPassMode === "MULTI") {
      update.ingestPassMode = patch.ingestPassMode;
      create.ingestPassMode = patch.ingestPassMode;
    }
    const isc = clamp(patch.ingestSectionConcurrency, 1, 10);
    if (isc !== undefined) {
      update.ingestSectionConcurrency = isc;
      create.ingestSectionConcurrency = isc;
    }
    if (
      patch.ingestSectionFailureToleranceRatio !== undefined &&
      Number.isFinite(patch.ingestSectionFailureToleranceRatio)
    ) {
      const r = Math.max(
        0,
        Math.min(1, patch.ingestSectionFailureToleranceRatio),
      );
      update.ingestSectionFailureToleranceRatio = r;
      create.ingestSectionFailureToleranceRatio = r;
    }
    const iomp = clamp(patch.ingestOutlineMaxPages, 1, 200);
    if (iomp !== undefined) {
      update.ingestOutlineMaxPages = iomp;
      create.ingestOutlineMaxPages = iomp;
    }

    return this.prisma.wikiKnowledgeBaseConfig.upsert({
      where: { knowledgeBaseId },
      update,
      create,
    });
  }

  /**
   * W5 v2.0 rebuild (2026-05-12): regenerate the `__index__` system page —
   * a Karpathy "compounding tracker" that lists every page in the KB
   * grouped by category. Called by `WikiDiffService.applyDiff` after a
   * successful apply so the index stays current after each ingest.
   *
   * The index page itself is a regular WikiPage (slug=`__index__`,
   * category=SUMMARY, locale=zh) so it's queryable / readable through
   * the same API surface as user-authored pages. Not part of the diff
   * pipeline (intentional — we don't want it to show up in pending
   * proposals or burn lint budget).
   *
   * Fire-and-forget from caller perspective: we swallow errors here and
   * return a status so apply success isn't blocked by index regen.
   */
  async regenerateIndexPage(knowledgeBaseId: string): Promise<{
    regenerated: boolean;
    pageCount: number;
    locales: Array<"zh" | "en">;
  }> {
    // W5 + gap #5 (2026-05-12): regenerate one __index__ page per
    // KB-enabled locale. Each index lists only same-locale pages so a
    // bilingual KB gets two coherent indexes (zh sees zh pages, en sees
    // en pages). When the config row is missing, fall back to ['zh'].
    const config = await this.prisma.wikiKnowledgeBaseConfig.findUnique({
      where: { knowledgeBaseId },
      select: { enabledLocales: true },
    });
    const enabledLocales = (config?.enabledLocales ?? ["zh"]).filter(
      (v): v is "zh" | "en" => v === "zh" || v === "en",
    );
    const targetLocales: Array<"zh" | "en"> =
      enabledLocales.length > 0 ? enabledLocales : ["zh"];

    let totalPages = 0;
    let anyRegen = false;
    for (const locale of targetLocales) {
      const pages = await this.prisma.wikiPage.findMany({
        where: {
          knowledgeBaseId,
          slug: { not: "__index__" },
          locale,
        },
        orderBy: [{ category: "asc" }, { title: "asc" }],
        select: {
          slug: true,
          title: true,
          category: true,
          oneLiner: true,
        },
      });

      if (pages.length === 0) {
        // Drop any stale per-locale index so re-enabling later starts clean.
        await this.prisma.wikiPage.deleteMany({
          where: {
            knowledgeBaseId,
            slug: "__index__",
            locale,
          },
        });
        continue;
      }

      anyRegen = true;
      totalPages += pages.length;

      const byCategory = new Map<string, typeof pages>();
      for (const p of pages) {
        const bucket = byCategory.get(p.category) ?? [];
        bucket.push(p);
        byCategory.set(p.category, bucket);
      }

      const order: Array<"ENTITY" | "CONCEPT" | "SUMMARY" | "SOURCE"> = [
        "ENTITY",
        "CONCEPT",
        "SUMMARY",
        "SOURCE",
      ];
      // gap #5: per-locale category labels + headline + oneLiner. Both
      // copies sit in DB so a future product decision to translate
      // user-authored pages also benefits.
      const localeStrings: Record<
        "zh" | "en",
        {
          title: string;
          headline: string;
          oneLiner: (n: number) => string;
          labels: Record<string, string>;
        }
      > = {
        zh: {
          title: "Wiki 索引",
          headline:
            "本页由 Wiki 系统自动维护，每次 ingest apply 后重写。\n\n共 {n} 页 · 按类别分组。点击 [[slug]] 进入对应页。",
          oneLiner: (n) => `${n} 页 · 按类别分组的全 KB 索引`,
          labels: {
            ENTITY: "实体页",
            CONCEPT: "概念页",
            SUMMARY: "总结页",
            SOURCE: "源文档页",
          },
        },
        en: {
          title: "Wiki Index",
          headline:
            "This page is maintained automatically by the Wiki system; it is rewritten on every ingest apply.\n\n{n} pages total, grouped by category. Click [[slug]] to open a page.",
          oneLiner: (n) => `${n} pages, grouped by category — full KB index`,
          labels: {
            ENTITY: "Entities",
            CONCEPT: "Concepts",
            SUMMARY: "Summaries",
            SOURCE: "Sources",
          },
        },
      };
      const s = localeStrings[locale];

      const sections: string[] = [];
      for (const cat of order) {
        const grouped = byCategory.get(cat) ?? [];
        if (grouped.length === 0) continue;
        sections.push(`## ${s.labels[cat]} (${grouped.length})`);
        for (const p of grouped) {
          const summary = p.oneLiner ? ` — ${p.oneLiner}` : "";
          sections.push(`- [[${p.slug}]] ${p.title}${summary}`);
        }
        sections.push("");
      }

      const body =
        `${s.headline.replace("{n}", String(pages.length))}\n\n` +
        sections.join("\n");

      const contentHash = crypto
        .createHash("sha256")
        .update(body, "utf8")
        .digest("hex");

      await this.prisma.wikiPage.upsert({
        where: {
          knowledgeBaseId_slug_locale: {
            knowledgeBaseId,
            slug: "__index__",
            locale,
          },
        },
        create: {
          knowledgeBaseId,
          slug: "__index__",
          locale,
          title: s.title,
          category: "SUMMARY",
          body,
          oneLiner: s.oneLiner(pages.length),
          contentHash,
          lastEditedBy: WikiPageEditedBy.LLM,
        },
        update: {
          title: s.title,
          body,
          oneLiner: s.oneLiner(pages.length),
          contentHash,
          lastEditedBy: WikiPageEditedBy.LLM,
        },
      });

      this.logger.log(
        `[regenerateIndexPage] kb=${knowledgeBaseId} locale=${locale} pages=${pages.length}`,
      );
    }

    return {
      regenerated: anyRegen,
      pageCount: totalPages,
      locales: targetLocales,
    };
  }

  private async assertViewerAccess(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<void> {
    const ok = await this.kbService.hasAccess(
      knowledgeBaseId,
      userId,
      "VIEWER",
    );
    if (!ok) {
      // v1.5.3 §7.3: no VIEWER access on the underlying KB returns the
      // generic redirect-to-guidance signal at the controller boundary;
      // service layer just throws a typed exception the controller maps.
      throw new ForbiddenException("Access denied");
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

    // v1.5.3 §11 wikiEnabled=false gate on writes
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
