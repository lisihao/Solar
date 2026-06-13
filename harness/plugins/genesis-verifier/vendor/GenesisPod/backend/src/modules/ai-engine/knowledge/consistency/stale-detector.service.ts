import { Injectable, Logger } from "@nestjs/common";

// ─── Types ───

/**
 * One entry to check for staleness.
 *
 * Each entry can have multiple sources (a wiki page typically cites several
 * raw documents); the entry is considered stale if ANY of its sources has
 * drifted beyond the threshold.
 */
export interface StaleSourceEntry {
  /** Stable identifier (e.g. WikiPage.id, ResearchSection.id) */
  id: string;
  /**
   * Source citations to verify. `referenceText` is the historical quote stored
   * with the page (immutable since page.body was last edited). `currentText`
   * is the latest substring from the underlying raw document — if the raw was
   * edited / the document content changed, currentText differs from referenceText.
   */
  sources: Array<{
    referenceText: string;
    currentText: string;
  }>;
}

export interface StaleResult {
  id: string;
  isStale: boolean;
  /** 0 = identical, 1 = completely diverged. LLM-estimated semantic drift. */
  driftScore: number;
  /** LLM's brief rationale when isStale=true (omitted if isStale=false). */
  reason?: string;
}

export interface DetectStaleOptions {
  /** Drift threshold above which `isStale` is true. Default 0.3. */
  staleThreshold?: number;
  /** Reserved for future routing to specific model profiles. */
  taskProfile?: { creativity: "deterministic" | "balanced" };
}

// ─── Prompt ───

const STALE_SYSTEM_PROMPT = `You are an editorial consistency checker.

For each entry, you receive a "reference quote" (what a derived page currently
cites) and a "current text" (the latest version of the same span in the source
document). Your job is to determine whether the meaning has drifted.

Score each entry from 0.0 to 1.0:
- 0.0–0.2: only whitespace/formatting/typo differences (NOT stale)
- 0.2–0.5: minor wording changes that preserve meaning (NOT stale)
- 0.5–0.8: meaningful semantic shift, conclusion may have changed (STALE)
- 0.8–1.0: complete reversal or unrelated content (STALE)

You MUST respond in valid JSON matching this schema:
{
  "results": [
    { "id": "<entry-id>", "driftScore": 0.0, "reason": "<one-sentence rationale; omit if driftScore < threshold>" }
  ]
}`;

// ─── Service ───

/**
 * StaleDetectorService
 *
 * Detects whether a referenced quote has semantically drifted from its current
 * source text. Used by wiki-lint STALE finding type; also reusable by research
 * / writing modules for "this citation may be outdated" warnings.
 *
 * Capability ownership rationale (v1.5.3 §3.1): quote-vs-current-text drift
 * detection is a generic semantic-consistency primitive needed wherever
 * derived content cites raw sources. Lives in ai-engine/knowledge/consistency/
 * alongside synthesis/extraction/evidence as a peer concern.
 *
 * Decoupled from any specific LLM service via injected `chatFn` (same pattern
 * as CrossCuttingSynthesisService).
 */
@Injectable()
export class StaleDetectorService {
  private readonly logger = new Logger(StaleDetectorService.name);

  /**
   * Detect staleness for each entry.
   *
   * @param entries - entries to check; each may have multiple sources
   * @param chatFn - injected LLM call function
   * @param options - threshold and task profile overrides
   * @returns one StaleResult per input entry, in the same order
   */
  async detect(
    entries: StaleSourceEntry[],
    chatFn: (
      systemPrompt: string,
      userPrompt: string,
    ) => Promise<{ content: string; tokensUsed: number }>,
    options: DetectStaleOptions = {},
  ): Promise<StaleResult[]> {
    if (entries.length === 0) return [];

    const threshold = options.staleThreshold ?? 0.3;

    const userPrompt = this.buildUserPrompt(entries);

    try {
      const result = await chatFn(STALE_SYSTEM_PROMPT, userPrompt);
      const parsed = this.parseResponse(result.content, entries);

      // Apply threshold to mark isStale.
      const finalized: StaleResult[] = parsed.map((r) => ({
        id: r.id,
        driftScore: r.driftScore,
        isStale: r.driftScore >= threshold,
        ...(r.driftScore >= threshold && r.reason ? { reason: r.reason } : {}),
      }));

      this.logger.log(
        `[detect] Checked ${entries.length} entries; ${finalized.filter((r) => r.isStale).length} stale (threshold=${threshold})`,
      );

      return finalized;
    } catch (error) {
      this.logger.error(
        `[detect] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Conservative fallback: mark nothing stale on LLM failure to avoid
      // false-positive blocking. wiki-lint cron path will retry next cycle.
      return entries.map((e) => ({
        id: e.id,
        isStale: false,
        driftScore: 0,
      }));
    }
  }

  /** Build per-entry prompt body. Public for testability. */
  buildUserPrompt(entries: StaleSourceEntry[]): string {
    const parts: string[] = [`Total entries: ${entries.length}\n`];
    for (const e of entries) {
      parts.push(`\n--- Entry: ${e.id} ---`);
      e.sources.forEach((s, i) => {
        parts.push(`\nSource ${i + 1}:`);
        parts.push(`Reference quote: ${this.truncate(s.referenceText, 600)}`);
        parts.push(`Current text:    ${this.truncate(s.currentText, 600)}`);
      });
    }
    return parts.join("\n");
  }

  /**
   * Parse LLM JSON response into per-entry results.
   * Falls back to driftScore=0 (not stale) for any missing/malformed entry.
   */
  parseResponse(
    content: string,
    entries: StaleSourceEntry[],
  ): Array<{ id: string; driftScore: number; reason?: string }> {
    const fallback = (id: string) => ({ id, driftScore: 0 });

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn("[parseResponse] No JSON in response");
        return entries.map((e) => fallback(e.id));
      }
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const rawResults = Array.isArray(parsed.results) ? parsed.results : [];

      const byId = new Map<string, { driftScore: number; reason?: string }>();
      for (const r of rawResults as Array<Record<string, unknown>>) {
        if (typeof r.id !== "string") continue;
        const score =
          typeof r.driftScore === "number" &&
          r.driftScore >= 0 &&
          r.driftScore <= 1
            ? r.driftScore
            : 0;
        const reason = typeof r.reason === "string" ? r.reason : undefined;
        byId.set(r.id, { driftScore: score, reason });
      }

      return entries.map((e) => {
        const got = byId.get(e.id);
        if (!got) return fallback(e.id);
        return { id: e.id, driftScore: got.driftScore, reason: got.reason };
      });
    } catch (error) {
      this.logger.warn(
        `[parseResponse] JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return entries.map((e) => fallback(e.id));
    }
  }

  private truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) + "…" : s;
  }
}
