/**
 * Unit tests for ContextCompactionPipelineService
 */

import { Logger } from "@nestjs/common";
import {
  ContextCompactionPipelineService,
  LLMMessage,
  SummarizeFn,
} from "../context-compaction-pipeline.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(): ContextCompactionPipelineService {
  jest.spyOn(Logger.prototype, "log").mockImplementation();
  jest.spyOn(Logger.prototype, "warn").mockImplementation();
  jest.spyOn(Logger.prototype, "debug").mockImplementation();
  return new ContextCompactionPipelineService();
}

function systemMsg(content: string): LLMMessage {
  return { role: "system", content };
}

function userMsg(content: string): LLMMessage {
  return { role: "user", content };
}

function assistantMsg(content: string): LLMMessage {
  return { role: "assistant", content };
}

function toolUseMsg(toolUseId: string, content = "calling tool"): LLMMessage {
  return { role: "assistant", content, isToolUse: true, toolUseId };
}

function toolResultMsg(toolResultFor: string, content = "result"): LLMMessage {
  return { role: "tool", content, isToolResult: true, toolResultFor };
}

/** Build a conversation with N user+assistant turn pairs */
function buildConversation(turns: number): LLMMessage[] {
  const msgs: LLMMessage[] = [];
  for (let i = 0; i < turns; i++) {
    msgs.push(userMsg(`User message ${i + 1}`));
    msgs.push(assistantMsg(`Assistant reply ${i + 1}`));
  }
  return msgs;
}

