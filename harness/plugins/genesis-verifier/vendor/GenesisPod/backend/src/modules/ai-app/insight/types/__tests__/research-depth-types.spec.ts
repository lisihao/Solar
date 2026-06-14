import { describe, it, expect } from "@jest/globals";
import { resolveResearchDepthConfig } from "../research-depth.types";
import { buildValidationContextForWriting } from "../../prompts/research-depth.prompt";

describe("V5 Research Types", () => {
  describe("resolveResearchDepthConfig", () => {
    it("quick → knowledgeIterations=1, all flags false", () => {
      const config = resolveResearchDepthConfig("quick");
      expect(config.knowledgeIterations).toBe(1);
      expect(config.crossValidationEnabled).toBe(false);
      expect(config.hypothesisTestingEnabled).toBe(false);
      expect(config.factCheckEnabled).toBe(false);
      expect(config.literatureBaselineEnabled).toBe(false);
      expect(config.maxCognitiveLoops).toBe(0);
      expect(config.maxRevisionRounds).toBe(0);
    });

    it("standard → knowledgeIterations=2, crossValidation+hypothesisTesting true, factCheck false", () => {
      const config = resolveResearchDepthConfig("standard");
      expect(config.knowledgeIterations).toBe(2);
      expect(config.crossValidationEnabled).toBe(true);
      expect(config.hypothesisTestingEnabled).toBe(true);
      expect(config.factCheckEnabled).toBe(false);
      expect(config.literatureBaselineEnabled).toBe(true);
    });

    it("thorough → knowledgeIterations=3, all flags true", () => {
      const config = resolveResearchDepthConfig("thorough");
      expect(config.knowledgeIterations).toBe(3);
      expect(config.crossValidationEnabled).toBe(true);
      expect(config.hypothesisTestingEnabled).toBe(true);
      expect(config.factCheckEnabled).toBe(true);
      expect(config.literatureBaselineEnabled).toBe(true);
    });
  });

  describe("buildValidationContextForWriting", () => {
    it("should include disputed/unverified claims in output", () => {
      const result = buildValidationContextForWriting(
        [
          {
            claimId: "c1",
            status: "disputed",
            explanation: "conflicting data",
          },
          {
            claimId: "c2",
            status: "unverified",
            explanation: "no source found",
          },
          { claimId: "c3", status: "verified", explanation: "confirmed" },
        ],
        [
          { hypothesisId: "h1", status: "refuted" },
          {
            hypothesisId: "h2",
            status: "partially_supported",
            refinedStatement: "revised statement",
          },
        ],
      );
      expect(result).toContain("验证注意事项");
      expect(result).toContain("c1");
      expect(result).toContain("conflicting data");
      expect(result).toContain("c2");
      expect(result).toContain("假设验证结果");
      expect(result).toContain("h1");
      expect(result).toContain("h2");
      expect(result).toContain("revised statement");
    });

    it("should return empty string when no issues", () => {
      const result = buildValidationContextForWriting(
        [{ claimId: "c1", status: "verified", explanation: "ok" }],
        [{ hypothesisId: "h1", status: "supported" }],
      );
      expect(result).toBe("");
    });
  });
});
