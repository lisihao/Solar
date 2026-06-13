/**
 * StewardAgent — unit tests
 *
 * 当前唯一 scope: budget-guard。
 * 历史预留 scope（compliance-check / data-boundary / source-diversity）
 * 已删（2026-05-15 PR-E）：从未接入 orchestrator + 没有 SKILL.md duty body。
 */

import { z } from "zod";
import { readDefineAgentMeta } from "@/modules/ai-harness/agents/dev-tools";
import { StewardAgent } from "../steward.agent";
import * as dutyLoader from "../../_shared/skill-loader";

const meta = readDefineAgentMeta(StewardAgent)!;
const inputSchema = meta.inputSchema as z.ZodType;
const outputSchema = meta.outputSchema as z.ZodType;

const alert = {
  level: "warning" as const,
  trigger: "token usage at 75%",
  current: "75000",
  threshold: "70%",
  suggestedAction: "Consider pausing non-critical stages",
};

const budgetGuardInput = {
  scope: "budget-guard" as const,
  missionId: "mission-123",
  language: "zh-CN" as const,
  snapshot: {
    tokensUsed: 75_000,
    tokensLimit: 100_000,
    costUsd: 0.5,
    stagesCompleted: ["S1", "S2"],
    stagesPending: ["S3", "S4"],
  },
  thresholds: {
    softWarnPct: 70,
    hardBlockPct: 95,
  },
};

describe("StewardAgent", () => {
  let agent: StewardAgent;

  beforeAll(() => {
    agent = new StewardAgent();
  });

  describe("inputSchema — budget-guard", () => {
    it("accepts valid budget-guard input", () => {
      expect(inputSchema.safeParse(budgetGuardInput).success).toBe(true);
    });

    it("defaults softWarnPct to 70 when omitted", () => {
      const { thresholds: _, ...rest } = budgetGuardInput as Record<
        string,
        unknown
      >;
      const r = inputSchema.safeParse({
        ...rest,
        thresholds: { hardBlockPct: 95 },
      });
      expect(r.success).toBe(true);
      if (r.success) {
        const thresholds = (r.data as Record<string, unknown>)[
          "thresholds"
        ] as Record<string, unknown>;
        expect(thresholds["softWarnPct"]).toBe(70);
      }
    });

    it("defaults hardBlockPct to 95 when omitted", () => {
      const r = inputSchema.safeParse({
        ...budgetGuardInput,
        thresholds: { softWarnPct: 70 },
      });
      expect(r.success).toBe(true);
      if (r.success) {
        const thresholds = (r.data as Record<string, unknown>)[
          "thresholds"
        ] as Record<string, unknown>;
        expect(thresholds["hardBlockPct"]).toBe(95);
      }
    });

    it("rejects budget-guard missing snapshot", () => {
      const { snapshot: _, ...rest } = budgetGuardInput as Record<
        string,
        unknown
      >;
      expect(inputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects non-integer tokensUsed", () => {
      expect(
        inputSchema.safeParse({
          ...budgetGuardInput,
          snapshot: { ...budgetGuardInput.snapshot, tokensUsed: 75000.5 },
        }).success,
      ).toBe(false);
    });

    it("rejects non-literal scope", () => {
      expect(
        inputSchema.safeParse({
          ...budgetGuardInput,
          scope: "compliance-check",
        }).success,
      ).toBe(false);
    });
  });

  describe("outputSchema — budget-guard", () => {
    it("accepts valid budget-guard output", () => {
      expect(
        outputSchema.safeParse({
          scope: "budget-guard",
          alerts: [alert],
        }).success,
      ).toBe(true);
    });

    it("accepts budget-guard output with empty alerts", () => {
      expect(
        outputSchema.safeParse({ scope: "budget-guard", alerts: [] }).success,
      ).toBe(true);
    });

    it("accepts all alert levels", () => {
      for (const level of ["info", "warning", "block"] as const) {
        expect(
          outputSchema.safeParse({
            scope: "budget-guard",
            alerts: [{ ...alert, level }],
          }).success,
        ).toBe(true);
      }
    });

    it("rejects invalid alert level", () => {
      expect(
        outputSchema.safeParse({
          scope: "budget-guard",
          alerts: [{ ...alert, level: "critical" }],
        }).success,
      ).toBe(false);
    });
  });

  describe("buildSystemPrompt", () => {
    const identity = {
      role: { id: "steward", name: "Steward" },
    } as never;

    it("budget-guard scope calls buildPromptFromDuty with correct args", () => {
      const spy = jest
        .spyOn(dutyLoader, "buildPromptFromDuty")
        .mockReturnValue("mocked budget-guard prompt");
      agent.buildSystemPrompt({ input: budgetGuardInput, identity });
      expect(spy).toHaveBeenCalledWith(
        "steward",
        "budget-guard",
        expect.any(Object),
      );
      spy.mockRestore();
    });

    it("budget-guard prompt returns string (real duty file exists)", () => {
      dutyLoader.clearDutyCache();
      const prompt = agent.buildSystemPrompt({
        input: budgetGuardInput,
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
