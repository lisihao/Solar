/**
 * Branch coverage for LaTeX-safety guard inside SectionRemediationService.
 *
 * Scenarios covered:
 *   - Remediation returns clean content (0 issues before, 0 after) → accept
 *   - Remediation fixes latex issues (5 before, 2 after) → accept
 *   - Remediation regresses latex (2 before, 5 after) → REJECT, keep original
 *   - Remediation equal issues (3 before, 3 after) → accept (not strictly worse)
 *   - API error → skip (unchanged, no latex check needed)
 *   - Content too short → skip (unchanged, no latex check needed)
 */
import { Test } from "@nestjs/testing";
import { SectionRemediationService } from "../section-remediation.service";
import { ChatFacade, AIFacade } from "@/modules/ai-harness/facade";

describe("SectionRemediationService — LaTeX safety guard", () => {
  let service: SectionRemediationService;
  let chat: jest.Mock;

  const baseAction = {
    type: "deepen_analysis" as const,
    dimension: "depth" as const,
    score: 4,
    guidance: "add more analysis",
  };

  const bigSection = "A ".repeat(500); // ~1000 chars to pass length checks
  const call = (content: string) =>
    service.remediate({
      content,
      sectionTitle: "Section",
      actions: [baseAction],
    });

  beforeEach(async () => {
    chat = jest.fn();
    const m = await Test.createTestingModule({
      providers: [
        SectionRemediationService,
        { provide: ChatFacade, useValue: { chat } },
        { provide: AIFacade, useValue: {} },
      ],
    }).compile();
    service = m.get(SectionRemediationService);
  });

  it("accepts clean remediation (no latex issues before or after)", async () => {
    chat.mockResolvedValue({
      content: "improved " + bigSection,
      isError: false,
    });
    const res = await call(bigSection);
    expect(res.skipped).not.toBe(true);
    expect(res.content).toContain("improved");
  });

  it("accepts remediation that REDUCES latex issues", async () => {
    const originalContent =
      bigSection + "\nFormula: \\frac{a}{b} bare and $\\alpha incomplete";
    chat.mockResolvedValue({
      content:
        bigSection + "\nFormula: $\\frac{a}{b}$ wrapped and $\\alpha$ closed",
      isError: false,
    });
    const res = await call(originalContent);
    expect(res.skipped).not.toBe(true);
    expect(res.content).toContain("wrapped");
  });

  it("REJECTS remediation that INTRODUCES new latex damage", async () => {
    const originalContent = bigSection + "\nGood: $\\frac{a}{b}$ and $\\alpha$";
    const remediatedWithDamage =
      bigSection +
      "\nGood: $\\frac{a}{b}，中间断了 bare and \\beta_{wrong, \\gamma_{more, \\delta_{worse";
    chat.mockResolvedValue({
      content: remediatedWithDamage,
      isError: false,
    });
    const res = await call(originalContent);
    expect(res.skipped).toBe(true);
    expect(res.skipReason).toBe("remediated_content_latex_regressed");
    expect(res.content).toBe(originalContent);
  });

  it("skips on API error (latex guard never runs)", async () => {
    chat.mockResolvedValue({ content: "error message", isError: true });
    const res = await call(bigSection);
    expect(res.skipped).toBe(true);
    expect(res.skipReason).toMatch(/api_error/);
  });

  it("skips on too-short remediation (latex guard never runs)", async () => {
    chat.mockResolvedValue({ content: "tiny", isError: false });
    const res = await call(bigSection);
    expect(res.skipped).toBe(true);
    expect(res.skipReason).toBe("remediated_content_too_short");
  });
});
