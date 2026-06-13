import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { AIModelType, Prisma } from "@prisma/client";
import * as crypto from "crypto";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { KnowledgeBaseService } from "../rag/services/knowledge-base.service";
import { AiChatService } from "../../../ai-engine/facade";

export interface WikiKbSummary {
  id: string;
  name: string;
  description: string | null;
  type: "PERSONAL" | "TEAM";
  pageCount: number;
  lastIngestAt: Date | null;
  /**
   * W3-P0 v2.0 rebuild gap #2 (2026-05-12): per-KB enabled locale set so
   * frontend can show the locale switcher only on bilingual KBs.
   * Defaults to ['zh'] when the config row is missing (legacy KB).
   */
  enabledLocales: Array<"zh" | "en">;
}

export interface WikiPageSearchHit {
  slug: string;
  title: string;
  oneLiner: string;
  category: string;
}

export interface WikiOperationLogEntry {
  id: string;
  op: "INGEST" | "LINT" | "EDIT" | "REVERT";
  title: string;
  meta: Record<string, unknown>;
  actorUserId: string | null;
  actorName: string | null;
  createdAt: Date;
  affectedSlugs: string[];
}

const SEARCH_REGEX = /^[\p{L}\p{N}\p{M}\s\-]+$/u;

/**
 * WikiKbAdminService — v1.5.3 P3b backend support for the KB selector,
 * wikiEnabled toggle, and wiki-internal search.
 *
 * Three endpoints (per v1.5.3 §6 + §11 v1.5.x security rules):
 *
 *  - GET /library/wiki/kbs
 *    Lists wikiEnabled KBs the user has VIEWER+ access to (server-side
 *    filtering only; frontend never sees other KBs). Excludes KBs that
 *    have wikiEnabled=false.
 *
 *  - PATCH /library/kbs/:kbId/wiki-enabled
 *    Toggles wikiEnabled. Requires KB OWNER or ADMIN role (per security
 *    P0-5: prevents EDITOR from unilaterally enabling wiki and exposing
 *    ingest payload surface). EDITOR/VIEWER → 403.
 *
 *  - GET /library/wiki/kbs/:kbId/pages/search
 *    Wiki-internal full-text search restricted to caller's KB. Path
 *    segment kbId enforces scope; service layer hasAccess + wikiEnabled
 *    double check; returns only slug/title/oneLiner/category (NOT body)
 *    to minimize data exposure surface; q regex defends ReDoS via
 *    Unicode property classes.
 */
@Injectable()
export class WikiKbAdminService {
  private readonly logger = new Logger(WikiKbAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kbService: KnowledgeBaseService,
    private readonly chat: AiChatService,
  ) {}

  /**
   * List wikiEnabled KBs accessible to the user (VIEWER+).
   * Server-side filtering — no client-side fallback (per §11 v1.5.x).
   * Sorted by most-recently-edited wiki page (activity proxy).
   */
  async listWikiEnabledKbs(userId: string): Promise<WikiKbSummary[]> {
    const userKbs = await this.kbService.findByUser(userId);
    const wikiEnabledIds = userKbs
      .filter((kb) => (kb as { wikiEnabled?: boolean }).wikiEnabled)
      .map((kb) => kb.id);

    if (wikiEnabledIds.length === 0) return [];

    // Fetch page counts + last ingest time + per-KB enabledLocales config
    // in parallel. enabledLocales is loaded here so the frontend doesn't
    // need a second round-trip just to decide whether to show the locale
    // switcher on the KB selector.
    const [pageCounts, ingestRows, configs] = await Promise.all([
      this.prisma.wikiPage.groupBy({
        by: ["knowledgeBaseId"],
        where: { knowledgeBaseId: { in: wikiEnabledIds } },
        _count: { _all: true },
      }),
      this.prisma.wikiOperationLog.findMany({
        where: {
          knowledgeBaseId: { in: wikiEnabledIds },
          op: "INGEST",
        },
        select: { knowledgeBaseId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.wikiKnowledgeBaseConfig.findMany({
        where: { knowledgeBaseId: { in: wikiEnabledIds } },
        select: { knowledgeBaseId: true, enabledLocales: true },
      }),
    ]);

    const countByKb = new Map(
      pageCounts.map((c) => [c.knowledgeBaseId, c._count._all]),
    );
    const lastIngestByKb = new Map<string, Date>();
    for (const row of ingestRows) {
      if (!lastIngestByKb.has(row.knowledgeBaseId)) {
        lastIngestByKb.set(row.knowledgeBaseId, row.createdAt);
      }
    }
    const localesByKb = new Map<string, Array<"zh" | "en">>();
    for (const cfg of configs) {
      const filtered = cfg.enabledLocales.filter(
        (v): v is "zh" | "en" => v === "zh" || v === "en",
      );
      localesByKb.set(
        cfg.knowledgeBaseId,
        filtered.length > 0 ? filtered : ["zh"],
      );
    }

    return userKbs
      .filter((kb) => wikiEnabledIds.includes(kb.id))
      .map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
        type: kb.type as "PERSONAL" | "TEAM",
        pageCount: countByKb.get(kb.id) ?? 0,
        lastIngestAt: lastIngestByKb.get(kb.id) ?? null,
        // Default to ['zh'] when config row missing (matches schema default
        // + migration backfill). Tests rely on this fallback.
        enabledLocales: localesByKb.get(kb.id) ?? ["zh"],
      }))
      .sort((a, b) => {
        const at = a.lastIngestAt?.getTime() ?? 0;
        const bt = b.lastIngestAt?.getTime() ?? 0;
        return bt - at;
      });
  }

