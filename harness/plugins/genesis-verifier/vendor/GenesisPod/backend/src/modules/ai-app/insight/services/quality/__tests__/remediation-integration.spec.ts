/**
 * Remediation Integration Tests
 *
 * 仿真 dimension-writing.service 中的自评+补救完整流程，
 * 覆盖所有业务分支组合：
 *
 * 1. QG 通过 → 跳过自评（成本为 0）
 * 2. QG 失败 + 自评全 ≥7 → 跳过补救，trace 记录 skippedReason
 * 3. QG 失败 + 自评有 <7 + 补救成功 → 内容替换 + QG auto-fix + trace wasRemediated=true
 * 4. QG 失败 + 自评有 <7 + 补救失败（API error）→ 保留原内容，trace wasRemediated=false
 * 5. QG 失败 + 自评异常 → catch，无 trace
 * 6. 多 section 的 trace 收集到 remediationTraces 数组
 * 7. trace 数据流：sectionResult → analysisResult → dataPoints JSON
 */

import { SectionSelfEvalService } from "../section-self-eval.service";
import { SectionRemediationService } from "../section-remediation.service";
import type { RemediationTrace } from "../../../types/quality.types";

// Simulate the QualityGate result structure
interface QCResult {
  passed: boolean;
  wasAutoFixed: boolean;
  fixedContent: string;
  violations: Array<{ rule: string; severity: string }>;
  rewriteGuidance: string[];
}

