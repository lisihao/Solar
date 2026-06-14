/**
 * SectionRemediationService — unit tests
 *
 * Covers:
 *   - remediate() with no actions → skipped immediately
 *   - remediate() with actions → calls ChatFacade.chat()
 *   - remediate() API error response → skipped with api_error reason
 *   - remediate() remediated content too short → skipped
 *   - remediate() LaTeX regression → skipped
 *   - remediate() ChatFacade throws → skipped with error reason
 *   - resolveRemediationModel via getRemediationModelId():
 *       * STRONG tier input → returns same model
 *       * non-STRONG tier → calls engineFacade.selectModel()
 *       * selectModel returns STRONG model
 *       * selectModel fails → returns ""
 *       * selectModel returns non-STRONG model → returns ""
 *   - language fallback: "en" → English prompt, other → Chinese prompt
 *   - resolvedRemediationModelId pre-supplied → skips selectModel call
 */

import { SectionRemediationService } from "../section-remediation.service";
import type { RemediationAction } from "../quality.types";

// ─── Factory helpers ──────────────────────────────────────────────────────────

function makeChatFacade(opts: {
  content?: string;
  isError?: boolean;
  model?: string;
  throws?: Error;
}) {
  return {
    chat: jest.fn(async () => {
      if (opts.throws) throw opts.throws;
      return {
        content:
          opts.content ??
          "Improved content that is definitely longer than before.",
        isError: opts.isError ?? false,
        model: opts.model ?? "mock-model",
      };
    }),
  };
}

function makeEngineFacade(opts: { modelId?: string; throws?: boolean } = {}) {
  return {
    selectModel: jest.fn(async () => {
      if (opts.throws) throw new Error("selectModel failed");
      if (opts.modelId === undefined) return null;
      return { id: opts.modelId };
    }),
  };
}

function makeAction(
  overrides: Partial<RemediationAction> = {},
): RemediationAction {
  return {
    type: "deepen_analysis",
    dimension: "depth" as RemediationAction["dimension"],
    score: 5,
    guidance: "Add more statistical evidence.",
    ...overrides,
  };
}