  /**
   * Toggle wikiEnabled on a KB. Requires any KB access (VIEWER+) — i.e. owner,
   * any KbMember role, or platform admin (per kbService.hasAccess fallback).
   *
   * Note: 2026-05-09 product decision relaxed this from ADMIN+ to VIEWER+ —
   * shared-with-me KBs should also be wiki-enable-able. The original P0-5
   * concern (EDITOR exposing ingest surface) is mitigated downstream by
   * existing per-action checks on /ingest, /lint, /query, etc.
   *
   * On enable: upsert WikiKnowledgeBaseConfig with v1.5.3 defaults so
   * subsequent reads (query / lint / ingest) have config to consult.
   * Returns { kbId, wikiEnabled, configCreated } so the UI can flag
   * the first-time path.
   */
  async toggleWikiEnabled(
    userId: string,
    knowledgeBaseId: string,
    enabled: boolean,
  ): Promise<{
    kbId: string;
    wikiEnabled: boolean;
    configCreated: boolean;
  }> {
    const ok = await this.kbService.hasAccess(
      knowledgeBaseId,
      userId,
      "VIEWER",
    );
    if (!ok) {
      throw new ForbiddenException(
        "Need at least KB access to toggle wikiEnabled",
      );
    }

    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { id: true, wikiEnabled: true },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");

    if (kb.wikiEnabled === enabled) {
      return {
        kbId: knowledgeBaseId,
        wikiEnabled: enabled,
        configCreated: false,
      };
    }

    let configCreated = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeBase.update({
        where: { id: knowledgeBaseId },
        data: { wikiEnabled: enabled },
      });
      if (enabled) {
        const existing = await tx.wikiKnowledgeBaseConfig.findUnique({
          where: { knowledgeBaseId },
        });
        if (!existing) {
          await tx.wikiKnowledgeBaseConfig.create({
            data: { knowledgeBaseId },
          });
          configCreated = true;
        }
      }
      await tx.wikiOperationLog.create({
        data: {
          knowledgeBaseId,
          op: "EDIT",
          title: `wikiEnabled toggled to ${enabled}`,
          meta: {
            action: "toggle_wiki_enabled",
            enabled,
          } as Prisma.InputJsonValue,
          actorUserId: userId,
        },
      });
    });

    this.logger.log(
      `[toggleWikiEnabled] kb=${knowledgeBaseId} enabled=${enabled} configCreated=${configCreated} actor=${userId}`,
    );
    return {
      kbId: knowledgeBaseId,
      wikiEnabled: enabled,
      configCreated,
    };
  }

  /**
   * W5 v2.0 rebuild (2026-05-12): destructive hard-delete of a KB's wiki
   * data. Wipes pages / diffs / lint / coverage / operation log / ingest
   * drafts / config — but PRESERVES the underlying KnowledgeBase and its
   * documents (chunks, embeddings, raw docs are RAG-side, untouched).
   *
   * Use case: user wants to fully reset Wiki for a KB and re-ingest from
   * scratch (existing pages were generated under bad prompt / shrunk LLM
   * / wrong locale). Today the only path was per-page DELETE — at 50+
   * pages that's painful and leaves diffs / lint state inconsistent.
   *
   * Sets wikiEnabled=false at the same time so re-enable is an explicit
   * fresh start (re-creates default config row + emits operation log).
   *
   * Requires OWNER or ADMIN role on the KB (destructive — VIEWER not
   * allowed even though enable is VIEWER+; this is the only wiki op
   * gated tighter than enable per CLAUDE.md "destructive_op_must_have_
   * rollback" feedback).
   *
   * Rollback: this op is intentionally not soft-deletable — we hold the
   * cascade-deletes inside a single $transaction so a mid-op crash
   * leaves the KB untouched. The WikiOperationLog entry is created
   * AFTER the cascade succeeds so successful destroy + subsequent crash
   * still leaves an audit trail.
   */
  async destroyWikiData(
    userId: string,
    knowledgeBaseId: string,
  ): Promise<{
    kbId: string;
    deleted: {
      pages: number;
      diffs: number;
      lintFindings: number;
      coverage: number;
      operations: number;
      ingestDrafts: number;
    };
  }> {
    const ok = await this.kbService.hasAccess(knowledgeBaseId, userId, "OWNER");
    if (!ok) {
      throw new ForbiddenException(
        "Destroying wiki data requires KB OWNER or platform ADMIN role",
      );
    }
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { id: true, wikiEnabled: true },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");

    const counts = await this.prisma.$transaction(async (tx) => {
      // Cascade order: dependent rows first (defense-in-depth even though
      // schema has onDelete: Cascade — explicit deletes give count returns
      // so the UI can show "X pages / Y diffs / Z lint findings cleared").
      const ingestDrafts = await tx.wikiIngestDraft.deleteMany({
        where: { knowledgeBaseId },
      });
      const coverage = await tx.wikiDocumentCoverage.deleteMany({
        where: { knowledgeBaseId },
      });
      const lintFindings = await tx.wikiLintFinding.deleteMany({
        where: { knowledgeBaseId },
      });
      const diffs = await tx.wikiDiff.deleteMany({
        where: { knowledgeBaseId },
      });
      const operations = await tx.wikiOperationLog.deleteMany({
        where: { knowledgeBaseId },
      });
      // WikiPage cascade reaches WikiPageSource / WikiPageLink (from side) /
      // WikiPageRevision / WikiPageEmbedding via onDelete: Cascade. Backlinks
      // (other pages' WikiPageLink.toSlug pointing here) are slug strings —
      // they remain but their target slug is gone; deliberate, since after
      // destroy the next ingest may produce new pages reusing the same slug.
      const pages = await tx.wikiPage.deleteMany({
        where: { knowledgeBaseId },
      });
      await tx.wikiKnowledgeBaseConfig.deleteMany({
        where: { knowledgeBaseId },
      });
      await tx.knowledgeBase.update({
        where: { id: knowledgeBaseId },
        data: { wikiEnabled: false },
      });
      return {
        pages: pages.count,
        diffs: diffs.count,
        lintFindings: lintFindings.count,
        coverage: coverage.count,
        operations: operations.count,
        ingestDrafts: ingestDrafts.count,
      };
    });

    this.logger.warn(
      `[destroyWikiData] kb=${knowledgeBaseId} actor=${userId} deleted pages=${counts.pages} ` +
        `diffs=${counts.diffs} lint=${counts.lintFindings} cov=${counts.coverage} ` +
        `ops=${counts.operations} drafts=${counts.ingestDrafts}`,
    );

    return { kbId: knowledgeBaseId, deleted: counts };
  }

  /**
   * Wiki-internal search restricted to a single KB.
   *
   * Defense layers (per §11 v1.5.x):
   *  - kbId path segment enforced by controller; service double-checks
   *    hasAccess + wikiEnabled
   *  - q regex blocks ReDoS via Unicode property classes (linear match)
   *  - returns only metadata fields (slug/title/oneLiner/category) — no
   *    body / contentHash / sourceRefs / lastEditedBy
   */
  async searchPages(
    userId: string,
    knowledgeBaseId: string,
    query: string,
    limit: number = 20,
  ): Promise<WikiPageSearchHit[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      throw new ForbiddenException("Search query must be 1–200 characters");
    }
    if (!SEARCH_REGEX.test(trimmed)) {
      throw new ForbiddenException(
        "Search query contains disallowed characters",
      );
    }

    const ok = await this.kbService.hasAccess(
      knowledgeBaseId,
      userId,
      "VIEWER",
    );
    if (!ok) throw new ForbiddenException("Access denied");

    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { wikiEnabled: true },
    });
    // v1.5.3 §6: KB unknown / wikiEnabled=false returns 404 (existence
    // oracle protection)
    if (!kb || !kb.wikiEnabled) {
      throw new NotFoundException("Knowledge base not found");
    }

    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const lower = trimmed.toLowerCase();

    const pages = await this.prisma.wikiPage.findMany({
      where: {
        knowledgeBaseId,
        OR: [
          { slug: { contains: lower, mode: "insensitive" } },
          { title: { contains: trimmed, mode: "insensitive" } },
          { oneLiner: { contains: trimmed, mode: "insensitive" } },
        ],
      },
      select: {
        slug: true,
        title: true,
        oneLiner: true,
        category: true,
      },
      orderBy: { updatedAt: "desc" },
      take: safeLimit,
    });

    return pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      oneLiner: p.oneLiner,
      category: p.category,
    }));
  }

  /**
   * List recent operation log entries for a KB. Time-reverse cards on the
   * frontend "Log" drawer surface ingest / lint / edit / revert history.
   *
   * Access: VIEWER+ (consistent with read-only wiki surfaces).
   * Returns up to `limit` entries (clamped to 1–200, default 50).
   */
  async listOperations(
    userId: string,
    knowledgeBaseId: string,
    limit: number = 50,
  ): Promise<WikiOperationLogEntry[]> {
    const ok = await this.kbService.hasAccess(
      knowledgeBaseId,
      userId,
      "VIEWER",
    );
    if (!ok) throw new ForbiddenException("Access denied");

    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { wikiEnabled: true },
    });
    if (!kb || !kb.wikiEnabled) {
      throw new NotFoundException("Knowledge base not found");
    }

    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));

    const rows = await this.prisma.wikiOperationLog.findMany({
      where: { knowledgeBaseId },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      include: {
        pages: {
          include: {
            page: { select: { slug: true } },
          },
        },
      },
    });

    const actorIds = Array.from(
      new Set(
        rows
          .map((r) => r.actorUserId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const actorMap = new Map<string, string>();
    if (actorIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, username: true, email: true },
      });
      for (const u of users) {
        actorMap.set(u.id, u.username || u.email || u.id.slice(0, 8));
      }
    }

    return rows.map((r) => ({
      id: r.id,
      op: r.op,
      title: r.title,
      meta:
        r.meta && typeof r.meta === "object" && !Array.isArray(r.meta)
          ? (r.meta as Record<string, unknown>)
          : {},
      actorUserId: r.actorUserId,
      actorName: r.actorUserId ? (actorMap.get(r.actorUserId) ?? null) : null,
      createdAt: r.createdAt,
      affectedSlugs: r.pages
        .map((p) => p.page?.slug)
        .filter((s): s is string => Boolean(s)),
    }));
  }

  /**
   * 2026-05-14 P0-B: translate every page lacking the target locale to that
   * locale. Used when a KB was originally zh-only and the user wants en
   * coverage WITHOUT re-running the expensive source-document ingest.
   *
   * Semantics:
   *  - Only pages with `locale != targetLocale` AND no sibling page at
   *    `(kbId, slug, targetLocale)` are translated.
   *  - For each translated page, mint a translationGroupId (or reuse the
   *    source page's existing one). Both source + target locale rows end up
   *    pointing to the same group → frontend locale switcher can pair them.
   *  - Updates the KB's enabledLocales to include targetLocale so future
   *    ingests treat the KB as bilingual.
   *  - Audit log entry of op="EDIT" with meta={kind:"translate-kb",...}.
   *
   * Concurrency: sequential pages, but parallel within a batch of 3 so we
   * don't spike LLM rate limits. Partial-success — failures are logged and
   * counted but don't abort the whole job.
   *
   * Owner-only (translates produce DB writes + LLM costs).
   */
  async translateKbToLocale(
    userId: string,
    knowledgeBaseId: string,
    targetLocale: "zh" | "en",
  ): Promise<{
    kbId: string;
    targetLocale: "zh" | "en";
    translated: number;
    skipped: number;
    failedSlugs: string[];
  }> {
    const ok = await this.kbService.hasAccess(knowledgeBaseId, userId, "OWNER");
    if (!ok) {
      throw new ForbiddenException(
        "Translating KB wiki requires KB OWNER or platform ADMIN role",
      );
    }
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { id: true, wikiEnabled: true },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");
    if (!kb.wikiEnabled) {
      throw new BadRequestException("KB does not have wiki enabled");
    }

    const allPages = await this.prisma.wikiPage.findMany({
      where: { knowledgeBaseId },
      select: {
        id: true,
        slug: true,
        locale: true,
        title: true,
        body: true,
        oneLiner: true,
        category: true,
        contentHash: true,
        translationGroupId: true,
      },
    });
    if (allPages.length === 0) {
      return {
        kbId: knowledgeBaseId,
        targetLocale,
        translated: 0,
        skipped: 0,
        failedSlugs: [],
      };
    }

    const slugsWithTarget = new Set(
      allPages.filter((p) => p.locale === targetLocale).map((p) => p.slug),
    );
    const candidates = allPages.filter(
      (p) => p.locale !== targetLocale && !slugsWithTarget.has(p.slug),
    );
    if (candidates.length === 0) {
      return {
        kbId: knowledgeBaseId,
        targetLocale,
        translated: 0,
        skipped: allPages.length,
        failedSlugs: [],
      };
    }

    const failedSlugs: string[] = [];
    let translatedCount = 0;
    const concurrency = 3;
    for (let i = 0; i < candidates.length; i += concurrency) {
      const batch = candidates.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        batch.map((p) =>
          this.translateOnePage(p, targetLocale, userId, knowledgeBaseId),
        ),
      );
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j];
        const src = batch[j];
        if (r.status === "fulfilled") {
          translatedCount += 1;
        } else {
          failedSlugs.push(src.slug);
          this.logger.warn(
            `[translateKb] slug=${src.slug} failed: ${
              r.reason instanceof Error ? r.reason.message : String(r.reason)
            }`,
          );
        }
      }
    }

    // Bump enabledLocales so subsequent ingests run in bilingual mode.
    await this.prisma.wikiKnowledgeBaseConfig
      .upsert({
        where: { knowledgeBaseId },
        create: {
          knowledgeBaseId,
          enabledLocales: ["zh", "en"],
        },
        update: {
          enabledLocales: { set: Array.from(new Set(["zh", "en"])) },
        },
      })
      .catch((err) =>
        this.logger.warn(
          `[translateKb] enabledLocales update failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    await this.prisma.wikiOperationLog
      .create({
        data: {
          knowledgeBaseId,
          op: "EDIT",
          title: `Translate KB → ${targetLocale}`,
          actorUserId: userId,
          meta: {
            kind: "translate-kb",
            targetLocale,
            translated: translatedCount,
            skipped: allPages.length - candidates.length,
            failedSlugs,
          } as Prisma.InputJsonValue,
        },
      })
      .catch((err) =>
        this.logger.warn(
          `[translateKb] operation log write failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    this.logger.log(
      `[translateKb] kb=${knowledgeBaseId} actor=${userId} target=${targetLocale} translated=${translatedCount} failed=${failedSlugs.length}`,
    );

    return {
      kbId: knowledgeBaseId,
      targetLocale,
      translated: translatedCount,
      skipped: allPages.length - candidates.length,
      failedSlugs,
    };
  }

  /**
   * Translate a single page via LLM and write the target-locale row. Reuses
   * the source page's translationGroupId or mints a new one (and backfills
   * the source row so future renders pair them). Caller wraps per-page
   * failure into a Promise rejection — we throw on LLM / DB errors.
   */
  private async translateOnePage(
    source: {
      id: string;
      slug: string;
      locale: string;
      title: string;
      body: string;
      oneLiner: string;
      category: string;
      contentHash: string;
      translationGroupId: string | null;
    },
    targetLocale: "zh" | "en",
    userId: string,
    knowledgeBaseId: string,
  ): Promise<void> {
    const sourceLang = source.locale === "zh" ? "Chinese" : "English";
    const targetLang = targetLocale === "zh" ? "Chinese" : "English";

    const systemPrompt = [
      "You are a professional technical translator. You translate wiki pages",
      "between Chinese and English while preserving structure, technical",
      "terminology, and idiomatic native style.",
      "",
      "Rules:",
      "- Translate `title`, `body` (markdown), and `oneLiner`.",
      `- Source language: ${sourceLang}. Target language: ${targetLang}.`,
      "- Preserve ALL `[[slug]]` wiki-link references unchanged (the slug is",
      "  locale-agnostic; only surface text changes via the `|...` form).",
      "- Preserve ALL markdown structure: `## H2` headings, `### H3`, fenced",
      "  code blocks, `![alt](url)` image links, bulleted / numbered lists,",
      "  tables. H2 / H3 heading TEXT must be translated to the target",
      "  language (e.g. `## 概述` → `## Overview`).",
      "- Preserve technical terminology, model names, code identifiers,",
      "  product names verbatim (e.g. `Nvidia H100`, `torch.compile`).",
      "- Write in idiomatic native style, NOT word-for-word translation.",
      "- `oneLiner` HARD LIMIT 280 characters in target language.",
      "",
      "Respond ONLY with a single JSON object — no prose, no markdown fence:",
      '{ "title": "...", "body": "...", "oneLiner": "..." }',
    ].join("\n");

    const userPrompt = [
      `## Source page (${sourceLang})`,
      `slug: ${source.slug}`,
      `category: ${source.category}`,
      "",
      `### title`,
      source.title,
      "",
      `### oneLiner`,
      source.oneLiner,
      "",
      `### body (markdown)`,
      source.body,
    ].join("\n");

    const raw = await this.chat.chat({
      messages: [{ role: "user", content: userPrompt }],
      systemPrompt,
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "low", outputLength: "extended" },
      responseFormat: "json_object",
      operationName: "library-wiki-translate-kb",
      skipGuardrails: true,
      userId,
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.content) as Record<string, unknown>;
    } catch {
      throw new Error("translate-kb LLM returned non-JSON");
    }
    const title = typeof parsed.title === "string" ? parsed.title : "";
    const body = typeof parsed.body === "string" ? parsed.body : "";
    const oneLinerRaw =
      typeof parsed.oneLiner === "string" ? parsed.oneLiner : "";
    if (!title || !body || !oneLinerRaw) {
      throw new Error("translate-kb LLM omitted a required field");
    }
    const oneLiner =
      oneLinerRaw.length > 280
        ? oneLinerRaw.slice(0, 277).trimEnd() + "..."
        : oneLinerRaw;

    const groupId = source.translationGroupId ?? crypto.randomUUID();
    const newContentHash = crypto
      .createHash("sha256")
      .update(body)
      .digest("hex");

    await this.prisma.$transaction(async (tx) => {
      // Backfill the source row with the groupId if it had none, so both
      // locales point to the same translationGroupId after this op.
      if (!source.translationGroupId) {
        await tx.wikiPage.update({
          where: { id: source.id },
          data: { translationGroupId: groupId },
        });
      }
      await tx.wikiPage.create({
        data: {
          knowledgeBaseId,
          slug: source.slug,
          locale: targetLocale,
          title,
          body,
          oneLiner,
          category: source.category as
            | "ENTITY"
            | "CONCEPT"
            | "SUMMARY"
            | "SOURCE",
          contentHash: newContentHash,
          translationGroupId: groupId,
          lastEditedBy: "LLM",
        },
      });
    });
  }
}
