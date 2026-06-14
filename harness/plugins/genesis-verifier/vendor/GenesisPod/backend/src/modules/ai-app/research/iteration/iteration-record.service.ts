import { Injectable, Logger } from "@nestjs/common";
import type { ExitDecision } from "../evaluation";

interface InitRecordParams {
  query: string;
  topicType: string;
  depth: string;
  qualityThreshold: number;
  maxIterations: number;
  searchSummary: { directions: number; sources: number; rounds: number };
  insights: string[];
  creativeIdeas: string[];
  demoType: string;
  demoScore: number;
  gaps: { dataGaps: string[]; ideaGaps: string[] };
}

interface IterationRecordParams {
  round: number;
  previousScore: number;
  gaps: { dataGaps: string[]; ideaGaps: string[] };
  researchActions: {
    queries: string[];
    newSources: number;
    informationGain: number;
  };
  newInsights: string[];
  newCreativeIdeas: string[];
  ideaPoolTotal: { insights: number; creativeIdeas: number };
  adoptedInDemo: string[];
  demoChanges: string[];
  newScore: number;
  remainingGaps: { dataGaps: string[]; ideaGaps: string[] };
  exitDecision: ExitDecision;
}

interface SummaryIterationRow {
  round: number;
  score: number;
  delta: number;
  insights: number;
  creativeIdeas: number;
  gaps: number;
  keyChange: string;
}

interface SummaryRecordParams {
  exitReason: string;
  totalIterations: number;
  finalScore: number;
  duration: number;
  creditsConsumed: number;
  iterations: SummaryIterationRow[];
  finalInsights: string[];
  finalCreativeIdeas: string[];
  learnings: string[];
}

@Injectable()
export class IterationRecordService {
  private readonly logger = new Logger(IterationRecordService.name);

  /**
   * Generates the round-0 initialisation record markdown.
   */
  generateInitRecord(params: InitRecordParams): string {
    this.logger.debug(`Generating init record for query: "${params.query}"`);

    const {
      query,
      topicType,
      depth,
      qualityThreshold,
      maxIterations,
      searchSummary,
      insights,
      creativeIdeas,
      demoType,
      demoScore,
      gaps,
    } = params;

    const insightList =
      insights.length > 0
        ? insights.map((s) => `- ${s}`).join("\n")
        : "- (none)";

    const creativeList =
      creativeIdeas.length > 0
        ? creativeIdeas.map((s) => `- ${s}`).join("\n")
        : "- (none)";

    const dataGapList =
      gaps.dataGaps.length > 0
        ? gaps.dataGaps.map((g) => `- ${g}`).join("\n")
        : "- (none)";

    const ideaGapList =
      gaps.ideaGaps.length > 0
        ? gaps.ideaGaps.map((g) => `- ${g}`).join("\n")
        : "- (none)";

    return `# Round 0 — Initialisation

## Research Configuration

| Parameter | Value |
|---|---|
| Query | ${query} |
| Topic Type | ${topicType} |
| Depth | ${depth} |
| Quality Threshold | ${qualityThreshold} |
| Max Iterations | ${maxIterations} |

## Initial Search Summary

| Metric | Value |
|---|---|
| Search Directions | ${searchSummary.directions} |
| Sources Collected | ${searchSummary.sources} |
| Search Rounds | ${searchSummary.rounds} |

## Idea Pool (Initial)

### Insights (${insights.length})

${insightList}

### Creative Ideas (${creativeIdeas.length})

${creativeList}

## Initial Demo

| Property | Value |
|---|---|
| Type | ${demoType} |
| Score | ${demoScore} |

## Identified Gaps

### Data Gaps

${dataGapList}

### Idea Gaps

${ideaGapList}
`;
  }

