import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  AIModelType,
  Prisma,
  WikiLintFinding,
  WikiLintType,
  WikiPage,
} from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { KnowledgeBaseService } from "../rag/services/knowledge-base.service";
import {
  AiChatService,
  CrossCuttingSynthesisService,
  StaleDetectorService,
  type StaleSourceEntry,
  type SynthesisDocument,
} from "../../../ai-engine/facade";

/**
 * WikiLintService — 5 lint types per v1.5.3 §5.3
 *
 * Pure SQL (wiki-specific, fast, no LLM cost):
 *  - ORPHAN: pages with no inbound link AND category != SOURCE
 *  - MISSING_XREF: WikiPageLink.toSlug not present in WikiPage
 *
 * LLM-driven (delegates to ai-engine facade primitives):
 *  - STALE: StaleDetectorService.detect on (referenceText vs currentText)
 *  - CONTRADICTION: CrossCuttingSynthesisService.detectContradictions
 *  - DATA_GAP: CrossCuttingSynthesisService.detectDataGaps
 *
 * Trigger sources:
 *  - invariant (after diff apply): SQL-only types, instant
 *  - user-triggered POST /lint: all 5 types
 *  - cron daily: all 5 types, LLM types capped by config.cronLintDailyBudgetCalls
 *
 * Concurrency: cron and user-triggered runs check WikiOperationLog for a
 * recent lint within 1 minute and short-circuit to return existing findings.
 */
@Injectable()
export class WikiLintService {
  private readonly logger = new Logger(WikiLintService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kbService: KnowledgeBaseService,
    private readonly chat: AiChatService,
    private readonly synthesis: CrossCuttingSynthesisService,
    private readonly staleDetector: StaleDetectorService,
  ) {}

