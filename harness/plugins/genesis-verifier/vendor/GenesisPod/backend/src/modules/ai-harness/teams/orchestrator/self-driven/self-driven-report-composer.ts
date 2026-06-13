/**
 * SelfDrivenReportComposer — thin deliver-phase assembler for the self-driven runner.
 *
 * Responsibility: convert per-step text outputs + plan metadata into a
 * Markdown report string.  Intentionally zero-LLM; rubric scoring and
 * quality evaluation are separate concerns handled by the evaluate layer.
 *
 * Design: §5.4 交付件组装收口 IDeliveryGenerator — v1 report projector.
 * Placement: harness/teams/orchestrator (deliver artefact assembly belongs
 * with orchestration, not evaluation).
 *
 * MECE:
 *   - No import of ai-app/** (spec P5 guard).
 *   - No import of ai-engine internal paths — pure string composition.
 */

import { Injectable } from "@nestjs/common";
// Reuse the engine's markdown sanitizer (pure function, facade-exported) instead
// of trusting raw LLM output — strips <thinking> blocks, prompt-injection text,
// hallucinated figure tags, and repairs code-fence pairing. Pure fn ⇒ no DI
// cycle (safe to value-import from the facade barrel).
import { sanitizeMarkdownBody } from "@/modules/ai-engine/facade";
import type {
  ExecutionStep,
  MissionExecutionPlan,
} from "../orchestrator.interface";

/** Aggregated input for the report composer. */
export interface ReportComposerInput {
  plan: MissionExecutionPlan;
  /** Map of stepId → text output produced by the role's LLM call. */
  stepOutputs: Map<string, string>;
  /** Original user prompt (repeated in the report header for context). */
  userPrompt: string;
  /**
   * Optional pre-formatted APA bibliography block (from engine citation API).
   * When present a references section is appended as the last block.
   * Absent = no section (never emit an empty heading).
   */
  referencesMarkdown?: string;
  /**
   * Human-readable target language (e.g. "Chinese (简体中文)" or "English").
   * Controls the References section heading. Absent = bilingual fallback heading.
   */
  language?: string;
  /**
   * The synthesized report body (one coherent, non-redundant document produced
   * by the deliver-phase synthesis pass from ALL step outputs). When present,
   * THIS is the report; the per-step outputs are demoted to a collapsed
   * appendix and the internal rubric table is omitted. Absent = legacy mode
   * (concatenate every step output + rubric) for back-compat / synthesis failure.
   */
  synthesizedBody?: string;
}

/** Slim report output — content is a Markdown string. */
export interface ReportComposerOutput {
  content: string;
  wordCount: number;
}

@Injectable()
export class SelfDrivenReportComposer {
  /**
   * Assemble a Markdown report from per-step LLM outputs + plan metadata.
   *
   * Structure:
   *   # Mission Report
   *   Prompt summary / steps executed / role contributions
   *   ## [Step name] — [Role]
   *   <step output>
   *   ## Acceptance Rubric
   *   rubric dimension table (passLine reference, not scored here)
   */
  compose(input: ReportComposerInput): ReportComposerOutput {
    const {
      plan,
      stepOutputs,
      userPrompt,
      referencesMarkdown,
      language,
      synthesizedBody,
    } = input;

    // Synthesis mode: a real, coherent report exists. Emit it as the body, demote
    // raw per-step outputs to an appendix, and DROP the internal rubric table
    // (it's scoring config, not report content). This is the path that fixes the
    // "8 steps concatenated, three overlapping reports, no synthesis" problem.
    if (synthesizedBody && synthesizedBody.trim().length > 0) {
      return this.composeFromSynthesis(
        synthesizedBody,
        plan,
        stepOutputs,
        referencesMarkdown,
        language,
      );
    }
    // Each entry is a complete Markdown BLOCK. Blocks are joined with a blank
    // line ("\n\n"). NB: never terminate a block with "\n" — joining
    // newline-terminated blocks with "\n" injects a blank line *inside* a block,
    // which (e.g.) splits a GFM table's header from its delimiter row and makes
    // the whole table render as raw "| pipes |" text. That was the formatting bug.
    const blocks: string[] = [];

    // ── Header ────────────────────────────────────────────────────────────────
    blocks.push(`# Mission Report`);

    const meta: string[] = [`**Objective:** ${userPrompt}`];
    const executedCount = stepOutputs.size;
    const totalCount = plan.steps.length;
    meta.push(
      `**Steps executed:** ${executedCount} / ${totalCount}` +
        (executedCount < totalCount
          ? ` (${totalCount - executedCount} step(s) skipped due to errors)`
          : ""),
    );
    if (plan.roleAssignments && plan.roleAssignments.length > 0) {
      const roleList = plan.roleAssignments
        .map((r) => `${r.roleId}${r.modelId ? ` (${r.modelId})` : ""}`)
        .join(", ");
      meta.push(`**Team:** ${roleList}`);
    }
    blocks.push(meta.join("\n\n"));
    blocks.push(`---`);

    // ── Per-step sections ─────────────────────────────────────────────────────
    for (const step of plan.steps) {
      const output = stepOutputs.get(step.id);
      if (!output) {
        blocks.push(
          `## ${step.name} — ${step.executor}\n\n` +
            `_This step did not produce output (execution error or dependency failure)._`,
        );
        continue;
      }
      blocks.push(
        `## ${step.name} — ${step.executor}\n\n${this.cleanStepBody(output)}`,
      );
    }

    // ── Rubric table (reference only, not scored here) ────────────────────────
    if (plan.rubric && plan.rubric.length > 0) {
      const rows = plan.rubric.map(
        (dim) =>
          `| ${dim.dimension} | ${Math.round(dim.weight * 100)}% | ${dim.passLine} |`,
      );
      // Header + delimiter + rows are ONE block on consecutive lines so GFM
      // recognises it as a table.
      const table = [
        `| Dimension | Weight | Pass Line |`,
        `| --- | --- | --- |`,
        ...rows,
      ].join("\n");
      blocks.push(`---`);
      blocks.push(`## Acceptance Rubric\n\n${table}`);
    }

    // ── References section (best-effort, appended last) ──────────────────────
    // Only emitted when the runner successfully extracted ≥1 source via the
    // engine citation API. An absent/empty string means skip — never emit an
    // empty "## References" heading.
    if (referencesMarkdown && referencesMarkdown.trim().length > 0) {
      const refHeading =
        language === "Chinese (简体中文)"
          ? "## 参考文献"
          : language === "English"
            ? "## References"
            : "## References / 参考文献";
      blocks.push(`---`);
      blocks.push(`${refHeading}\n\n${referencesMarkdown.trim()}`);
    }

    const content = blocks.join("\n\n").trim() + "\n";
    const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;

    return { content, wordCount };
  }

