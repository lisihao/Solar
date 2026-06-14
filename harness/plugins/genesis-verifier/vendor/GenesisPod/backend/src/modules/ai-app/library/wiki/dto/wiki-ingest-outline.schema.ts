import { z } from "zod";

/**
 * Outline-pass output schema (v1.5.3 §P2 — 2026-05-12 multi-pass consensus).
 *
 * The outline pass plans the diff: which pages to create / update / delete,
 * the H2 section skeleton per page, and a coverageMap that the lint pipeline
 * cross-checks. Section-fill pass writes bodies + oneLiners + sources in a
 * later step — DO NOT add those fields here.
 *
 * Limits chosen per §P2:
 *  - slug: a-z0-9 + hyphens, 2-200 chars, no leading/trailing hyphens.
 *  - sectionSkeleton: 1-10 H2 titles per page. Each title ≤ 200 chars
 *    (single-line H2; the `s` flag accepts CJK + ASCII without surprises).
 *  - creates: ≤ 30 per outline (matches ingestOutlineMaxPages default).
 *  - updates: ≤ 30 per outline.
 *  - deletes: ≤ 20 per outline (delete sparingly).
 *  - coverageMap: optional map from entity name → assigned slug.
 *
 * NOTE on translationGroupId: it is intentionally NOT in this schema. The
 * LLM cannot reliably mint UUIDs, so the outline returns a stable human-
 * readable `groupLabel` (free-form 1-200 chars) and the service layer
 * deduplicates labels then assigns `crypto.randomUUID()` per unique group.
 * This resolves BLOCKER #9 of the 2026-05-12 consensus.
 */

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,198}[a-z0-9]$/;
const SECTION_TITLE_REGEX = /^.{1,200}$/s;

export const WikiOutlineCategorySchema = z.enum([
  "ENTITY",
  "CONCEPT",
  "SUMMARY",
  "SOURCE",
]);

export const WikiOutlineCreateItemSchema = z.object({
  slug: z.string().regex(SLUG_REGEX),
  title: z.string().min(1).max(500),
  category: WikiOutlineCategorySchema,
  sectionSkeleton: z
    .array(z.string().regex(SECTION_TITLE_REGEX))
    .min(1)
    .max(10),
  groupLabel: z.string().min(1).max(200),
});

export const WikiOutlineUpdateItemSchema = z.object({
  slug: z.string().regex(SLUG_REGEX),
  sectionSkeleton: z
    .array(z.string().regex(SECTION_TITLE_REGEX))
    .min(1)
    .max(10),
});

export const WikiOutlineSchema = z.object({
  creates: z.array(WikiOutlineCreateItemSchema).max(30),
  updates: z.array(WikiOutlineUpdateItemSchema).max(30),
  deletes: z.array(z.string().regex(SLUG_REGEX)).max(20),
  coverageMap: z.record(z.string(), z.string()).optional(),
});

export type WikiOutline = z.infer<typeof WikiOutlineSchema>;
export type WikiOutlineCreateItem = z.infer<typeof WikiOutlineCreateItemSchema>;
export type WikiOutlineUpdateItem = z.infer<typeof WikiOutlineUpdateItemSchema>;
