/**
 * Prompt Adaptation Config Tests
 *
 * 覆盖分支：
 * 1. TIER_ADAPTATIONS 完整性 — 3 个 tier 都有配置
 * 2. STRONG — 非空 suffix，不限证据
 * 3. STANDARD — 空 suffix（基线行为），不限证据
 * 4. BASIC — 非空 suffix，限制 8 条证据
 * 5. taskProfile 值正确性
 * 6. 与 section-writer 集成：证据截断行为仿真
 */

import { TIER_ADAPTATIONS } from "../prompt-adaptation.config";
import { ModelTier, classifyModelTier } from "../model-tier.config";

describe("TIER_ADAPTATIONS", () => {
  it("defines adaptations for all 3 tiers", () => {
    expect(TIER_ADAPTATIONS[ModelTier.STRONG]).toBeDefined();
    expect(TIER_ADAPTATIONS[ModelTier.STANDARD]).toBeDefined();
    expect(TIER_ADAPTATIONS[ModelTier.BASIC]).toBeDefined();
  });

  // ==================== STRONG ====================

  describe("STRONG tier", () => {
    const adaptation = TIER_ADAPTATIONS[ModelTier.STRONG];

    it("has non-empty promptSuffix with analysis guidance", () => {
      expect(adaptation.promptSuffix.length).toBeGreaterThan(0);
      expect(adaptation.promptSuffix).toContain("高级分析模式");
      expect(adaptation.promptSuffix).toContain("跨来源综合推理");
    });

    it("does not limit evidence items", () => {
      expect(adaptation.maxEvidenceItems).toBe(0);
    });

    it("uses medium creativity and long output", () => {
      expect(adaptation.taskProfile).toEqual({
        creativity: "medium",
        outputLength: "long",
      });
    });
  });

  // ==================== STANDARD ====================

  describe("STANDARD tier", () => {
    const adaptation = TIER_ADAPTATIONS[ModelTier.STANDARD];

    it("has empty promptSuffix (baseline behavior)", () => {
      expect(adaptation.promptSuffix).toBe("");
    });

    it("does not limit evidence items", () => {
      expect(adaptation.maxEvidenceItems).toBe(0);
    });

    it("uses same taskProfile as original hardcoded values", () => {
      // ★ 关键：STANDARD 必须等于原始硬编码值，确保零回归
      expect(adaptation.taskProfile).toEqual({
        creativity: "medium",
        outputLength: "long",
      });
    });
  });

  // ==================== BASIC ====================

  describe("BASIC tier", () => {
    const adaptation = TIER_ADAPTATIONS[ModelTier.BASIC];

    it("has non-empty promptSuffix with structured guidance", () => {
      expect(adaptation.promptSuffix.length).toBeGreaterThan(0);
      expect(adaptation.promptSuffix).toContain("结构化写作模式");
      expect(adaptation.promptSuffix).toContain("每段只阐述一个核心观点");
    });

    it("limits evidence to 8 items", () => {
      expect(adaptation.maxEvidenceItems).toBe(8);
    });

    it("uses low creativity", () => {
      expect(adaptation.taskProfile.creativity).toBe("low");
    });
  });

  // ==================== Evidence Truncation Simulation ====================

  describe("evidence truncation simulation", () => {
    it("BASIC tier truncates evidence beyond maxEvidenceItems", () => {
      const evidenceData = Array.from({ length: 15 }, (_, i) => ({
        id: `e-${i}`,
        content: `Evidence item ${i}`,
      }));

      const tier = classifyModelTier("unknown-model"); // BASIC
      const adaptation = TIER_ADAPTATIONS[tier];

      const effectiveEvidence =
        adaptation.maxEvidenceItems > 0 &&
        evidenceData.length > adaptation.maxEvidenceItems
          ? evidenceData.slice(0, adaptation.maxEvidenceItems)
          : evidenceData;

      expect(effectiveEvidence).toHaveLength(8);
      expect(effectiveEvidence[0].id).toBe("e-0");
      expect(effectiveEvidence[7].id).toBe("e-7");
    });

    it("STRONG tier does not truncate evidence", () => {
      const evidenceData = Array.from({ length: 20 }, (_, i) => ({
        id: `e-${i}`,
      }));

      const tier = classifyModelTier("gpt-4o"); // STRONG
      const adaptation = TIER_ADAPTATIONS[tier];

      const effectiveEvidence =
        adaptation.maxEvidenceItems > 0 &&
        evidenceData.length > adaptation.maxEvidenceItems
          ? evidenceData.slice(0, adaptation.maxEvidenceItems)
          : evidenceData;

      expect(effectiveEvidence).toHaveLength(20);
    });

    it("BASIC tier with fewer items than limit does not truncate", () => {
      const evidenceData = Array.from({ length: 5 }, (_, i) => ({
        id: `e-${i}`,
      }));

      const tier = classifyModelTier("unknown"); // BASIC
      const adaptation = TIER_ADAPTATIONS[tier];

      const effectiveEvidence =
        adaptation.maxEvidenceItems > 0 &&
        evidenceData.length > adaptation.maxEvidenceItems
          ? evidenceData.slice(0, adaptation.maxEvidenceItems)
          : evidenceData;

      expect(effectiveEvidence).toHaveLength(5);
    });
  });
});


