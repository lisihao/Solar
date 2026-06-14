/**
 * LeaderAgent 单元测试
 *
 * 覆盖：inputSchema / outputSchema / validateBusinessRules / buildSystemPrompt
 */

import { LeaderAgent } from "../leader.agent";
import { readDefineAgentMeta } from "@/modules/ai-harness/agents/dev-tools/agent-spec.base";

// ── helpers ─────────────────────────────────────────────────────────

function getMeta() {
  const meta = readDefineAgentMeta(LeaderAgent);
  if (!meta) throw new Error("@DefineAgent metadata missing");
  return meta;
}

const validDimension = () => ({
  id: "dim-1",
  name: "Regulatory Landscape",
  rationale: "Covers compliance requirements",
  toolHint: { categories: ["information"] },
});

const validGoals = () => ({
  successCriteria: [
    "Identify top 3 policy drivers",
    "Map competitive response",
  ],
  qualityBar: { minSources: 5, minCoverage: 70, hardConstraints: [] },
  deliverables: ["Executive briefing", "Risk matrix"],
});

// ── InputSchema ──────────────────────────────────────────────────────

describe("LeaderAgent — inputSchema", () => {
  const { inputSchema } = getMeta();

  describe("phase=plan", () => {
    const basePlan = {
      phase: "plan" as const,
      topic: "AI Regulation 2026",
      depth: "standard" as const,
      language: "en-US" as const,
    };

    it("accepts minimal valid plan input", () => {
      const r = inputSchema.safeParse(basePlan);
      expect(r.success).toBe(true);
    });

    it("accepts plan with priorPostmortems array", () => {
      const r = inputSchema.safeParse({
        ...basePlan,
        priorPostmortems: [
          {
            missionId: "m-001",
            topic: "AI Governance",
            summary: "Summary text",
            recommendations: ["Add more sources"],
            leaderSigned: true,
            qualityScore: 80,
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      });
      expect(r.success).toBe(true);
    });

    it("accepts all depth values", () => {
      for (const depth of ["quick", "standard", "deep"] as const) {
        const r = inputSchema.safeParse({ ...basePlan, depth });
        expect(r.success).toBe(true);
      }
    });

    it("rejects plan missing topic", () => {
      const { topic: _t, ...rest } = basePlan;
      const r = inputSchema.safeParse(rest);
      expect(r.success).toBe(false);
    });

    it("rejects plan with invalid depth", () => {
      const r = inputSchema.safeParse({ ...basePlan, depth: "extreme" });
      expect(r.success).toBe(false);
    });

    it("rejects plan with invalid language", () => {
      const r = inputSchema.safeParse({ ...basePlan, language: "fr-FR" });
      expect(r.success).toBe(false);
    });
  });

  describe("phase=assess-research", () => {
    const baseAssess = {
      phase: "assess-research" as const,
      topic: "AI Regulation 2026",
      language: "zh-CN" as const,
      myPlan: { goals: validGoals(), dimensions: [validDimension()] },
      researcherOutcomes: [
        {
          dimensionId: "dim-1",
          dimensionName: "Regulatory Landscape",
          state: "completed" as const,
          findingsCount: 5,
          sources: ["https://example.com"],
          summary: "Good coverage",
        },
      ],
    };

    it("accepts valid assess-research input", () => {
      const r = inputSchema.safeParse(baseAssess);
      expect(r.success).toBe(true);
    });

    it("accepts researcher outcome with failureCode", () => {
      const r = inputSchema.safeParse({
        ...baseAssess,
        researcherOutcomes: [
          {
            ...baseAssess.researcherOutcomes[0],
            state: "failed",
            failureCode: "TIMEOUT",
          },
        ],
      });
      expect(r.success).toBe(true);
    });

    it("rejects assess-research missing myPlan", () => {
      const { myPlan: _p, ...rest } = baseAssess;
      const r = inputSchema.safeParse(rest);
      expect(r.success).toBe(false);
    });
  });

  describe("phase=foreword", () => {
    const baseForeword = {
      phase: "foreword" as const,
      topic: "AI Regulation 2026",
      language: "en-US" as const,
      myPlan: { goals: validGoals(), dimensions: [validDimension()] },
      stageOutcomes: {
        researcherStates: [{ name: "Regulatory", state: "completed" as const }],
        writerSections: ["Introduction", "Analysis"],
        qualitySnapshot: {
          sourceCount: 10,
          coverageScore: 75,
          overall: 80,
          finalVerdict: "good",
          criticBlindspots: [],
          criticBiases: [],
        },
      },
    };

    it("accepts valid foreword input", () => {
      const r = inputSchema.safeParse(baseForeword);
      expect(r.success).toBe(true);
    });

    it("accepts foreword with reconciliation data", () => {
      const r = inputSchema.safeParse({
        ...baseForeword,
        stageOutcomes: {
          ...baseForeword.stageOutcomes,
          reconciliation: {
            factCount: 20,
            conflictCount: 2,
            criticalGaps: ["Market data"],
          },
        },
      });
      expect(r.success).toBe(true);
    });

    it("accepts foreword with myDecisions", () => {
      const r = inputSchema.safeParse({
        ...baseForeword,
        myDecisions: [
          {
            phase: "plan",
            at: "2026-01-01T10:00:00Z",
            decision: "Kept 4 dimensions",
            rationale: "Coverage breadth important",
          },
        ],
      });
      expect(r.success).toBe(true);
    });
  });

  describe("phase=signoff", () => {
    const baseSignoff = {
      phase: "signoff" as const,
      topic: "AI Regulation 2026",
      language: "en-US" as const,
      myPlan: { goals: validGoals(), dimensions: [validDimension()] },
      myForeword: {
        whatWeAnswered: [
          {
            criterion: "Policy drivers",
            addressed: "yes" as const,
            evidence: "Three major policies identified",
          },
        ],
        whatRemainsUnclear: [],
      },
      finalQuality: {
        sourceCount: 15,
        coverageScore: 80,
        overall: 85,
        finalVerdict: "good",
        wordCount: 5000,
      },
      dimensionStates: [{ name: "Regulatory", state: "completed" as const }],
    };

    it("accepts valid signoff input", () => {
      const r = inputSchema.safeParse(baseSignoff);
      expect(r.success).toBe(true);
    });

    it("accepts signoff with lengthAccuracy and objectiveScore", () => {
      const r = inputSchema.safeParse({
        ...baseSignoff,
        finalQuality: {
          ...baseSignoff.finalQuality,
          lengthAccuracy: 45,
          targetWordCount: 10000,
          objectiveScore: 70,
          objectiveGrade: "B",
          objectiveFeedback: "Coverage could be broader",
        },
      });
      expect(r.success).toBe(true);
    });

    it("rejects signoff missing finalQuality", () => {
      const { finalQuality: _fq, ...rest } = baseSignoff;
      const r = inputSchema.safeParse(rest);
      expect(r.success).toBe(false);
    });
  });
});

// ── OutputSchema ─────────────────────────────────────────────────────

describe("LeaderAgent — outputSchema", () => {
  const { outputSchema } = getMeta();

  it("accepts valid plan output", () => {
    const r = outputSchema.safeParse({
      phase: "plan",
      themeSummary:
        "Comprehensive analysis of AI regulatory landscape across major jurisdictions",
      dimensions: [
        validDimension(),
        {
          id: "dim-2",
          name: "Market Impact",
          rationale: "Economic effects",
          toolHint: { categories: ["information"] },
        },
        {
          id: "dim-3",
          name: "Tech Capabilities",
          rationale: "Technical details",
          toolHint: { categories: ["information"] },
        },
      ],
      goals: validGoals(),
      initialRisks: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects plan output with too few dimensions (<2)", () => {
    const r = outputSchema.safeParse({
      phase: "plan",
      themeSummary:
        "This is a very detailed theme summary with enough characters",
      dimensions: [validDimension()],
      goals: validGoals(),
      initialRisks: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects plan output with short themeSummary (<20 chars)", () => {
    const r = outputSchema.safeParse({
      phase: "plan",
      themeSummary: "Short",
      dimensions: [validDimension(), validDimension()],
      goals: validGoals(),
      initialRisks: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts valid assess-research output", () => {
    const r = outputSchema.safeParse({
      phase: "assess-research",
      decision: "accept-all",
      rationale:
        "All dimensions completed with sufficient findings and sources",
      perDimension: [{ dimensionId: "dim-1", action: "accept" }],
      newDimensions: [],
    });
    expect(r.success).toBe(true);
  });

  it("accepts assess-research output with patch decision", () => {
    const r = outputSchema.safeParse({
      phase: "assess-research",
      decision: "patch",
      rationale:
        "One dimension needs additional research based on missing data",
      perDimension: [
        {
          dimensionId: "dim-1",
          action: "retry-with-critique",
          critique: "Missing quantitative evidence",
        },
      ],
      newDimensions: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects assess-research output with short rationale", () => {
    const r = outputSchema.safeParse({
      phase: "assess-research",
      decision: "accept-all",
      rationale: "Short",
      perDimension: [],
      newDimensions: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts valid foreword output", () => {
    const r = outputSchema.safeParse({
      phase: "foreword",
      whatWeAnswered: [
        {
          criterion: "Policy analysis",
          addressed: "yes",
          evidence: "Three regulatory frameworks compared",
        },
      ],
      whatRemainsUnclear: [],
      howToRead:
        "Start with the executive summary, then follow the regulatory timeline analysis",
      recommendedFollowUp: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects foreword output with empty whatWeAnswered", () => {
    const r = outputSchema.safeParse({
      phase: "foreword",
      whatWeAnswered: [],
      whatRemainsUnclear: [],
      howToRead:
        "This is a valid howToRead with enough characters for the minimum",
      recommendedFollowUp: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts valid signoff output", () => {
    const r = outputSchema.safeParse({
      phase: "signoff",
      leaderOverallScore: 82,
      leaderVerdict: "excellent",
      accountabilityNote:
        "我在 M0 决定采用 4 个维度的全面研究框架，这个决策带来了充分的市场覆盖。M1 评估时我接受了所有研究员产出，最终报告质量符合预期。",
      signed: true,
    });
    expect(r.success).toBe(true);
  });

  it("rejects signoff output with short accountabilityNote (<50 chars)", () => {
    const r = outputSchema.safeParse({
      phase: "signoff",
      leaderOverallScore: 82,
      leaderVerdict: "excellent",
      accountabilityNote: "Too short",
      signed: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects signoff output with score out of range", () => {
    const r = outputSchema.safeParse({
      phase: "signoff",
      leaderOverallScore: 150,
      leaderVerdict: "excellent",
      accountabilityNote:
        "我在 M0 做出了正确的维度规划决策，确保了研究全面性和深度。",
      signed: true,
    });
    expect(r.success).toBe(false);
  });
});

// ── validateBusinessRules ────────────────────────────────────────────

describe("LeaderAgent — validateBusinessRules", () => {
  const agent = new LeaderAgent();

  const identity = { role: "leader", description: "test" };

  // plan phase
  describe("phase=plan", () => {
    const planInput = {
      phase: "plan" as const,
      topic: "AI",
      depth: "standard" as const,
      language: "en-US" as const,
      priorPostmortems: [],
    };

    it("passes when standard depth has 5-8 dimensions", () => {
      const output = {
        phase: "plan" as const,
        themeSummary: "A comprehensive theme summary for the mission",
        dimensions: Array.from({ length: 6 }, (_, i) => ({
          id: `d${i + 1}`,
          name: `Dim ${String.fromCharCode(65 + i)}`,
          rationale: "r",
          toolHint: { categories: ["info"] },
        })),
        goals: validGoals(),
        initialRisks: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: planInput, identity }),
      ).not.toThrow();
    });

    it("fails when standard depth has only 3 dimensions", () => {
      const output = {
        phase: "plan" as const,
        themeSummary: "A comprehensive theme summary for the mission",
        dimensions: [
          {
            id: "d1",
            name: "A",
            rationale: "r",
            toolHint: { categories: ["info"] },
          },
          {
            id: "d2",
            name: "B",
            rationale: "r",
            toolHint: { categories: ["info"] },
          },
          {
            id: "d3",
            name: "C",
            rationale: "r",
            toolHint: { categories: ["info"] },
          },
        ],
        goals: validGoals(),
        initialRisks: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: planInput, identity }),
      ).toThrow(/5-8/);
    });

    it("passes when quick depth has 3-5 dimensions", () => {
      const quickInput = { ...planInput, depth: "quick" as const };
      const output = {
        phase: "plan" as const,
        themeSummary: "A comprehensive theme summary for the mission",
        dimensions: [
          {
            id: "d1",
            name: "A",
            rationale: "r",
            toolHint: { categories: ["info"] },
          },
          {
            id: "d2",
            name: "B",
            rationale: "r",
            toolHint: { categories: ["info"] },
          },
          {
            id: "d3",
            name: "C",
            rationale: "r",
            toolHint: { categories: ["info"] },
          },
          {
            id: "d4",
            name: "D",
            rationale: "r",
            toolHint: { categories: ["info"] },
          },
        ],
        goals: validGoals(),
        initialRisks: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: quickInput, identity }),
      ).not.toThrow();
    });

    it("fails when quick depth has 6 dimensions", () => {
      const quickInput = { ...planInput, depth: "quick" as const };
      const output = {
        phase: "plan" as const,
        themeSummary: "A comprehensive theme summary for the mission",
        dimensions: Array.from({ length: 6 }, (_, i) => ({
          id: `d${i + 1}`,
          name: `Dim ${i + 1}`,
          rationale: "r",
          toolHint: { categories: ["info"] },
        })),
        goals: validGoals(),
        initialRisks: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: quickInput, identity }),
      ).toThrow(/3-5/);
    });

    it("passes when deep depth has 8-12 dimensions", () => {
      const deepInput = { ...planInput, depth: "deep" as const };
      const output = {
        phase: "plan" as const,
        themeSummary: "A comprehensive theme summary for the mission",
        dimensions: Array.from({ length: 10 }, (_, i) => ({
          id: `d${i + 1}`,
          name: `Dim ${i + 1}`,
          rationale: "r",
          toolHint: { categories: ["info"] },
        })),
        goals: validGoals(),
        initialRisks: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: deepInput, identity }),
      ).not.toThrow();
    });

    it("fails when deep depth has only 5 dimensions", () => {
      const deepInput = { ...planInput, depth: "deep" as const };
      const output = {
        phase: "plan" as const,
        themeSummary: "A comprehensive theme summary for the mission",
        dimensions: Array.from({ length: 5 }, (_, i) => ({
          id: `d${i + 1}`,
          name: `Dim ${i + 1}`,
          rationale: "r",
          toolHint: { categories: ["info"] },
        })),
        goals: validGoals(),
        initialRisks: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: deepInput, identity }),
      ).toThrow(/8-12/);
    });

    it("fails on duplicate dimension IDs", () => {
      const output = {
        phase: "plan" as const,
        themeSummary: "A comprehensive theme summary for the mission",
        dimensions: [
          {
            id: "dup",
            name: "A",
            rationale: "r",
            toolHint: { categories: ["info"] },
          },
          {
            id: "dup",
            name: "B",
            rationale: "r",
            toolHint: { categories: ["info"] },
          },
          {
            id: "d3",
            name: "C",
            rationale: "r",
            toolHint: { categories: ["info"] },
          },
        ],
        goals: validGoals(),
        initialRisks: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: planInput, identity }),
      ).toThrow(/重复/);
    });

    it("still validates duplicate IDs even without ctx.input", () => {
      const output = {
        phase: "plan" as const,
        themeSummary: "A comprehensive theme summary for the mission",
        dimensions: [
          {
            id: "dup",
            name: "A",
            rationale: "r",
            toolHint: { categories: ["info"] },
          },
          {
            id: "dup",
            name: "B",
            rationale: "r",
            toolHint: { categories: ["info"] },
          },
        ],
        goals: validGoals(),
        initialRisks: [],
      };
      expect(() => agent.validateBusinessRules(output, { identity })).toThrow(
        /重复/,
      );
    });
  });

  // assess-research phase
  describe("phase=assess-research", () => {
    const assessInput = {
      phase: "assess-research" as const,
      topic: "AI",
      language: "en-US" as const,
      myPlan: { goals: validGoals(), dimensions: [validDimension()] },
      researcherOutcomes: [
        {
          dimensionId: "dim-1",
          dimensionName: "Regulatory",
          state: "completed" as const,
          findingsCount: 5,
          sources: ["https://example.com"],
          summary: "Good findings",
        },
      ],
    };

    it("passes when all dimensions are covered", () => {
      const output = {
        phase: "assess-research" as const,
        decision: "accept-all" as const,
        rationale: "All dimensions have sufficient findings and sources",
        perDimension: [{ dimensionId: "dim-1", action: "accept" as const }],
        newDimensions: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: assessInput, identity }),
      ).not.toThrow();
    });

    it("fails when a dimension is missing from perDimension", () => {
      const output = {
        phase: "assess-research" as const,
        decision: "accept-all" as const,
        rationale: "All dimensions have sufficient findings and sources",
        perDimension: [], // missing dim-1
        newDimensions: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: assessInput, identity }),
      ).toThrow(/dim-1/);
    });

    it("fails when decision=patch but all perDimension are accept", () => {
      const output = {
        phase: "assess-research" as const,
        decision: "patch" as const,
        rationale: "Some dimensions need additional work on quality",
        perDimension: [{ dimensionId: "dim-1", action: "accept" as const }],
        newDimensions: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: assessInput, identity }),
      ).toThrow(/patch/);
    });

    it("fails when retry-with-critique missing critique", () => {
      const output = {
        phase: "assess-research" as const,
        decision: "patch" as const,
        rationale: "Dimension needs additional research and better sourcing",
        perDimension: [
          { dimensionId: "dim-1", action: "retry-with-critique" as const },
        ],
        newDimensions: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: assessInput, identity }),
      ).toThrow(/critique/);
    });

    it("fails when replace-spec missing newAgentSpecId", () => {
      const output = {
        phase: "assess-research" as const,
        decision: "patch" as const,
        rationale: "Need to replace the dim spec with a better one",
        perDimension: [
          { dimensionId: "dim-1", action: "replace-spec" as const },
        ],
        newDimensions: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: assessInput, identity }),
      ).toThrow(/newAgentSpecId/);
    });

    it("passes when retry-with-critique has critique field", () => {
      const multiInput = {
        ...assessInput,
        researcherOutcomes: [
          assessInput.researcherOutcomes[0],
          {
            ...assessInput.researcherOutcomes[0],
            dimensionId: "dim-2",
            dimensionName: "Market",
          },
        ],
      };
      const output = {
        phase: "assess-research" as const,
        decision: "patch" as const,
        rationale:
          "One dimension needs additional research on quantitative data",
        perDimension: [
          { dimensionId: "dim-1", action: "accept" as const },
          {
            dimensionId: "dim-2",
            action: "retry-with-critique" as const,
            critique: "Need more data points",
          },
        ],
        newDimensions: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: multiInput, identity }),
      ).not.toThrow();
    });
  });

  // foreword phase
  describe("phase=foreword", () => {
    const forewordInput = {
      phase: "foreword" as const,
      topic: "AI",
      language: "en-US" as const,
      myPlan: {
        goals: {
          successCriteria: ["Criterion 1", "Criterion 2"],
          qualityBar: { minSources: 5, minCoverage: 70, hardConstraints: [] },
          deliverables: ["Report"],
        },
        dimensions: [validDimension()],
      },
      myDecisions: [],
      stageOutcomes: {
        researcherStates: [{ name: "Regulatory", state: "completed" as const }],
        writerSections: ["Introduction"],
        qualitySnapshot: {
          sourceCount: 10,
          coverageScore: 75,
          overall: 80,
          finalVerdict: "good",
          criticBlindspots: [],
          criticBiases: [],
        },
      },
    };

    it("passes when all completed and whatWeAnswered covers successCriteria", () => {
      const output = {
        phase: "foreword" as const,
        whatWeAnswered: [
          {
            criterion: "Criterion 1",
            addressed: "yes" as const,
            evidence: "Evidence for criterion 1 found",
          },
          {
            criterion: "Criterion 2",
            addressed: "partial" as const,
            evidence: "Partial evidence for criterion 2",
          },
        ],
        whatRemainsUnclear: [],
        howToRead:
          "Start with the executive summary, then review the regulatory section",
        recommendedFollowUp: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: forewordInput, identity }),
      ).not.toThrow();
    });

    it("fails when degraded researcher but whatRemainsUnclear is empty", () => {
      const degradedInput = {
        ...forewordInput,
        stageOutcomes: {
          ...forewordInput.stageOutcomes,
          researcherStates: [
            { name: "Regulatory", state: "degraded" as const },
          ],
        },
      };
      const output = {
        phase: "foreword" as const,
        whatWeAnswered: [
          {
            criterion: "Criterion 1",
            addressed: "yes" as const,
            evidence: "Evidence for criterion 1",
          },
          {
            criterion: "Criterion 2",
            addressed: "yes" as const,
            evidence: "Evidence for criterion 2",
          },
        ],
        whatRemainsUnclear: [], // must not be empty when degraded
        howToRead: "Start with the executive summary for the overview",
        recommendedFollowUp: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: degradedInput, identity }),
      ).toThrow(/degraded/);
    });

    it("fails when criticalGaps exist but whatRemainsUnclear is empty", () => {
      const gapInput = {
        ...forewordInput,
        stageOutcomes: {
          ...forewordInput.stageOutcomes,
          reconciliation: {
            factCount: 10,
            conflictCount: 0,
            criticalGaps: ["Market data gap"],
          },
        },
      };
      const output = {
        phase: "foreword" as const,
        whatWeAnswered: [
          {
            criterion: "Criterion 1",
            addressed: "yes" as const,
            evidence: "Evidence here",
          },
          {
            criterion: "Criterion 2",
            addressed: "yes" as const,
            evidence: "Evidence here too",
          },
        ],
        whatRemainsUnclear: [],
        howToRead: "Start with the executive summary and regulatory analysis",
        recommendedFollowUp: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: gapInput, identity }),
      ).toThrow(/gap/i);
    });

    it("fails when criticVerdict=fail but whatRemainsUnclear is empty", () => {
      const criticInput = {
        ...forewordInput,
        stageOutcomes: {
          ...forewordInput.stageOutcomes,
          qualitySnapshot: {
            ...forewordInput.stageOutcomes.qualitySnapshot,
            criticVerdict: "fail" as const,
          },
        },
      };
      const output = {
        phase: "foreword" as const,
        whatWeAnswered: [
          {
            criterion: "Criterion 1",
            addressed: "yes" as const,
            evidence: "Evidence here",
          },
          {
            criterion: "Criterion 2",
            addressed: "yes" as const,
            evidence: "Evidence here too",
          },
        ],
        whatRemainsUnclear: [],
        howToRead: "Start with the executive summary and regulatory analysis",
        recommendedFollowUp: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: criticInput, identity }),
      ).toThrow(/critic/i);
    });

    it("fails when whatWeAnswered covers fewer criteria than successCriteria", () => {
      const output = {
        phase: "foreword" as const,
        whatWeAnswered: [
          {
            criterion: "Criterion 1 only",
            addressed: "yes" as const,
            evidence: "Only one criterion covered",
          },
        ],
        whatRemainsUnclear: [],
        howToRead: "Start with the executive summary and regulatory analysis",
        recommendedFollowUp: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: forewordInput, identity }),
      ).toThrow(/successCriteria/);
    });

    it("passes when critic has blindspots but whatRemainsUnclear populated", () => {
      const blindspotInput = {
        ...forewordInput,
        stageOutcomes: {
          ...forewordInput.stageOutcomes,
          qualitySnapshot: {
            ...forewordInput.stageOutcomes.qualitySnapshot,
            criticBlindspots: ["No coverage of EU AI Act"],
          },
        },
      };
      const output = {
        phase: "foreword" as const,
        whatWeAnswered: [
          {
            criterion: "Criterion 1",
            addressed: "yes" as const,
            evidence: "Evidence for criterion 1",
          },
          {
            criterion: "Criterion 2",
            addressed: "yes" as const,
            evidence: "Evidence for criterion 2",
          },
        ],
        whatRemainsUnclear: ["EU AI Act specifics still unclear"],
        howToRead: "Start with the executive summary for the overview",
        recommendedFollowUp: [],
      };
      expect(() =>
        agent.validateBusinessRules(output, {
          input: blindspotInput,
          identity,
        }),
      ).not.toThrow();
    });
  });

  // signoff phase
  describe("phase=signoff", () => {
    const signoffInput = {
      phase: "signoff" as const,
      topic: "AI",
      language: "en-US" as const,
      myPlan: { goals: validGoals(), dimensions: [validDimension()] },
      myDecisions: [],
      myForeword: {
        whatWeAnswered: [
          { criterion: "C1", addressed: "yes" as const, evidence: "Evidence" },
        ],
        whatRemainsUnclear: [],
      },
      finalQuality: {
        sourceCount: 15,
        coverageScore: 80,
        overall: 85,
        finalVerdict: "good",
        wordCount: 5000,
      },
      dimensionStates: [{ name: "Regulatory", state: "completed" as const }],
    };

    const validNote =
      "我在 M0 决定采用全面的维度规划策略，M1 我接受了所有研究员产出，当时判断数据质量良好，本次报告达到预期质量标准。";

    it("passes with excellent verdict and score 85", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 85,
        leaderVerdict: "excellent" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).not.toThrow();
    });

    it("fails when verdict=excellent but score < 80", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 75,
        leaderVerdict: "excellent" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).toThrow(/excellent.*80|80.*excellent/i);
    });

    it("fails when verdict=good but score < 65", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 60,
        leaderVerdict: "good" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).toThrow(/good/i);
    });

    it("fails when verdict=good but score >= 90", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 92,
        leaderVerdict: "good" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).toThrow(/good/i);
    });

    it("passes when verdict=good and score in [65,90)", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 75,
        leaderVerdict: "good" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).not.toThrow();
    });

    it("fails when verdict=acceptable but score < 45", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 40,
        leaderVerdict: "acceptable" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).toThrow(/acceptable/i);
    });

    it("fails when verdict=acceptable but score >= 75", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 76,
        leaderVerdict: "acceptable" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).toThrow(/acceptable/i);
    });

    it("passes when verdict=acceptable and score in [45,75)", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 60,
        leaderVerdict: "acceptable" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).not.toThrow();
    });

    it("fails when verdict=failed but score >= 60", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 65,
        leaderVerdict: "failed" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).toThrow(/failed/i);
    });

    it("passes when verdict=failed and score < 60", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 40,
        leaderVerdict: "failed" as const,
        accountabilityNote:
          "我在 M0 决定使用这个框架，当时判断有误，本次 mission 未达质量标准，需要重做。",
        signed: false,
        refusalReason: "Quality insufficient",
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).not.toThrow();
    });

    it("fails when signed=false but refusalReason missing", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 40,
        leaderVerdict: "failed" as const,
        accountabilityNote: validNote,
        signed: false,
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).toThrow(/refusalReason/);
    });

    it("fails when accountabilityNote has no historical reference keywords", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 85,
        leaderVerdict: "excellent" as const,
        accountabilityNote:
          "This report meets all quality standards and demonstrates thorough research coverage across all dimensions with multiple verified sources.",
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).toThrow(/accountabilityNote/);
    });

    it("fails with lengthAccuracy < 60 and verdict=excellent", () => {
      const lowAccuracyInput = {
        ...signoffInput,
        finalQuality: {
          ...signoffInput.finalQuality,
          lengthAccuracy: 45,
          targetWordCount: 10000,
          wordCount: 4500,
        },
      };
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 85,
        leaderVerdict: "excellent" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, {
          input: lowAccuracyInput,
          identity,
        }),
      ).toThrow(/lengthAccuracy/);
    });

    it("fails with lengthAccuracy < 60 and verdict=good", () => {
      const lowAccuracyInput = {
        ...signoffInput,
        finalQuality: {
          ...signoffInput.finalQuality,
          lengthAccuracy: 50,
          targetWordCount: 10000,
          wordCount: 5000,
        },
      };
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 75,
        leaderVerdict: "good" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, {
          input: lowAccuracyInput,
          identity,
        }),
      ).toThrow(/lengthAccuracy/);
    });

    it("passes with lengthAccuracy < 60 and verdict=acceptable", () => {
      const lowAccuracyInput = {
        ...signoffInput,
        finalQuality: {
          ...signoffInput.finalQuality,
          lengthAccuracy: 50,
          targetWordCount: 10000,
          wordCount: 5000,
        },
      };
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 60,
        leaderVerdict: "acceptable" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, {
          input: lowAccuracyInput,
          identity,
        }),
      ).not.toThrow();
    });

    it("passes with lengthAccuracy >= 60 and verdict=excellent", () => {
      const goodAccuracyInput = {
        ...signoffInput,
        finalQuality: { ...signoffInput.finalQuality, lengthAccuracy: 90 },
      };
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 85,
        leaderVerdict: "excellent" as const,
        accountabilityNote: validNote,
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, {
          input: goodAccuracyInput,
          identity,
        }),
      ).not.toThrow();
    });

    it("accepts accountabilityNote with M0 keyword", () => {
      const output = {
        phase: "signoff" as const,
        leaderOverallScore: 85,
        leaderVerdict: "excellent" as const,
        accountabilityNote:
          "M0 我规划了四个研究维度，涵盖政策法规、市场竞争、技术能力和社会影响，这个框架使得最终报告达到了预期深度。",
        signed: true,
      };
      expect(() =>
        agent.validateBusinessRules(output, { input: signoffInput, identity }),
      ).not.toThrow();
    });
  });
});

