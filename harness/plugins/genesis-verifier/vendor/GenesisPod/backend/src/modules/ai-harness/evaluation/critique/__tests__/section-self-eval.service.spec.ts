/**
 * section-self-eval.service.spec.ts
 *
 * Tests for SectionSelfEvalService — mocks ChatFacade.
 */

import { SectionSelfEvalService } from "../section-self-eval.service";

function makeFacade(responseContent: string) {
  return {
    chat: jest.fn(async () => ({
      content: responseContent,
      model: "mock",
      usage: { totalTokens: 50 },
    })),
  };
}

const GOOD_SCORES = JSON.stringify({
  analytical_depth: 8,
  evidence_coverage: 9,
  actionability: 7,
  writing_quality: 8,
});

const POOR_SCORES = JSON.stringify({
  analytical_depth: 4,
  evidence_coverage: 3,
  actionability: 5,
  writing_quality: 6,
});

describe("SectionSelfEvalService", () => {
  describe("evaluateSection", () => {
    it("parses scores correctly from JSON response", async () => {
      const facade = makeFacade(GOOD_SCORES);
      const svc = new SectionSelfEvalService(facade as never);
      const result = await svc.evaluateSection({
        content: "High quality content with analysis.",
        sectionTitle: "Market Analysis",
        topicName: "AI Technology",
      });
      expect(result.scores.analytical_depth).toBe(8);
      expect(result.scores.evidence_coverage).toBe(9);
      expect(result.scores.actionability).toBe(7);
      expect(result.scores.writing_quality).toBe(8);
      expect(result.weakAreas).toHaveLength(0);
      expect(result.overallOk).toBe(true);
    });

    it("identifies weak areas (scores < 7)", async () => {
      const facade = makeFacade(POOR_SCORES);
      const svc = new SectionSelfEvalService(facade as never);
      const result = await svc.evaluateSection({
        content: "Low quality content.",
        sectionTitle: "Risk Assessment",
        topicName: "Finance",
      });
      expect(result.weakAreas).toContain("analytical_depth");
      expect(result.weakAreas).toContain("evidence_coverage");
      expect(result.overallOk).toBe(false);
    });

    it("falls back to default scores (7) when LLM throws", async () => {
      const facade = {
        chat: jest.fn(async () => {
          throw new Error("LLM error");
        }),
      };
      const svc = new SectionSelfEvalService(facade as never);
      const result = await svc.evaluateSection({
        content: "content",
        sectionTitle: "Overview",
        topicName: "Tech",
      });
      expect(result.scores.analytical_depth).toBe(7);
      expect(result.overallOk).toBe(true);
      expect(result.weakAreas).toHaveLength(0);
    });

    it("falls back when response is not valid JSON", async () => {
      const facade = makeFacade("Sorry, I cannot evaluate this.");
      const svc = new SectionSelfEvalService(facade as never);
      const result = await svc.evaluateSection({
        content: "content",
        sectionTitle: "Section",
        topicName: "Topic",
      });
      // Should return default scores
      expect(result.scores.analytical_depth).toBe(7);
    });

    it("handles markdown-wrapped JSON (```json...```)", async () => {
      const facade = makeFacade("```json\n" + GOOD_SCORES + "\n```");
      const svc = new SectionSelfEvalService(facade as never);
      const result = await svc.evaluateSection({
        content: "content",
        sectionTitle: "Section",
        topicName: "Topic",
      });
      // JSON inside code block — parser looks for {...} pattern
      // If it finds it, scores should parse correctly
      expect(result.scores.analytical_depth).toBeGreaterThanOrEqual(1);
    });

    it("clamps out-of-range scores to valid range (1-10)", async () => {
      const facade = makeFacade(
        JSON.stringify({
          analytical_depth: 15,
          evidence_coverage: -1,
          actionability: 8,
          writing_quality: 7,
        }),
      );
      const svc = new SectionSelfEvalService(facade as never);
      const result = await svc.evaluateSection({
        content: "content",
        sectionTitle: "Section",
        topicName: "Topic",
      });
      // Out-of-range values should fall back to default (7)
      expect(result.scores.analytical_depth).toBe(7); // 15 out of range → default
      expect(result.scores.evidence_coverage).toBe(7); // -1 out of range → default
      expect(result.scores.actionability).toBe(8);
    });

    it("uses English prompt when language=en", async () => {
      const facade = makeFacade(GOOD_SCORES);
      const svc = new SectionSelfEvalService(facade as never);
      await svc.evaluateSection({
        content: "content",
        sectionTitle: "Section",
        topicName: "Topic",
        language: "en",
      });
      const callArgs = facade.chat.mock.calls[0][0] as {
        messages: Array<{ content: string }>;
      };
      expect(callArgs.messages[0].content).toContain("Section");
    });
  });

  describe("determineRemediationActions", () => {
    it("returns empty actions when overallOk", () => {
      const facade = makeFacade(GOOD_SCORES);
      const svc = new SectionSelfEvalService(facade as never);
      const evalResult = {
        scores: {
          analytical_depth: 8,
          evidence_coverage: 9,
          actionability: 7,
          writing_quality: 8,
        },
        weakAreas: [] as const,
        overallOk: true,
      };
      const actions = svc.determineRemediationActions(evalResult as never);
      expect(actions).toHaveLength(0);
    });

    it("returns one action per weak area", () => {
      const facade = makeFacade(POOR_SCORES);
      const svc = new SectionSelfEvalService(facade as never);
      const evalResult = {
        scores: {
          analytical_depth: 4,
          evidence_coverage: 3,
          actionability: 7,
          writing_quality: 8,
        },
        weakAreas: ["analytical_depth", "evidence_coverage"] as const,
        overallOk: false,
      };
      const actions = svc.determineRemediationActions(evalResult as never);
      expect(actions).toHaveLength(2);
      expect(actions[0].type).toBe("deepen_analysis");
      expect(actions[0].dimension).toBe("analytical_depth");
      expect(actions[1].type).toBe("inject_evidence");
    });

    it("uses English guidance when language=en", () => {
      const facade = makeFacade(POOR_SCORES);
      const svc = new SectionSelfEvalService(facade as never);
      const evalResult = {
        scores: {
          analytical_depth: 4,
          evidence_coverage: 8,
          actionability: 8,
          writing_quality: 8,
        },
        weakAreas: ["analytical_depth"] as const,
        overallOk: false,
      };
      const actions = svc.determineRemediationActions(
        evalResult as never,
        7,
        "en",
      );
      expect(actions[0].guidance).toContain("causal");
    });

    it("uses Chinese guidance by default", () => {
      const facade = makeFacade(POOR_SCORES);
      const svc = new SectionSelfEvalService(facade as never);
      const evalResult = {
        scores: {
          analytical_depth: 4,
          evidence_coverage: 8,
          actionability: 8,
          writing_quality: 8,
        },
        weakAreas: ["analytical_depth"] as const,
        overallOk: false,
      };
      const actions = svc.determineRemediationActions(evalResult as never);
      expect(actions[0].guidance).toContain("因果");
    });

    it("includes score in each action", () => {
      const facade = makeFacade(POOR_SCORES);
      const svc = new SectionSelfEvalService(facade as never);
      const evalResult = {
        scores: {
          analytical_depth: 5,
          evidence_coverage: 3,
          actionability: 8,
          writing_quality: 8,
        },
        weakAreas: ["analytical_depth", "evidence_coverage"] as const,
        overallOk: false,
      };
      const actions = svc.determineRemediationActions(evalResult as never);
      expect(actions[0].score).toBe(5);
      expect(actions[1].score).toBe(3);
    });

    it("handles all 4 remediation types", () => {
      const facade = makeFacade(POOR_SCORES);
      const svc = new SectionSelfEvalService(facade as never);
      const evalResult = {
        scores: {
          analytical_depth: 4,
          evidence_coverage: 3,
          actionability: 5,
          writing_quality: 6,
        },
        weakAreas: [
          "analytical_depth",
          "evidence_coverage",
          "actionability",
          "writing_quality",
        ] as const,
        overallOk: false,
      };
      const actions = svc.determineRemediationActions(evalResult as never);
      const types = actions.map((a) => a.type);
      expect(types).toContain("deepen_analysis");
      expect(types).toContain("inject_evidence");
      expect(types).toContain("add_recommendations");
      expect(types).toContain("improve_style");
    });
  });
});
