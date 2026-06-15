import type { EvalResult } from "./eval-pipeline.service";

export type EvalCaseStatus = "passed" | "failed" | "error";
export type EvalRunStatus = "completed" | "failed";

export interface EvalCaseDefinition<TInput = unknown, TExpected = unknown> {
  id: string;
  name?: string;
  input: TInput;
  expected?: TExpected;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface EvalDataset<TInput = unknown, TExpected = unknown> {
  id: string;
  name: string;
  version?: string;
  cases: readonly EvalCaseDefinition<TInput, TExpected>[];
  metadata?: Record<string, unknown>;
}

export interface EvalRunnerContext {
  runId: string;
  datasetId: string;
  datasetVersion?: string;
}

export interface EvalCaseExecution {
  output?: unknown;
  traceId?: string;
  artifacts?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type EvalCaseRunner<TInput = unknown, TExpected = unknown> = (
  testCase: EvalCaseDefinition<TInput, TExpected>,
  context: EvalRunnerContext,
) => Promise<EvalCaseExecution> | EvalCaseExecution;

export interface EvalMetric {
  id: string;
  name?: string;
  score: number;
  threshold?: number;
  passed?: boolean;
  reason?: string;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface EvalScorer<TInput = unknown, TExpected = unknown> {
  id: string;
  weight?: number;
  score: (
    testCase: EvalCaseDefinition<TInput, TExpected>,
    execution: EvalCaseExecution,
  ) => Promise<EvalMetric> | EvalMetric;
}

export interface EvalHarnessRunRequest<TInput = unknown, TExpected = unknown> {
  runId?: string;
  dataset: EvalDataset<TInput, TExpected>;
  runner: EvalCaseRunner<TInput, TExpected>;
  scorers?: readonly EvalScorer<TInput, TExpected>[];
  continueOnError?: boolean;
  evaluateTrace?: boolean;
  traceThreshold?: number;
  traceWeight?: number;
  metadata?: Record<string, unknown>;
}

export interface EvalCaseResult {
  caseId: string;
  name?: string;
  status: EvalCaseStatus;
  score: number;
  metrics: EvalMetric[];
  traceId?: string;
  traceEval?: EvalResult;
  durationMs: number;
  output?: unknown;
  artifacts?: Record<string, unknown>;
  error?: string;
}

export interface EvalRunSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  passRate: number;
  averageScore: number;
}

export interface EvalRunResult {
  id: string;
  datasetId: string;
  datasetName: string;
  datasetVersion?: string;
  status: EvalRunStatus;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  cases: EvalCaseResult[];
  summary: EvalRunSummary;
  metadata?: Record<string, unknown>;
}

export interface EvalRunComparison {
  candidateRunId: string;
  baselineRunId: string;
  scoreDelta: number;
  passRateDelta: number;
  regressedCases: string[];
  improvedCases: string[];
}

export type EvalExperimentStatus = "passed" | "failed" | "error";

export interface EvalExperimentPolicy {
  /** Candidate average score must be at least this value. */
  minAverageScore?: number;
  /** Candidate pass rate must be at least this value, expressed as 0-1. */
  minPassRate?: number;
  /** Allowed average-score drop versus baseline. Defaults to 0. */
  maxScoreDrop?: number;
  /** Allowed pass-rate drop versus baseline, expressed as 0-1. Defaults to 0. */
  maxPassRateDrop?: number;
  /** Allowed number of per-case score regressions. Defaults to 0. */
  maxRegressedCases?: number;
  /** Whether a candidate run with errored cases fails the experiment. Defaults to true. */
  failOnCandidateRunFailure?: boolean;
}

export interface EvalExperimentViolation {
  code:
    | "candidate_run_failed"
    | "min_average_score"
    | "min_pass_rate"
    | "score_regression"
    | "pass_rate_regression"
    | "case_regression"
    | "experiment_error";
  message: string;
  actual?: number;
  expected?: number;
}

export interface EvalExperimentRunRequest<
  TInput = unknown,
  TExpected = unknown,
> {
  experimentId?: string;
  name: string;
  baselineRunId?: string;
  baselineRun?: EvalHarnessRunRequest<TInput, TExpected>;
  candidateRun: EvalHarnessRunRequest<TInput, TExpected>;
  policy?: EvalExperimentPolicy;
  metadata?: Record<string, unknown>;
}

export interface EvalExperimentResult {
  id: string;
  name: string;
  status: EvalExperimentStatus;
  baselineRun?: EvalRunResult;
  candidateRun?: EvalRunResult;
  comparison?: EvalRunComparison;
  policy: EvalExperimentPolicy;
  violations: EvalExperimentViolation[];
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  metadata?: Record<string, unknown>;
}
