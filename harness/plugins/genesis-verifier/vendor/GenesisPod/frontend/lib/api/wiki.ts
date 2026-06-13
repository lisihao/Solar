/**
 * LLM Wiki API client (v1.5.3 P3a/P3b).
 *
 * Mirrors the 19 backend endpoints under /api/v1/library/wiki/* and
 * /api/v1/library/kbs/:kbId/wiki-enabled, returning typed responses.
 * No client-side filtering — server enforces wikiEnabled + hasAccess
 * + role checks per §11 v1.5.x.
 */

import apiClient from './client';

// ─── Types ────────────────────────────────────────────────────────

export type WikiPageCategory = 'ENTITY' | 'CONCEPT' | 'SUMMARY' | 'SOURCE';
export type WikiPageEditedBy = 'USER' | 'LLM' | 'IMPORT';
export type WikiDiffStatus = 'PENDING' | 'APPLIED' | 'DISMISSED' | 'CONFLICTED';
export type WikiOp = 'INGEST' | 'LINT' | 'EDIT' | 'REVERT';
export type WikiLintTypeStr =
  | 'ORPHAN'
  | 'MISSING_XREF'
  | 'STALE'
  | 'CONTRADICTION'
  | 'DATA_GAP';

export interface WikiKbSummary {
  id: string;
  name: string;
  description: string | null;
  type: 'PERSONAL' | 'TEAM';
  pageCount: number;
  lastIngestAt: string | null;
  /**
   * W3-P0 v2.0 rebuild gap #2 (2026-05-12): per-KB enabled locales. Default
   * `['zh']` for backward compat; WikiTab shows the locale switcher only when
   * `enabledLocales.length > 1`.
   */
  enabledLocales?: WikiLocale[];
}

export interface WikiPage {
  id: string;
  knowledgeBaseId: string;
  slug: string;
  title: string;
  category: WikiPageCategory;
  body: string;
  oneLiner: string;
  contentHash: string;
  lastEditedBy: WikiPageEditedBy;
  createdAt: string;
  updatedAt: string;
}

/**
 * 2026-05-14 multi-locale title rebuild: links carry display title + locale.
 * - `title`: 显示用名字；目标 page 不存在（lint MISSING_XREF）时 fallback 到 slug
 * - `exists`: 区分已建立 vs 待补全的占位
 */
export interface WikiPageLinkInfo {
  slug: string;
  title: string;
  locale: 'zh' | 'en' | string;
  exists: boolean;
}

export interface WikiPageWithLinks {
  page: WikiPage;
  outboundLinks: WikiPageLinkInfo[];
  backlinks: WikiPageLinkInfo[];
}

export interface WikiPageSearchHit {
  slug: string;
  title: string;
  oneLiner: string;
  category: WikiPageCategory;
}

export interface WikiDiffSummary {
  id: string;
  status: WikiDiffStatus;
  /**
   * Composite `slug:locale` keys (e.g. `auth:zh`, `auth:en`). Renamed from
   * `affectedSlugs` in the 2026-05-12 multi-pass-and-locale BLOCKER C2 fix
   * so two diffs touching the same slug across different locales do not
   * false-positive collide. UI rendering that wants slug-only display can
   * `s.split(':')[0]`.
   */
  affectedKeys: string[];
}

export interface WikiDiff extends WikiDiffSummary {
  knowledgeBaseId: string;
  items: {
    creates: Array<{
      slug: string;
      title: string;
      category: WikiPageCategory;
      body: string;
      oneLiner: string;
      sources: Array<{
        documentId: string;
        spanStart: number;
        spanEnd: number;
        quote: string;
      }>;
    }>;
    updates: Array<{
      slug: string;
      newBody: string;
      newOneLiner?: string;
      sources?: Array<{
        documentId: string;
        spanStart: number;
        spanEnd: number;
        quote: string;
      }>;
    }>;
    deletes: string[];
  };
  baselineHash: string;
  createdByUserId: string;
  createdAt: string;
  appliedAt: string | null;
  dismissedAt: string | null;
}

