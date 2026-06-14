/**
 * VerifierAgent — unit tests
 *
 * 当前唯一 mode: citation-audit。
 * 历史预留 mode（number-check / claim-grounding / source-tier）已删
 * （2026-05-15 PR-E）：从未接入 orchestrator + 没有 SKILL.md duty body。
 */

import { z } from "zod";
import { readDefineAgentMeta } from "../../../../../../ai-harness/agents/dev-tools";
import { VerifierAgent } from "../verifier.agent";
import * as dutyLoader from "../../_shared/skill-loader";

const meta = readDefineAgentMeta(VerifierAgent)!;
const inputSchema = meta.inputSchema as z.ZodType;
const outputSchema = meta.outputSchema as z.ZodType;

const citationAuditInput = {
  mode: "citation-audit" as const,
  topic: "AI in Finance",
  language: "zh-CN" as const,
  citations: [
    {
      index: 1,
      url: "https://example.com/source1",
      inlineQuote: "AI revenue grew 40%",
    },
  ],
};

const verdict = {
  status: "verified" as const,
  evidence: "Source clearly states the claim with matching data.",
};

describe("VerifierAgent", () => {
  let agent: VerifierAgent;

  beforeAll(() => {
    agent = new VerifierAgent();
  });

  describe("inputSchema — citation-audit", () => {
    it("accepts valid citation-audit input", () => {
      expect(inputSchema.safeParse(citationAuditInput).success).toBe(true);
    });

    it("rejects empty citations array (min 1)", () => {
      expect(
        inputSchema.safeParse({ ...citationAuditInput, citations: [] }).success,
      ).toBe(false);
    });

    it("accepts citation without optional inlineQuote", () => {
      expect(
        inputSchema.safeParse({
          ...citationAuditInput,
          citations: [{ index: 1, url: "https://example.com" }],
        }).success,
      ).toBe(true);
    });

    it("rejects citation with non-integer index", () => {
      expect(
        inputSchema.safeParse({
          ...citationAuditInput,
          citations: [{ index: 1.5, url: "https://example.com" }],
        }).success,
      ).toBe(false);
    });

    it("accepts language en-US", () => {
      expect(
        inputSchema.safeParse({ ...citationAuditInput, language: "en-US" })
          .success,
      ).toBe(true);
    });

    it("rejects invalid language", () => {
      expect(
        inputSchema.safeParse({ ...citationAuditInput, language: "de-DE" })
          .success,
      ).toBe(false);
    });

    it("rejects missing topic", () => {
      const { topic: _, ...rest } = citationAuditInput as Record<
        string,
        unknown
      >;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects non-literal mode", () => {
      expect(
        inputSchema.safeParse({ ...citationAuditInput, mode: "number-check" })
          .success,
      ).toBe(false);
    });
  });

  describe("outputSchema — citation-audit", () => {
    it("accepts valid citation-audit output", () => {
      expect(
        outputSchema.safeParse({
          mode: "citation-audit",
          summary: { total: 1, verified: 1, unverified: 0, contradicted: 0 },
          verdicts: [{ index: 1, url: "https://example.com", ...verdict }],
        }).success,
      ).toBe(true);
    });

    it("rejects non-integer summary.total", () => {
      expect(
        outputSchema.safeParse({
          mode: "citation-audit",
          summary: { total: 1.5, verified: 1, unverified: 0, contradicted: 0 },
          verdicts: [],
        }).success,
      ).toBe(false);
    });

    it("accepts all valid verdict statuses", () => {
      for (const status of [
        "verified",
        "unverified-but-plausible",
        "unverified-suspicious",
        "contradicted",
      ] as const) {
        expect(
          outputSchema.safeParse({
            mode: "citation-audit",
            summary: { total: 1, verified: 0, unverified: 0, contradicted: 0 },
            verdicts: [{ ...verdict, status }],
          }).success,
        ).toBe(true);
      }
    });

    it("rejects invalid verdict status", () => {
      expect(
        outputSchema.safeParse({
          mode: "citation-audit",
          summary: { total: 1, verified: 0, unverified: 0, contradicted: 0 },
          verdicts: [{ ...verdict, status: "unknown" }],
        }).success,
      ).toBe(false);
    });

    it("accepts verdict without optional index and url", () => {
      expect(
        outputSchema.safeParse({
          mode: "citation-audit",
          summary: { total: 1, verified: 1, unverified: 0, contradicted: 0 },
          verdicts: [
            {
              status: "verified" as const,
              evidence: "Source confirms claim.",
            },
          ],
        }).success,
      ).toBe(true);
    });
  });

  describe("buildSystemPrompt", () => {
    const identity = {
      role: { id: "verifier", name: "Verifier" },
    } as never;

    it("citation-audit mode calls buildPromptFromDuty with correct args", () => {
      const spy = jest
        .spyOn(dutyLoader, "buildPromptFromDuty")
        .mockReturnValue("mocked citation-audit prompt");
      agent.buildSystemPrompt({ input: citationAuditInput, identity });
      expect(spy).toHaveBeenCalledWith(
        "verifier",
        "citation-audit",
        expect.objectContaining({ currentDate: expect.any(String) }),
      );
      spy.mockRestore();
    });

    it("injects currentDate in YYYY-MM-DD format", () => {
      const spy = jest
        .spyOn(dutyLoader, "buildPromptFromDuty")
        .mockReturnValue("mocked prompt");
      agent.buildSystemPrompt({ input: citationAuditInput, identity });
      const args = spy.mock.calls[0];
      const vars = args[2] as unknown as Record<string, unknown>;
      expect(typeof vars["currentDate"]).toBe("string");
      expect(vars["currentDate"] as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      spy.mockRestore();
    });

    it("citation-audit prompt returns string (real duty file exists)", () => {
      dutyLoader.clearDutyCache();
      const prompt = agent.buildSystemPrompt({
        input: citationAuditInput,
        identity,
      });
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe("taskProfile", () => {
    it("declares reasoningDepth minimal for fast mechanical check", () => {
      expect(meta.taskProfile?.reasoningDepth).toBe("minimal");
    });
  });
});
