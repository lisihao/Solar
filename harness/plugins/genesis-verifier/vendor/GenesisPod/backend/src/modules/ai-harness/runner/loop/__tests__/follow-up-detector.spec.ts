/**
 * ★ Claude Code P0-2 借鉴：follow-up-detector 单元测试
 *
 * 验证 hasUnexecutedToolUse / rawContentHasUnexecutedToolIntent / envelopeHasUnexecutedToolUse
 * 在各种场景下的判定行为。
 *
 * 参考：Claude Code query.ts:553-557
 *   "stop_reason === 'tool_use' is unreliable — check content for unexecuted
 *    tool_use blocks instead."
 */

import {
  hasUnexecutedToolUse,
  rawContentHasUnexecutedToolIntent,
  envelopeHasUnexecutedToolUse,
  extractToolUseState,
  type AssistantContentBlock,
} from "../utils/follow-up-detector";

// ─────────────────────────────────────────────────────────────────────────────
// hasUnexecutedToolUse — 原生 content block 格式
// ─────────────────────────────────────────────────────────────────────────────

describe("hasUnexecutedToolUse", () => {
  it("returns false when content array is empty", () => {
    expect(hasUnexecutedToolUse([], [])).toBe(false);
  });

  it("returns false when content has only text blocks (no tool_use)", () => {
    const blocks: AssistantContentBlock[] = [
      { type: "text", content: "Here is my answer." },
    ];
    expect(hasUnexecutedToolUse(blocks, [])).toBe(false);
  });

  it("returns true when content has a tool_use block with no executed result", () => {
    const blocks: AssistantContentBlock[] = [
      { type: "text", content: "Let me search." },
      {
        type: "tool_use",
        id: "toolu_abc123",
        name: "web_search",
        input: { q: "test" },
      },
    ];
    expect(hasUnexecutedToolUse(blocks, [])).toBe(true);
  });

  it("returns false when all tool_use blocks have been executed", () => {
    const blocks: AssistantContentBlock[] = [
      {
        type: "tool_use",
        id: "toolu_abc123",
        name: "web_search",
        input: { q: "test" },
      },
      {
        type: "tool_use",
        id: "toolu_def456",
        name: "calculator",
        input: { expr: "2+2" },
      },
    ];
    expect(hasUnexecutedToolUse(blocks, ["toolu_abc123", "toolu_def456"])).toBe(
      false,
    );
  });

  it("returns true when only some tool_use blocks have been executed", () => {
    const blocks: AssistantContentBlock[] = [
      {
        type: "tool_use",
        id: "toolu_abc123",
        name: "web_search",
        input: { q: "test" },
      },
      {
        type: "tool_use",
        id: "toolu_def456",
        name: "calculator",
        input: { expr: "2+2" },
      },
    ];
    // Only first one executed
    expect(hasUnexecutedToolUse(blocks, ["toolu_abc123"])).toBe(true);
  });

  it("treats thinking blocks as non-tool-use (returns false with only thinking)", () => {
    const blocks: AssistantContentBlock[] = [
      { type: "thinking", content: "I need to think about this..." },
      { type: "text", content: "Final answer." },
    ];
    expect(hasUnexecutedToolUse(blocks, [])).toBe(false);
  });

  it("handles mixed thinking + tool_use blocks correctly", () => {
    const blocks: AssistantContentBlock[] = [
      { type: "thinking", content: "Let me search for this." },
      {
        type: "tool_use",
        id: "toolu_xyz789",
        name: "web_search",
        input: { q: "query" },
      },
      { type: "text", content: "Based on my search..." },
    ];
    // tool_use not yet executed
    expect(hasUnexecutedToolUse(blocks, [])).toBe(true);
    // tool_use executed
    expect(hasUnexecutedToolUse(blocks, ["toolu_xyz789"])).toBe(false);
  });

  it("returns true conservatively when tool_use block has no id", () => {
    const blocks: AssistantContentBlock[] = [
      { type: "tool_use", name: "web_search" }, // no id
    ];
    // No id → treated as unexecuted (conservative)
    expect(hasUnexecutedToolUse(blocks, ["toolu_abc123"])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rawContentHasUnexecutedToolIntent — ReAct JSON 协议场景
// ─────────────────────────────────────────────────────────────────────────────

describe("rawContentHasUnexecutedToolIntent", () => {
  it("returns false when there was no parse error (LLM finalized cleanly)", () => {
    const raw =
      '{"thinking":"done","action":{"kind":"tool_call","toolId":"calc","input":{}}}';
    expect(rawContentHasUnexecutedToolIntent(raw, false)).toBe(false);
  });

  it("returns false when rawContent is empty even with parse error", () => {
    expect(rawContentHasUnexecutedToolIntent("", true)).toBe(false);
  });

  it("returns false when rawContent has no tool_call patterns even with parse error", () => {
    const raw = "The answer to your question is 42.";
    expect(rawContentHasUnexecutedToolIntent(raw, true)).toBe(false);
  });

  it('returns true when rawContent contains "kind":"tool_call" with parse error', () => {
    // Simulates truncated JSON that parseDecision failed to extract
    const raw =
      '{"thinking":"I need to search","action":{"kind":"tool_call","toolId":"web-search","input"';
    expect(rawContentHasUnexecutedToolIntent(raw, true)).toBe(true);
  });

  it('returns true when rawContent contains "kind":"parallel_tool_call" with parse error', () => {
    const raw =
      '```json\n{"thinking":"parallel search","action":{"kind":"parallel_tool_call"';
    expect(rawContentHasUnexecutedToolIntent(raw, true)).toBe(true);
  });

  it('returns true when rawContent contains "toolId": with parse error', () => {
    const raw =
      'some prefix {"toolId": "web-search", "input": {"q": "test"}} some suffix';
    expect(rawContentHasUnexecutedToolIntent(raw, true)).toBe(true);
  });

  it('returns true when rawContent contains "type":"tool_use" with parse error (Anthropic native)', () => {
    const raw = '{"type":"tool_use","id":"toolu_123","name":"web_search"}';
    expect(rawContentHasUnexecutedToolIntent(raw, true)).toBe(true);
  });

  it("returns false when parse error but content is just plain text finalize", () => {
    const raw =
      "I have gathered all the information needed. Here is my summary: ...";
    expect(rawContentHasUnexecutedToolIntent(raw, true)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractToolUseState — envelope message 扫描
// ─────────────────────────────────────────────────────────────────────────────

describe("extractToolUseState", () => {
  it("returns empty arrays for messages with string content", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content:
          '{"thinking":"...","action":{"kind":"finalize","output":"hi"}}',
      },
    ];
    const result = extractToolUseState(msgs);
    expect(result.pendingToolUseIds).toEqual([]);
    expect(result.executedToolResultIds).toEqual([]);
  });

  it("extracts tool_use IDs from assistant messages with block arrays", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", content: "Let me search." },
          { type: "tool_use", id: "toolu_111", name: "web_search", input: {} },
        ] as AssistantContentBlock[],
      },
    ];
    const result = extractToolUseState(msgs);
    expect(result.pendingToolUseIds).toEqual(["toolu_111"]);
    expect(result.executedToolResultIds).toEqual([]);
  });

  it("extracts tool_result IDs from tool messages with block arrays", () => {
    const msgs = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_111",
            content: "result data",
          },
        ] as AssistantContentBlock[],
      },
    ];
    const result = extractToolUseState(msgs);
    expect(result.pendingToolUseIds).toEqual([]);
    expect(result.executedToolResultIds).toEqual(["toolu_111"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// envelopeHasUnexecutedToolUse — 综合场景
// ─────────────────────────────────────────────────────────────────────────────

describe("envelopeHasUnexecutedToolUse", () => {
  it("returns false when messages have only string content", () => {
    const msgs = [
      { role: "user", content: "What is 2+2?" },
      {
        role: "assistant",
        content: '{"thinking":"","action":{"kind":"finalize","output":"4"}}',
      },
    ];
    expect(envelopeHasUnexecutedToolUse(msgs)).toBe(false);
  });

  it("returns true when assistant has tool_use block without corresponding tool_result", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_abc",
            name: "web_search",
            input: { q: "ai" },
          },
        ] as AssistantContentBlock[],
      },
    ];
    expect(envelopeHasUnexecutedToolUse(msgs)).toBe(true);
  });

  it("returns false when all tool_use blocks have corresponding tool_result blocks", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_abc",
            name: "web_search",
            input: { q: "ai" },
          },
        ] as AssistantContentBlock[],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_abc",
            content: "search results",
          },
        ] as AssistantContentBlock[],
      },
    ];
    expect(envelopeHasUnexecutedToolUse(msgs)).toBe(false);
  });
});
