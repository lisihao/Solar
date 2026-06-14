import { AIModelType } from "@prisma/client";
import {
  resolveEffectiveModelType,
  normalizeDowngradePolicy,
  DEFAULT_DOWNGRADE_POLICY,
} from "../model-policy";

describe("model-policy · resolveEffectiveModelType", () => {
  describe("default policy", () => {
    it("default policy is quality-first", () => {
      expect(DEFAULT_DOWNGRADE_POLICY).toBe("quality-first");
    });

    it("uses quality-first when policy omitted", () => {
      // CHAT_FAST → CHAT under the default (quality-first)
      expect(resolveEffectiveModelType(AIModelType.CHAT_FAST)).toBe(
        AIModelType.CHAT,
      );
    });
  });

  describe("quality-first", () => {
    it("collapses CHAT_FAST → CHAT (the grok-3-mini fix)", () => {
      expect(
        resolveEffectiveModelType(AIModelType.CHAT_FAST, "quality-first"),
      ).toBe(AIModelType.CHAT);
    });

    it("keeps CHAT as-is", () => {
      expect(resolveEffectiveModelType(AIModelType.CHAT, "quality-first")).toBe(
        AIModelType.CHAT,
      );
    });

    it("keeps EVALUATOR (consensus de-correlation is not a cost downgrade)", () => {
      expect(
        resolveEffectiveModelType(AIModelType.EVALUATOR, "quality-first"),
      ).toBe(AIModelType.EVALUATOR);
    });
  });

  describe("cost-first", () => {
    it("keeps CHAT_FAST as requested (preserve existing cost behavior)", () => {
      expect(
        resolveEffectiveModelType(AIModelType.CHAT_FAST, "cost-first"),
      ).toBe(AIModelType.CHAT_FAST);
    });
  });

  describe("single-model", () => {
    it("collapses CHAT_FAST → CHAT", () => {
      expect(
        resolveEffectiveModelType(AIModelType.CHAT_FAST, "single-model"),
      ).toBe(AIModelType.CHAT);
    });

    it("collapses EVALUATOR → CHAT (primary governs everything chat-ish)", () => {
      expect(
        resolveEffectiveModelType(AIModelType.EVALUATOR, "single-model"),
      ).toBe(AIModelType.CHAT);
    });
  });

  describe("orthogonal capabilities never collapse", () => {
    const orthogonal: AIModelType[] = [
      AIModelType.EMBEDDING,
      AIModelType.RERANK,
      AIModelType.IMAGE_GENERATION,
      AIModelType.IMAGE_EDITING,
      AIModelType.CODE,
      AIModelType.MULTIMODAL,
    ];
    const policies = ["quality-first", "cost-first", "single-model"] as const;
    for (const type of orthogonal) {
      for (const policy of policies) {
        it(`${type} stays ${type} under ${policy}`, () => {
          expect(resolveEffectiveModelType(type, policy)).toBe(type);
        });
      }
    }
  });

  describe("normalizeDowngradePolicy", () => {
    it("passes through valid policies", () => {
      expect(normalizeDowngradePolicy("quality-first")).toBe("quality-first");
      expect(normalizeDowngradePolicy("cost-first")).toBe("cost-first");
      expect(normalizeDowngradePolicy("single-model")).toBe("single-model");
    });

    it("falls back to default on invalid / empty input", () => {
      expect(normalizeDowngradePolicy("")).toBe(DEFAULT_DOWNGRADE_POLICY);
      expect(normalizeDowngradePolicy(undefined)).toBe(
        DEFAULT_DOWNGRADE_POLICY,
      );
      expect(normalizeDowngradePolicy("garbage")).toBe(
        DEFAULT_DOWNGRADE_POLICY,
      );
    });
  });
});
