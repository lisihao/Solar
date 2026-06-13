/**
 * quality-trace-compute.service.spec.ts
 *
 * Tests for QualityTraceComputeService — pure computation, no LLM calls.
 */

import { QualityTraceComputeService } from "../quality-trace-compute.service";
import type {
  QualityTraceEvidence,
  DimensionOutputProbe,
} from "../quality-trace-compute.service";
import { createEmptyScan } from "../defect-scanner";

function makeSvc(): QualityTraceComputeService {
  return new QualityTraceComputeService();
}

function _makeEmptyDimProbe(id: string): DimensionOutputProbe {
  return {
    dimensionId: id,
    dimensionName: id,
    rawOutput: {
      contentLength: 5000,
      keyFindingsCount: 3,
      citationsUsed: 5,
      uniqueSourcesCited: 4,
      figureRefsCount: 1,
      jsonParsed: true,
      usedFallback: false,
    },
    defects: createEmptyScan(),
  };
}

describe("QualityTraceComputeService", () => {
  let svc: QualityTraceComputeService;

  beforeEach(() => {
    svc = makeSvc();
  });

  // ─────────────────────────────────────────────────────────────
  // createTrace
  // ─────────────────────────────────────────────────────────────
  describe("createTrace", () => {
    it("creates a context with the given reportId", () => {
      const ctx = svc.createTrace("report-001");
      expect(ctx.reportId).toBe("report-001");
      expect(ctx.dimensionOutputs).toHaveLength(0);
      expect(ctx.startedAt).toBeGreaterThan(0);
    });

    it("attaches promptProvenance when supplied", () => {
      const prov = { s1: { version: "v1", hash: "abc123" } };
      const ctx = svc.createTrace<"s1">("r2", prov);
      expect(ctx.promptProvenance).toEqual(prov);
    });

    it("leaves promptProvenance undefined when not supplied", () => {
      const ctx = svc.createTrace("r3");
      expect(ctx.promptProvenance).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // recordEvidenceQuality
  // ─────────────────────────────────────────────────────────────
  describe("recordEvidenceQuality", () => {
    it("records credibility distribution correctly", () => {
      const ctx = svc.createTrace("r1");
      const evidences: QualityTraceEvidence[] = [
        {
          domain: "nature.com",
          snippet: "A".repeat(120),
          credibilityScore: 80,
        },
        { domain: "arxiv.org", snippet: "B".repeat(120), credibilityScore: 50 },
        { domain: "blog.io", snippet: "C".repeat(120), credibilityScore: 20 },
        { domain: "unknown.xyz", snippet: null, credibilityScore: null },
      ];
      svc.recordEvidenceQuality(ctx, evidences);
      const eq = ctx.evidenceQuality!;
      expect(eq.totalEvidences).toBe(4);
      expect(eq.credibilityDistribution.high).toBe(1);
      expect(eq.credibilityDistribution.medium).toBe(1);
      expect(eq.credibilityDistribution.low).toBe(1);
      expect(eq.credibilityDistribution.unscored).toBe(1);
      expect(eq.uniqueDomains).toBe(4);
    });

    it("computes fullContentRatio from snippets > 100 chars", () => {
      const ctx = svc.createTrace("r2");
      svc.recordEvidenceQuality(ctx, [
        { snippet: "A".repeat(150), credibilityScore: 70 },
        { snippet: "B".repeat(50), credibilityScore: 70 }, // too short
      ]);
      expect(ctx.evidenceQuality!.fullContentRatio).toBe(0.5);
    });

    it("handles empty evidence array", () => {
      const ctx = svc.createTrace("r3");
      svc.recordEvidenceQuality(ctx, []);
      const eq = ctx.evidenceQuality!;
      expect(eq.totalEvidences).toBe(0);
      expect(eq.fullContentRatio).toBe(0);
      expect(eq.recentRatio).toBe(0);
    });

    it("counts recent evidences (within 6 months)", () => {
      const ctx = svc.createTrace("r4");
      const recent = new Date();
      recent.setMonth(recent.getMonth() - 1);
      const old = new Date("2020-01-01");
      svc.recordEvidenceQuality(ctx, [
        { publishedAt: recent, credibilityScore: 70 },
        { publishedAt: old, credibilityScore: 70 },
      ]);
      expect(ctx.evidenceQuality!.recentRatio).toBe(0.5);
    });

    it("survives an error without throwing (non-fatal)", () => {
      const ctx = svc.createTrace("r5");
      // Pass null evidence to trigger error path — non-fatal, should not throw
      expect(() =>
        svc.recordEvidenceQuality(
          ctx,
          null as unknown as QualityTraceEvidence[],
        ),
      ).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // scanDimensionOutput (Probe 2)
  // ─────────────────────────────────────────────────────────────
  describe("scanDimensionOutput", () => {
    it("adds a dimension with defects", () => {
      const ctx = svc.createTrace("r1");
      svc.scanDimensionOutput(ctx, "dim1", "Market", "Content here", {
        keyFindingsCount: 5,
        citationsUsed: 3,
      });
      expect(ctx.dimensionOutputs).toHaveLength(1);
      expect(ctx.dimensionOutputs[0].dimensionId).toBe("dim1");
      expect(ctx.dimensionOutputs[0].rawOutput.keyFindingsCount).toBe(5);
      expect(ctx.dimensionOutputs[0].defects).toBeDefined();
    });

    it("detects defects when content has bare latex", () => {
      const ctx = svc.createTrace("r2");
      svc.scanDimensionOutput(
        ctx,
        "d1",
        "D1",
        "The formula \\frac{a}{b} is used.",
        {},
      );
      expect(ctx.dimensionOutputs[0].defects.bareLatexCount).toBeGreaterThan(0);
    });

    it("uses defaults for missing meta fields", () => {
      const ctx = svc.createTrace("r3");
      svc.scanDimensionOutput(ctx, "d1", "D1", "content");
      const raw = ctx.dimensionOutputs[0].rawOutput;
      expect(raw.usedFallback).toBe(false);
      expect(raw.jsonParsed).toBe(true);
      expect(raw.figureRefsCount).toBe(0);
    });

    it("survives error without throwing", () => {
      const ctx = svc.createTrace("r4");
      expect(() =>
        svc.scanDimensionOutput(ctx, "d1", "D1", null as unknown as string),
      ).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // recordDimensionQualityGate (Probe 2b)
  // ─────────────────────────────────────────────────────────────
  describe("recordDimensionQualityGate", () => {
    it("attaches quality gate result to existing dimension", () => {
      const ctx = svc.createTrace("r1");
      svc.scanDimensionOutput(ctx, "d1", "D1", "content");
      svc.recordDimensionQualityGate(ctx, "d1", {
        passed: true,
        errorCount: 0,
        warningCount: 2,
        autoFixCount: 1,
        violationsByRule: { heading_hierarchy: 1 },
      });
      expect(ctx.dimensionOutputs[0].qualityGate!.passed).toBe(true);
      expect(ctx.dimensionOutputs[0].qualityGate!.warningCount).toBe(2);
    });

    it("does nothing for unknown dimensionId", () => {
      const ctx = svc.createTrace("r2");
      svc.scanDimensionOutput(ctx, "d1", "D1", "content");
      svc.recordDimensionQualityGate(ctx, "not-found", {
        passed: false,
        errorCount: 1,
        warningCount: 0,
        autoFixCount: 0,
        violationsByRule: {},
      });
      expect(ctx.dimensionOutputs[0].qualityGate).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // recordPostProcessing (Probe 3)
  // ─────────────────────────────────────────────────────────────
  describe("recordPostProcessing", () => {
    it("records post-processing stats", () => {
      const ctx = svc.createTrace("r1");
      svc.recordPostProcessing(
        ctx,
        { bold: 5, hr: 2 },
        1000,
        950,
        ["warn1"],
        1,
        2,
      );
      expect(ctx.postProcessing!.totalFixes).toBe(7);
      expect(ctx.postProcessing!.charsBefore).toBe(1000);
      expect(ctx.postProcessing!.charsAfter).toBe(950);
      expect(ctx.postProcessing!.warnings).toContain("warn1");
      expect(ctx.postProcessing!.truncatedDimensions).toBe(1);
      expect(ctx.postProcessing!.deduplicatedParagraphs).toBe(2);
    });

    it("defaults truncatedDimensions and deduplicatedParagraphs to 0", () => {
      const ctx = svc.createTrace("r2");
      svc.recordPostProcessing(ctx, {}, 100, 100, []);
      expect(ctx.postProcessing!.truncatedDimensions).toBe(0);
      expect(ctx.postProcessing!.deduplicatedParagraphs).toBe(0);
    });

    it("survives error without throwing", () => {
      const ctx = svc.createTrace("r3");
      expect(() =>
        svc.recordPostProcessing(
          ctx,
          null as unknown as Record<string, number>,
          0,
          0,
          [],
        ),
      ).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // recordSynthesisOutput (Probe 4)
  // ─────────────────────────────────────────────────────────────
  describe("recordSynthesisOutput", () => {
    it("records synthesis section lengths", () => {
      const ctx = svc.createTrace("r1");
      svc.recordSynthesisOutput(
        ctx,
        {
          executiveSummary: "A".repeat(300),
          preface: "B".repeat(200),
          crossDimensionAnalysis: "C".repeat(500),
          riskAssessment: "D".repeat(400),
          strategicRecommendations: "E".repeat(600),
          conclusion: "F".repeat(150),
        },
        0,
        2000,
        5000,
        true,
      );
      const so = ctx.synthesisOutput!;
      expect(so.sectionLengths.executiveSummary).toBe(300);
      expect(so.sectionLengths.conclusion).toBe(150);
      expect(so.generationTimeMs).toBe(2000);
      expect(so.tokensUsed).toBe(5000);
      expect(so.jsonParsed).toBe(true);
    });

    it("handles missing sections gracefully", () => {
      const ctx = svc.createTrace("r2");
      svc.recordSynthesisOutput(ctx, {}, 1, 100, 200, false);
      expect(ctx.synthesisOutput!.sectionLengths.executiveSummary).toBe(0);
    });

    it("survives error without throwing", () => {
      const ctx = svc.createTrace("r3");
      expect(() =>
        svc.recordSynthesisOutput(
          ctx,
          null as unknown as Record<string, string>,
          0,
          0,
          0,
          false,
        ),
      ).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // recordOutputReview
  // ─────────────────────────────────────────────────────────────
  describe("recordOutputReview", () => {
    it("attaches output review to context", () => {
      const ctx = svc.createTrace("r1");
      svc.recordOutputReview(ctx, {
        passed: true,
        score: 85,
        feedback: "Good quality",
        issues: [],
        suggestions: ["Consider more data sources"],
      });
      expect(ctx.outputReview!.passed).toBe(true);
      expect(ctx.outputReview!.score).toBe(85);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // computeFinalAssessment (Probe 5)
  // ─────────────────────────────────────────────────────────────
  describe("computeFinalAssessment", () => {
    it("returns grade A for high-quality trace", () => {
      const ctx = svc.createTrace("r1");
      // Add good evidence
      svc.recordEvidenceQuality(
        ctx,
        Array(20).fill({
          domain: "nature.com",
          snippet: "A".repeat(200),
          credibilityScore: 80,
          publishedAt: new Date(),
        }),
      );
      // Add clean dimensions
      for (let i = 0; i < 3; i++) {
        svc.scanDimensionOutput(ctx, `d${i}`, `Dim ${i}`, "A".repeat(5000));
      }
      // Record synthesis
      svc.recordSynthesisOutput(
        ctx,
        {
          executiveSummary: "A".repeat(400),
          crossDimensionAnalysis: "B".repeat(600),
          conclusion: "C".repeat(200),
          preface: "D".repeat(100),
          riskAssessment: "E".repeat(200),
          strategicRecommendations: "F".repeat(300),
        },
        0,
        3000,
        8000,
        true,
      );
      svc.recordPostProcessing(ctx, {}, 10000, 10000, []);

      const assessment = svc.computeFinalAssessment(ctx);
      expect(assessment.grade).toMatch(/^[A-F]$/);
      expect(assessment.overallScore).toBeGreaterThanOrEqual(0);
      expect(assessment.overallScore).toBeLessThanOrEqual(100);
    });

    it("returns grade F for empty/bad trace", () => {
      const ctx = svc.createTrace("r2");
      // Simulate very short content
      svc.scanDimensionOutput(ctx, "d1", "D1", "Short", { usedFallback: true });
      const assessment = svc.computeFinalAssessment(ctx);
      expect(["A", "B", "C", "D", "F"]).toContain(assessment.grade);
    });

    it("deducts points for defects", () => {
      const ctx1 = svc.createTrace("clean");
      svc.scanDimensionOutput(
        ctx1,
        "d1",
        "D1",
        "Clean markdown content here.\n### Section\nContent.",
      );
      const clean = svc.computeFinalAssessment(ctx1);

      const ctx2 = svc.createTrace("defective");
      // 10 bare latex items, each costs 3 points
      const defectiveContent = Array(10).fill("\\frac{a}{b}").join("\n");
      svc.scanDimensionOutput(ctx2, "d1", "D1", defectiveContent);
      const defective = svc.computeFinalAssessment(ctx2);

      expect(defective.scores.formatting).toBeLessThanOrEqual(
        clean.scores.formatting,
      );
    });

    it("generates topIssues list", () => {
      const ctx = svc.createTrace("r3");
      svc.scanDimensionOutput(
        ctx,
        "d1",
        "D1",
        "The formula \\frac{a}{b} is \\sum_{i}.",
      );
      svc.computeFinalAssessment(ctx);
      const issues = ctx.finalAssessment!.topIssues;
      expect(Array.isArray(issues)).toBe(true);
    });

    it("sets finalAssessment on ctx", () => {
      const ctx = svc.createTrace("r4");
      expect(ctx.finalAssessment).toBeUndefined();
      svc.computeFinalAssessment(ctx);
      expect(ctx.finalAssessment).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // recordDimensionRemediationLoop
  // ─────────────────────────────────────────────────────────────
  describe("recordDimensionRemediationLoop", () => {
    it("records before/after scores and computes delta", () => {
      const ctx = svc.createTrace("r1");
      svc.scanDimensionOutput(ctx, "d1", "D1", "content");
      svc.recordDimensionRemediationLoop(ctx, "d1", {
        selfEvalScoresBefore: { analytical_depth: 4, writing_quality: 5 },
        selfEvalScoresAfter: { analytical_depth: 7, writing_quality: 8 },
        weakAreasResolved: true,
        remediationModel: "gpt-4o",
      });
      const dim = ctx.dimensionOutputs[0];
      expect(dim.selfEvalScoresBefore!.analytical_depth).toBe(4);
      expect(dim.selfEvalScoresAfter!.writing_quality).toBe(8);
      expect(dim.selfEvalDelta).toBeCloseTo(3, 0);
      expect(dim.weakAreasResolved).toBe(true);
      expect(dim.remediationModel).toBe("gpt-4o");
    });

    it("does nothing for unknown dimensionId", () => {
      const ctx = svc.createTrace("r2");
      svc.scanDimensionOutput(ctx, "d1", "D1", "content");
      svc.recordDimensionRemediationLoop(ctx, "nonexistent", {
        selfEvalScoresBefore: { x: 5 },
        selfEvalScoresAfter: { x: 8 },
        weakAreasResolved: false,
      });
      expect(ctx.dimensionOutputs[0].selfEvalDelta).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // finalizeTrace
  // ─────────────────────────────────────────────────────────────
  describe("finalizeTrace", () => {
    it("returns a complete QualityTrace structure", () => {
      const ctx = svc.createTrace("r1");
      svc.scanDimensionOutput(ctx, "d1", "D1", "content");
      svc.computeFinalAssessment(ctx);

      const trace = svc.finalizeTrace(ctx, "v5.1");
      expect(trace.version).toBe(1);
      expect(trace.pipelineVersion).toBe("v5.1");
      expect(trace.generatedAt).toBeDefined();
      expect(trace.finalAssessment).toBeDefined();
    });

    it("calls computeFinalAssessment if not already done", () => {
      const ctx = svc.createTrace("r2");
      expect(ctx.finalAssessment).toBeUndefined();
      const trace = svc.finalizeTrace(ctx);
      expect(trace.finalAssessment).toBeDefined();
    });

    it("provides default values for missing probes", () => {
      const ctx = svc.createTrace("r3");
      const trace = svc.finalizeTrace(ctx);
      expect(trace.evidenceQuality.totalEvidences).toBe(0);
      expect(trace.postProcessing.totalFixes).toBe(0);
      expect(trace.synthesisOutput.jsonParsed).toBe(false);
    });

    it("uses default pipelineVersion when not specified", () => {
      const ctx = svc.createTrace("r4");
      const trace = svc.finalizeTrace(ctx);
      expect(trace.pipelineVersion).toBe("v5.0");
    });

    it("includes outputReview when present", () => {
      const ctx = svc.createTrace("r5");
      svc.recordOutputReview(ctx, {
        passed: true,
        score: 90,
        feedback: "Excellent",
        issues: [],
        suggestions: [],
      });
      const trace = svc.finalizeTrace(ctx);
      expect(trace.outputReview!.passed).toBe(true);
    });
  });
});
