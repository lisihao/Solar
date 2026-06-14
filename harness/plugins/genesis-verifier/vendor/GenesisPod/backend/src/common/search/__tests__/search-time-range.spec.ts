/**
 * Unit tests for resolveEffectiveTimeRange — the core injection function that
 * auto-fills `timeRange` into search tool calls when the LLM omits it.
 *
 * Coverage:
 *   1. Missing timeRange → auto-filled from metadata.searchTimeRange
 *   2. Explicit timeRange (even "all") → respected, metadata not used
 *   3. Neither input nor metadata → DEFAULT_SEARCH_TIME_RANGE (365d)
 *   4. Non-search tool context (no metadata) → DEFAULT fallback
 */

import {
  resolveEffectiveTimeRange,
  DEFAULT_SEARCH_TIME_RANGE,
} from "../search-time-range";

describe("resolveEffectiveTimeRange", () => {
  describe("missing timeRange — auto-inject from metadata", () => {
    it("fills mission searchTimeRange when LLM omits timeRange", () => {
      const result = resolveEffectiveTimeRange(undefined, {
        searchTimeRange: "90d",
      });
      expect(result).toBe("90d");
    });

    it("fills all valid SearchTimeRange values from metadata", () => {
      const values = ["30d", "90d", "180d", "365d", "730d", "all"] as const;
      for (const v of values) {
        expect(
          resolveEffectiveTimeRange(undefined, { searchTimeRange: v }),
        ).toBe(v);
      }
    });
  });

  describe("explicit timeRange — LLM choice is preserved", () => {
    it("keeps LLM-supplied timeRange even when metadata has a different value", () => {
      // LLM picked 30d; mission default is 365d — LLM wins
      const result = resolveEffectiveTimeRange("30d", {
        searchTimeRange: "365d",
      });
      expect(result).toBe("30d");
    });

    it('keeps explicit "all" even when metadata has a finite range', () => {
      // LLM explicitly chose no time filter — must not be overridden
      const result = resolveEffectiveTimeRange("all", {
        searchTimeRange: "90d",
      });
      expect(result).toBe("all");
    });
  });

  describe("neither input nor metadata — DEFAULT fallback", () => {
    it("returns DEFAULT_SEARCH_TIME_RANGE when both input and metadata are absent", () => {
      expect(resolveEffectiveTimeRange(undefined, undefined)).toBe(
        DEFAULT_SEARCH_TIME_RANGE,
      );
    });

    it("returns DEFAULT when metadata lacks searchTimeRange (non-search tool context)", () => {
      // Simulates a tool called from a context where no mission metadata was injected
      expect(resolveEffectiveTimeRange(undefined, { language: "en-US" })).toBe(
        DEFAULT_SEARCH_TIME_RANGE,
      );
    });

    it("ignores invalid metadata.searchTimeRange and falls back to DEFAULT", () => {
      expect(
        resolveEffectiveTimeRange(undefined, { searchTimeRange: "1y" }),
      ).toBe(DEFAULT_SEARCH_TIME_RANGE);
    });
  });
});
