import { Injectable, Logger } from "@nestjs/common";

// ─── Types ───

/**
 * Input: one dimension's research results
 */
export interface DimensionResult {
  dimensionId: string;
  dimensionName: string;
  content: string;
  keyFindings: string[];
  sources: Array<{ title: string; url?: string }>;
}

/**
 * A cross-cutting theme that appears across multiple dimensions
 */
export interface CrossCuttingTheme {
  theme: string;
  supportingDimensions: string[];
  evidence: string[];
  confidence: number; // 0-1
}

/**
 * A contradiction between two dimensions
 */
export interface Contradiction {
  topic: string;
  dimensionA: string;
  dimensionB: string;
  descriptionA: string;
  descriptionB: string;
}

/**
 * A gap in research coverage
 */
export interface ResearchGap {
  area: string;
  coveredBy: string[];
  missingPerspective: string;
}

/**
 * Generic markdown document input for low-level detect APIs.
 *
 * v1.5.3 P0a-3: shared input shape for `detectContradictions` / `detectDataGaps`,
 * reused by wiki-lint and downstream cross-cutting analysis.
 */
export interface SynthesisDocument {
  id: string;
  title?: string;
  body: string;
  category?: string;
}

/**
 * Data gap (alias of ResearchGap for wiki-lint DATA_GAP semantic alignment).
 *
 * v1.5.3 P0a-3: same shape; named alias to avoid concept duplication in callers.
 */
export type DataGap = ResearchGap;

/**
 * Complete synthesis result
 */
export interface SynthesisResult {
  crossCuttingThemes: CrossCuttingTheme[];
  contradictions: Contradiction[];
  gaps: ResearchGap[];
  executiveSummary: string;
  synthesisMetadata: {
    dimensionsAnalyzed: number;
    themesIdentified: number;
    contradictionsFound: number;
    gapsIdentified: number;
    tokensUsed: number;
  };
}

// ─── Prompt ───

const SYNTHESIS_SYSTEM_PROMPT = `You are a senior research analyst performing cross-dimensional synthesis.

You have received findings from multiple research dimensions on the same topic.
Your task is NOT to summarize each dimension. Instead, you must:

1. IDENTIFY CROSS-CUTTING THEMES — patterns, trends, or insights that appear across multiple dimensions. Rate each theme's confidence (0-1).
2. FLAG CONTRADICTIONS — where two dimensions disagree or present conflicting evidence.
3. IDENTIFY GAPS — important perspectives or areas that are not adequately covered by any dimension.
4. WRITE AN EXECUTIVE SUMMARY — a cohesive narrative that synthesizes (not concatenates) the key insights.

You MUST respond in valid JSON matching this exact schema:
{
  "crossCuttingThemes": [{ "theme": "...", "supportingDimensions": ["dim1", "dim2"], "evidence": ["..."], "confidence": 0.85 }],
  "contradictions": [{ "topic": "...", "dimensionA": "...", "dimensionB": "...", "descriptionA": "...", "descriptionB": "..." }],
  "gaps": [{ "area": "...", "coveredBy": ["dim1"], "missingPerspective": "..." }],
  "executiveSummary": "..."
}`;

// ─── Service ───

/**
 * CrossCuttingSynthesisService
 *
 * Analyzes all dimension research results and produces a structured synthesis.
 * This replaces the "concatenate and hope" approach with genuine intellectual synthesis.
 *
 * The service:
 * 1. Takes N dimension results as input
 * 2. Calls an LLM with a synthesis-specific prompt
 * 3. Returns structured themes, contradictions, gaps, and executive summary
 * 4. This result feeds into report generation for higher-quality reports
 *
 * Inspired by Claude Code's "Coordinator must understand before delegating" pattern.
 */
@Injectable()
export class CrossCuttingSynthesisService {
  private readonly logger = new Logger(CrossCuttingSynthesisService.name);