  /**
   * Synthesis-mode assembly: the synthesized report is the body; raw step
   * outputs go into a clearly-separated "process appendix" (so the detailed
   * research/data is still available without polluting the main report); the
   * rubric is omitted. References (if any) are appended last.
   */
  private composeFromSynthesis(
    synthesizedBody: string,
    plan: MissionExecutionPlan,
    stepOutputs: Map<string, string>,
    referencesMarkdown: string | undefined,
    language: string | undefined,
  ): ReportComposerOutput {
    const blocks: string[] = [];

    // Body = the synthesized report verbatim (already a coherent document with
    // its own top-level heading). Sanitize only (strip injection/thinking junk).
    blocks.push(this.cleanStepBody(synthesizedBody));

    // Appendix — raw per-step outputs, demoted under one H2 so they read as
    // supporting detail rather than competing reports.
    const appendixSteps = plan.steps.filter((s) => stepOutputs.get(s.id));
    if (appendixSteps.length > 0) {
      const appendixHeading =
        language === "Chinese (简体中文)"
          ? "## 附录：研究过程产出"
          : language === "English"
            ? "## Appendix: Research Process"
            : "## Appendix / 附录";
      blocks.push(`---`);
      blocks.push(appendixHeading);
      for (const step of appendixSteps) {
        const output = stepOutputs.get(step.id)!;
        // Demote each step to H3 so it nests under the appendix H2.
        blocks.push(
          `### ${step.name} — ${step.executor}\n\n${this.cleanStepBody(output)}`,
        );
      }
    }

    // References (best-effort, last).
    if (referencesMarkdown && referencesMarkdown.trim().length > 0) {
      const refHeading =
        language === "Chinese (简体中文)"
          ? "## 参考文献"
          : language === "English"
            ? "## References"
            : "## References / 参考文献";
      blocks.push(`---`);
      blocks.push(`${refHeading}\n\n${referencesMarkdown.trim()}`);
    }

    const content = blocks.join("\n\n").trim() + "\n";
    const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
    return { content, wordCount };
  }

  /**
   * Clean one step's raw LLM markdown through the engine sanitizer (strip
   * <thinking>/injection/figure junk, repair fences). Headings are preserved
   * (allowTopLevelHeadings) so the step's own sub-structure survives. Falls back
   * to the trimmed raw text if the sanitizer throws.
   */
  private cleanStepBody(raw: string): string {
    const trimmed = raw.trim();
    try {
      const { body } = sanitizeMarkdownBody(trimmed, {
        allowTopLevelHeadings: true,
      });
      return body.trim() || trimmed;
    } catch {
      return trimmed;
    }
  }

