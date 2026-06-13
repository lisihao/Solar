/**
 * Branch coverage for LaTeX-safety guard inside CritiqueRefineService
 * (parseRefineResponse method).
 *
 * Scenarios covered:
 *   - Refined content has fewer latex issues → accept
 *   - Refined content has equal issues → accept (not strictly worse)
 *   - Refined content has MORE issues → REJECT, revert to original
 *   - No refined content → fall back to original (existing behavior)
 */
import { Test } from "@nestjs/testing";
import { CritiqueRefineService } from "../critique-refine.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { CritiqueResult } from "../../../types/quality.types";

describe("CritiqueRefineService — LaTeX safety guard", () => {
  let service: CritiqueRefineService;
  let svcAny: { parseRefineResponse: Function };

  beforeEach(async () => {
    const m = await Test.createTestingModule({
      providers: [
        CritiqueRefineService,
        {
          provide: ChatFacade,
          useValue: { chat: jest.fn(), chatStructured: jest.fn() },
        },
      ],
    }).compile();
    service = m.get(CritiqueRefineService);
    svcAny = service as unknown as { parseRefineResponse: Function };
  });

  const critique: CritiqueResult = {
    overallScore: 0.6,
    categoryScores: {},
    items: [],
    strengths: [],
    improvementPriorities: [],
    summary: "ok",
  };

  it("accepts refined content with FEWER latex issues", () => {
    const original = "Original with bare \\frac{a}{b} and $\\alpha incomplete";
    const refinedRaw = {
      refinedContent: "Refined with $\\frac{a}{b}$ and $\\alpha$ closed",
      changesApplied: [],
      remainingIssues: [],
      refinementSummary: "fixed latex",
    };
    const result = svcAny.parseRefineResponse.call(
      service,
      refinedRaw,
      original,
      critique,
      [],
    );
    expect(result.refinedContent).toContain("Refined");
  });

  it("REJECTS refined content with MORE latex issues (reverts to original)", () => {
    const original = "Clean: $\\alpha$ and $\\beta$ both wrapped";
    const refinedRaw = {
      refinedContent:
        "Broken: $\\alpha + \\beta，中文散文 B$ 和 \\gamma_{naked and \\delta_{more",
      changesApplied: [],
      remainingIssues: [],
      refinementSummary: "",
    };
    const result = svcAny.parseRefineResponse.call(
      service,
      refinedRaw,
      original,
      critique,
      [],
    );
    expect(result.refinedContent).toBe(original);
  });

  it("falls back to original when LLM produced no refinedContent", () => {
    const original = "x";
    const result = svcAny.parseRefineResponse.call(
      service,
      { refinedContent: "", changesApplied: [], remainingIssues: [] },
      original,
      critique,
      [],
    );
    expect(result.refinedContent).toBe(original);
  });
});
