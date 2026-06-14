import { z } from "zod";

/**
 * WikiDiff.items shape (v1.5.3 §11.1 zod schema).
 *
 * apply / dismiss must zod parse `WikiDiff.items` BEFORE entering the Prisma
 * transaction (security R3 P2: defends against malicious / buggy ingest
 * writing illegal fields into DB).
 *
 * Limits chosen per v1.5.3 §11.1:
 *  - slug: a-z0-9 + hyphens, 2-200 chars, no leading/trailing hyphens
 *  - body: ≤ 200_000 chars per page
 *  - oneLiner: ≤ 280 chars
 *  - sources: ≤ 50 per page
 *  - creates: ≤ 100 per diff
 *  - updates: ≤ 100 per diff
 *  - deletes: ≤ 20 per diff (delete sparingly)
 */

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,198}[a-z0-9]$/;

export const WikiPageSourceItemSchema = z
  .object({
    // Accept any non-empty string. Service layer enforces the documentId is in
    // the caller-supplied whitelist (LLMs hallucinate UUIDs even when given the
    // real ones; strict uuid() here would fail entire diffs over one bad cite).
    documentId: z.string().min(1).max(200),
    spanStart: z.number().int().min(0),
    spanEnd: z.number().int().min(0),
    quote: z.string().min(1).max(2000),
  })
  .refine((s) => s.spanStart <= s.spanEnd, {
    message: "spanStart must be <= spanEnd",
  });

export const WikiPageCategorySchema = z.enum([
  "ENTITY",
  "CONCEPT",
  "SUMMARY",
  "SOURCE",
]);

/**
 * P3 (2026-05-12): every diff item carries a `locale` string. CRITICAL
 * (BLOCKER C6 / consensus #8): the field has `.default('zh')` and is
 * NEVER `.required()`. Legacy PENDING diffs persisted before P3
 * (which omit `locale` entirely from items.creates[]/items.updates[])
 * MUST still parse cleanly and route to the 'zh' locale automatically
 * — otherwise an in-flight upgrade would brick those rows on
 * applyDiff. zod fills the missing field at parse time inside
 * applyDiff so the downstream code can read `item.locale`
 * unconditionally.
 *
 * Range: 2–8 chars matches the wiki_pages.locale column VARCHAR(8) and
 * is wide enough for "zh-CN" / "en-US" style BCP47 tags.
 */
const WikiLocaleSchema = z.string().min(2).max(8).default("zh");

/**
 * W3 v2.0 rebuild gap #1 (2026-05-12): optional translation pairing key for
 * bilingual KBs. When KB.enabledLocales has both zh + en, the LLM emits two
 * CREATE items per page concept (one per locale) sharing the same UUID v4
 * here so frontend can pair them. Single-locale KB → field absent → no
 * pairing (each page stands alone).
 *
 * Stored as a plain string (not z.string().uuid()) to mirror our LLM-
 * tolerance design (cf. SLUG_REGEX rationale): one bad UUID from a
 * hallucinating model must not 400 the whole diff. The Prisma column is
 * also `String?`, so length 16-64 keeps the cost-vs-flexibility balance.
 */
const TranslationGroupIdSchema = z.string().min(8).max(64).optional();

export const WikiDiffCreateItemSchema = z.object({
  slug: z.string().regex(SLUG_REGEX),
  locale: WikiLocaleSchema,
  title: z.string().min(1).max(500),
  category: WikiPageCategorySchema,
  body: z.string().min(1).max(200_000),
  oneLiner: z.string().min(1).max(280),
  sources: z.array(WikiPageSourceItemSchema).max(50),
  translationGroupId: TranslationGroupIdSchema,
});

export const WikiDiffUpdateItemSchema = z.object({
  slug: z.string().regex(SLUG_REGEX),
  locale: WikiLocaleSchema,
  newBody: z.string().min(1).max(200_000),
  newOneLiner: z.string().min(1).max(280).optional(),
  sources: z.array(WikiPageSourceItemSchema).max(50).optional(),
});

export const WikiDiffItemsSchema = z.object({
  creates: z.array(WikiDiffCreateItemSchema).max(100),
  updates: z.array(WikiDiffUpdateItemSchema).max(100),
  deletes: z.array(z.string().regex(SLUG_REGEX)).max(20),
});

export type WikiDiffItems = z.infer<typeof WikiDiffItemsSchema>;
export type WikiDiffCreateItem = z.infer<typeof WikiDiffCreateItemSchema>;
export type WikiDiffUpdateItem = z.infer<typeof WikiDiffUpdateItemSchema>;
export type WikiPageSourceItem = z.infer<typeof WikiPageSourceItemSchema>;
