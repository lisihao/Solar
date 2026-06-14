import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import {
  EvalDataset,
  EvalExperimentPolicy,
  EvalExperimentService,
  EvalHarnessRunRequest,
  EvalHarnessService,
  EvalRunResult,
  EvalScorer,
} from "../../../ai-harness/facade";

interface EvalAdminScorerSpec {
  type: "exact_match" | "contains_text";
  id?: string;
  threshold?: number;
  weight?: number;
  ignoreCase?: boolean;
  trim?: boolean;
}

interface EvalAdminTraceCase {
  id: string;
  name?: string;
  input?: unknown;
  expected?: unknown;
  output?: unknown;
  traceId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

interface EvalAdminTraceDataset {
  id: string;
  name: string;
  version?: string;
  cases: EvalAdminTraceCase[];
  metadata?: Record<string, unknown>;
}

interface RunTraceDatasetDto {
  runId?: string;
  dataset: EvalAdminTraceDataset;
  scorers?: EvalAdminScorerSpec[];
  continueOnError?: boolean;
  evaluateTrace?: boolean;
  traceThreshold?: number;
  traceWeight?: number;
  metadata?: Record<string, unknown>;
}

interface CompareRunsDto {
  candidateRunId: string;
  baselineRunId: string;
}

interface RunTraceExperimentDto {
  experimentId?: string;
  name: string;
  baselineRunId?: string;
  baselineDataset?: EvalAdminTraceDataset;
  candidateDataset: EvalAdminTraceDataset;
  scorers?: EvalAdminScorerSpec[];
  policy?: EvalExperimentPolicy;
  evaluateTrace?: boolean;
  traceThreshold?: number;
  traceWeight?: number;
  metadata?: Record<string, unknown>;
}

@ApiTags("Admin - Eval")
@Controller("admin/evals")
@UseGuards(JwtAuthGuard, AdminGuard)
export class EvalController {
  private readonly logger = new Logger(EvalController.name);

  constructor(
    private readonly evalHarness: EvalHarnessService,
    private readonly evalExperiments: EvalExperimentService,
  ) {}

