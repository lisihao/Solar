import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { EvalHarnessService } from "./eval-harness.service";
import type {
  EvalExperimentPolicy,
  EvalExperimentResult,
  EvalExperimentRunRequest,
  EvalExperimentViolation,
  EvalHarnessRunRequest,
  EvalRunResult,
} from "./eval-harness.types";

const DEFAULT_POLICY: Required<
  Pick<
    EvalExperimentPolicy,
    | "maxScoreDrop"
    | "maxPassRateDrop"
    | "maxRegressedCases"
    | "failOnCandidateRunFailure"
  >
> = {
  maxScoreDrop: 0,
  maxPassRateDrop: 0,
  maxRegressedCases: 0,
  failOnCandidateRunFailure: true,
};

@Injectable()
export class EvalExperimentService {
  private readonly logger = new Logger(EvalExperimentService.name);

  constructor(private readonly evalHarness: EvalHarnessService) {}

  async runExperiment<TInput = unknown, TExpected = unknown>(
    request: EvalExperimentRunRequest<TInput, TExpected>,
  ): Promise<EvalExperimentResult> {
    const startedAt = new Date();
    const experimentId = request.experimentId ?? randomUUID();
    const policy = { ...DEFAULT_POLICY, ...(request.policy ?? {}) };

    try {
      const baselineRun = await this.resolveBaselineRun(request);
      const candidateRun = await this.evalHarness.runDataset({
        ...request.candidateRun,
        metadata: {
          ...(request.candidateRun.metadata ?? {}),
          experimentId,
          experimentName: request.name,
          experimentRole: "candidate",
        },
      });
      const comparison = this.evalHarness.compareRuns(
        candidateRun,
        baselineRun,
      );
      const violations = this.evaluatePolicy(candidateRun, comparison, policy);
      const completedAt = new Date();

      return {
        id: experimentId,
        name: request.name,
        status: violations.length > 0 ? "failed" : "passed",
        baselineRun,
        candidateRun,
        comparison,
        policy,
        violations,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        metadata: request.metadata,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[runExperiment] failed id=${experimentId}: ${message}`);
      const completedAt = new Date();
      return {
        id: experimentId,
        name: request.name,
        status: "error",
        policy,
        violations: [
          {
            code: "experiment_error",
            message,
          },
        ],
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        metadata: request.metadata,
      };
    }
  }

  private async resolveBaselineRun<TInput, TExpected>(
    request: EvalExperimentRunRequest<TInput, TExpected>,
  ): Promise<EvalRunResult> {
    if (request.baselineRun) {
      return this.evalHarness.runDataset({
        ...request.baselineRun,
        metadata: {
          ...(request.baselineRun.metadata ?? {}),
          experimentName: request.name,
          experimentRole: "baseline",
        },
      });
    }

    if (request.baselineRunId) {
      const run = await this.evalHarness.getRun(request.baselineRunId);
      if (!run) {
        throw new Error(`Baseline run not found: ${request.baselineRunId}`);
      }
      return run;
    }

    throw new Error("Either baselineRun or baselineRunId is required");
  }

  private evaluatePolicy(
    candidateRun: EvalRunResult,
    comparison: EvalExperimentResult["comparison"],
    policy: EvalExperimentResult["policy"],
  ): EvalExperimentViolation[] {
    const violations: EvalExperimentViolation[] = [];

    if (
      policy.failOnCandidateRunFailure !== false &&
      candidateRun.status === "failed"
    ) {
      violations.push({
        code: "candidate_run_failed",
        message: "Candidate eval run failed.",
      });
    }

    if (
      typeof policy.minAverageScore === "number" &&
      candidateRun.summary.averageScore < policy.minAverageScore
    ) {
      violations.push({
        code: "min_average_score",
        message: "Candidate average score is below the required threshold.",
        actual: candidateRun.summary.averageScore,
        expected: policy.minAverageScore,
      });
    }

    if (
      typeof policy.minPassRate === "number" &&
      candidateRun.summary.passRate < policy.minPassRate
    ) {
      violations.push({
        code: "min_pass_rate",
        message: "Candidate pass rate is below the required threshold.",
        actual: candidateRun.summary.passRate,
        expected: policy.minPassRate,
      });
    }

    if (comparison) {
      const allowedScoreDelta = -Math.abs(policy.maxScoreDrop ?? 0);
      if (comparison.scoreDelta < allowedScoreDelta) {
        violations.push({
          code: "score_regression",
          message: "Candidate average score regressed beyond policy.",
          actual: comparison.scoreDelta,
          expected: allowedScoreDelta,
        });
      }

      const allowedPassRateDelta = -Math.abs(policy.maxPassRateDrop ?? 0);
      if (comparison.passRateDelta < allowedPassRateDelta) {
        violations.push({
          code: "pass_rate_regression",
          message: "Candidate pass rate regressed beyond policy.",
          actual: comparison.passRateDelta,
          expected: allowedPassRateDelta,
        });
      }

      if (comparison.regressedCases.length > (policy.maxRegressedCases ?? 0)) {
        violations.push({
          code: "case_regression",
          message: "Candidate has too many regressed cases.",
          actual: comparison.regressedCases.length,
          expected: policy.maxRegressedCases ?? 0,
        });
      }
    }

    return violations;
  }
}

export type { EvalExperimentRunRequest, EvalHarnessRunRequest, EvalRunResult };
