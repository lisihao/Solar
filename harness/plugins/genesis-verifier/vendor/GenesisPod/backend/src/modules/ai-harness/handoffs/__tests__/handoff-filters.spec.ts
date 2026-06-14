/**
 * Handoff envelope filters tests (G6)
 */
import { ContextEnvelope } from "@/modules/ai-harness/agents/core/context-envelope";
import type { IContextMessage } from "@/modules/ai-harness/agents/abstractions";
import {
  removeToolMessages,
  keepLastNMessages,
  redactMessages,
  composeFilters,
} from "../handoff-filters";

function env(messages: IContextMessage[]): ContextEnvelope {
  return new ContextEnvelope({
    system: "sys",
    messages,
    reminders: [],
    tools: ["t1"],
    memory: { sessionId: "s" } as never,
    budget: {} as never,
  });
}

const msg = (
  role: IContextMessage["role"],
  content: string,
): IContextMessage => ({ role, content });

describe("handoff-filters", () => {
  describe("removeToolMessages()", () => {
    it("drops tool messages, keeps the rest, preserves other fields", () => {
      const e = env([
        msg("user", "hi"),
        msg("tool", "search result"),
        msg("assistant", "answer"),
      ]);
      const out = removeToolMessages(e);
      expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(out.id).toBe(e.id); // identity preserved
      expect(out.tools).toEqual(["t1"]);
      expect(e.messages).toHaveLength(3); // original untouched (immutable)
    });
  });

  describe("keepLastNMessages()", () => {
    it("keeps only the last n", () => {
      const e = env([msg("user", "1"), msg("user", "2"), msg("user", "3")]);
      expect(keepLastNMessages(e, 2).messages.map((m) => m.content)).toEqual([
        "2",
        "3",
      ]);
    });
    it("returns same envelope when n >= length", () => {
      const e = env([msg("user", "1")]);
      expect(keepLastNMessages(e, 5)).toBe(e);
    });
    it("returns empty messages when n <= 0", () => {
      const e = env([msg("user", "1")]);
      expect(keepLastNMessages(e, 0).messages).toHaveLength(0);
    });
  });

  describe("redactMessages()", () => {
    it("replaces content matching the predicate", () => {
      const e = env([msg("user", "my key is sk-123"), msg("user", "hello")]);
      const out = redactMessages(e, (c) => c.includes("sk-"));
      expect(out.messages[0].content).toBe("[redacted]");
      expect(out.messages[1].content).toBe("hello");
    });
  });

  describe("composeFilters()", () => {
    it("applies filters left-to-right", () => {
      const e = env([
        msg("user", "1"),
        msg("tool", "t"),
        msg("assistant", "2"),
        msg("user", "3"),
      ]);
      const filter = composeFilters(removeToolMessages, (x) =>
        keepLastNMessages(x, 2),
      );
      const out = filter(e);
      // tool removed → [user1, assistant2, user3] → last 2 → [assistant2, user3]
      expect(out.messages.map((m) => m.content)).toEqual(["2", "3"]);
    });
  });
});
