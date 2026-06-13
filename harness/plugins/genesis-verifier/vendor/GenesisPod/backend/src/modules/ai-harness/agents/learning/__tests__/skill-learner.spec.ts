/**
 * SkillLearner 单元测试
 */

import { SkillLearner } from "../skill-learner";
import { AgentIdentity } from "../../core/agent-identity";
import type { IAgentEvent } from "../../abstractions";

const identity = AgentIdentity.of({
  id: "researcher",
  name: "Researcher",
  description: "A research agent",
});

function mkEvents(): IAgentEvent[] {
  return [
    {
      type: "thinking",
      agentId: "a1",
      timestamp: 0,
      payload: { text: "let me search", tokenCount: 5 },
    },
    {
      type: "action_planned",
      agentId: "a1",
      timestamp: 1,
      payload: { kind: "tool_call", toolId: "web-search", input: { q: "X" } },
    },
    {
      type: "action_executed",
      agentId: "a1",
      timestamp: 2,
      payload: {
        action: { kind: "tool_call", toolId: "web-search", input: { q: "X" } },
        output: "results",
        latencyMs: 10,
      },
    },
    {
      type: "action_planned",
      agentId: "a1",
      timestamp: 3,
      payload: { kind: "tool_call", toolId: "fetch", input: { url: "u" } },
    },
    {
      type: "action_executed",
      agentId: "a1",
      timestamp: 4,
      payload: {
        action: { kind: "tool_call", toolId: "fetch", input: { url: "u" } },
        output: "page",
        latencyMs: 20,
      },
    },
    {
      type: "action_planned",
      agentId: "a1",
      timestamp: 5,
      payload: { kind: "finalize", output: "done" },
    },
    {
      type: "output",
      agentId: "a1",
      timestamp: 6,
      payload: { output: "done" },
    },
    {
      type: "terminated",
      agentId: "a1",
      timestamp: 7,
      payload: { reason: "completed" },
    },
  ];
}

describe("SkillLearner", () => {
  it("returns null when chatService not available", async () => {
    const learner = new SkillLearner();
    const result = await learner.learn({
      identity,
      events: mkEvents(),
    });
    expect(result).toBeNull();
  });

  it("returns null when trace has no actions", async () => {
    const chat = { chat: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const learner = new SkillLearner(chat as any);
    const result = await learner.learn({
      identity,
      events: [
        {
          type: "thinking",
          agentId: "a1",
          timestamp: 0,
          payload: { text: "empty", tokenCount: 1 },
        },
      ],
    });
    expect(result).toBeNull();
    expect(chat.chat).not.toHaveBeenCalled();
  });

  it("produces SkillCandidate with parsed frontmatter", async () => {
    const skillMd = `---
name: research-two-step
description: Search then fetch then finalize
tags: [research, web]
allowedTools: [web-search, fetch]
---

# Instructions

1. Use web-search to find candidates
2. Fetch each candidate
3. Synthesize and finalize`;

    const chat = {
      chat: jest.fn(async () => ({
        content: skillMd,
        model: "mock",
        usage: { totalTokens: 100 },
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const learner = new SkillLearner(chat as any);
    const result = await learner.learn({
      identity,
      events: mkEvents(),
      successSummary: "Completed with 2 tools",
    });

    expect(result).not.toBeNull();
    expect(result?.suggestedId).toBe("research-two-step");
    expect(result?.frontmatter.name).toBe("research-two-step");
    expect(result?.frontmatter.tags).toEqual(["research", "web"]);
    expect(result?.frontmatter.allowedTools).toEqual(["web-search", "fetch"]);
    expect(result?.stats.toolsUsed.sort()).toEqual(["fetch", "web-search"]);
    expect(result?.stats.actionCount).toBe(3); // 2 tool_call + 1 finalize
    expect(result?.markdown).toContain("# Instructions");
  });

  it("strips code fences from LLM output", async () => {
    const wrapped =
      "```markdown\n---\nname: x\ndescription: d\n---\n\nbody\n```";
    const chat = {
      chat: jest.fn(async () => ({
        content: wrapped,
        model: "mock",
        usage: { totalTokens: 10 },
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const learner = new SkillLearner(chat as any);
    const result = await learner.learn({ identity, events: mkEvents() });
    expect(result?.markdown.startsWith("```")).toBe(false);
    expect(result?.frontmatter.name).toBe("x");
  });

  it("returns null when LLM output has no valid frontmatter", async () => {
    const chat = {
      chat: jest.fn(async () => ({
        content: "just some prose, no frontmatter",
        model: "mock",
        usage: { totalTokens: 5 },
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const learner = new SkillLearner(chat as any);
    const result = await learner.learn({ identity, events: mkEvents() });
    expect(result).toBeNull();
  });

  it("handles LLM errors gracefully", async () => {
    const chat = {
      chat: jest.fn(async () => {
        throw new Error("LLM down");
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const learner = new SkillLearner(chat as any);
    const result = await learner.learn({ identity, events: mkEvents() });
    expect(result).toBeNull();
  });

  it("parses inline-array frontmatter format", async () => {
    const skillMd = `---
name: inline-test
description: desc
tags: [a, b, c]
allowedTools: [t1]
---
body`;
    const chat = {
      chat: jest.fn(async () => ({
        content: skillMd,
        model: "mock",
        usage: { totalTokens: 10 },
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const learner = new SkillLearner(chat as any);
    const result = await learner.learn({ identity, events: mkEvents() });
    expect(result?.frontmatter.tags).toEqual(["a", "b", "c"]);
    expect(result?.frontmatter.allowedTools).toEqual(["t1"]);
  });
});