// ── buildSystemPrompt ─────────────────────────────────────────────────

describe("LeaderAgent — buildSystemPrompt", () => {
  // Mock the duty loader to avoid filesystem dependency
  jest.mock("../../_shared/skill-loader", () => ({
    buildPromptFromDuty: jest.fn(
      (_agentDir: string, dutyName: string, vars: Record<string, unknown>) =>
        `DUTY:${dutyName}:${JSON.stringify(vars)}`,
    ),
  }));

  let agent: LeaderAgent;
  beforeEach(() => {
    agent = new LeaderAgent();
  });

  const identity = { role: "leader", description: "test" };

  it("calls buildPromptFromDuty with plan duty for plan phase", () => {
    const input = {
      phase: "plan" as const,
      topic: "AI Regulation",
      depth: "standard" as const,
      language: "en-US" as const,
      priorPostmortems: [],
    };
    const result = agent.buildSystemPrompt({ input, identity });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("injects dimensionsTarget=3-5 for quick depth", () => {
    const input = {
      phase: "plan" as const,
      topic: "Quick topic",
      depth: "quick" as const,
      language: "zh-CN" as const,
      priorPostmortems: [],
    };
    const result = agent.buildSystemPrompt({ input, identity });
    expect(result).toContain("3-5");
  });

  it("injects dimensionsTarget=10-12 for deep depth", () => {
    const input = {
      phase: "plan" as const,
      topic: "Deep topic",
      depth: "deep" as const,
      language: "en-US" as const,
      priorPostmortems: [],
    };
    const result = agent.buildSystemPrompt({ input, identity });
    expect(result).toContain("10-12");
  });

  it("injects dimensionsTarget=5-8 for standard depth", () => {
    const input = {
      phase: "plan" as const,
      topic: "Standard topic",
      depth: "standard" as const,
      language: "en-US" as const,
      priorPostmortems: [],
    };
    const result = agent.buildSystemPrompt({ input, identity });
    expect(result).toContain("5-8");
  });

  it("calls buildPromptFromDuty with assess-research duty", () => {
    const input = {
      phase: "assess-research" as const,
      topic: "AI",
      language: "en-US" as const,
      myPlan: { goals: validGoals(), dimensions: [validDimension()] },
      researcherOutcomes: [],
    };
    const result = agent.buildSystemPrompt({ input, identity });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("calls buildPromptFromDuty with foreword duty", () => {
    const input = {
      phase: "foreword" as const,
      topic: "AI",
      language: "en-US" as const,
      myPlan: { goals: validGoals(), dimensions: [validDimension()] },
      myDecisions: [],
      stageOutcomes: {
        researcherStates: [],
        writerSections: [],
        qualitySnapshot: {
          sourceCount: 10,
          coverageScore: 75,
          overall: 80,
          finalVerdict: "good",
          criticBlindspots: [],
          criticBiases: [],
        },
      },
    };
    const result = agent.buildSystemPrompt({ input, identity });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("calls buildPromptFromDuty with signoff duty", () => {
    const input = {
      phase: "signoff" as const,
      topic: "AI",
      language: "en-US" as const,
      myPlan: { goals: validGoals(), dimensions: [validDimension()] },
      myDecisions: [],
      myForeword: {
        whatWeAnswered: [],
        whatRemainsUnclear: [],
      },
      finalQuality: {
        sourceCount: 15,
        coverageScore: 80,
        overall: 85,
        finalVerdict: "good",
        wordCount: 5000,
      },
      dimensionStates: [],
    };
    const result = agent.buildSystemPrompt({ input, identity });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