export interface WikiQueryResponse {
  answer: string;
  citations: Array<{ slug: string }>;
  usedPageIds: string[];
  branch: 'A_inline' | 'B_rag';
}

export interface WikiLintFinding {
  id: string;
  knowledgeBaseId: string;
  type: WikiLintTypeStr;
  pageId: string | null;
  detail: Record<string, unknown>;
  resolvedAt: string | null;
  createdAt: string;
}

export interface WikiLintRunResult {
  counts: Record<WikiLintTypeStr, number>;
  budgetExceeded: boolean;
}

export interface ToggleWikiEnabledResult {
  kbId: string;
  wikiEnabled: boolean;
  configCreated: boolean;
}

export type WikiLocale = 'zh' | 'en';

export type WikiIngestPassMode = 'SINGLE' | 'MULTI';

export type WikiIngestStage =
  | 'starting'
  | 'load-docs'
  | 'outline'
  | 'section-fill'
  | 'cross-link'
  | 'persist'
  | 'completed'
  | 'failed';

/**
 * 2026-05-19 fire-and-forget UX：后端 wiki-ingest service 写到 in-memory map，
 * GET /library/wiki/:kbId/ingest-progress 返回。前端 banner 每 3-5s 轮询。
 */
export interface WikiIngestProgress {
  status: 'running' | 'completed' | 'failed';
  stage: WikiIngestStage;
  startedAt: string;
  finishedAt?: string;
  passMode: WikiIngestPassMode;
  pagesDone?: number;
  pagesTotal?: number;
  /** 完成时填，前端用于跳转到 PENDING diff 详情 */
  diffId?: string;
  /** status=failed 时填，banner 展示 */
  errorMessage?: string;
  /**
   * Partial-success：completed 时若 section-fill 有页失败，列出 slug。
   * banner 展示 "X 页失败"+ slug 缩略，用户可对失败 slug 单独重试。
   */
  failedSlugs?: string[];
}

export interface WikiKbConfig {
  knowledgeBaseId: string;
  /**
   * Master on/off for the per-KB wiki auto-ingest cron. When false the
   * scheduler skips this KB (no LLM spend). Default true.
   */
  autoIngestEnabled: boolean;
  inlinePageCount: number;
  inlineTokenBudget: number;
  ingestMaxTokens: number;
  cronLintEnabled: boolean;
  cronLintDailyBudgetCalls: number;
  /**
   * W3 v2.0 rebuild — KB-level enabled languages. Admin picks zh / en / both
   * in the settings modal; ingest routes single-locale KBs to source-only
   * pages and dual-locale KBs through the cross-language translation pass.
   * Default `['zh']` mirrors the backend migration backfill.
   */
  enabledLocales: WikiLocale[];
  /**
   * W7 v2.0 — wiki ingest pass mode.
   * SINGLE: one LLM call produces all pages (8K tokens shared, ~300 chars/page).
   *         Cheap but body-starved on documents >20K chars.
   * MULTI:  outline → fan-out section-fill (K-way concurrent, 8K tokens each)
   *         → cross-link. Produces ~8K-12K chars/page. Slower but real depth.
   * Default 'SINGLE' for backward compat; user toggles in the settings modal.
   */
  ingestPassMode: WikiIngestPassMode;
  /** MULTI: parallel section-fill workers. Default 3, range 1-10. */
  ingestSectionConcurrency: number;
  /** MULTI: fraction of pages allowed to fail before whole pass aborts.
   * Default 0.2 (=20%), range 0-1. */
  ingestSectionFailureToleranceRatio: number;
  /** MULTI: hard cap on pages outline phase can declare. Default 30, range 1-200. */
  ingestOutlineMaxPages: number;
  updatedAt: string;
}

