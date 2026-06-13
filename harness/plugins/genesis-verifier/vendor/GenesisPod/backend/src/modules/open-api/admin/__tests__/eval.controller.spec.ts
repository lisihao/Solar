import { BadRequestException, NotFoundException } from "@nestjs/common";
import { EvalController } from "../eval/eval.controller";
import {
  EvalExperimentService,
  EvalHarnessService,
} from "../../../ai-harness/facade";

describe("EvalController", () => {
  let controller: EvalController;
  let evalHarness: jest.Mocked<
    Pick<
      EvalHarnessService,
      | "listRuns"
      | "getRun"
      | "runDataset"
      | "compareRuns"
      | "createExactMatchScorer"
      | "createContainsTextScorer"
    >
  >;
  let evalExperiments: jest.Mocked<
    Pick<EvalExperimentService, "runExperiment">
  >;

  beforeEach(() => {
    evalHarness = {
      listRuns: jest.fn(),
      getRun: jest.fn(),
      runDataset: jest.fn(),
      compareRuns: jest.fn(),
      createExactMatchScorer: jest.fn((options) => ({
        id: options?.id ?? "exact_match",
        score: jest.fn(),
      })),
      createContainsTextScorer: jest.fn((options) => ({
        id: options?.id ?? "contains_text",
        score: jest.fn(),
      })),
    };
    evalExperiments = {
      runExperiment: jest.fn(),
    };
    controller = new EvalController(
      evalHarness as unknown as EvalHarnessService,
      evalExperiments as unknown as EvalExperimentService,
    );
  });

  it("lists runs with parsed limit", async () => {
    evalHarness.listRuns.mockResolvedValue([]);

    await expect(controller.listRuns("25")).resolves.toEqual([]);

    expect(evalHarness.listRuns).toHaveBeenCalledWith(25);
  });

  it("returns 404 when a run is missing", async () => {
    evalHarness.getRun.mockResolvedValue(null);

    await expect(controller.getRun("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("runs a trace dataset by building a static runner", async () => {
    evalHarness.runDataset.mockImplementation(async (request) => {
      const execution = await request.runner(request.dataset.cases[0], {
        runId: "run-1",
        datasetId: request.dataset.id,
      });
      return {
        id: "run-1",
        datasetId: request.dataset.id,
        datasetName: request.dataset.name,
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
        cases: [],
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          errored: 0,
          passRate: 0,
          averageScore: 0,
        },
        metadata: { execution },
      };
    });

    const result = await controller.runTraceDataset({
      runId: "run-1",
      dataset: {
        id: "dataset-1",
        name: "Dataset",
        cases: [
          {
            id: "case-1",
            expected: "Paris",
            output: "Paris",
            traceId: "trace-1",
          },
        ],
      },
      scorers: [{ type: "exact_match", ignoreCase: true }],
      evaluateTrace: true,
    });

    expect(result.metadata).toEqual({
      execution: {
        output: "Paris",
        traceId: "trace-1",
        metadata: undefined,
      },
    });
    expect(evalHarness.createExactMatchScorer).toHaveBeenCalledWith({
      type: "exact_match",
      ignoreCase: true,
    });
  });

  it("rejects unsupported scorer types", async () => {
    await expect(
      controller.runTraceDataset({
        dataset: {
          id: "dataset-1",
          name: "Dataset",
          cases: [{ id: "case-1", output: "ok" }],
        },
        scorers: [{ type: "unknown" as never }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects malformed trace datasets before running", async () => {
    await expect(
      controller.runTraceDataset({
        dataset: {
          id: "dataset-1",
          name: "Dataset",
        } as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(evalHarness.runDataset).not.toHaveBeenCalled();
  });

  it("compares two stored runs", async () => {
    const candidate = { id: "candidate" } as never;
    const baseline = { id: "baseline" } as never;
    evalHarness.getRun
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce(baseline);
    evalHarness.compareRuns.mockReturnValue({
      candidateRunId: "candidate",
      baselineRunId: "baseline",
      scoreDelta: 0,
      passRateDelta: 0,
      regressedCases: [],
      improvedCases: [],
    });

    await expect(
      controller.compareRuns({
        candidateRunId: "candidate",
        baselineRunId: "baseline",
      }),
    ).resolves.toMatchObject({ scoreDelta: 0 });
  });

  it("runs trace dataset experiments", async () => {
    evalExperiments.runExperiment.mockResolvedValue({
      id: "exp-1",
      name: "Experiment",
      status: "passed",
      policy: {},
      violations: [],
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 0,
    });

    await controller.runTraceExperiment({
      experimentId: "exp-1",
      name: "Experiment",
      baselineRunId: "baseline",
      candidateDataset: {
        id: "candidate-dataset",
        name: "Candidate",
        cases: [{ id: "case-1", output: "ok" }],
      },
      policy: { maxScoreDrop: 5 },
    });

    expect(evalExperiments.runExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        experimentId: "exp-1",
        baselineRunId: "baseline",
        policy: { maxScoreDrop: 5 },
      }),
    );
  });

  it("rejects experiments without a baseline", async () => {
    await expect(
      controller.runTraceExperiment({
        name: "Experiment",
        candidateDataset: {
          id: "candidate-dataset",
          name: "Candidate",
          cases: [{ id: "case-1", output: "ok" }],
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(evalExperiments.runExperiment).not.toHaveBeenCalled();
  });
});
