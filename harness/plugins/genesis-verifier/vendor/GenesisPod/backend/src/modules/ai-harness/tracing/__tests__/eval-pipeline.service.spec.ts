import { Test, TestingModule } from "@nestjs/testing";
import { EvalPipelineService } from "../experiments/eval-pipeline.service";
import { TraceCollectorService } from "../observability/trace-collector.service";
import { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";
import { TraceData } from "../observability/trace.interface";

// ─── Helpers ─────────────────────────────────────────────

function makeTrace(overrides: Partial<TraceData> = {}): TraceData {
  return {
    id: "trace-1",
    name: "Test Research",
    type: "research_mission",
    status: "success",
    startTime: new Date(Date.now() - 5000),
    endTime: new Date(),
    duration: 5000,
    metadata: {},
    spans: [
      {
        id: "span-1",
        traceId: "trace-1",
        name: "LLM call",
        type: "llm_call",
        status: "success",
        startTime: new Date(Date.now() - 4000),
        endTime: new Date(),
        duration: 4000,
        metadata: {},
        output: "This is the analysis result.",
      },
    ],
    ...overrides,
  };
}

function makeTraceMock(trace: TraceData | null) {
  return { getTrace: jest.fn().mockReturnValue(trace) };
}

function makeAiMock(responseContent: string) {
  return {
    chat: jest.fn().mockResolvedValue({
      content: responseContent,
      model: "test",
      tokensUsed: 30,
    }),
  };
}

const GOOD_JUDGE_RESPONSE = JSON.stringify({
  accuracy: 4,
  relevance: 5,
  readability: 4,
  completeness: 3,
  suggestions: "Add more citations.",
});

describe("EvalPipelineService", () => {
  let service: EvalPipelineService;
  let traceMock: ReturnType<typeof makeTraceMock>;
  let aiMock: ReturnType<typeof makeAiMock>;

  async function build(
    trace: TraceData | null,
    judgeResponse = GOOD_JUDGE_RESPONSE,
  ) {
    traceMock = makeTraceMock(trace);
    aiMock = makeAiMock(judgeResponse);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvalPipelineService,
        { provide: TraceCollectorService, useValue: traceMock },
        { provide: AiChatService, useValue: aiMock },
      ],
    }).compile();

    service = module.get(EvalPipelineService);
    // Force 100% sampling for deterministic tests
    service.setSampleRate(1.0);
  }

  describe("evaluate() — trace not found", () => {
    it("returns zero score and failReason when trace is missing", async () => {
      await build(null);

      const result = await service.evaluate("nonexistent");
      expect(result.overallScore).toBe(0);
      expect(result.judgeEvaluated).toBe(false);
      expect(result.structuralChecks.failReason).toMatch(/Trace not found/);
    });
  });

  describe("evaluate() — Layer 1 structural checks", () => {
    it("passes with healthy trace (all spans successful, has output)", async () => {
      await build(makeTrace());

      const result = await service.evaluate("trace-1");
      expect(result.structuralChecks.passed).toBe(true);
      expect(result.structuralScore).toBeGreaterThan(0);
    });

    it("fails when majority of spans error", async () => {
      await build(
        makeTrace({
          spans: [
            {
              id: "s1",
              traceId: "trace-1",
              name: "err",
              type: "llm_call",
              status: "error",
              startTime: new Date(),
              metadata: {},
            },
            {
              id: "s2",
              traceId: "trace-1",
              name: "err2",
              type: "llm_call",
              status: "error",
              startTime: new Date(),
              metadata: {},
            },
          ],
        }),
      );

      const result = await service.evaluate("trace-1");
      expect(result.structuralChecks.passed).toBe(false);
      expect(result.structuralScore).toBe(0);
      // Layer 1 failed → AI Judge not run
      expect(result.judgeEvaluated).toBe(false);
    });

    it("fails when no output found in any span", async () => {
      await build(
        makeTrace({
          spans: [
            {
              id: "s1",
              traceId: "trace-1",
              name: "span",
              type: "llm_call",
              status: "success",
              startTime: new Date(),
              metadata: {},
              output: undefined, // no output
            },
          ],
        }),
      );

      const result = await service.evaluate("trace-1");
      expect(result.structuralChecks.hasOutput).toBe(false);
      expect(result.structuralChecks.passed).toBe(false);
    });

    it("detects slow execution (>10min)", async () => {
      await build(
        makeTrace({
          duration: 11 * 60 * 1000, // 11 minutes
          spans: [
            {
              id: "s1",
              traceId: "trace-1",
              name: "span",
              type: "llm_call",
              status: "success",
              startTime: new Date(),
              metadata: {},
              output: "ok",
            },
          ],
        }),
      );

      const result = await service.evaluate("trace-1");
      expect(result.structuralChecks.durationReasonable).toBe(false);
      expect(result.structuralChecks.passed).toBe(false);
    });
  });

  describe("evaluate() — Layer 2 AI Judge", () => {
    it("evaluates and returns judge scores for good trace", async () => {
      await build(makeTrace(), GOOD_JUDGE_RESPONSE);

      const result = await service.evaluate("trace-1");
      expect(result.judgeEvaluated).toBe(true);
      expect(result.dimensions).toEqual({
        accuracy: 4,
        relevance: 5,
        readability: 4,
        completeness: 3,
      });
      expect(result.judgeScore).toBeCloseTo((4 + 5 + 4 + 3) / 4);
      expect(result.suggestions).toBe("Add more citations.");
    });

    it("skips judge when Layer 1 fails (no AI waste)", async () => {
      await build(
        makeTrace({
          spans: [
            {
              id: "s1",
              traceId: "trace-1",
              name: "fail",
              type: "llm_call",
              status: "error",
              startTime: new Date(),
              metadata: {},
            },
            {
              id: "s2",
              traceId: "trace-1",
              name: "fail2",
              type: "llm_call",
              status: "error",
              startTime: new Date(),
              metadata: {},
            },
          ],
        }),
      );

      await service.evaluate("trace-1");
      expect(aiMock.chat).not.toHaveBeenCalled();
    });

    it("handles malformed judge JSON gracefully (judgeEvaluated=false)", async () => {
      await build(makeTrace(), "Sorry, I cannot evaluate this.");

      const result = await service.evaluate("trace-1");
      // Judge ran but parsing failed → judgeEvaluated=false
      expect(result.judgeEvaluated).toBe(false);
      expect(result.judgeScore).toBeNull();
      // overall still uses structural score
      expect(result.overallScore).toBeGreaterThan(0);
    });

    it("skips judge at 0% sample rate", async () => {
      await build(makeTrace());
      service.setSampleRate(0);

      const result = await service.evaluate("trace-1");
      expect(result.judgeEvaluated).toBe(false);
      expect(aiMock.chat).not.toHaveBeenCalled();
    });
  });

  describe("overall score", () => {
    it("overall = structural only when judge not evaluated", async () => {
      await build(makeTrace());
      service.setSampleRate(0); // no AI judge

      const result = await service.evaluate("trace-1");
      expect(result.overallScore).toBe(result.structuralScore);
    });

    it("overall = weighted blend when judge evaluated", async () => {
      await build(makeTrace(), GOOD_JUDGE_RESPONSE);

      const result = await service.evaluate("trace-1");
      // structural * 0.4 + judge_normalized * 0.6
      const judgeNorm = ((result.judgeScore! - 1) / 4) * 100;
      const expected = Math.round(
        result.structuralScore * 0.4 + judgeNorm * 0.6,
      );
      expect(result.overallScore).toBe(expected);
    });
  });
});