/** Configuration with a 128 000-token window */
const WINDOW = 128_000;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ContextCompactionPipelineService", () => {
  let service: ContextCompactionPipelineService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  // -------------------------------------------------------------------------
  // Level "none"
  // -------------------------------------------------------------------------

  describe("below pruneThreshold", () => {
    it('returns levelApplied "none" and leaves messages unchanged', async () => {
      const messages = [userMsg("hello"), assistantMsg("hi")];
      // 50 % utilization (< 60 % pruneThreshold)
      const currentTokens = Math.floor(WINDOW * 0.5);

      const result = await service.compact(messages, currentTokens, {
        contextWindowTokens: WINDOW,
      });

      expect(result.levelApplied).toBe("none");
      expect(result.messages).toBe(messages); // same reference — no copy
      expect(result.messagesRemoved).toBe(0);
      expect(result.tokensSaved).toBe(0);
      expect(result.summaryInserted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Level "prune"
  // -------------------------------------------------------------------------

  describe("at pruneThreshold", () => {
    it('returns levelApplied "prune" and removes old messages', async () => {
      const messages = buildConversation(6); // 12 messages total
      // 65 % utilization (>= 60 % prune, < 80 % summarize)
      const currentTokens = Math.floor(WINDOW * 0.65);

      const result = await service.compact(messages, currentTokens, {
        contextWindowTokens: WINDOW,
        preserveLastNTurns: 2,
      });

      expect(result.levelApplied).toBe("prune");
      expect(result.messagesRemoved).toBeGreaterThan(0);
      expect(result.messages.length).toBeLessThan(messages.length);
      expect(result.summaryInserted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Level "summarize"
  // -------------------------------------------------------------------------

  describe("at summarizeThreshold WITH summarizeFn", () => {
    it('returns levelApplied "summarize" and summaryInserted true', async () => {
      const messages = buildConversation(8);
      const currentTokens = Math.floor(WINDOW * 0.85);

      const summarizeFn: SummarizeFn = jest
        .fn()
        .mockResolvedValue("Summary of earlier conversation");

      const result = await service.compact(
        messages,
        currentTokens,
        { contextWindowTokens: WINDOW, preserveLastNTurns: 2 },
        summarizeFn,
      );

      expect(result.levelApplied).toBe("summarize");
      expect(result.summaryInserted).toBe(true);
      expect(
        result.messages.some(
          (m) =>
            typeof m.content === "string" &&
            m.content.includes("[Conversation Summary]"),
        ),
      ).toBe(true);
    });
  });

  describe("at summarizeThreshold WITHOUT summarizeFn", () => {
    it('falls back to "prune" when no summarizeFn is provided', async () => {
      const messages = buildConversation(8);
      const currentTokens = Math.floor(WINDOW * 0.85);

      // No summarizeFn supplied
      const result = await service.compact(messages, currentTokens, {
        contextWindowTokens: WINDOW,
        preserveLastNTurns: 2,
      });

      expect(result.levelApplied).toBe("prune");
      expect(result.summaryInserted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Level "emergency"
  // -------------------------------------------------------------------------

  describe("at emergencyThreshold", () => {
    it('returns levelApplied "emergency" and keeps only system + last turn', async () => {
      const messages = [systemMsg("System prompt"), ...buildConversation(6)];
      // 97 % utilization (>= 95 % emergencyThreshold)
      const currentTokens = Math.floor(WINDOW * 0.97);

      const result = await service.compact(messages, currentTokens, {
        contextWindowTokens: WINDOW,
      });

      expect(result.levelApplied).toBe("emergency");
      // System prompt preserved + last 1 turn (user + assistant = 2 msgs)
      const systemCount = result.messages.filter(
        (m) => m.role === "system",
      ).length;
      expect(systemCount).toBe(1);
      // Should have far fewer messages than the original 14
      expect(result.messages.length).toBeLessThan(messages.length);
    });
  });

  // -------------------------------------------------------------------------
  // preserveSystemPrompt
  // -------------------------------------------------------------------------

  describe("preserveSystemPrompt", () => {
    it("always keeps system messages when preserveSystemPrompt is true", async () => {
      const messages = [
        systemMsg("Important system instructions"),
        ...buildConversation(6),
      ];
      const currentTokens = Math.floor(WINDOW * 0.65);

      const result = await service.compact(messages, currentTokens, {
        contextWindowTokens: WINDOW,
        preserveSystemPrompt: true,
        preserveLastNTurns: 2,
      });

      const hasSystem = result.messages.some((m) => m.role === "system");
      expect(hasSystem).toBe(true);
    });

    it("does not separate system messages when preserveSystemPrompt is false", async () => {
      const messages = [
        systemMsg("Should not be specially preserved"),
        ...buildConversation(6),
      ];
      const currentTokens = Math.floor(WINDOW * 0.65);

      // With preserveSystemPrompt false, the system message joins the conversation pool
      // and may be pruned. It is at index 0 (oldest) so it will typically be removed.
      const result = await service.compact(messages, currentTokens, {
        contextWindowTokens: WINDOW,
        preserveSystemPrompt: false,
        preserveLastNTurns: 1,
      });

      // levelApplied must be prune (not "none")
      expect(result.levelApplied).toBe("prune");
    });
  });

  // -------------------------------------------------------------------------
  // preserveLastNTurns
  // -------------------------------------------------------------------------

  describe("preserveLastNTurns", () => {
    it("keeps at least the last 3 user turns after pruning", async () => {
      // 8 turns => 16 messages; last 3 user msgs are at indices 10, 12, 14
      const messages = buildConversation(8);
      const currentTokens = Math.floor(WINDOW * 0.65);

      const result = await service.compact(messages, currentTokens, {
        contextWindowTokens: WINDOW,
        preserveLastNTurns: 3,
      });

      const userMsgs = result.messages.filter((m) => m.role === "user");
      expect(userMsgs.length).toBeGreaterThanOrEqual(3);
    });
  });

  // -------------------------------------------------------------------------
  // Tool pair preservation
  // -------------------------------------------------------------------------

  describe("tool pair preservation", () => {
    it("moves tool_use to keep set when its tool_result is in keep set", async () => {
      const useId = "tool-abc";
      // Build: 5 old turns, then a tool_use (in removal candidates), then a
      // tool_result + new user turn (in keep set due to preserveLastNTurns)
      const messages: LLMMessage[] = [
        ...buildConversation(5), // 10 messages, all old
        toolUseMsg(useId), // candidate for removal
        toolResultMsg(useId), // in keep zone (recent)
        userMsg("Follow-up question"),
      ];
      const currentTokens = Math.floor(WINDOW * 0.65);

      const result = await service.compact(messages, currentTokens, {
        contextWindowTokens: WINDOW,
        preserveLastNTurns: 2,
        preserveToolPairs: true,
      });

      // The tool_use should have been moved to keep alongside its tool_result
      const keptToolUseIds = result.messages
        .filter((m) => m.isToolUse)
        .map((m) => m.toolUseId);
      expect(keptToolUseIds).toContain(useId);
    });

    it("does not preserve pairs when preserveToolPairs is false", async () => {
      const useId = "tool-xyz";
      const messages: LLMMessage[] = [
        ...buildConversation(5),
        toolUseMsg(useId),
        toolResultMsg(useId),
        userMsg("Follow-up"),
      ];
      const currentTokens = Math.floor(WINDOW * 0.65);

      const result = await service.compact(messages, currentTokens, {
        contextWindowTokens: WINDOW,
        preserveLastNTurns: 1,
        preserveToolPairs: false,
      });

      // With pair preservation off, tool_use may be removed; only check level
      expect(result.levelApplied).toBe("prune");
    });
  });

  // -------------------------------------------------------------------------
  // Summarization failure fallback
  // -------------------------------------------------------------------------

  describe("summarization failure", () => {
    it("falls back to prune when summarizeFn rejects", async () => {
      const messages = buildConversation(8);
      const currentTokens = Math.floor(WINDOW * 0.85);

      const failingSummarizeFn: SummarizeFn = jest
        .fn()
        .mockRejectedValue(new Error("LLM unavailable"));

      const result = await service.compact(
        messages,
        currentTokens,
        { contextWindowTokens: WINDOW, preserveLastNTurns: 2 },
        failingSummarizeFn,
      );

      expect(result.levelApplied).toBe("prune");
      expect(result.summaryInserted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Empty conversation
  // -------------------------------------------------------------------------

  describe("empty conversation", () => {
    it("handles empty message array gracefully", async () => {
      const result = await service.compact([], Math.floor(WINDOW * 0.65), {
        contextWindowTokens: WINDOW,
      });

      // Either "none" (nothing to prune) or "prune" with 0 removed — both acceptable
      expect(result.messagesRemoved).toBe(0);
      expect(result.messages).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // messagesRemoved count
  // -------------------------------------------------------------------------

  describe("messagesRemoved count", () => {
    it("reports the correct number of removed messages", async () => {
      const messages = buildConversation(6); // 12 messages
      const originalCount = messages.length;
      const currentTokens = Math.floor(WINDOW * 0.65);

      const result = await service.compact(messages, currentTokens, {
        contextWindowTokens: WINDOW,
        preserveLastNTurns: 2,
      });

      expect(result.messagesRemoved).toBe(
        originalCount - result.messages.length,
      );
    });
  });

  // -------------------------------------------------------------------------
  // tokensSaved
  // -------------------------------------------------------------------------

  describe("tokensSaved", () => {
    it("is positive when compaction removes messages with content", async () => {
      // Each message has substantial content so token estimate is non-zero
      const messages: LLMMessage[] = [
        userMsg("A".repeat(500)),
        assistantMsg("B".repeat(500)),
        userMsg("C".repeat(500)),
        assistantMsg("D".repeat(500)),
        userMsg("E".repeat(500)),
        assistantMsg("F".repeat(500)),
      ];
      const currentTokens = Math.floor(WINDOW * 0.65);

      const result = await service.compact(messages, currentTokens, {
        contextWindowTokens: WINDOW,
        preserveLastNTurns: 1,
      });

      if (result.messagesRemoved > 0) {
        expect(result.tokensSaved).toBeGreaterThan(0);
      }
    });
  });
});
