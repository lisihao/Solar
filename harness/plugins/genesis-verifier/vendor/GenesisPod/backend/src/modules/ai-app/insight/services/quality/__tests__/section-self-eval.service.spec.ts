/**
 * SectionSelfEvalService Tests
 *
 * 覆盖分支：
 * 1. 正常评估 — 全部 ≥7 → overallOk=true
 * 2. 正常评估 — 部分 <7 → weakAreas 正确标记
 * 3. LLM 返回非 JSON → parseScores 回退默认值
 * 4. LLM 返回 markdown 包裹的 JSON → 正确提取
 * 5. LLM 调用异常 → fail-open（全 7 分）
 * 6. 分数越界处理（<1 或 >10）
 * 7. determineRemediationActions — 弱维度生成正确动作
 * 8. determineRemediationActions — 无弱维度 → 空数组
 * 9. 英文语言适配
 */

import { SectionSelfEvalService } from "../section-self-eval.service";

// Mock ChatFacade
const mockChat = jest.fn();
const mockChatFacade = { chat: mockChat } as any;

describe("SectionSelfEvalService", () => {
  let service: SectionSelfEvalService;

  beforeEach(() => {
    service = new SectionSelfEvalService(mockChatFacade);
    mockChat.mockReset();
  });

  const defaultInput = {
    content: "这是一段测试内容，用于质量评估。包含多个论点和引用 [1][2]。",
    sectionTitle: "市场格局分析",
    topicName: "AI 行业研究",
    language: "zh",
  };

  // ==================== evaluateSection ====================

  describe("evaluateSection", () => {
    it("returns overallOk=true when all scores >= 7", async () => {
      mockChat.mockResolvedValue({
        content:
          '{"analytical_depth":8,"evidence_coverage":7,"actionability":9,"writing_quality":7}',
      });

      const result = await service.evaluateSection(defaultInput);

      expect(result.overallOk).toBe(true);
      expect(result.weakAreas).toEqual([]);
      expect(result.scores.analytical_depth).toBe(8);
      expect(result.scores.evidence_coverage).toBe(7);
      expect(result.scores.actionability).toBe(9);
      expect(result.scores.writing_quality).toBe(7);
    });

    it("identifies weakAreas when scores < 7", async () => {
      mockChat.mockResolvedValue({
        content:
          '{"analytical_depth":5,"evidence_coverage":4,"actionability":8,"writing_quality":6}',
      });

      const result = await service.evaluateSection(defaultInput);

      expect(result.overallOk).toBe(false);
      expect(result.weakAreas).toEqual(
        expect.arrayContaining([
          "analytical_depth",
          "evidence_coverage",
          "writing_quality",
        ]),
      );
      expect(result.weakAreas).not.toContain("actionability");
    });

    it("handles markdown-wrapped JSON response", async () => {
      mockChat.mockResolvedValue({
        content:
          '```json\n{"analytical_depth":6,"evidence_coverage":8,"actionability":7,"writing_quality":9}\n```',
      });

      const result = await service.evaluateSection(defaultInput);

      expect(result.scores.analytical_depth).toBe(6);
      expect(result.weakAreas).toContain("analytical_depth");
    });

    it("falls back to defaults on invalid JSON", async () => {
      mockChat.mockResolvedValue({
        content: "I cannot evaluate this content properly.",
      });

      const result = await service.evaluateSection(defaultInput);

      // All default to 7 → overallOk
      expect(result.overallOk).toBe(true);
      expect(result.scores.analytical_depth).toBe(7);
    });

    it("fail-open on LLM exception — returns all 7s", async () => {
      mockChat.mockRejectedValue(new Error("API rate limit"));

      const result = await service.evaluateSection(defaultInput);

      expect(result.overallOk).toBe(true);
      expect(result.weakAreas).toEqual([]);
      expect(result.scores).toEqual({
        analytical_depth: 7,
        evidence_coverage: 7,
        actionability: 7,
        writing_quality: 7,
      });
    });

    it("clamps out-of-range scores to defaults", async () => {
      mockChat.mockResolvedValue({
        content:
          '{"analytical_depth":0,"evidence_coverage":11,"actionability":"high","writing_quality":5}',
      });

      const result = await service.evaluateSection(defaultInput);

      // 0 and 11 are out of [1,10] → default 7; "high" is not number → default 7
      expect(result.scores.analytical_depth).toBe(7); // 0 < 1 → default
      expect(result.scores.evidence_coverage).toBe(7); // 11 > 10 → default
      expect(result.scores.actionability).toBe(7); // string → default
      expect(result.scores.writing_quality).toBe(5); // valid
    });

    it("rounds float scores to integers", async () => {
      mockChat.mockResolvedValue({
        content:
          '{"analytical_depth":7.6,"evidence_coverage":5.3,"actionability":8.9,"writing_quality":6.1}',
      });

      const result = await service.evaluateSection(defaultInput);

      expect(result.scores.analytical_depth).toBe(8);
      expect(result.scores.evidence_coverage).toBe(5);
      expect(result.scores.actionability).toBe(9);
      expect(result.scores.writing_quality).toBe(6);
    });

    it("uses English prompt for en language", async () => {
      mockChat.mockResolvedValue({
        content:
          '{"analytical_depth":8,"evidence_coverage":7,"actionability":7,"writing_quality":8}',
      });

      await service.evaluateSection({ ...defaultInput, language: "en" });

      const prompt = mockChat.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain("You are a report quality reviewer");
      expect(prompt).not.toContain("你是报告质量评审员");
    });

    it("uses Chinese prompt for zh language", async () => {
      mockChat.mockResolvedValue({
        content:
          '{"analytical_depth":8,"evidence_coverage":7,"actionability":7,"writing_quality":8}',
      });

      await service.evaluateSection(defaultInput);

      const prompt = mockChat.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain("你是报告质量评审员");
    });

    it("truncates content to 2000 chars", async () => {
      const longContent = "X".repeat(5000);
      mockChat.mockResolvedValue({
        content:
          '{"analytical_depth":7,"evidence_coverage":7,"actionability":7,"writing_quality":7}',
      });

      await service.evaluateSection({
        ...defaultInput,
        content: longContent,
      });

      const prompt = mockChat.mock.calls[0][0].messages[0].content;
      // Content in prompt should be truncated to 2000 chars
      const xCount = (prompt.match(/X/g) || []).length;
      expect(xCount).toBe(2000);
    });

    it("uses deterministic creativity and minimal outputLength", async () => {
      mockChat.mockResolvedValue({
        content:
          '{"analytical_depth":7,"evidence_coverage":7,"actionability":7,"writing_quality":7}',
      });

      await service.evaluateSection(defaultInput);

      expect(mockChat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: {
            creativity: "deterministic",
            outputLength: "minimal",
          },
          skipGuardrails: true,
        }),
      );
    });
  });

  // ==================== determineRemediationActions ====================

  describe("determineRemediationActions", () => {
    it("generates correct actions for weak areas", () => {
      const evalResult = {
        scores: {
          analytical_depth: 5,
          evidence_coverage: 4,
          actionability: 8,
          writing_quality: 6,
        },
        weakAreas: [
          "analytical_depth" as const,
          "evidence_coverage" as const,
          "writing_quality" as const,
        ],
        overallOk: false,
      };

      const actions = service.determineRemediationActions(evalResult, 7, "zh");

      expect(actions).toHaveLength(3);

      const depthAction = actions.find(
        (a) => a.dimension === "analytical_depth",
      );
      expect(depthAction).toBeDefined();
      expect(depthAction!.type).toBe("deepen_analysis");
      expect(depthAction!.score).toBe(5);
      expect(depthAction!.guidance).toContain("因果推理");

      const evidenceAction = actions.find(
        (a) => a.dimension === "evidence_coverage",
      );
      expect(evidenceAction).toBeDefined();
      expect(evidenceAction!.type).toBe("inject_evidence");

      const styleAction = actions.find(
        (a) => a.dimension === "writing_quality",
      );
      expect(styleAction).toBeDefined();
      expect(styleAction!.type).toBe("improve_style");
    });

    it("returns empty array when no weak areas", () => {
      const evalResult = {
        scores: {
          analytical_depth: 8,
          evidence_coverage: 9,
          actionability: 7,
          writing_quality: 8,
        },
        weakAreas: [],
        overallOk: true,
      };

      const actions = service.determineRemediationActions(evalResult);

      expect(actions).toEqual([]);
    });

    it("uses English guidance for en language", () => {
      const evalResult = {
        scores: {
          analytical_depth: 5,
          evidence_coverage: 7,
          actionability: 7,
          writing_quality: 7,
        },
        weakAreas: ["analytical_depth" as const],
        overallOk: false,
      };

      const actions = service.determineRemediationActions(evalResult, 7, "en");

      expect(actions[0].guidance).toContain("causal reasoning");
    });

    it("maps all 4 dimensions to correct action types", () => {
      const evalResult = {
        scores: {
          analytical_depth: 3,
          evidence_coverage: 3,
          actionability: 3,
          writing_quality: 3,
        },
        weakAreas: [
          "analytical_depth" as const,
          "evidence_coverage" as const,
          "actionability" as const,
          "writing_quality" as const,
        ],
        overallOk: false,
      };

      const actions = service.determineRemediationActions(evalResult);

      const typeMap = Object.fromEntries(
        actions.map((a) => [a.dimension, a.type]),
      );
      expect(typeMap).toEqual({
        analytical_depth: "deepen_analysis",
        evidence_coverage: "inject_evidence",
        actionability: "add_recommendations",
        writing_quality: "improve_style",
      });
    });
  });
});
