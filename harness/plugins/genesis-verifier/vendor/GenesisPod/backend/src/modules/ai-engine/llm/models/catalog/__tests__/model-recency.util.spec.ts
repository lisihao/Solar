import { compareRecencyDesc, sortByRecencyDesc } from "../model-recency.util";

describe("model-recency.util", () => {
  describe("sortByRecencyDesc — created epoch present", () => {
    it("orders by created desc (newest first)", () => {
      const sorted = sortByRecencyDesc([
        { id: "gpt-4o-2024-05", created: 1000 },
        { id: "gpt-5.4", created: 2000 },
        { id: "gpt-4-turbo", created: 1500 },
      ]);
      expect(sorted.map((m) => m.id)).toEqual([
        "gpt-5.4",
        "gpt-4-turbo",
        "gpt-4o-2024-05",
      ]);
    });

    it("created wins even when version number is lower", () => {
      // 一个旧版本号但 created 更新（罕见但合法）——created 优先
      const sorted = sortByRecencyDesc([
        { id: "gpt-5.4", created: 100 },
        { id: "gpt-4o", created: 999 },
      ]);
      expect(sorted[0].id).toBe("gpt-4o");
    });
  });

  describe("sortByRecencyDesc — no created (version fallback)", () => {
    // ★ 强验证用例：代际通配 pattern 命中的候选里，最新代必须排第一。
    it("picks newest generation when created absent (gpt-5.4 > gpt-4o-2024-05)", () => {
      const sorted = sortByRecencyDesc([
        { id: "gpt-4o-2024-05" },
        { id: "gpt-5.4" },
      ]);
      expect(sorted[0].id).toBe("gpt-5.4");
    });

    it("orders Gemini generations newest-first (2.5 > 1.5)", () => {
      const sorted = sortByRecencyDesc([
        { id: "gemini-1.5-pro" },
        { id: "gemini-2.5-pro" },
        { id: "gemini-2.0-pro" },
      ]);
      expect(sorted.map((m) => m.id)).toEqual([
        "gemini-2.5-pro",
        "gemini-2.0-pro",
        "gemini-1.5-pro",
      ]);
    });

    it("orders Claude generations newest-first (opus-4-1 > 3-5-sonnet)", () => {
      const sorted = sortByRecencyDesc([
        { id: "claude-3-5-sonnet-20241022" },
        { id: "claude-opus-4-1-20250805" },
        { id: "claude-sonnet-4-5-20250929" },
      ]);
      // opus-4-1 / sonnet-4-5 都是第 4 代；3-5-sonnet 是第 3 代，必须排最后
      expect(sorted[sorted.length - 1].id).toBe("claude-3-5-sonnet-20241022");
    });

    it("orders grok generations newest-first (grok-4 > grok-2)", () => {
      const sorted = sortByRecencyDesc([
        { id: "grok-2-1212" },
        { id: "grok-4" },
        { id: "grok-3" },
      ]);
      expect(sorted.map((m) => m.id)).toEqual([
        "grok-4",
        "grok-3",
        "grok-2-1212",
      ]);
    });
  });

  describe("compareRecencyDesc — edge cases", () => {
    it("does not treat date suffix as version (gpt-4o-2024-05 stays gen 4)", () => {
      // gpt-5 (gen 5) 必须新于 gpt-4o-2024-05 (gen 4)，不能把 2024 当版本
      expect(
        compareRecencyDesc({ id: "gpt-5" }, { id: "gpt-4o-2024-05" }),
      ).toBeLessThan(0);
    });

    it("is stable / lexical-desc fallback when no version extractable", () => {
      const sorted = sortByRecencyDesc([
        { id: "command-r" },
        { id: "command-r-plus" },
      ]);
      // 无数字版本 → 字典序降序兜底，可预测即可
      expect(sorted.map((m) => m.id)).toEqual(["command-r-plus", "command-r"]);
    });

    it("does not mutate input array", () => {
      const input = [{ id: "gpt-4o" }, { id: "gpt-5" }];
      const copy = [...input];
      sortByRecencyDesc(input);
      expect(input).toEqual(copy);
    });
  });
});