  /**
   * Synthesize cross-cutting insights from multiple dimension results.
   *
   * @param dimensions - Array of dimension research results
   * @param chatFn - LLM call function (injected for decoupling from specific LLM service)
   * @returns Structured synthesis with themes, contradictions, gaps
   */
  async synthesize(
    dimensions: DimensionResult[],
    chatFn: (
      systemPrompt: string,
      userPrompt: string,
    ) => Promise<{ content: string; tokensUsed: number }>,
  ): Promise<SynthesisResult> {
    if (dimensions.length === 0) {
      return this.emptySynthesis();
    }

    this.logger.log(
      `[synthesize] Starting cross-cutting synthesis for ${dimensions.length} dimensions`,
    );

    const userPrompt = this.buildUserPrompt(dimensions);

    try {
      const result = await chatFn(SYNTHESIS_SYSTEM_PROMPT, userPrompt);

      const parsed = this.parseResponse(result.content);

      const synthesisResult: SynthesisResult = {
        ...parsed,
        synthesisMetadata: {
          dimensionsAnalyzed: dimensions.length,
          themesIdentified: parsed.crossCuttingThemes.length,
          contradictionsFound: parsed.contradictions.length,
          gapsIdentified: parsed.gaps.length,
          tokensUsed: result.tokensUsed,
        },
      };

      this.logger.log(
        `[synthesize] Completed: ${synthesisResult.synthesisMetadata.themesIdentified} themes, ` +
          `${synthesisResult.synthesisMetadata.contradictionsFound} contradictions, ` +
          `${synthesisResult.synthesisMetadata.gapsIdentified} gaps, ` +
          `${synthesisResult.synthesisMetadata.tokensUsed} tokens`,
      );

      return synthesisResult;
    } catch (error) {
      this.logger.error(
        `[synthesize] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Return empty synthesis on failure — don't block report generation
      return this.emptySynthesis();
    }
  }

  /**
   * Build the user prompt from dimension results
   */
  buildUserPrompt(dimensions: DimensionResult[]): string {
    const parts: string[] = [];
    parts.push(`Total dimensions: ${dimensions.length}\n`);

    for (const dim of dimensions) {
      parts.push(`\n--- Dimension: ${dim.dimensionName} ---`);

      if (dim.keyFindings.length > 0) {
        parts.push(`Key Findings:`);
        dim.keyFindings.forEach((f, i) => parts.push(`  ${i + 1}. ${f}`));
      }

      // Include content summary (first 2000 chars to stay within token budget)
      const contentPreview =
        dim.content.length > 2000
          ? dim.content.slice(0, 2000) + "\n[... truncated ...]"
          : dim.content;
      parts.push(`\nContent:\n${contentPreview}`);

      if (dim.sources.length > 0) {
        parts.push(`Sources: ${dim.sources.map((s) => s.title).join(", ")}`);
      }
    }

    return parts.join("\n");
  }

  /**
   * Parse the LLM response into structured SynthesisResult
   */
  parseResponse(content: string): Omit<SynthesisResult, "synthesisMetadata"> {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn("[parseResponse] No JSON found in response");
        return this.emptyParsed();
      }

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      return {
        crossCuttingThemes: Array.isArray(parsed.crossCuttingThemes)
          ? (parsed.crossCuttingThemes as CrossCuttingTheme[])
          : [],
        contradictions: Array.isArray(parsed.contradictions)
          ? (parsed.contradictions as Contradiction[])
          : [],
        gaps: Array.isArray(parsed.gaps) ? (parsed.gaps as ResearchGap[]) : [],
        executiveSummary:
          typeof parsed.executiveSummary === "string"
            ? parsed.executiveSummary
            : "",
      };
    } catch (error) {
      this.logger.warn(
        `[parseResponse] Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.emptyParsed();
    }
  }

  private emptyParsed(): Omit<SynthesisResult, "synthesisMetadata"> {
    return {
      crossCuttingThemes: [],
      contradictions: [],
      gaps: [],
      executiveSummary: "",
    };
  }

  private emptySynthesis(): SynthesisResult {
    return {
      ...this.emptyParsed(),
      synthesisMetadata: {
        dimensionsAnalyzed: 0,
        themesIdentified: 0,
        contradictionsFound: 0,
        gapsIdentified: 0,
        tokensUsed: 0,
      },
    };
  }

  // ─── Low-level public APIs (v1.5.3 P0a-3) ───
  // Shared by wiki-lint (CONTRADICTION / DATA_GAP) and downstream cross-cutting
  // analysis. Internally reuse synthesize() to avoid prompt duplication; callers
  // pay for unused themes/summary fields but project policy of "no concept double
  // sourcing" outweighs the marginal token cost.

  /**
   * Detect contradictions across markdown documents.
   *
   * v1.5.3 P0a-3: low-level public API extracted from inline orchestration.
   * Used by wiki-lint CONTRADICTION + downstream cross-cutting analysis.
   *
   * @param documents - markdown docs (e.g. WikiPage bodies grouped by category)
   * @param chatFn - injected LLM call function (decoupled from specific chat service)
   * @param options - sampling and recency preferences
   * @returns array of detected contradictions
   */
  async detectContradictions(
    documents: SynthesisDocument[],
    chatFn: (
      systemPrompt: string,
      userPrompt: string,
    ) => Promise<{ content: string; tokensUsed: number }>,
    options?: {
      samplingLimit?: number;
      preferRecent?: { sinceHours: number };
    },
  ): Promise<Contradiction[]> {
    if (documents.length === 0) return [];

    const sampled = options?.samplingLimit
      ? documents.slice(0, options.samplingLimit)
      : documents;

    const dimensions = this.documentsAsDimensions(sampled);
    const result = await this.synthesize(dimensions, chatFn);
    return result.contradictions;
  }

  /**
   * Detect data gaps — areas under-covered relative to mentions.
   *
   * v1.5.3 P0a-3: low-level public API. Used by wiki-lint DATA_GAP +
   * research/cross-cutting consumers gap analysis (same ResearchGap concept).
   *
   * @param documents - markdown docs to analyze
   * @param chatFn - injected LLM call function
   * @param options - existingEntityIds excludes already-covered entities;
   *                  minMentions reserved for future precision tuning
   * @returns array of data gaps
   */
  async detectDataGaps(
    documents: SynthesisDocument[],
    chatFn: (
      systemPrompt: string,
      userPrompt: string,
    ) => Promise<{ content: string; tokensUsed: number }>,
    options?: {
      minMentions?: number;
      existingEntityIds?: string[];
    },
  ): Promise<DataGap[]> {
    if (documents.length === 0) return [];

    const dimensions = this.documentsAsDimensions(documents);
    const result = await this.synthesize(dimensions, chatFn);

    if (!options?.existingEntityIds || options.existingEntityIds.length === 0) {
      return result.gaps;
    }
    // Normalize both sides to a comparable form: lowercase + collapse all
    // non-alphanumeric to hyphens. Lets callers pass either kebab-case slugs
    // (e.g. "renewable-energy") or natural-language ids; both compare against
    // LLM-output gap.area like "Renewable Energy".
    const toCompareForm = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const normalizedIds = options.existingEntityIds
      .map(toCompareForm)
      .filter((id) => id.length > 0);
    return result.gaps.filter((gap) => {
      const normalizedArea = toCompareForm(gap.area);
      return !normalizedIds.some((id) => normalizedArea.includes(id));
    });
  }

  /**
   * Adapt SynthesisDocument[] to DimensionResult[] for reusing synthesize().
   * Title falls back to id; keyFindings/sources are empty (wiki/document inputs
   * don't have these as separate fields, the LLM extracts from body directly).
   */
  private documentsAsDimensions(
    documents: SynthesisDocument[],
  ): DimensionResult[] {
    return documents.map((d) => ({
      dimensionId: d.id,
      dimensionName: d.title ?? d.id,
      content: d.body,
      keyFindings: [],
      sources: [],
    }));
  }
}