export type WikiKbConfigPatch = Partial<
  Pick<
    WikiKbConfig,
    | 'autoIngestEnabled'
    | 'inlinePageCount'
    | 'inlineTokenBudget'
    | 'ingestMaxTokens'
    | 'cronLintEnabled'
    | 'cronLintDailyBudgetCalls'
    | 'enabledLocales'
    | 'ingestPassMode'
    | 'ingestSectionConcurrency'
    | 'ingestSectionFailureToleranceRatio'
    | 'ingestOutlineMaxPages'
  >
>;

export interface KbDocumentSummary {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  createdAt: string;
}

export type WikiIngestCandidateState =
  | 'READY_NEW'
  | 'READY_STALE'
  | 'READY_COVERED'
  | 'BLOCKED';

export interface WikiIngestCandidate {
  id: string;
  title: string;
  sourceType: string;
  mimeType: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  chunkCount: number;
  lastError: string | null;
  pageReferenceCount: number;
  lastCitedAt: string | null;
  ingestState: WikiIngestCandidateState;
  recommended: boolean;
  reason: string;
}

export interface WikiOperationLogEntry {
  id: string;
  op: WikiOp;
  title: string;
  meta: Record<string, unknown>;
  actorUserId: string | null;
  actorName: string | null;
  createdAt: string;
  affectedSlugs: string[];
}

// ─── Endpoints ────────────────────────────────────────────────────

// apiClient already prepends `/api/v1`; paths here are relative to that.
const base = '/library/wiki';

