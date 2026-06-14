import { z } from "zod";
import { WikiPageSourceItemSchema } from "./wiki-diff-items.schema";

/**
 * Section-fill output schema (v1.5.3 §P2 — 2026-05-12 multi-pass consensus).
 *
 * The section-fill pass writes ONE page at a time: given the page identity
 * (slug + title + category) and the H2 sectionSkeleton from the outline pass,
 * it emits the full body + oneLiner + sources. Runs in parallel across
 * pages; each invocation is independent and stateless. The orchestrator
 * tolerates up to `ingestSectionFailureToleranceRatio` of these invocations
 * failing and still commits the rest.
 *
 * Limits mirror WikiDiffCreateItemSchema where they overlap (body ≤ 200_000,
 * oneLiner ≤ 280, sources ≤ 50) so a section-fill output drops cleanly into
 * the final diff envelope without re-validating.
 *
 * NOTE the source item schema is reused VERBATIM from
 * `wiki-diff-items.schema.ts` (`WikiPageSourceItemSchema`). Keeping a single
 * source-item schema prevents drift between the legacy SINGLE-mode diff and
 * the new MULTI-mode section-fill output.
 */

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,198}[a-z0-9]$/;

export const WikiSectionFillSchema = z.object({
  slug: z.string().regex(SLUG_REGEX),
  body: z.string().min(1).max(200_000),
  oneLiner: z.string().min(1).max(280),
  sources: z.array(WikiPageSourceItemSchema).max(50),
});

export type WikiSectionFill = z.infer<typeof WikiSectionFillSchema>;