  /**
   * Convert structured agent output (object/array/string) to readable Markdown prose.
   * Handles ReActLoop final answers that are JSON-serializable objects instead of plain strings.
   *
   * Rules:
   *  - string  → return as-is (trimmed), then passed through cleanStepBody
   *  - object  → key-value sections with ### headings; priority keys promoted to top
   *  - array   → bulleted list; each element formatted recursively
   *  - null/undefined/primitive → String() fallback or ""
   */
  formatStructuredOutput(raw: unknown): string {
    if (raw === null || raw === undefined) {
      return "";
    }

    if (typeof raw === "string") {
      return this.cleanStepBody(raw);
    }

    if (Array.isArray(raw)) {
      const body = this.formatArray(raw);
      return body ? this.cleanStepBody(body) : "";
    }

    if (typeof raw === "object") {
      const body = this.formatObject(raw as Record<string, unknown>);
      return body ? this.cleanStepBody(body) : "";
    }

    // number, boolean, bigint, symbol
    return String(raw);
  }

  private formatObject(obj: Record<string, unknown>): string {
    const PRIORITY_KEYS = ["summary", "conclusion", "result", "answer"];
    const keys = Object.keys(obj).sort((a, b) => {
      const aIdx = PRIORITY_KEYS.indexOf(a.toLowerCase());
      const bIdx = PRIORITY_KEYS.indexOf(b.toLowerCase());
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return a.localeCompare(b);
    });

    const blocks: string[] = [];
    for (const key of keys) {
      const val = obj[key];
      if (val === null || val === undefined || val === "") continue;

      const heading = this.kebabToTitle(key);

      if (typeof val === "string") {
        blocks.push(`### ${heading}\n\n${val.trim()}`);
      } else if (Array.isArray(val)) {
        const list = this.formatArray(val);
        if (list) blocks.push(`### ${heading}\n\n${list}`);
      } else if (typeof val === "object") {
        const nested = this.formatObject(val as Record<string, unknown>);
        if (nested) blocks.push(`### ${heading}\n\n${nested}`);
      } else {
        blocks.push(`### ${heading}\n\n${String(val)}`);
      }
    }

    return blocks.join("\n\n");
  }

  private formatArray(arr: unknown[]): string {
    if (arr.length === 0) return "";

    return arr
      .map((item) => {
        if (item === null || item === undefined) return null;
        if (typeof item === "string") return `- ${item}`;
        if (typeof item === "object") {
          return `- ${this.objectToSummary(item as Record<string, unknown>)}`;
        }
        return `- ${String(item)}`;
      })
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  private objectToSummary(obj: Record<string, unknown>): string {
    const entries = Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined)
      .slice(0, 3)
      .map(([k, v]) => {
        const display =
          typeof v === "string" ? v : JSON.stringify(v).slice(0, 50);
        return `${k}: ${display}`;
      });
    return entries.length > 0 ? entries.join("; ") : "(empty)";
  }

  private kebabToTitle(key: string): string {
    return key
      .split(/[-_\s]+/)
      .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
      .join(" ");
  }

  /** Build the system prompt for a given step's executor role. */
  buildStepSystemPrompt(
    step: ExecutionStep,
    roleHint: string,
    userPrompt: string,
    priorContext: string,
    language?: string,
  ): string {
    const parts: string[] = [roleHint];

    parts.push(`\nThe overall mission objective is:\n${userPrompt}\n`);

    if (priorContext) {
      parts.push(
        `\nPrevious steps have produced the following context:\n${priorContext}\n`,
      );
    }

    parts.push(
      `\nYour current task is: ${step.name}\n` +
        `Description: ${step.description}\n`,
    );

    parts.push(
      `\nProduce thorough, well-structured content for your task. ` +
        `Do not include meta-commentary about your role — output the content directly.`,
    );

    // Inline-citation discipline. When the step ran web search / scraping tools,
    // every non-trivial factual claim should carry its source as an inline
    // Markdown link to the REAL URL returned by the tool. This is what turns the
    // report into a sourced research document (claims you can click through to
    // verify) rather than unsourced prose.
    parts.push(
      `\nCitations: when you state a fact, figure, date, or quote that you ` +
        `obtained from a tool result (web search/scrape) or from the context ` +
        `above, cite it INLINE as a Markdown link right after the claim, e.g. ` +
        `"...launched in 2026 ([IEEE](https://example.com/page))". Use ONLY the ` +
        `exact URLs that appear in your tool results or the provided context — ` +
        `never invent, guess, or shorten a URL. If you have no real source URL ` +
        `for a claim, state the claim without a link rather than fabricating one. ` +
        `Carry forward any source links already present in the context above.`,
    );

    if (language) {
      parts.push(
        `\nIMPORTANT: Write your entire response in ${language}. Do not mix languages.`,
      );
    }

    return parts.join("\n");
  }
}
