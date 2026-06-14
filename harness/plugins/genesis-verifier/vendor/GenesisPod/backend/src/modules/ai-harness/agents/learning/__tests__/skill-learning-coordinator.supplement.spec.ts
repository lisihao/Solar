/**
 * SkillLearningCoordinator — supplement branch coverage spec
 *
 * Targets uncovered branches:
 *   - sandboxReplayer.sample() returns empty array → replayScore=null, score not blended
 *   - sandboxReplayer.replay() throws → caught, log.warn
 *   - sandboxReplayer provided, samples.length > 0 → replay scoring blended
 *   - judge throws → score=0
 *   - no judge → heuristic score path
 *   - rejectStaged: name not found → returns false
 *   - approveStaged: name not found → returns false
 *   - non-SkillParseError thrown during parse → String(err) used
 */

import { Logger } from "@nestjs/common";
import { SkillLearningCoordinator } from "../skill-learning-coordinator";
import { SkillLearner, type SkillCandidate } from "../skill-learner";
import { BuiltinSkillCatalog } from "../../skill-runtime/skill-registry";

jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "log").mockImplementation();

const VALID_MARKDOWN = `---
name: test-skill
description: A test skill
tags: [test]
allowedTools: [web-search]
---

# Test Skill

When searching:
1. Use \`web-search\` to find sources.
2. Cite URLs.
`;

function fakeCandidate(markdown = VALID_MARKDOWN): SkillCandidate {
  return {
    suggestedId: "test-skill",
    markdown,
    frontmatter: {
      name: "test-skill",
      description: "test",
      tags: [],
      allowedTools: [],
    },
    stats: {
      totalEvents: 5,
      toolsUsed: ["web-search", "fetch"],
      actionCount: 4,
    },
    rationale: "test",
  };
}

function fakeIdentity() {
  return {
    role: { id: "researcher", name: "Researcher", description: "" },
    skills: [],
    tools: [],
  };
}

function fakeJudge(score: number) {
  return {
    judgeWithConsensus: jest.fn(async () => ({
      verdicts: [],
      decision: { verdict: "pass" as const, score },
    })),
  };
}

// ─── sandboxReplayer: empty samples ──────────────────────────────────────────

describe("SkillLearningCoordinator supplement — sandboxReplayer empty samples", () => {
  it("skips replay blending when sample() returns empty array", async () => {
    const learner = { learn: jest.fn(async () => fakeCandidate()) };
    const registry = new BuiltinSkillCatalog();
    const judge = fakeJudge(85);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
      judge as any,
    );

    const sandboxReplayer = {
      sample: jest.fn().mockResolvedValue([]), // empty → skip replay
      replay: jest.fn(),
    };

    const result = await coord.closeLoop({
      identity: fakeIdentity(),
      events: [],
      sandboxReplayer,
    });

    // No replay → judge score 85 used directly → auto-register
    expect(result.decision).toBe("auto-registered");
    expect(sandboxReplayer.replay).not.toHaveBeenCalled();
  });
});

// ─── sandboxReplayer: samples > 0 → replay blending ─────────────────────────

describe("SkillLearningCoordinator supplement — sandboxReplayer with samples", () => {
  it("blends judge score and replay score when samples exist", async () => {
    const learner = { learn: jest.fn(async () => fakeCandidate()) };
    const registry = new BuiltinSkillCatalog();
    const judge = fakeJudge(80); // judge score = 80
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
      judge as any,
    );

    const sandboxReplayer = {
      sample: jest.fn().mockResolvedValue([
        { id: "task-1", input: { prompt: "hello" } },
        { id: "task-2", input: { prompt: "world" } },
      ]),
      // replay returns score 100 → blended = round(80*0.6 + 100*0.4) = round(88) = 88
      replay: jest.fn().mockResolvedValue({ score: 100, note: "ok" }),
    };

    const result = await coord.closeLoop({
      identity: fakeIdentity(),
      events: [],
      sandboxReplayer,
    });

    // blended score = round(80*0.6 + 100*0.4) = 88 → auto-register (≥80)
    expect(result.decision).toBe("auto-registered");
    expect(sandboxReplayer.replay).toHaveBeenCalledTimes(2);
    expect(result.score).toBe(88);
  });
});

// ─── sandboxReplayer throws ──────────────────────────────────────────────────

describe("SkillLearningCoordinator supplement — sandboxReplayer throws", () => {
  it("falls back to judge-only score when sandboxReplayer throws", async () => {
    const learner = { learn: jest.fn(async () => fakeCandidate()) };
    const registry = new BuiltinSkillCatalog();
    const judge = fakeJudge(85);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
      judge as any,
    );

    const sandboxReplayer = {
      sample: jest.fn().mockRejectedValue(new Error("Sandbox unavailable")),
      replay: jest.fn(),
    };

    const result = await coord.closeLoop({
      identity: fakeIdentity(),
      events: [],
      sandboxReplayer,
    });

    // Replay throws → caught → replayScore=null → judge score 85 used → auto-register
    expect(result.decision).toBe("auto-registered");
    expect(result.score).toBe(85);
  });
});

