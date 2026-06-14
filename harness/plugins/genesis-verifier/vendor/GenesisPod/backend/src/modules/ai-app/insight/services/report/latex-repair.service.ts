import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  validateLatexDelimiters,
  type LatexValidationResult,
} from "@/common/utils/latex-delimiter-validator";

/**
 * LaTeX Repair Service
 *
 * Surgical repair for reports where the markdown has ALREADY been stored
 * with malformed LaTeX (bare commands, unclosed `$`, prose inside `$...$`).
 *
 * This service DOES NOT regenerate content. It asks the LLM to add or fix
 * math delimiters ONLY — every character of prose must stay identical.
 * That keeps cost low and preserves the researcher's work.
 *
 * Strategy:
 *   1. Run `validateLatexDelimiters` on the stored markdown.
 *   2. If clean, return untouched.
 *   3. Otherwise, send the markdown + a STRICT repair prompt to the LLM.
 *   4. Re-validate the LLM response. If still invalid, return the
 *      MORE-valid of the two (fewer issues) and log a warning.
 *
 * Safety:
 *   - Temperature LOW (deterministic text-level edits only).
 *   - System prompt is explicit that no other edits are allowed.
 *   - Caller is responsible for persisting the result.
 */
@Injectable()
export class LatexRepairService {
  private readonly logger = new Logger(LatexRepairService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * Repair LaTeX delimiters in a markdown document without changing prose.
   *
   * Returns:
   *   - `{ repaired: markdown, changed: false }` when input was already valid.
   *   - `{ repaired, changed: true, before, after }` when LLM produced a
   *     strictly-better result (fewer issues) — `after` is the residual
   *     validation result so callers can tell whether any issues remain.
   *   - `{ repaired: original, changed: false, before, failureReason }`
   *     when LLM repair failed and original is kept unchanged.
   */
  /**
   * Maximum markdown length we send to the LLM in one shot.
   * Large reports are split by H2 headings so each chunk fits. 30 KB is
   * ~7.5 k tokens — comfortably inside any model's single-pass budget and
   * keeps response time low enough that HTTP callers don't time out.
   */
  private static readonly MAX_CHUNK_CHARS = 30000;

  async repairMarkdown(markdown: string): Promise<{
    repaired: string;
    changed: boolean;
    before?: LatexValidationResult;
    after?: LatexValidationResult;
    failureReason?: string;
  }> {
    // ── No mechanical pre-cleanup ──
    // Earlier iterations stripped `$$$1$$` artifacts and `}$$` patterns
    // via regex, but a scan of 303 stored reports showed every candidate
    // "artifact" carries LOST content (the regex bug that produced `$1`
    // replaced a real formula, so stripping `$1` leaves a lone `}` or
    // mismatched delimiter — adding MORE issues, not fewer). Only an LLM
    // that sees surrounding context can safely rebuild those regions.
    //
    // So: we skip straight to validator → (chunked) LLM.
    const before = validateLatexDelimiters(markdown);
    if (before.valid) {
      return { repaired: markdown, changed: false };
    }

    // ── Chunked path for large documents ──
    if (markdown.length > LatexRepairService.MAX_CHUNK_CHARS) {
      return this.repairChunked(markdown, before);
    }

    this.logger.log(
      `[LatexRepair] Found ${before.issues.length} issue(s), invoking LLM. Types: ${Array.from(
        new Set(before.issues.map((i) => i.kind)),
      ).join(", ")}`,
    );

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(markdown, before);

    let response;
    try {
      response = await this.chatFacade.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        operationName: "LaTeX公式定界符修复",
        modelType: AIModelType.CHAT,
        skipGuardrails: true,
        cachePolicy: "auto",
        taskProfile: {
          creativity: "deterministic",
          outputLength: "extended",
        },
      });
    } catch (err) {
      this.logger.warn(
        `[LatexRepair] LLM call failed: ${(err as Error).message}. Keeping original.`,
      );
      return {
        repaired: markdown,
        changed: false,
        before,
        failureReason: `llm_error: ${(err as Error).message}`,
      };
    }

    if (response.isError) {
      this.logger.warn(
        `[LatexRepair] LLM returned error state. Keeping original.`,
      );
      return {
        repaired: markdown,
        changed: false,
        before,
        failureReason: "llm_error_response",
      };
    }

    const candidate = this.stripBoundaryMarkers(
      this.stripCodeFence(response.content),
    ).trim();