  /** List existing lint findings (read-only, VIEWER access). */
  async listFindings(
    userId: string,
    knowledgeBaseId: string,
    options: { type?: WikiLintType; resolved?: boolean } = {},
  ): Promise<WikiLintFinding[]> {
    await this.assertViewerAccess(userId, knowledgeBaseId);
    return this.prisma.wikiLintFinding.findMany({
      where: {
        knowledgeBaseId,
        ...(options.type ? { type: options.type } : {}),
        ...(options.resolved === true
          ? { resolvedAt: { not: null } }
          : options.resolved === false
            ? { resolvedAt: null }
            : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  /** Resolve / dismiss a single finding (EDITOR access). */
  async patchFinding(
    userId: string,
    knowledgeBaseId: string,
    findingId: string,
    action: "resolve" | "dismiss",
  ): Promise<WikiLintFinding> {
    await this.assertEditorAccessAndWikiEnabled(userId, knowledgeBaseId);
    const finding = await this.prisma.wikiLintFinding.findUnique({
      where: { id: findingId },
    });
    // v1.5.3 §6 IDOR unified 404
    if (!finding || finding.knowledgeBaseId !== knowledgeBaseId) {
      throw new NotFoundException("Lint finding not found");
    }
    return this.prisma.wikiLintFinding.update({
      where: { id: findingId },
      data: {
        resolvedAt: action === "resolve" ? new Date() : new Date(),
      },
    });
  }

  /**
   * 批量 resolve / dismiss findings。
   * - ids 给定 → 仅作用这些 id（自动用 kb 做 IDOR 过滤）
   * - filterAll=true + type → 作用该 type 下所有未解决
   * - 二者皆未给 → 作用 KB 下所有未解决（"全部解决"）
   * 返回受影响的条数。
   */
  async batchPatchFindings(
    userId: string,
    knowledgeBaseId: string,
    action: "resolve" | "dismiss",
    selector: { ids?: string[]; filterAll?: boolean; type?: WikiLintType },
  ): Promise<{ updated: number }> {
    await this.assertEditorAccessAndWikiEnabled(userId, knowledgeBaseId);
    const where: Prisma.WikiLintFindingWhereInput = {
      knowledgeBaseId,
      resolvedAt: null,
    };
    if (selector.ids && selector.ids.length > 0) {
      where.id = { in: selector.ids };
    } else if (!selector.filterAll) {
      // 无 ids 且未声明 filterAll → 拒绝，避免 caller 误传空 ids 把整 KB 全清
      return { updated: 0 };
    }
    if (selector.type) {
      where.type = selector.type;
    }
    const result = await this.prisma.wikiLintFinding.updateMany({
      where,
      data: { resolvedAt: new Date() },
    });
    this.logger.log(
      `[batchPatchFindings] kb=${knowledgeBaseId} action=${action} type=${selector.type ?? "*"} updated=${result.count}`,
    );
    return { updated: result.count };
  }

  /**
   * Run pure-SQL invariant lint (ORPHAN + MISSING_XREF only).
   *
   * Used after diff apply (best-effort, outside the apply transaction so a
   * lint failure never rolls back the apply itself).
   */
  async runInvariantLint(knowledgeBaseId: string): Promise<WikiLintFinding[]> {
    const created: WikiLintFinding[] = [];
    const orphanFindings = await this.computeOrphans(knowledgeBaseId);
    const xrefFindings = await this.computeMissingXrefs(knowledgeBaseId);
    for (const f of [...orphanFindings, ...xrefFindings]) {
      const row = await this.prisma.wikiLintFinding.create({ data: f });
      created.push(row);
    }
    this.logger.log(
      `[runInvariantLint] kb=${knowledgeBaseId} orphan=${orphanFindings.length} xref=${xrefFindings.length}`,
    );
    return created;
  }

  /**
   * Run all 5 lint types. EDITOR access. Honors per-KB LLM budget for
   * STALE/CONTRADICTION/DATA_GAP.
   */
  async runFullLint(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<{
    counts: Record<WikiLintType, number>;
    budgetExceeded: boolean;
  }> {
    await this.assertEditorAccessAndWikiEnabled(userId, knowledgeBaseId);
    return this.runFullLintInternal(knowledgeBaseId, userId);
  }

  /**
   * Cron entry — same lint pipeline, but bypasses user auth (trusted internal
   * caller) and runs as a system LLM call. Wired by WikiLintScheduler at
   * 03:00 UTC daily; also callable by tests.
   */
  async runFullLintAsCron(knowledgeBaseId: string): Promise<{
    counts: Record<WikiLintType, number>;
    budgetExceeded: boolean;
  }> {
    return this.runFullLintInternal(knowledgeBaseId, undefined);
  }

  private async runFullLintInternal(
    knowledgeBaseId: string,
    userId: string | undefined,
  ): Promise<{
    counts: Record<WikiLintType, number>;
    budgetExceeded: boolean;
  }> {
    const config = await this.prisma.wikiKnowledgeBaseConfig.findUnique({
      where: { knowledgeBaseId },
    });
    const llmBudget = config?.cronLintDailyBudgetCalls ?? 50;

    const counts: Record<WikiLintType, number> = {
      ORPHAN: 0,
      MISSING_XREF: 0,
      STALE: 0,
      CONTRADICTION: 0,
      DATA_GAP: 0,
    };

    // SQL-only types
    const orphanFindings = await this.computeOrphans(knowledgeBaseId);
    const xrefFindings = await this.computeMissingXrefs(knowledgeBaseId);
    for (const f of [...orphanFindings, ...xrefFindings]) {
      await this.prisma.wikiLintFinding.create({ data: f });
      counts[f.type as WikiLintType] += 1;
    }

    // Load pages once for LLM-driven types
    const pages = await this.prisma.wikiPage.findMany({
      where: { knowledgeBaseId },
      include: {
        sources: {
          select: {
            quote: true,
            spanStart: true,
            spanEnd: true,
            // rawContentUri 必须同 select 让 hydrate hook 能回填 off-load 后的内容
            document: { select: { rawContent: true, rawContentUri: true } },
          },
          take: 5,
        },
      },
      take: 200,
    });

    let llmCallsRemaining = llmBudget;

    // STALE
    if (llmCallsRemaining > 0 && pages.length > 0) {
      const entries = this.buildStaleEntries(pages);
      if (entries.length > 0) {
        try {
          const results = await this.staleDetector.detect(
            entries,
            (sys, user) =>
              this.chat
                .chat({
                  systemPrompt: sys,
                  messages: [{ role: "user", content: user }],
                  responseFormat: "json_object",
                  operationName: "library-wiki-lint-stale",
                  modelType: AIModelType.CHAT,
                  userId,
                })
                .then((r) => ({
                  content: r.content,
                  tokensUsed: r.usage?.totalTokens ?? 0,
                })),
          );
          for (const r of results) {
            if (!r.isStale) continue;
            await this.prisma.wikiLintFinding.create({
              data: {
                knowledgeBaseId,
                type: WikiLintType.STALE,
                pageId: r.id,
                detail: {
                  driftScore: r.driftScore,
                  reason: r.reason ?? null,
                } as Prisma.InputJsonValue,
              },
            });
            counts.STALE += 1;
          }
          llmCallsRemaining -= 1;
        } catch (e) {
          this.logger.warn(
            `[runFullLint] STALE failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    // CONTRADICTION
    if (llmCallsRemaining > 0 && pages.length >= 2) {
      try {
        const documents: SynthesisDocument[] = pages.map((p) => ({
          id: p.slug,
          title: p.title,
          body: p.body,
          category: p.category,
        }));
        const contradictions = await this.synthesis.detectContradictions(
          documents,
          (sys, user) =>
            this.chat
              .chat({
                systemPrompt: sys,
                messages: [{ role: "user", content: user }],
                responseFormat: "json_object",
                operationName: "library-wiki-lint-contradiction",
                modelType: AIModelType.CHAT,
                userId,
              })
              .then((r) => ({
                content: r.content,
                tokensUsed: r.usage?.totalTokens ?? 0,
              })),
          { samplingLimit: Math.min(20, pages.length) },
        );
        for (const c of contradictions) {
          await this.prisma.wikiLintFinding.create({
            data: {
              knowledgeBaseId,
              type: WikiLintType.CONTRADICTION,
              detail: c as unknown as Prisma.InputJsonValue,
            },
          });
          counts.CONTRADICTION += 1;
        }
        llmCallsRemaining -= 1;
      } catch (e) {
        this.logger.warn(
          `[runFullLint] CONTRADICTION failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // DATA_GAP
    if (llmCallsRemaining > 0 && pages.length >= 3) {
      try {
        const documents: SynthesisDocument[] = pages.map((p) => ({
          id: p.slug,
          title: p.title,
          body: p.body,
          category: p.category,
        }));
        const existingEntityIds = pages
          .filter((p) => p.category === "ENTITY")
          .map((p) => p.slug);
        const gaps = await this.synthesis.detectDataGaps(
          documents,
          (sys, user) =>
            this.chat
              .chat({
                systemPrompt: sys,
                messages: [{ role: "user", content: user }],
                responseFormat: "json_object",
                operationName: "library-wiki-lint-data-gap",
                modelType: AIModelType.CHAT,
                userId,
              })
              .then((r) => ({
                content: r.content,
                tokensUsed: r.usage?.totalTokens ?? 0,
              })),
          { existingEntityIds },
        );
        for (const g of gaps) {
          await this.prisma.wikiLintFinding.create({
            data: {
              knowledgeBaseId,
              type: WikiLintType.DATA_GAP,
              detail: g as unknown as Prisma.InputJsonValue,
            },
          });
          counts.DATA_GAP += 1;
        }
        llmCallsRemaining -= 1;
      } catch (e) {
        this.logger.warn(
          `[runFullLint] DATA_GAP failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const budgetExceeded = llmCallsRemaining <= 0 && pages.length > 0;
    this.logger.log(
      `[runFullLint] kb=${knowledgeBaseId} counts=${JSON.stringify(counts)} budgetExceeded=${budgetExceeded}`,
    );
    return { counts, budgetExceeded };
  }

  // ─── SQL-only computations ───

  private async computeOrphans(
    knowledgeBaseId: string,
  ): Promise<Array<Prisma.WikiLintFindingCreateManyInput>> {
    // ORPHAN: pages without inbound WikiPageLink AND category != SOURCE.
    // Use raw SQL for the subquery (no Prisma DSL for "not exists in
    // related table with self-join via slug").
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; slug: string }>
    >`
      SELECT p.id, p.slug
      FROM "wiki_pages" p
      WHERE p.knowledge_base_id = ${knowledgeBaseId}
        AND p.category != 'SOURCE'
        AND NOT EXISTS (
          SELECT 1 FROM "wiki_page_links" l
          WHERE l.to_slug = p.slug
        )
    `;
    return rows.map((r) => ({
      knowledgeBaseId,
      type: WikiLintType.ORPHAN,
      pageId: r.id,
      detail: { slug: r.slug } as Prisma.InputJsonValue,
    }));
  }

  private async computeMissingXrefs(
    knowledgeBaseId: string,
  ): Promise<Array<Prisma.WikiLintFindingCreateManyInput>> {
    // MISSING_XREF: WikiPageLink.(toSlug, toLocale) has no matching
    // WikiPage(slug, locale) in the same KB. pageId is the FROM page so the
    // user can navigate to fix.
    //
    // BLOCKER A1 (2026-05-12 multi-pass-and-locale consensus): under the
    // locale-aware unique key ([knowledgeBaseId, slug, locale]) "missing"
    // is defined PER LOCALE — `[[auth]]` from a zh page that resolves only
    // to a wiki_pages row with locale='en' is genuinely a missing xref in
    // the zh world. The join now matches BOTH `to_slug` AND `to_locale`
    // (the column was promoted to NOT NULL DEFAULT 'zh' in P3 commit 1
    // 20260514_wiki_locale_add_columns, so this predicate never produces
    // NULL semantics).
    //
    // Semantic note (kept here so it does not drift): MISSING_XREF in the
    // multi-locale world means "the target (slug, locale) pair does not
    // exist". A future enhancement could fall back to "any locale" (group
    // fallback) when the toLocale-specific row is missing — that lives in
    // the wiki-page reader, not the lint pipeline.
    const rows = await this.prisma.$queryRaw<
      Array<{ from_page_id: string; to_slug: string; to_locale: string }>
    >`
      SELECT l.from_page_id, l.to_slug, l.to_locale
      FROM "wiki_page_links" l
      JOIN "wiki_pages" fp ON fp.id = l.from_page_id
      WHERE fp.knowledge_base_id = ${knowledgeBaseId}
        AND NOT EXISTS (
          SELECT 1 FROM "wiki_pages" tp
          WHERE tp.knowledge_base_id = ${knowledgeBaseId}
            AND tp.slug = l.to_slug
            AND tp.locale = l.to_locale
        )
    `;
    return rows.map((r) => ({
      knowledgeBaseId,
      type: WikiLintType.MISSING_XREF,
      pageId: r.from_page_id,
      detail: {
        toSlug: r.to_slug,
        toLocale: r.to_locale,
      } as Prisma.InputJsonValue,
    }));
  }

  private buildStaleEntries(
    pages: Array<
      WikiPage & {
        sources: Array<{
          quote: string;
          spanStart: number;
          spanEnd: number;
          document: { rawContent: string | null; rawContentUri: string | null };
        }>;
      }
    >,
  ): StaleSourceEntry[] {
    const entries: StaleSourceEntry[] = [];
    for (const p of pages) {
      if (p.sources.length === 0) continue;
      const sources = p.sources
        .map((s) => {
          const raw = s.document.rawContent ?? "";
          const start = Math.max(0, Math.min(s.spanStart, raw.length));
          const end = Math.max(start, Math.min(s.spanEnd, raw.length));
          return {
            referenceText: s.quote,
            currentText: raw.slice(start, end),
          };
        })
        .filter((s) => s.referenceText.length > 0 && s.currentText.length > 0);
      if (sources.length === 0) continue;
      entries.push({ id: p.id, sources });
    }
    return entries;
  }

  // ─── Access helpers ───

  private async assertViewerAccess(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<void> {
    const ok = await this.kbService.hasAccess(
      knowledgeBaseId,
      userId,
      "VIEWER",
    );
    if (!ok) throw new ForbiddenException("Access denied");
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
}