// ─── judge throws → score=0 ──────────────────────────────────────────────────

describe("SkillLearningCoordinator supplement — judge throws", () => {
  it("sets score=0 when judge.judgeWithConsensus throws", async () => {
    const learner = { learn: jest.fn(async () => fakeCandidate()) };
    const registry = new BuiltinSkillCatalog();
    const badJudge = {
      judgeWithConsensus: jest.fn(async () => {
        throw new Error("Judge service unavailable");
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
      badJudge as any,
    );

    const result = await coord.closeLoop({
      identity: fakeIdentity(),
      events: [],
    });

    // score=0 < stagingThreshold(60) → rejected
    expect(result.decision).toBe("rejected");
    expect(result.score).toBe(0);
  });
});

// ─── no judge → heuristic score ──────────────────────────────────────────────

describe("SkillLearningCoordinator supplement — no judge (heuristic)", () => {
  it("uses actionCount * 8 + toolsUsed.length * 10 as heuristic score", async () => {
    const learner = {
      learn: jest.fn(async () => ({
        ...fakeCandidate(),
        stats: {
          totalEvents: 10,
          toolsUsed: ["web-search", "fetch", "calc"],
          actionCount: 5,
        },
      })),
    };
    const registry = new BuiltinSkillCatalog();
    // No judge injected
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
    );

    const result = await coord.closeLoop({
      identity: fakeIdentity(),
      events: [],
    });

    // heuristic: min(100, 5*8 + 3*10) = min(100, 40+30) = 70 → staged (60-79)
    expect(result.decision).toBe("staged");
    expect(result.score).toBe(70);
  });

  it("caps heuristic score at 100", async () => {
    const learner = {
      learn: jest.fn(async () => ({
        ...fakeCandidate(),
        stats: {
          totalEvents: 20,
          toolsUsed: ["a", "b", "c", "d", "e", "f", "g"],
          actionCount: 10,
        },
      })),
    };
    const registry = new BuiltinSkillCatalog();
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
    );

    const result = await coord.closeLoop({
      identity: fakeIdentity(),
      events: [],
    });

    // min(100, 10*8 + 7*10) = min(100, 80+70) = 100 → auto-register
    expect(result.score).toBe(100);
    expect(result.decision).toBe("auto-registered");
  });
});

// ─── rejectStaged / approveStaged: name not found ────────────────────────────

describe("SkillLearningCoordinator supplement — staging management", () => {
  it("rejectStaged returns false when name not in staging", () => {
    const learner = { learn: jest.fn() };
    const registry = new BuiltinSkillCatalog();
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
    );

    const result = coord.rejectStaged("nonexistent-skill");
    expect(result).toBe(false);
  });

  it("approveStaged returns false when name not in staging", () => {
    const learner = { learn: jest.fn() };
    const registry = new BuiltinSkillCatalog();
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
    );

    const result = coord.approveStaged("nonexistent-skill");
    expect(result).toBe(false);
  });

  it("rejectStaged returns true and removes staged skill", async () => {
    const learner = { learn: jest.fn(async () => fakeCandidate()) };
    const registry = new BuiltinSkillCatalog();
    const judge = fakeJudge(70); // staged
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
      judge as any,
    );

    await coord.closeLoop({ identity: fakeIdentity(), events: [] });
    expect(coord.listStaged()).toHaveLength(1);

    const rejected = coord.rejectStaged("test-skill");
    expect(rejected).toBe(true);
    expect(coord.listStaged()).toHaveLength(0);
    expect(registry.has("test-skill")).toBe(false);
  });
});

// ─── non-SkillParseError during parse ────────────────────────────────────────

describe("SkillLearningCoordinator supplement — generic parse error", () => {
  it("rejects with String(err) when non-SkillParseError is thrown during parse", async () => {
    // Provide markdown that is invalid but not a SkillParseError
    // We simulate by having the markdown content be a non-frontmatter string
    const badMarkdown = ""; // empty string → parse will fail
    const learner = { learn: jest.fn(async () => fakeCandidate(badMarkdown)) };
    const registry = new BuiltinSkillCatalog();
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
    );

    const result = await coord.closeLoop({
      identity: fakeIdentity(),
      events: [],
    });

    expect(result.decision).toBe("rejected");
    expect(result.reason).toMatch(/parse-failed/);
  });
});


