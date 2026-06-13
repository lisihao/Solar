/**
 * SkillLearningCoordinator 单元测试 (PR-F)
 *
 * 验证：
 *   - 高分（>= autoRegisterThreshold）→ 自动 register 到 SkillRegistry
 *   - 中分 → staged
 *   - 低分 / 解析失败 → rejected / skipped
 *   - approveStaged 升级到 registry
 */

import { SkillLearningCoordinator } from "../skill-learning-coordinator";
import { SkillLearner, type SkillCandidate } from "../skill-learner";
import { BuiltinSkillCatalog } from "../../skill-runtime/skill-registry";

const VALID_MARKDOWN = `---
name: web-search-protocol
description: A reusable protocol for fact-grounded web search
tags: [web, research]
allowedTools: [web-search, fetch]
---

# Web Search Protocol

When asked a factual question:
1. Use \`web-search\` to find candidate sources.
2. \`fetch\` the top 3 to verify.
3. Cite URLs in the final answer.
`;

const INVALID_MARKDOWN = "no frontmatter at all";

function fakeCandidate(markdown: string): SkillCandidate {
  return {
    suggestedId: "web-search-protocol",
    markdown,
    frontmatter: {
      name: "web-search-protocol",
      description: "x",
      tags: [],
      allowedTools: [],
    },
    stats: { totalEvents: 5, toolsUsed: ["web-search"], actionCount: 3 },
    rationale: "test",
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

describe("SkillLearningCoordinator (PR-F)", () => {
  it("auto-registers high-score candidate", async () => {
    const learner = {
      learn: jest.fn(async () => fakeCandidate(VALID_MARKDOWN)),
    };
    const registry = new BuiltinSkillCatalog();
    const judge = fakeJudge(85);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
      judge as any,
    );
    const r = await coord.closeLoop({
      identity: {
        role: { id: "researcher", name: "Researcher", description: "" },
        skills: [],
        tools: [],
      },
      events: [],
    });
    expect(r.decision).toBe("auto-registered");
    expect(registry.has("web-search-protocol")).toBe(true);
  });

  it("stages mid-score candidate without registering", async () => {
    const learner = {
      learn: jest.fn(async () => fakeCandidate(VALID_MARKDOWN)),
    };
    const registry = new BuiltinSkillCatalog();
    const judge = fakeJudge(70);
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      judge as any,
    );
    const r = await coord.closeLoop({
      identity: {
        role: { id: "x", name: "X", description: "" },
        skills: [],
        tools: [],
      },
      events: [],
    });
    expect(r.decision).toBe("staged");
    expect(registry.has("web-search-protocol")).toBe(false);
    expect(coord.listStaged()).toHaveLength(1);
  });

  it("approveStaged promotes staged skill into registry", async () => {
    const learner = {
      learn: jest.fn(async () => fakeCandidate(VALID_MARKDOWN)),
    };
    const registry = new BuiltinSkillCatalog();
    const judge = fakeJudge(70);
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      judge as any,
    );
    await coord.closeLoop({
      identity: {
        role: { id: "x", name: "X", description: "" },
        skills: [],
        tools: [],
      },
      events: [],
    });
    expect(coord.approveStaged("web-search-protocol")).toBe(true);
    expect(registry.has("web-search-protocol")).toBe(true);
    expect(coord.listStaged()).toHaveLength(0);
  });

  it("rejects low-score candidate", async () => {
    const learner = {
      learn: jest.fn(async () => fakeCandidate(VALID_MARKDOWN)),
    };
    const registry = new BuiltinSkillCatalog();
    const judge = fakeJudge(40);
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      judge as any,
    );
    const r = await coord.closeLoop({
      identity: {
        role: { id: "x", name: "X", description: "" },
        skills: [],
        tools: [],
      },
      events: [],
    });
    expect(r.decision).toBe("rejected");
    expect(r.score).toBe(40);
  });

  it("rejects unparseable markdown", async () => {
    const learner = {
      learn: jest.fn(async () => fakeCandidate(INVALID_MARKDOWN)),
    };
    const registry = new BuiltinSkillCatalog();
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
    );
    const r = await coord.closeLoop({
      identity: {
        role: { id: "x", name: "X", description: "" },
        skills: [],
        tools: [],
      },
      events: [],
    });
    expect(r.decision).toBe("rejected");
    expect(r.reason).toMatch(/parse-failed/);
  });

  it("skipped when learner returns null", async () => {
    const learner = { learn: jest.fn(async () => null) };
    const registry = new BuiltinSkillCatalog();
    const coord = new SkillLearningCoordinator(
      learner as unknown as SkillLearner,
      registry,
    );
    const r = await coord.closeLoop({
      identity: {
        role: { id: "x", name: "X", description: "" },
        skills: [],
        tools: [],
      },
      events: [],
    });
    expect(r.decision).toBe("skipped");
  });
});