  @Get("runs")
  @ApiOperation({ summary: "List recent eval runs" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiResponse({ status: 200, description: "Returns recent eval runs" })
  async listRuns(@Query("limit") limit?: string): Promise<EvalRunResult[]> {
    return this.evalHarness.listRuns(limit ? Number.parseInt(limit, 10) : 50);
  }

  @Get("runs/:id")
  @ApiOperation({ summary: "Get an eval run by id" })
  @ApiResponse({ status: 200, description: "Returns an eval run" })
  @ApiResponse({ status: 404, description: "Eval run not found" })
  async getRun(@Param("id") id: string): Promise<EvalRunResult> {
    const run = await this.evalHarness.getRun(id);
    if (!run) throw new NotFoundException(`Eval run ${id} not found`);
    return run;
  }

  @Post("runs/trace-dataset")
  @ApiOperation({ summary: "Run an eval dataset from static outputs/traces" })
  @ApiResponse({ status: 201, description: "Returns the eval run result" })
  async runTraceDataset(@Body() body: RunTraceDatasetDto) {
    this.validateTraceDataset(body?.dataset);
    this.logger.log(`Admin: Running eval dataset ${body.dataset?.id ?? ""}`);
    return this.evalHarness.runDataset(this.buildRunRequest(body));
  }

  @Post("runs/compare")
  @ApiOperation({ summary: "Compare candidate and baseline eval runs" })
  @ApiResponse({ status: 201, description: "Returns run comparison" })
  @ApiResponse({ status: 404, description: "One or both runs were not found" })
  async compareRuns(@Body() body: CompareRunsDto) {
    const [candidate, baseline] = await Promise.all([
      this.evalHarness.getRun(body.candidateRunId),
      this.evalHarness.getRun(body.baselineRunId),
    ]);
    if (!candidate) {
      throw new NotFoundException(
        `Candidate eval run ${body.candidateRunId} not found`,
      );
    }
    if (!baseline) {
      throw new NotFoundException(
        `Baseline eval run ${body.baselineRunId} not found`,
      );
    }
    return this.evalHarness.compareRuns(candidate, baseline);
  }

  @Post("experiments/trace-dataset")
  @ApiOperation({ summary: "Run a trace/static-output eval experiment" })
  @ApiResponse({ status: 201, description: "Returns experiment result" })
  async runTraceExperiment(@Body() body: RunTraceExperimentDto) {
    if (!body?.baselineRunId && !body?.baselineDataset) {
      throw new BadRequestException(
        "Either baselineRunId or baselineDataset is required",
      );
    }
    this.validateTraceDataset(body.candidateDataset, "candidateDataset");
    if (body.baselineDataset) {
      this.validateTraceDataset(body.baselineDataset, "baselineDataset");
    }
    this.logger.log(`Admin: Running eval experiment ${body.name}`);
    return this.evalExperiments.runExperiment({
      experimentId: body.experimentId,
      name: body.name,
      baselineRunId: body.baselineRunId,
      baselineRun: body.baselineDataset
        ? this.buildRunRequest({
            ...body,
            dataset: body.baselineDataset,
            metadata: {
              ...(body.metadata ?? {}),
              experimentRole: "baseline",
            },
          })
        : undefined,
      candidateRun: this.buildRunRequest({
        ...body,
        dataset: body.candidateDataset,
        metadata: {
          ...(body.metadata ?? {}),
          experimentRole: "candidate",
        },
      }),
      policy: body.policy,
      metadata: body.metadata,
    });
  }

  private buildRunRequest(
    body: RunTraceDatasetDto,
  ): EvalHarnessRunRequest<unknown, unknown> {
    this.validateTraceDataset(body?.dataset);
    const caseById = new Map(body.dataset.cases.map((c) => [c.id, c]));
    const dataset: EvalDataset<unknown, unknown> = {
      id: body.dataset.id,
      name: body.dataset.name,
      version: body.dataset.version,
      metadata: body.dataset.metadata,
      cases: body.dataset.cases.map((testCase) => ({
        id: testCase.id,
        name: testCase.name,
        input: testCase.input ?? { traceId: testCase.traceId },
        expected: testCase.expected,
        tags: testCase.tags,
        metadata: testCase.metadata,
      })),
    };

    return {
      runId: body.runId,
      dataset,
      scorers: this.buildScorers(body.scorers ?? []),
      continueOnError: body.continueOnError,
      evaluateTrace: body.evaluateTrace,
      traceThreshold: body.traceThreshold,
      traceWeight: body.traceWeight,
      metadata: body.metadata,
      runner: (testCase) => {
        const source = caseById.get(testCase.id);
        if (!source) {
          throw new Error(`Eval case source not found: ${testCase.id}`);
        }
        return {
          output: source.output,
          traceId: source.traceId,
          metadata: source.metadata,
        };
      },
    };
  }

  private buildScorers(
    specs: readonly EvalAdminScorerSpec[],
  ): EvalScorer<unknown, unknown>[] {
    return specs.map((spec) => {
      if (spec.type === "exact_match") {
        return this.evalHarness.createExactMatchScorer(spec);
      }
      if (spec.type === "contains_text") {
        return this.evalHarness.createContainsTextScorer(spec);
      }
      throw new BadRequestException(`Unsupported eval scorer: ${spec.type}`);
    });
  }

  private validateTraceDataset(
    dataset: EvalAdminTraceDataset | undefined,
    field = "dataset",
  ): asserts dataset is EvalAdminTraceDataset {
    if (!dataset) {
      throw new BadRequestException(`${field} is required`);
    }
    if (typeof dataset.id !== "string" || !dataset.id.trim()) {
      throw new BadRequestException(`${field}.id is required`);
    }
    if (typeof dataset.name !== "string" || !dataset.name.trim()) {
      throw new BadRequestException(`${field}.name is required`);
    }
    if (!Array.isArray(dataset.cases)) {
      throw new BadRequestException(`${field}.cases must be an array`);
    }
    for (const testCase of dataset.cases) {
      if (typeof testCase.id !== "string" || !testCase.id.trim()) {
        throw new BadRequestException(`${field}.cases[].id is required`);
      }
    }
  }
}
