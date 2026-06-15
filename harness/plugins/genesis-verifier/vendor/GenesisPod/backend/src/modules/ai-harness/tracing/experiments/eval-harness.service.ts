import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "crypto";
import { EvalPipelineService } from "./eval-pipeline.service";
import { EVAL_RUN_STORE, EvalRunStore } from "./eval-run.store";
import type {
  EvalCaseDefinition,
  EvalCaseExecution,
  EvalCaseResult,
  EvalDataset,
  EvalHarnessRunRequest,
  EvalMetric,
  EvalRunComparison,
  EvalRunResult,
  EvalRunSummary,
  EvalScorer,
} from "./eval-harness.types";

const DEFAULT_THRESHOLD = 70;

@Injectable()
export class EvalHarnessService {
  private readonly logger = new Logger(EvalHarnessService.name);

  constructor(
    private readonly evalPipeline: EvalPipelineService,
    @Optional()
    @Inject(EVAL_RUN_STORE)
    private readonly runStore?: EvalRunStore,
  ) {}

  async runDataset<TInput = unknown, TExpected = unknown>(
    request: EvalHarnessRunRequest<TInput, TExpected>,
  ): Promise<EvalRunResult> {
    this.validateDataset(request.dataset);

    const startedAt = new Date();
    const runId = request.runId ?? randomUUID();
    const cases: EvalCaseResult[] = [];
    const continueOnError = request.continueOnError ?? true;

    for (const testCase of request.dataset.cases) {
      const caseStartedAt = Date.now();
      try {
        const execution = await request.runner(testCase, {
          runId,
          datasetId: request.dataset.id,
          datasetVersion: request.dataset.version,
        });

        const metrics = await this.scoreCase(
          testCase,
          execution,
          request.scorers ?? [],
        );
        const traceEval =
          request.evaluateTrace !== false && execution.traceId
            ? await this.evalPipeline.evaluate(execution.traceId)
            : undefined;

        if (traceEval) {
          metrics.push({
            id: "trace.overall",
            name: "Trace overall score",
            score: traceEval.overallScore,
            threshold: request.traceThreshold ?? DEFAULT_THRESHOLD,
            passed:
              traceEval.overallScore >=
              (request.traceThreshold ?? DEFAULT_THRESHOLD),
            weight: request.traceWeight ?? 1,
            metadata: { traceId: execution.traceId },
          });
        }

        const score = this.computeWeightedScore(metrics);
        cases.push({
          caseId: testCase.id,
          name: testCase.name,
          status: this.casePassed(metrics) ? "passed" : "failed",
          score,
          metrics,
          traceId: execution.traceId,
          traceEval,
          durationMs: Date.now() - caseStartedAt,
          output: execution.output,
          artifacts: execution.artifacts,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[runDataset] case failed run=${runId} case=${testCase.id}: ${message}`,
        );
        cases.push({
          caseId: testCase.id,
          name: testCase.name,
          status: "error",
          score: 0,
          metrics: [],
          durationMs: Date.now() - caseStartedAt,
          error: message,
        });
        if (!continueOnError) break;
      }
    }

    const completedAt = new Date();
    const result: EvalRunResult = {
      id: runId,
      datasetId: request.dataset.id,
      datasetName: request.dataset.name,
      datasetVersion: request.dataset.version,
      status: cases.some((c) => c.status === "error") ? "failed" : "completed",
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      cases,
      summary: this.buildSummary(cases),
      metadata: request.metadata,
    };

    await this.runStore?.saveRun(result);
    return result;
  }

  async getRun(runId: string): Promise<EvalRunResult | null> {
    return (await this.runStore?.getRun(runId)) ?? null;
  }

  async listRuns(limit = 50): Promise<EvalRunResult[]> {
    return (await this.runStore?.listRuns(limit)) ?? [];
  }

  compareRuns(
    candidate: EvalRunResult,
    baseline: EvalRunResult,
  ): EvalRunComparison {
    const baselineCases = new Map(
      baseline.cases.map((testCase) => [testCase.caseId, testCase]),
    );
    const regressedCases: string[] = [];
    const improvedCases: string[] = [];

    for (const testCase of candidate.cases) {
      const previous = baselineCases.get(testCase.caseId);
      if (!previous) continue;
      if (testCase.score < previous.score) regressedCases.push(testCase.caseId);
      if (testCase.score > previous.score) improvedCases.push(testCase.caseId);
    }

    return {
      candidateRunId: candidate.id,
      baselineRunId: baseline.id,
      scoreDelta:
        candidate.summary.averageScore - baseline.summary.averageScore,
      passRateDelta: candidate.summary.passRate - baseline.summary.passRate,
      regressedCases,
      improvedCases,
    };
  }

  createExactMatchScorer(
    options: {
      id?: string;
      threshold?: number;
      weight?: number;
      ignoreCase?: boolean;
      trim?: boolean;
    } = {},
  ): EvalScorer {
    const scorerId = options.id ?? "exact_match";
    return {
      id: scorerId,
      weight: options.weight,
      score: (testCase, execution) => {
        const actual = this.normalizeText(execution.output, options);
        const expected = this.normalizeText(testCase.expected, options);
        const passed = actual === expected;
        return {
          id: scorerId,
          name: "Exact match",
          score: passed ? 100 : 0,
          threshold: options.threshold ?? 100,
          passed,
          weight: options.weight,
          reason: passed
            ? "Output matched expected value."
            : "Output did not match expected value.",
        };
      },
    };
  }

  createContainsTextScorer(
    options: {
      id?: string;
      threshold?: number;
      weight?: number;
      ignoreCase?: boolean;
    } = {},
  ): EvalScorer {
    const scorerId = options.id ?? "contains_text";
    return {
      id: scorerId,
      weight: options.weight,
      score: (testCase, execution) => {
        const actual = this.normalizeText(execution.output, options);
        const expected = this.normalizeText(testCase.expected, options);
        const passed = expected.length > 0 && actual.includes(expected);
        return {
          id: scorerId,
          name: "Contains text",
          score: passed ? 100 : 0,
          threshold: options.threshold ?? 100,
          passed,
          weight: options.weight,
          reason: passed
            ? "Output contained expected text."
            : "Output did not contain expected text.",
        };
      },
    };
  }

  private async scoreCase<TInput, TExpected>(
    testCase: EvalCaseDefinition<TInput, TExpected>,
    execution: EvalCaseExecution,
    scorers: readonly EvalScorer<TInput, TExpected>[],
  ): Promise<EvalMetric[]> {
    const metrics = [];
    for (const scorer of scorers) {
      const metric = await scorer.score(testCase, execution);
      metrics.push({
        ...metric,
        id: metric.id || scorer.id,
        weight: metric.weight ?? scorer.weight,
        score: this.clampScore(metric.score),
      });
    }
    return metrics;
  }

  private validateDataset(dataset: EvalDataset): void {
    if (!dataset.id.trim()) {
      throw new Error("Eval dataset id is required");
    }
    if (!dataset.name.trim()) {
      throw new Error("Eval dataset name is required");
    }
    const caseIds = new Set<string>();
    for (const testCase of dataset.cases) {
      if (!testCase.id.trim()) {
        throw new Error("Eval case id is required");
      }
      if (caseIds.has(testCase.id)) {
        throw new Error(`Duplicate eval case id: ${testCase.id}`);
      }
      caseIds.add(testCase.id);
    }
  }

  private casePassed(metrics: readonly EvalMetric[]): boolean {
    if (metrics.length === 0) return true;
    return metrics.every((metric) => {
      if (typeof metric.passed === "boolean") return metric.passed;
      return metric.score >= (metric.threshold ?? DEFAULT_THRESHOLD);
    });
  }

  private computeWeightedScore(metrics: readonly EvalMetric[]): number {
    if (metrics.length === 0) return 100;

    let weightedTotal = 0;
    let totalWeight = 0;
    for (const metric of metrics) {
      const weight = metric.weight ?? 1;
      weightedTotal += this.clampScore(metric.score) * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? Math.round(weightedTotal / totalWeight) : 0;
  }

  private buildSummary(cases: EvalRunResult["cases"]): EvalRunSummary {
    const total = cases.length;
    const passed = cases.filter((c) => c.status === "passed").length;
    const failed = cases.filter((c) => c.status === "failed").length;
    const errored = cases.filter((c) => c.status === "error").length;
    const averageScore =
      total > 0
        ? Math.round(cases.reduce((sum, c) => sum + c.score, 0) / total)
        : 0;

    return {
      total,
      passed,
      failed,
      errored,
      passRate: total > 0 ? passed / total : 0,
      averageScore,
    };
  }

  private clampScore(score: number): number {
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(100, score));
  }

  private normalizeText(
    value: unknown,
    options: { ignoreCase?: boolean; trim?: boolean },
  ): string {
    let text = typeof value === "string" ? value : JSON.stringify(value ?? "");
    if (options.trim !== false) text = text.trim();
    if (options.ignoreCase) text = text.toLowerCase();
    return text;
  }
}
