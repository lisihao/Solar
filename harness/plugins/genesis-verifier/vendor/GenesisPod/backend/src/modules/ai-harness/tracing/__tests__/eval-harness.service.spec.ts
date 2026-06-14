import { EvalHarnessService } from "../experiments/eval-harness.service";
import { EvalPipelineService } from "../experiments/eval-pipeline.service";
import { InMemoryEvalRunStore } from "../experiments/eval-run.store";
import type { EvalDataset } from "../experiments/eval-harness.types";

function makeService(evaluate = jest.fn()) {
  return new EvalHarnessService(
    {
      evaluate,
    } as unknown as EvalPipelineService,
    new InMemoryEvalRunStore(),
  );
}

describe("EvalHarnessService", () => {
  const dataset: EvalDataset<string, string> = {
    id: "qa-smoke",
    name: "QA smoke",
    version: "v1",
    cases: [
      { id: "case-1", input: "capital of France", expected: "Paris" },
      { id: "case-2", input: "capital of Canada", expected: "Ottawa" },
    ],
  };

  it("runs a dataset with scorers and stores the run", async () => {
    const service = makeService();
    const scorer = service.createExactMatchScorer({ ignoreCase: true });

    const result = await service.runDataset({
      runId: "run-1",
      dataset,
      scorers: [scorer],
      runner: (testCase) => ({ output: testCase.expected }),
    });

    expect(result.id).toBe("run-1");
    expect(result.status).toBe("completed");
    expect(result.summary).toEqual({
      total: 2,
      passed: 2,
      failed: 0,
      errored: 0,
      passRate: 1,
      averageScore: 100,
    });
    await expect(service.getRun("run-1")).resolves.toBe(result);
    await expect(service.listRuns()).resolves.toEqual([result]);
  });

  it("marks failed cases when a scorer does not pass", async () => {
    const service = makeService();

    const result = await service.runDataset({
      dataset,
      scorers: [service.createContainsTextScorer({ ignoreCase: true })],
      runner: () => ({ output: "wrong answer" }),
    });

    expect(result.summary.passed).toBe(0);
    expect(result.summary.failed).toBe(2);
    expect(result.summary.averageScore).toBe(0);
    expect(result.cases.every((testCase) => testCase.status === "failed")).toBe(
      true,
    );
  });

  it("adds trace evaluation as a metric when runner returns a trace id", async () => {
    const evaluate = jest.fn().mockResolvedValue({
      traceId: "trace-1",
      overallScore: 82,
      structuralScore: 90,
      judgeScore: null,
      dimensions: null,
      structuralChecks: {
        spanSuccessRate: 1,
        hasOutput: true,
        durationReasonable: true,
        toolSuccessRate: 1,
        passed: true,
      },
      suggestions: null,
      judgeEvaluated: false,
      evaluatedAt: new Date(),
    });
    const service = makeService(evaluate);

    const result = await service.runDataset({
      dataset: {
        id: "trace-dataset",
        name: "Trace dataset",
        cases: [{ id: "case-1", input: "run", expected: "ok" }],
      },
      runner: () => ({ output: "ok", traceId: "trace-1" }),
    });

    expect(evaluate).toHaveBeenCalledWith("trace-1");
    expect(result.cases[0].score).toBe(82);
    expect(result.cases[0].metrics[0]).toMatchObject({
      id: "trace.overall",
      score: 82,
      passed: true,
    });
  });

  it("records runner errors and can stop on first error", async () => {
    const service = makeService();

    const result = await service.runDataset({
      dataset,
      continueOnError: false,
      runner: () => {
        throw new Error("boom");
      },
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toMatchObject({
      total: 1,
      errored: 1,
      averageScore: 0,
    });
    expect(result.cases[0].error).toBe("boom");
  });

  it("compares candidate runs against a baseline", async () => {
    const service = makeService();
    const baseline = await service.runDataset({
      runId: "baseline",
      dataset,
      scorers: [service.createExactMatchScorer()],
      runner: (testCase) => ({ output: testCase.expected }),
    });
    const candidate = await service.runDataset({
      runId: "candidate",
      dataset,
      scorers: [service.createExactMatchScorer()],
      runner: (testCase) => ({
        output: testCase.id === "case-1" ? "wrong" : testCase.expected,
      }),
    });

    expect(service.compareRuns(candidate, baseline)).toEqual({
      candidateRunId: "candidate",
      baselineRunId: "baseline",
      scoreDelta: -50,
      passRateDelta: -0.5,
      regressedCases: ["case-1"],
      improvedCases: [],
    });
  });

  it("rejects duplicate case ids", async () => {
    const service = makeService();

    await expect(
      service.runDataset({
        dataset: {
          id: "bad",
          name: "Bad",
          cases: [
            { id: "dup", input: "a" },
            { id: "dup", input: "b" },
          ],
        },
        runner: () => ({ output: "ok" }),
      }),
    ).rejects.toThrow("Duplicate eval case id: dup");
  });
});