    // Refuse if LLM returned an obviously-too-short response (it summarized
    // or refused instead of repairing). Heuristic: repaired length should be
    // within 85%..120% of original.
    if (
      candidate.length < markdown.length * 0.85 ||
      candidate.length > markdown.length * 1.2
    ) {
      this.logger.warn(
        `[LatexRepair] LLM response length ${candidate.length} out of bounds (${markdown.length} original). Keeping original.`,
      );
      return {
        repaired: markdown,
        changed: false,
        before,
        failureReason: "llm_response_length_out_of_bounds",
      };
    }

    const after = validateLatexDelimiters(candidate);
    // Only accept if strictly fewer issues
    if (after.issues.length >= before.issues.length) {
      this.logger.warn(
        `[LatexRepair] LLM did not reduce issue count (${before.issues.length} → ${after.issues.length}). Keeping original.`,
      );
      return {
        repaired: markdown,
        changed: false,
        before,
        after,
        failureReason: "no_improvement",
      };
    }

    this.logger.log(
      `[LatexRepair] Issues reduced ${before.issues.length} → ${after.issues.length}. Accepting LLM repair.`,
    );
    return { repaired: candidate, changed: true, before, after };
  }

  private buildSystemPrompt(): string {
    return [
      "You are a LaTeX delimiter repair tool. Your ONLY job is to add or fix math delimiters in markdown.",
      "",
      "STRICT RULES — follow exactly:",
      "1. Do NOT change any prose, wording, sentence, punctuation, or paragraph structure.",
      "2. Do NOT add, remove, or modify any markdown heading, list, table, image, or link.",
      "3. Do NOT add commentary. Your entire output is ONLY the repaired markdown.",
      "4. You MAY:",
      "   - Wrap bare LaTeX formulas (e.g. `T_{r,s}`, `\\frac{a}{b}`, `\\sum_{i}^{n}`) in `$...$`.",
      "   - Wrap display formulas (standalone equations on their own line) in `$$...$$`.",
      "   - Close unclosed `$` openings.",
      "   - Close unclosed `$$` openings.",
      "   - Remove `$` misplaced INSIDE a subscript brace (e.g. `T_{\\mathrm{ret}$}` → `T_{\\mathrm{ret}}$`).",
      "   - Split `$...$` blocks that wrongly contain prose (close the formula before the prose).",
      "   - Fix `x_{输入}` → wrap CJK in `\\text{...}`: `x_{\\text{输入}}`.",
      "5. Keep all existing `$`-wrapped math exactly as-is if already valid.",
      "6. Preserve every CJK character in its original position.",
      "7. Output the full repaired document in one response. Do NOT truncate.",
    ].join("\n");
  }

  private buildUserPrompt(
    markdown: string,
    validation: LatexValidationResult,
  ): string {
    const issueList = validation.issues
      .slice(0, 15)
      .map((issue, idx) => `  ${idx + 1}. [${issue.kind}] ${issue.message}`)
      .join("\n");
    return [
      "The following markdown document has broken LaTeX delimiters. Repair ONLY the math delimiters.",
      "",
      "Validator detected these issues:",
      issueList,
      validation.issues.length > 15
        ? `  ...and ${validation.issues.length - 15} more.`
        : "",
      "",
      "Return the full repaired markdown with identical prose. Do not add any preamble or code-fence wrapper.",
      "",
      "--- DOCUMENT START ---",
      markdown,
      "--- DOCUMENT END ---",
    ]
      .filter(Boolean)
      .join("\n");
  }

  /**
   * Strip a leading/trailing ```markdown code fence if the LLM wrapped
   * its response despite being told not to.
   */
  private stripCodeFence(text: string): string {
    const m = text.match(/^```(?:markdown)?\s*\n?([\s\S]*?)\n?```\s*$/);
    return m ? m[1] : text;
  }

  /**
   * Remove the `--- DOCUMENT START ---` / `--- DOCUMENT END ---` sentinels
   * that we use in {@link buildUserPrompt} if the LLM echoed them back.
   *
   * Rule (safe-truncation bias):
   *  1. If the response begins (after optional leading whitespace) with
   *     `--- DOCUMENT START ---`, drop that line.
   *  2. If `--- DOCUMENT END ---` appears anywhere in the response,
   *     **truncate at its first occurrence** — the marker AND everything
   *     after it are discarded. This defends against a common LLM failure
   *     mode where the model echoes the end sentinel then continues to
   *     hallucinate new sections.
   *
   * Observed in prod: 22 TopicReport rows got up to 2.8 MB of hallucinated
   * continuations appended after the end marker before this guard existed.
   */
  private stripBoundaryMarkers(text: string): string {
    // 1) Strip leading START marker (allow whitespace prefix).
    let out = text.replace(/^\s*--- DOCUMENT START ---[ \t]*\n?/, "");

    // 2) Truncate at first END marker, regardless of position. A non-prefix
    //    START elsewhere in the body is left untouched — we prefer keeping
    //    the body over aggressive surgery.
    const endIdx = out.indexOf("--- DOCUMENT END ---");
    if (endIdx !== -1) {
      out = out.slice(0, endIdx);
    }

    return out;
  }

  /**
   * Chunked repair for documents larger than MAX_CHUNK_CHARS.
   * Splits at top-level `## ` headings so the LLM only sees one chapter
   * at a time. Headings themselves travel with the chunk that follows.
   * Only chapters that have validator issues are sent to the LLM — the
   * rest are copied through unchanged to minimize cost and latency.
   */
  private async repairChunked(
    markdown: string,
    before: LatexValidationResult,
  ): Promise<{
    repaired: string;
    changed: boolean;
    before: LatexValidationResult;
    after: LatexValidationResult;
  }> {
    const chunks = this.splitByH2(markdown);
    const repairedChunks: string[] = [];
    let anyChanged = false;

    this.logger.log(
      `[LatexRepair] Large doc (${markdown.length} chars), split into ${chunks.length} chunks`,
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkValidation = validateLatexDelimiters(chunk);
      if (chunkValidation.valid) {
        repairedChunks.push(chunk);
        continue;
      }
      try {
        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildUserPrompt(chunk, chunkValidation);
        const response = await this.chatFacade.chat({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          operationName: `LaTeX 修复(chunk ${i + 1}/${chunks.length})`,
          modelType: AIModelType.CHAT,
          skipGuardrails: true,
          cachePolicy: "auto",
          taskProfile: {
            creativity: "deterministic",
            outputLength: "extended",
          },
        });
        if (response.isError) {
          repairedChunks.push(chunk);
          continue;
        }
        const candidate = this.stripBoundaryMarkers(
          this.stripCodeFence(response.content),
        ).trim();
        if (
          candidate.length < chunk.length * 0.85 ||
          candidate.length > chunk.length * 1.2
        ) {
          repairedChunks.push(chunk);
          continue;
        }
        const chunkAfter = validateLatexDelimiters(candidate);
        if (chunkAfter.issues.length >= chunkValidation.issues.length) {
          repairedChunks.push(chunk);
          continue;
        }
        repairedChunks.push(candidate);
        anyChanged = true;
        this.logger.log(
          `[LatexRepair] chunk ${i + 1}: ${chunkValidation.issues.length} → ${chunkAfter.issues.length}`,
        );
      } catch (err) {
        this.logger.warn(
          `[LatexRepair] chunk ${i + 1} failed: ${(err as Error).message}`,
        );
        repairedChunks.push(chunk);
      }
    }

    // ★ Chunk-boundary normalization.
    //
    // LLM-repaired chunks go through `.trim()` above, which eats the trailing
    // `\n` that `splitByH2` emits as the chunk separator. Concatenating with
    // `join("")` then glues the next chunk's `## ` heading onto the previous
    // chunk's last character, producing markdown like `...决策输入**。## 3. 标题`
    // where the H2 heading is no longer at line start — the chapter splitter
    // (frontend and backend both use `^##\s+`) silently drops that chapter.
    //
    // Fix: normalize EVERY chunk's trailing whitespace to exactly `\n\n` for
    // non-final chunks and "" for the final one. This is idempotent for
    // already-well-formed chunks (the original `splitByH2` output also has
    // `\n`-terminated non-final chunks, which this normalization converts to
    // `\n\n` — equivalent for markdown rendering and safer for H2 detection).
    const finalDoc = repairedChunks
      .map((c, i) =>
        i === repairedChunks.length - 1
          ? c.replace(/\s+$/, "")
          : c.replace(/\s+$/, "") + "\n\n",
      )
      .join("");
    const after = validateLatexDelimiters(finalDoc);
    return { repaired: finalDoc, changed: anyChanged, before, after };
  }

  /**
   * Split markdown at top-level `## ` headings. Returns an array of
   * chunks where the first chunk is anything before the first H2, and
   * every subsequent chunk starts with its own `## ` heading. Joining
   * the chunks with no separator exactly reconstructs the input.
   */
  private splitByH2(markdown: string): string[] {
    const parts: string[] = [];
    const lines = markdown.split("\n");
    let current: string[] = [];
    for (const line of lines) {
      if (/^##\s+/.test(line) && current.length > 0) {
        parts.push(current.join("\n") + "\n");
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) parts.push(current.join("\n"));
    return parts;
  }
}