  /**
   * Generates the markdown record for a completed iteration round (round >= 1).
   */
  generateIterationRecord(params: IterationRecordParams): string {
    this.logger.debug(`Generating iteration record for round ${params.round}`);

    const {
      round,
      previousScore,
      gaps,
      researchActions,
      newInsights,
      newCreativeIdeas,
      ideaPoolTotal,
      adoptedInDemo,
      demoChanges,
      newScore,
      remainingGaps,
      exitDecision,
    } = params;

    const scoreDelta = newScore - previousScore;
    const deltaStr =
      scoreDelta >= 0
        ? `+${scoreDelta.toFixed(1)}`
        : `${scoreDelta.toFixed(1)}`;

    const targetDataGaps =
      gaps.dataGaps.length > 0
        ? gaps.dataGaps.map((g) => `- ${g}`).join("\n")
        : "- (none)";

    const targetIdeaGaps =
      gaps.ideaGaps.length > 0
        ? gaps.ideaGaps.map((g) => `- ${g}`).join("\n")
        : "- (none)";

    const queriesList =
      researchActions.queries.length > 0
        ? researchActions.queries.map((q) => `- ${q}`).join("\n")
        : "- (none)";

    const newInsightList =
      newInsights.length > 0
        ? newInsights.map((s) => `- ${s}`).join("\n")
        : "- (none)";

    const newCreativeList =
      newCreativeIdeas.length > 0
        ? newCreativeIdeas.map((s) => `- ${s}`).join("\n")
        : "- (none)";

    const adoptedList =
      adoptedInDemo.length > 0
        ? adoptedInDemo.map((s) => `- ${s}`).join("\n")
        : "- (none)";

    const changesList =
      demoChanges.length > 0
        ? demoChanges.map((c) => `- ${c}`).join("\n")
        : "- (none)";

    const remainDataGaps =
      remainingGaps.dataGaps.length > 0
        ? remainingGaps.dataGaps.map((g) => `- ${g}`).join("\n")
        : "- (none)";

    const remainIdeaGaps =
      remainingGaps.ideaGaps.length > 0
        ? remainingGaps.ideaGaps.map((g) => `- ${g}`).join("\n")
        : "- (none)";

    const exitLine = exitDecision.exit
      ? `**Exit triggered**: ${exitDecision.reason ?? "unknown"}`
      : `**Continue**: next focus → ${(exitDecision.nextResearchFocus ?? []).join(", ") || "general improvement"}`;

    return `# Round ${round} — Iteration

## Target Gaps

### Data Gaps

${targetDataGaps}

### Idea Gaps

${targetIdeaGaps}

## Research Actions

| Metric | Value |
|---|---|
| New Sources | ${researchActions.newSources} |
| Information Gain | ${(researchActions.informationGain * 100).toFixed(1)}% |

### Queries Executed

${queriesList}

## New Ideas Generated

### Insights (${newInsights.length} new, ${ideaPoolTotal.insights} total)

${newInsightList}

### Creative Ideas (${newCreativeIdeas.length} new, ${ideaPoolTotal.creativeIdeas} total)

${newCreativeList}

## Demo Update

### Ideas Adopted in This Round

${adoptedList}

### Changes Made

${changesList}

## Evaluation

| Metric | Value |
|---|---|
| Previous Score | ${previousScore.toFixed(1)} |
| New Score | ${newScore.toFixed(1)} |
| Delta | ${deltaStr} |

## Remaining Gaps

### Data Gaps

${remainDataGaps}

### Idea Gaps

${remainIdeaGaps}

## Exit Decision

${exitLine}
`;
  }

  /**
   * Generates the final summary record markdown after all iterations complete.
   */
  generateSummaryRecord(params: SummaryRecordParams): string {
    this.logger.debug(
      `Generating summary record: ${params.totalIterations} iterations, final score ${params.finalScore}`,
    );

    const {
      exitReason,
      totalIterations,
      finalScore,
      duration,
      creditsConsumed,
      iterations,
      finalInsights,
      finalCreativeIdeas,
      learnings,
    } = params;

    const durationMin = Math.floor(duration / 60);
    const durationSec = duration % 60;
    const durationStr =
      durationMin > 0 ? `${durationMin}m ${durationSec}s` : `${durationSec}s`;

    const tableRows = iterations
      .map(
        (it) =>
          `| ${it.round} | ${it.score.toFixed(1)} | ${it.delta >= 0 ? "+" : ""}${it.delta.toFixed(1)} | ${it.insights} | ${it.creativeIdeas} | ${it.gaps} | ${it.keyChange} |`,
      )
      .join("\n");

    const iterationTable =
      iterations.length > 0
        ? `| Round | Score | Delta | Insights | Creative Ideas | Open Gaps | Key Change |\n|---|---|---|---|---|---|---|\n${tableRows}`
        : "(no iterations recorded)";

    const insightList =
      finalInsights.length > 0
        ? finalInsights.map((s) => `- ${s}`).join("\n")
        : "- (none)";

    const creativeList =
      finalCreativeIdeas.length > 0
        ? finalCreativeIdeas.map((s) => `- ${s}`).join("\n")
        : "- (none)";

    const learningList =
      learnings.length > 0
        ? learnings.map((l) => `- ${l}`).join("\n")
        : "- (none)";

    return `# Final Summary

## Exit Condition

**Reason**: ${exitReason}

## Overall Statistics

| Metric | Value |
|---|---|
| Total Iterations | ${totalIterations} |
| Final Score | ${finalScore.toFixed(1)} |
| Total Duration | ${durationStr} |
| Credits Consumed | ${creditsConsumed} |

## Iteration History

${iterationTable}

## Final Idea Pool

### Insights (${finalInsights.length})

${insightList}

### Creative Ideas (${finalCreativeIdeas.length})

${creativeList}

## Key Learnings

${learningList}
`;
  }
}