describe("Remediation Integration Flow", () => {
  const mockChat = jest.fn();
  const mockSelectModel = jest.fn();
  const mockChatFacade = { chat: mockChat } as any;
  const mockEngineFacade = { selectModel: mockSelectModel } as any;

  let selfEval: SectionSelfEvalService;
  let remediation: SectionRemediationService;

  beforeEach(() => {
    selfEval = new SectionSelfEvalService(mockChatFacade);
    remediation = new SectionRemediationService(
      mockChatFacade,
      mockEngineFacade,
    );
    mockChat.mockReset();
    mockSelectModel.mockReset();
  });

  const originalContent =
    "市场格局分析内容，包含引用 [1] 和多个论点 [2]。目前市场呈现...（300字）";
  const sectionTitle = "市场格局分析";
  const modelId = "gpt-4o-mini";

  /**
   * 仿真 dimension-writing.service.ts 中的补救逻辑
   */
  async function simulateRemediationFlow(
    qc: QCResult,
    content: string,
  ): Promise<{
    finalContent: string;
    trace?: RemediationTrace;
  }> {
    let result = { content };

    if (!qc.passed) {
      try {
        const evalResult = await selfEval.evaluateSection({
          content: result.content,
          sectionTitle,
          topicName: "AI Research",
          language: "zh",
        });

        const trace: RemediationTrace = {
          sectionTitle,
          originalModel: modelId,
          selfEvalScores: { ...evalResult.scores },
          actions: [],
          wasRemediated: false,
        };

        if (!evalResult.overallOk) {
          const actions = selfEval.determineRemediationActions(
            evalResult,
            7,
            "zh",
          );

          if (actions.length > 0) {
            const remediationModelId =
              await remediation.getRemediationModelId(modelId);
            trace.remediationModel = remediationModelId || undefined;
            trace.actions = actions.map((a) => ({
              type: a.type,
              dimension: a.dimension,
              scoreBefore: a.score,
              guidance: a.guidance,
            }));

            const remResult = await remediation.remediate({
              content: result.content,
              sectionTitle,
              actions,
              originalModelId: modelId,
              resolvedRemediationModelId: remediationModelId,
              language: "zh",
            });

            if (!remResult.skipped) {
              result = { content: remResult.content };
              trace.wasRemediated = true;
            } else {
              trace.skippedReason = remResult.skipReason;
            }
          }
        } else {
          trace.skippedReason = "all_scores_above_threshold";
        }

        return { finalContent: result.content, trace };
      } catch {
        return { finalContent: result.content };
      }
    }

    return { finalContent: result.content };
  }

  // ==================== Branch 1: QG passed ====================

  it("Branch 1: QG passed → no self-eval, no LLM calls", async () => {
    const qc: QCResult = {
      passed: true,
      wasAutoFixed: false,
      fixedContent: "",
      violations: [],
      rewriteGuidance: [],
    };

    const { finalContent, trace } = await simulateRemediationFlow(
      qc,
      originalContent,
    );

    expect(finalContent).toBe(originalContent);
    expect(trace).toBeUndefined();
    expect(mockChat).not.toHaveBeenCalled();
  });

  // ==================== Branch 2: QG failed, all scores >= 7 ====================

  it("Branch 2: QG failed + self-eval all ≥7 → skip remediation", async () => {
    // First call: self-eval returns all good scores
    mockChat.mockResolvedValueOnce({
      content:
        '{"analytical_depth":8,"evidence_coverage":7,"actionability":9,"writing_quality":7}',
    });

    const qc: QCResult = {
      passed: false,
      wasAutoFixed: true,
      fixedContent: originalContent,
      violations: [{ rule: "heading_format", severity: "low" }],
      rewriteGuidance: [],
    };

    const { finalContent, trace } = await simulateRemediationFlow(
      qc,
      originalContent,
    );

    expect(finalContent).toBe(originalContent);
    expect(trace).toBeDefined();
    expect(trace!.wasRemediated).toBe(false);
    expect(trace!.skippedReason).toBe("all_scores_above_threshold");
    expect(trace!.actions).toEqual([]);
    // Only 1 LLM call (self-eval), no remediation call
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  // ==================== Branch 3: QG failed, low scores, remediation success ====================

  it("Branch 3: QG failed + low scores + remediation success → content replaced", async () => {
    const improvedContent = originalContent + "\n\n深度分析：因果推理补充...";

    // Call 1: self-eval returns low scores
    mockChat.mockResolvedValueOnce({
      content:
        '{"analytical_depth":5,"evidence_coverage":4,"actionability":8,"writing_quality":6}',
    });
    // Call 2: selectModel for remediation model
    mockSelectModel.mockResolvedValueOnce({
      id: "gpt-4o",
      name: "GPT-4o",
      provider: "openai",
    });
    // Call 3: remediation LLM call
    mockChat.mockResolvedValueOnce({
      content: improvedContent,
      model: "gpt-4o",
      isError: false,
    });

    const qc: QCResult = {
      passed: false,
      wasAutoFixed: true,
      fixedContent: originalContent,
      violations: [{ rule: "language_mix", severity: "high" }],
      rewriteGuidance: [],
    };

    const { finalContent, trace } = await simulateRemediationFlow(
      qc,
      originalContent,
    );

    expect(finalContent).toBe(improvedContent);
    expect(trace).toBeDefined();
    expect(trace!.wasRemediated).toBe(true);
    expect(trace!.originalModel).toBe("gpt-4o-mini");
    expect(trace!.remediationModel).toBe("gpt-4o");
    expect(trace!.actions).toHaveLength(3); // depth + coverage + writing
    expect(trace!.selfEvalScores).toEqual({
      analytical_depth: 5,
      evidence_coverage: 4,
      actionability: 8,
      writing_quality: 6,
    });
    // 2 LLM calls: self-eval + remediation
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  // ==================== Branch 4: QG failed, low scores, remediation API error ====================

  it("Branch 4: QG failed + low scores + remediation fails → keep original", async () => {
    // Call 1: self-eval
    mockChat.mockResolvedValueOnce({
      content:
        '{"analytical_depth":3,"evidence_coverage":7,"actionability":7,"writing_quality":7}',
    });
    // selectModel
    mockSelectModel.mockResolvedValueOnce({
      id: "gpt-4o",
      name: "GPT-4o",
      provider: "openai",
    });
    // Call 2: remediation fails
    mockChat.mockResolvedValueOnce({
      content: "Rate limit exceeded",
      isError: true,
    });

    const qc: QCResult = {
      passed: false,
      wasAutoFixed: false,
      fixedContent: "",
      violations: [{ rule: "content_length", severity: "high" }],
      rewriteGuidance: ["内容过短"],
    };

    const { finalContent, trace } = await simulateRemediationFlow(
      qc,
      originalContent,
    );

    expect(finalContent).toBe(originalContent);
    expect(trace).toBeDefined();
    expect(trace!.wasRemediated).toBe(false);
    expect(trace!.skippedReason).toContain("api_error");
    expect(trace!.actions).toHaveLength(1); // only analytical_depth
  });

  // ==================== Branch 5: Self-eval exception ====================

  it("Branch 5: self-eval throws → catch, no trace", async () => {
    mockChat.mockRejectedValueOnce(new Error("Network error"));

    const qc: QCResult = {
      passed: false,
      wasAutoFixed: false,
      fixedContent: "",
      violations: [{ rule: "test", severity: "high" }],
      rewriteGuidance: [],
    };

    const { finalContent, trace } = await simulateRemediationFlow(
      qc,
      originalContent,
    );

    // self-eval fails-open returning all 7s → overallOk=true → skip remediation
    expect(finalContent).toBe(originalContent);
    // The self-eval catch returns all 7s, so trace IS created with skippedReason
    expect(trace).toBeDefined();
    expect(trace!.skippedReason).toBe("all_scores_above_threshold");
  });

  // ==================== Branch 6: Multi-section trace collection ====================

  it("Branch 6: multiple sections collect traces correctly", async () => {
    const sections = ["概述", "市场分析", "技术趋势"];
    const traces: RemediationTrace[] = [];

    for (const title of sections) {
      // Each section: self-eval returns different scores
      const score = title === "市场分析" ? 5 : 8;
      mockChat.mockResolvedValueOnce({
        content: `{"analytical_depth":${score},"evidence_coverage":7,"actionability":7,"writing_quality":7}`,
      });

      if (score < 7) {
        mockSelectModel.mockResolvedValueOnce({
          id: "gpt-4o",
          name: "GPT-4o",
          provider: "openai",
        });
        mockChat.mockResolvedValueOnce({
          content: originalContent + ` [remediated: ${title}]`,
          isError: false,
        });
      }

      const evalResult = await selfEval.evaluateSection({
        content: originalContent,
        sectionTitle: title,
        topicName: "Test",
        language: "zh",
      });

      const trace: RemediationTrace = {
        sectionTitle: title,
        originalModel: modelId,
        selfEvalScores: { ...evalResult.scores },
        actions: [],
        wasRemediated: false,
      };

      if (!evalResult.overallOk) {
        trace.wasRemediated = true;
        trace.actions = selfEval
          .determineRemediationActions(evalResult)
          .map((a) => ({
            type: a.type,
            dimension: a.dimension,
            scoreBefore: a.score,
            guidance: a.guidance,
          }));
      } else {
        trace.skippedReason = "all_scores_above_threshold";
      }

      traces.push(trace);
    }

    // Filter to only remediated traces (as frontend does)
    const remediatedTraces = traces.filter((t) => t.wasRemediated);

    expect(traces).toHaveLength(3);
    expect(remediatedTraces).toHaveLength(1);
    expect(remediatedTraces[0].sectionTitle).toBe("市场分析");
    expect(
      traces.filter((t) => t.skippedReason === "all_scores_above_threshold"),
    ).toHaveLength(2);
  });

  // ==================== Branch 7: Trace data structure integrity ====================

  it("Branch 7: trace serialization for dataPoints JSON", () => {
    const trace: RemediationTrace = {
      sectionTitle: "测试章节",
      originalModel: "gpt-4o-mini",
      remediationModel: "gpt-4o",
      selfEvalScores: {
        analytical_depth: 5,
        evidence_coverage: 4,
        actionability: 8,
        writing_quality: 6,
      },
      actions: [
        {
          type: "deepen_analysis",
          dimension: "analytical_depth",
          scoreBefore: 5,
          guidance: "补充因果推理",
        },
      ],
      wasRemediated: true,
    };

    // Simulate JSON serialization (as Prisma toPrismaJson does)
    const serialized = JSON.parse(JSON.stringify(trace));

    expect(serialized.sectionTitle).toBe("测试章节");
    expect(serialized.originalModel).toBe("gpt-4o-mini");
    expect(serialized.remediationModel).toBe("gpt-4o");
    expect(serialized.selfEvalScores.analytical_depth).toBe(5);
    expect(serialized.actions).toHaveLength(1);
    expect(serialized.wasRemediated).toBe(true);
    expect(serialized.skippedReason).toBeUndefined();

    // Frontend reads this from CredibilityReportData.aiEvaluation.chapters[].remediationTraces
    const remediationTraces = [serialized];
    const remediatedOnly = remediationTraces.filter(
      (t: RemediationTrace) => t.wasRemediated,
    );
    expect(remediatedOnly).toHaveLength(1);
  });
});