export const wikiApi = {
  // Admin / KB selector
  listKbs: () => apiClient.get<{ items: WikiKbSummary[] }>(`${base}/kbs`),

  /**
   * List documents in a KB (used by Ingest picker). Reuses the existing
   * RAG controller endpoint — no new wiki-specific endpoint needed.
   */
  listKbDocuments: (kbId: string) =>
    apiClient.get<{ items: KbDocumentSummary[] } | KbDocumentSummary[]>(
      `/rag/knowledge-bases/${encodeURIComponent(kbId)}/documents`
    ),

  /**
   * List ALL user-accessible KBs (not just wikiEnabled ones), so the
   * "enable Wiki" modal can show disabled KBs. Reuses RAG controller endpoint.
   */
  listAllKbs: () =>
    apiClient.get<
      | {
          items: Array<{
            id: string;
            name: string;
            type: string;
            wikiEnabled?: boolean;
          }>;
        }
      | Array<{ id: string; name: string; type: string; wikiEnabled?: boolean }>
    >(`/rag/knowledge-bases`),

  toggleWikiEnabled: (kbId: string, enabled: boolean) =>
    apiClient.patch<ToggleWikiEnabledResult>(
      `/library/kbs/${encodeURIComponent(kbId)}/wiki-enabled`,
      { enabled }
    ),

  /**
   * W5 v2.0 rebuild — destructive wipe of all wiki data for a KB. Sets
   * wikiEnabled=false on the KB row but does NOT delete the KB itself or
   * its raw documents (chunks / embeddings stay; only wiki tables are
   * cleared). OWNER role required.
   *
   * Returns counts of each table cleared so the dialog can render
   * "deleted X pages / Y diffs / Z lint findings".
   */
  destroyWikiData: (kbId: string) =>
    apiClient.delete<{
      kbId: string;
      deleted: {
        pages: number;
        diffs: number;
        lintFindings: number;
        coverage: number;
        operations: number;
        ingestDrafts: number;
      };
    }>(`/library/wiki/${encodeURIComponent(kbId)}/destroy`),

  /**
   * 2026-05-14 P0-B: translate this KB's pages into the missing locale.
   * Only pages with `locale != targetLocale` that have no sibling at
   * (slug, targetLocale) are translated. Updates the KB's enabledLocales
   * so subsequent ingests run in bilingual mode. OWNER role required.
   */
  translateKb: (kbId: string, targetLocale: 'zh' | 'en') =>
    apiClient.post<{
      kbId: string;
      targetLocale: 'zh' | 'en';
      translated: number;
      skipped: number;
      failedSlugs: string[];
    }>(`/library/wiki/${encodeURIComponent(kbId)}/translate`, {
      targetLocale,
    }),

  search: (kbId: string, q: string, limit = 20) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return apiClient.get<{ items: WikiPageSearchHit[] }>(
      `${base}/kbs/${encodeURIComponent(kbId)}/pages/search?${params.toString()}`
    );
  },

  // Pages
  // W3-P0 gap #2 (2026-05-12): optional `locale` lets bilingual KBs scope
  // listing / fetching to zh / en. Single-locale callers omit → backend
  // defaults to 'zh' for getPage, "all locales" for listPages.
  listPages: (
    kbId: string,
    category?: WikiPageCategory,
    limit = 200,
    locale?: WikiLocale
  ) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (category) params.set('category', category);
    if (locale) params.set('locale', locale);
    return apiClient.get<{ items: WikiPage[] }>(
      `${base}/${encodeURIComponent(kbId)}/pages?${params.toString()}`
    );
  },

  getPage: (kbId: string, slug: string, locale?: WikiLocale) => {
    const params = new URLSearchParams();
    if (locale) params.set('locale', locale);
    const qs = params.toString();
    return apiClient.get<WikiPageWithLinks>(
      `${base}/${encodeURIComponent(kbId)}/pages/${encodeURIComponent(slug)}${
        qs ? `?${qs}` : ''
      }`
    );
  },

  createPage: (
    kbId: string,
    payload: {
      slug: string;
      title: string;
      category: WikiPageCategory;
      body: string;
      oneLiner: string;
    }
  ) =>
    apiClient.post<{ page: WikiPage }>(
      `${base}/${encodeURIComponent(kbId)}/pages`,
      payload
    ),

  updatePage: (
    kbId: string,
    slug: string,
    payload: {
      action?: 'edit' | 'revert';
      title?: string;
      category?: WikiPageCategory;
      body?: string;
      oneLiner?: string;
      toRevisionId?: string;
    }
  ) =>
    apiClient.patch<{ page: WikiPage }>(
      `${base}/${encodeURIComponent(kbId)}/pages/${encodeURIComponent(slug)}`,
      payload
    ),

  deletePage: (kbId: string, slug: string) =>
    apiClient.delete<void>(
      `${base}/${encodeURIComponent(kbId)}/pages/${encodeURIComponent(slug)}`
    ),

  // Ingest / Diff
  // 2026-05-19 fire-and-forget：MULTI pass 一份大文档要 5-12 分钟，
  // 同步 await 会被 Cloudflare / Railway edge timeout 切断。后端 controller
  // 现在立即返回 { async: true, diff: { id: 'processing', status: 'PENDING',
  // affectedKeys: [] } }，真正的 WikiDiff 在后台跑完写入；前端依据 async 字段
  // 关 modal + toast 提示，不再跳转到不存在的 diff id。
  ingest: (kbId: string, documentIds: string[]) =>
    apiClient.post<{ diff: WikiDiffSummary; async: boolean }>(
      `${base}/${encodeURIComponent(kbId)}/ingest`,
      { documentIds },
      { timeout: 60_000 } // 后端立即返回，长 timeout 不需要了
    ),

  // 2026-05-19 fire-and-forget 进度查询；前端 banner 每 3-5s 轮询。
  // progress=null 表示没在跑（或 5min cleanup 已清）。
  getIngestProgress: (kbId: string) =>
    apiClient.get<{ progress: WikiIngestProgress | null }>(
      `${base}/${encodeURIComponent(kbId)}/ingest-progress`
    ),

  listIngestCandidates: (kbId: string) =>
    apiClient.get<{ items: WikiIngestCandidate[] }>(
      `${base}/${encodeURIComponent(kbId)}/ingest-candidates`
    ),

  // 2026-05-14 P4-A: PENDING diff 体积可达 30+ pages × 8K-16K body chars，
  // 默认 30s timeout 在大 diff 上极易超（Screenshot_12 "Request timeout after
  // 30000ms"）。提到 5 min 让 apply transaction + lint trigger 跑完再 ack。
  getDiff: (kbId: string, diffId: string) =>
    apiClient.get<WikiDiff>(
      `${base}/${encodeURIComponent(kbId)}/diffs/${encodeURIComponent(diffId)}`,
      { timeout: 300_000 }
    ),

  patchDiff: (
    kbId: string,
    diffId: string,
    action: 'apply' | 'dismiss',
    selectedItemIds?: string[],
    options?: { supersedeConflictingDiffs?: boolean }
  ) =>
    apiClient.patch<WikiDiff>(
      `${base}/${encodeURIComponent(kbId)}/diffs/${encodeURIComponent(diffId)}`,
      {
        action,
        selectedItemIds,
        ...(options?.supersedeConflictingDiffs
          ? { supersedeConflictingDiffs: true }
          : {}),
      },
      { timeout: 300_000 }
    ),

  // Query
  // Wiki query also calls an LLM (inline or RAG branch); 30s default is too
  // tight when the model is busy or the inline budget is large.
  query: (
    kbId: string,
    request: {
      question: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      mode?: 'inline' | 'rag' | 'auto';
    }
  ) =>
    apiClient.post<WikiQueryResponse>(
      `${base}/${encodeURIComponent(kbId)}/query`,
      request,
      { timeout: 120_000 }
    ),

  // Config (KB-level wiki settings)
  getConfig: (kbId: string) =>
    apiClient.get<WikiKbConfig>(`${base}/${encodeURIComponent(kbId)}/config`),

  updateConfig: (kbId: string, patch: WikiKbConfigPatch) =>
    apiClient.patch<WikiKbConfig>(
      `${base}/${encodeURIComponent(kbId)}/config`,
      patch
    ),

  // Lint
  // runLint触发的全量 lint 检查在大 KB 下也会跑数十秒。
  runLint: (kbId: string) =>
    apiClient.post<WikiLintRunResult>(
      `${base}/${encodeURIComponent(kbId)}/lint`,
      {},
      { timeout: 120_000 }
    ),

  listLintFindings: (
    kbId: string,
    options: { type?: WikiLintTypeStr; resolved?: boolean } = {}
  ) => {
    const params = new URLSearchParams();
    if (options.type) params.set('type', options.type);
    if (options.resolved !== undefined)
      params.set('resolved', String(options.resolved));
    const qs = params.toString();
    return apiClient.get<{ items: WikiLintFinding[] }>(
      `${base}/${encodeURIComponent(kbId)}/lint-findings${qs ? `?${qs}` : ''}`
    );
  },

  patchLintFinding: (
    kbId: string,
    findingId: string,
    action: 'resolve' | 'dismiss'
  ) =>
    apiClient.patch<WikiLintFinding>(
      `${base}/${encodeURIComponent(kbId)}/lint-findings/${encodeURIComponent(findingId)}`,
      { action }
    ),

  batchPatchLintFindings: (
    kbId: string,
    body: {
      action: 'resolve' | 'dismiss';
      ids?: string[];
      filterAll?: boolean;
      type?: WikiLintTypeStr;
    }
  ) =>
    apiClient.post<{ updated: number }>(
      `${base}/${encodeURIComponent(kbId)}/lint-findings/batch`,
      body
    ),

  // Operation log (Log drawer — ingest / lint / edit / revert history)
  listOperations: (kbId: string, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    return apiClient.get<{ items: WikiOperationLogEntry[] }>(
      `${base}/${encodeURIComponent(kbId)}/operations?${params.toString()}`
    );
  },
};
