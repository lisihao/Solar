import {
  SOCIAL_PIPELINE,
  SOCIAL_FAST_PIPELINE,
  selectSocialPipeline,
} from "../social.config";

describe("social.config", () => {
  describe("SOCIAL_PIPELINE (standard 13 stage)", () => {
    it("has stable id and 12 steps in pipeline (s12 is fire-and-forget postlude)", () => {
      expect(SOCIAL_PIPELINE.id).toBe("social-publish-mission");
      expect(SOCIAL_PIPELINE.steps.length).toBe(12);
    });

    it("starts with s1-mission-budget-eval and ends with s11-mission-persist", () => {
      expect(SOCIAL_PIPELINE.steps[0].id).toBe("s1-mission-budget-eval");
      expect(SOCIAL_PIPELINE.steps[SOCIAL_PIPELINE.steps.length - 1].id).toBe(
        "s11-mission-persist",
      );
    });

    it("includes s8b-publish-retry between s8 and s9 (standard retry path)", () => {
      const ids = SOCIAL_PIPELINE.steps.map((s) => s.id);
      const s8Idx = ids.indexOf("s8-publish-execute");
      const s8bIdx = ids.indexOf("s8b-publish-retry");
      const s9Idx = ids.indexOf("s9-publish-verify");
      expect(s8Idx).toBeGreaterThanOrEqual(0);
      expect(s8bIdx).toBeGreaterThan(s8Idx);
      expect(s9Idx).toBeGreaterThan(s8bIdx);
    });

    it("uses persist primitive for all 12 stages", () => {
      for (const step of SOCIAL_PIPELINE.steps) {
        expect(step.primitive).toBe("persist");
      }
    });
  });

  describe("SOCIAL_FAST_PIPELINE (fast-track 4 stage)", () => {
    it("has distinct id from standard pipeline", () => {
      expect(SOCIAL_FAST_PIPELINE.id).toBe("social-publish-mission-fast");
      expect(SOCIAL_FAST_PIPELINE.id).not.toBe(SOCIAL_PIPELINE.id);
    });

    it("has exactly 4 steps (s1 + s8 + s9 + s11)", () => {
      const ids = SOCIAL_FAST_PIPELINE.steps.map((s) => s.id);
      expect(ids).toEqual([
        "s1-mission-budget-eval",
        "s8-publish-execute",
        "s9-publish-verify",
        "s11-mission-persist",
      ]);
    });

    it("skips s8b-publish-retry (no retry for quick depth)", () => {
      const ids = SOCIAL_FAST_PIPELINE.steps.map((s) => s.id);
      expect(ids).not.toContain("s8b-publish-retry");
    });

    it("skips AI rewrite stages s2-s7 entirely (省 ~90% LLM cost)", () => {
      const ids = SOCIAL_FAST_PIPELINE.steps.map((s) => s.id);
      expect(ids).not.toContain("s2-platform-probe");
      expect(ids).not.toContain("s3-content-transform");
      expect(ids).not.toContain("s4-leader-assess-transform");
      expect(ids).not.toContain("s5-cover-craft");
      expect(ids).not.toContain("s6-body-compose");
      expect(ids).not.toContain("s7-polish-review");
    });

    it("preserves s1 Steward budget gate (省钱不省守护)", () => {
      const s1 = SOCIAL_FAST_PIPELINE.steps[0];
      expect(s1.id).toBe("s1-mission-budget-eval");
    });

    it("preserves s9 publish-verify (省时不省验证)", () => {
      const ids = SOCIAL_FAST_PIPELINE.steps.map((s) => s.id);
      expect(ids).toContain("s9-publish-verify");
    });

    it("uses persist primitive for all 4 stages", () => {
      for (const step of SOCIAL_FAST_PIPELINE.steps) {
        expect(step.primitive).toBe("persist");
      }
    });

    it("declares distinct runtimeVersion vs standard pipeline", () => {
      expect(SOCIAL_FAST_PIPELINE.meta?.runtimeVersion).toBe(
        "social-pipeline-fast-v1",
      );
      expect(SOCIAL_FAST_PIPELINE.meta?.runtimeVersion).not.toBe(
        SOCIAL_PIPELINE.meta?.runtimeVersion,
      );
    });

    it("shares social event prefix with standard pipeline", () => {
      expect(SOCIAL_FAST_PIPELINE.meta?.eventPrefix).toBe("social");
      expect(SOCIAL_FAST_PIPELINE.meta?.eventPrefix).toBe(
        SOCIAL_PIPELINE.meta?.eventPrefix,
      );
    });
  });

  describe("selectSocialPipeline", () => {
    it("returns SOCIAL_FAST_PIPELINE for depth=quick", () => {
      const pipeline = selectSocialPipeline("quick");
      expect(pipeline.id).toBe(SOCIAL_FAST_PIPELINE.id);
    });

    it("returns SOCIAL_PIPELINE for depth=standard", () => {
      const pipeline = selectSocialPipeline("standard");
      expect(pipeline.id).toBe(SOCIAL_PIPELINE.id);
    });

    it("returns SOCIAL_PIPELINE for depth=deep", () => {
      const pipeline = selectSocialPipeline("deep");
      expect(pipeline.id).toBe(SOCIAL_PIPELINE.id);
    });

    it("returns distinct pipeline objects for quick vs non-quick", () => {
      const quickPipeline = selectSocialPipeline("quick");
      const standardPipeline = selectSocialPipeline("standard");
      const deepPipeline = selectSocialPipeline("deep");
      expect(quickPipeline.id).not.toBe(standardPipeline.id);
      expect(standardPipeline.id).toBe(deepPipeline.id);
    });
  });
});