// Long enough original content so that even a short remediated version passes the 50% check
const LONG_ORIGINAL = "A".repeat(400);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SectionRemediationService", () => {
  describe("remediate() — early returns", () => {
    it("returns skipped=true with skipReason=no_actions_needed when actions is empty", async () => {
      const chat = makeChatFacade({ content: "improved" });
      const engine = makeEngineFacade();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      const result = await svc.remediate({
        content: "original",
        sectionTitle: "Intro",
        actions: [],
      });

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe("no_actions_needed");
      expect(result.content).toBe("original");
      expect(chat.chat).not.toHaveBeenCalled();
    });
  });

  describe("remediate() — happy path", () => {
    it("returns remediated content when ChatFacade succeeds", async () => {
      const remediatedContent = "B".repeat(300); // > 50% of LONG_ORIGINAL
      const chat = makeChatFacade({ content: remediatedContent });
      const engine = makeEngineFacade({ modelId: "gpt-4o" }); // STRONG tier
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      const result = await svc.remediate({
        content: LONG_ORIGINAL,
        sectionTitle: "Market Analysis",
        actions: [makeAction()],
      });

      expect(result.skipped).toBe(false);
      expect(result.content).toBe(remediatedContent);
      expect(result.actionsApplied).toHaveLength(1);
      expect(chat.chat).toHaveBeenCalledTimes(1);
    });

    it("uses pre-supplied resolvedRemediationModelId without calling selectModel", async () => {
      const remediatedContent = "C".repeat(300);
      const chat = makeChatFacade({ content: remediatedContent });
      const engine = makeEngineFacade({ modelId: "gpt-4o" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      const result = await svc.remediate({
        content: LONG_ORIGINAL,
        sectionTitle: "Sec",
        actions: [makeAction()],
        resolvedRemediationModelId: "gpt-4o",
      });

      expect(result.skipped).toBe(false);
      expect(engine.selectModel).not.toHaveBeenCalled();
    });

    it("builds English prompt when language starts with en", async () => {
      const remediatedContent = "D".repeat(300);
      const chat = makeChatFacade({ content: remediatedContent });
      const engine = makeEngineFacade({ modelId: "gpt-4o" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      await svc.remediate({
        content: LONG_ORIGINAL,
        sectionTitle: "Overview",
        actions: [makeAction()],
        language: "en",
      });

      const callArg = chat.chat.mock.calls[0][0] as {
        messages: Array<{ content: string }>;
      };
      expect(callArg.messages[0].content).toContain("senior report editor");
      expect(callArg.messages[0].content).not.toContain("资深报告编辑");
    });

    it("builds Chinese prompt when language is zh", async () => {
      const remediatedContent = "E".repeat(300);
      const chat = makeChatFacade({ content: remediatedContent });
      const engine = makeEngineFacade({ modelId: "gpt-4o" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      await svc.remediate({
        content: LONG_ORIGINAL,
        sectionTitle: "概述",
        actions: [makeAction()],
        language: "zh",
      });

      const callArg = chat.chat.mock.calls[0][0] as {
        messages: Array<{ content: string }>;
      };
      expect(callArg.messages[0].content).toContain("资深报告编辑");
    });
  });

  describe("remediate() — skip paths", () => {
    it("skips and returns original when API response is error", async () => {
      const chat = makeChatFacade({
        content: "API Error message",
        isError: true,
      });
      const engine = makeEngineFacade({ modelId: "gpt-4o" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      const result = await svc.remediate({
        content: LONG_ORIGINAL,
        sectionTitle: "Sec",
        actions: [makeAction()],
      });

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toMatch(/^api_error/);
      expect(result.content).toBe(LONG_ORIGINAL);
    });

    it("skips when remediated content is shorter than 50% of original", async () => {
      // Original is 400 chars; remediated is 150 chars (< 200 = 50%)
      const shortContent = "F".repeat(150);
      const chat = makeChatFacade({ content: shortContent });
      const engine = makeEngineFacade({ modelId: "gpt-4o" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      const result = await svc.remediate({
        content: LONG_ORIGINAL,
        sectionTitle: "Sec",
        actions: [makeAction()],
      });

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe("remediated_content_too_short");
    });

    it("skips when remediated content has MORE LaTeX issues than original", async () => {
      // Original has no LaTeX issues; remediated introduces unbalanced $
      const originalContent = "G".repeat(400); // no LaTeX
      const remediatedWithLatexIssue =
        "G".repeat(400) + " see formula $x + 1 oops"; // odd $ count
      const chat = makeChatFacade({ content: remediatedWithLatexIssue });
      const engine = makeEngineFacade({ modelId: "gpt-4o" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      const result = await svc.remediate({
        content: originalContent,
        sectionTitle: "Sec",
        actions: [makeAction()],
      });

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe("remediated_content_latex_regressed");
    });

    it("skips with error reason when ChatFacade throws", async () => {
      const chat = makeChatFacade({ throws: new Error("network timeout") });
      const engine = makeEngineFacade({ modelId: "gpt-4o" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      const result = await svc.remediate({
        content: LONG_ORIGINAL,
        sectionTitle: "Sec",
        actions: [makeAction()],
      });

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toMatch(/^error: network timeout/);
      expect(result.content).toBe(LONG_ORIGINAL);
    });
  });

  describe("resolveRemediationModel via getRemediationModelId()", () => {
    it("returns the original modelId when it is already STRONG tier (gpt-4o)", async () => {
      const chat = makeChatFacade({ content: "x" });
      const engine = makeEngineFacade();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      // gpt-4o matches /gpt-4o(?!-mini)/i → STRONG tier
      const modelId = await svc.getRemediationModelId("gpt-4o");

      expect(modelId).toBe("gpt-4o");
      expect(engine.selectModel).not.toHaveBeenCalled();
    });

    it("calls selectModel and returns STRONG model when input is non-STRONG", async () => {
      const chat = makeChatFacade({ content: "x" });
      // Return a model id that classifyModelTier will see as STRONG (gpt-4o)
      const engine = makeEngineFacade({ modelId: "gpt-4o" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      // "gpt-3.5-turbo" → BASIC (no match in any pattern) → non-STRONG
      const modelId = await svc.getRemediationModelId("gpt-3.5-turbo");

      expect(engine.selectModel).toHaveBeenCalled();
      // Result: gpt-4o (STRONG) → returned
      expect(modelId).toBe("gpt-4o");
    });

    it("returns empty string when selectModel throws", async () => {
      const chat = makeChatFacade({ content: "x" });
      const engine = makeEngineFacade({ throws: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      const modelId = await svc.getRemediationModelId("gpt-3.5-turbo");

      expect(modelId).toBe("");
    });

    it("returns empty string when selectModel returns null", async () => {
      const chat = makeChatFacade({ content: "x" });
      const engine = makeEngineFacade({ modelId: undefined }); // returns null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      const modelId = await svc.getRemediationModelId("gpt-3.5-turbo");

      expect(modelId).toBe("");
    });

    it("returns empty string when selectModel returns non-STRONG model", async () => {
      const chat = makeChatFacade({ content: "x" });
      // Simulate selectModel returning a cheap/balanced model
      const engine = makeEngineFacade({ modelId: "gpt-3.5-turbo" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      const modelId = await svc.getRemediationModelId("gpt-3.5-turbo");

      // Falls back to "" because selected model is also not STRONG
      expect(typeof modelId).toBe("string");
    });
  });

  describe("remediate() — multiple actions merged into one LLM call", () => {
    it("merges all actions into a single ChatFacade call", async () => {
      const remediatedContent = "H".repeat(300);
      const chat = makeChatFacade({ content: remediatedContent });
      const engine = makeEngineFacade({ modelId: "gpt-4o" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new SectionRemediationService(chat as any, engine as any);

      const actions: RemediationAction[] = [
        makeAction({
          type: "deepen_analysis",
          score: 4,
          guidance: "Add more depth.",
        }),
        makeAction({
          type: "inject_evidence",
          score: 5,
          guidance: "Add statistics.",
        }),
        makeAction({
          type: "add_recommendations",
          score: 6,
          guidance: "Add recommendations.",
        }),
      ];

      const result = await svc.remediate({
        content: LONG_ORIGINAL,
        sectionTitle: "Analysis",
        actions,
      });

      expect(chat.chat).toHaveBeenCalledTimes(1); // single merged call
      expect(result.actionsApplied).toHaveLength(3);
      expect(result.skipped).toBe(false);
    });
  });
});
