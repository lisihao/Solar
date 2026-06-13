import { EvalExperimentService } from "../experiments/eval-experiment.service";
import { EvalHarnessService } from "../experiments/eval-harness.service";
import { EvalPipelineService } from "../experiments/eval-pipeline.service";
import { InMemoryEvalRunStore } from "../experiments/eval-run.store";
import type { EvalDataset } from "../experiments/eval-harness.types";

function makeHarness() {
  return new EvalHarnessService(
    {
      evaluate: jest.fn(),
    } as unknown as EvalPipelineService,
    new InMemoryEvalRunStore(),
  );
}

describe("EvalExperimentService", () => {
  const dataset: EvalDataset<string, string> = {
    id: "qa-smoke",
    name: "QA smoke",
    cases: [
      { id: "case-1", input: "capital of France", expected: "Paris" },
      { id: "case-2", input: "capital of Canada", expected: "Ottawa" },
    ],
  };

  it("passes when candidate does not regress against baseline", async () => {
    const harness = makeHarness();
    const service = new EvalExperimentService(harness);
    const scorer = harness.createExactMatchScorer();

    const result = await service.runExperiment({
      experimentId: "exp-pass",
      name: "No regression",
      baselineRun: {
        runId: "baseline",
        dataset,
        scorers: [scorer],
        runner: (testCase) => ({ output: testCase.expected }),
      },
      candidateRun: {
        runId: "candidate",
        dataset,
        scorers: [scorer],
        runner: (testCase) => ({ output: testCase.expected }),
      },
    });

    expect(result.status).toBe("passed");
    expect(result.violations).toEqual([]);
    expect(result.comparison).toMatchObject({
      scoreDelta: 0,
      passRateDelta: 0,
      regressedCases: [],
    });
  });

  it("fails when candidate violates regression policy", async () => {
    const harness = makeHarness();
    const service = new EvalExperimentService(harness);
    const scorer = harness.createExactMatchScorer();

    const result = await service.runExperiment({
      name: "Regression gate",
      baselineRun: {
        dataset,
        scorers: [scorer],
        runner: (testCase) => ({ output: testCase.expected }),
      },
      candidateRun: {
        dataset,
        scorers: [scorer],
        runner: (testCase) => ({
          output: testCase.id === "case-1" ? "wrong" : testCase.expected,
        }),
      },
      policy: {
        maxScoreDrop: 10,
        maxPassRateDrop: 0.1,
        maxRegressedCases: 0,
        minAverageScore: 80,
      },
    });

    expect(result.status).toBe("failed");
    expect(result.comparison).toMatchObject({
      scoreDelta: -50,
      passRateDelta: -0.5,
      regressedCases: ["case-1"],
    });
    expect(result.violations.map((v) => v.code)).toEqual([
      "min_average_score",
      "score_regression",
      "pass_rate_regression",
      "case_regression",
    ]);
  });

  it("can reuse a stored baseline run", async () => {
    const harness = makeHarness();
    const service = new EvalExperimentService(harness);
    const scorer = harness.createExactMatchScorer();

    await harness.runDataset({
      runId: "stored-baseline",
      dataset,
      scorers: [scorer],
      runner: (testCase) => ({ output: testCase.expected }),
    });

    const result = await service.runExperiment({
      name: "Stored baseline",
      baselineRunId: "stored-baseline",
      candidateRun: {
        runId: "candidate",
        dataset,
        scorers: [scorer],
        runner: (testCase) => ({ output: testCase.expected }),
      },
    });

    expect(result.status).toBe("passed");
    expect(result.baselineRun?.id).toBe("stored-baseline");
    expect(result.candidateRun?.id).toBe("candidate");
  });

  it("returns an error result when baseline is missing", async () => {
    const harness = makeHarness();
    const service = new EvalExperimentService(harness);

    const result = await service.runExperiment({
      name: "Missing baseline",
      baselineRunId: "missing",
      candidateRun: {
        dataset,
        runner: () => ({ output: "ok" }),
      },
    });

    expect(result.status).toBe("error");
    expect(result.violations).toEqual([
      {
        code: "experiment_error",
        message: "Baseline run not found: missing",
      },
    ]);
  });
});
