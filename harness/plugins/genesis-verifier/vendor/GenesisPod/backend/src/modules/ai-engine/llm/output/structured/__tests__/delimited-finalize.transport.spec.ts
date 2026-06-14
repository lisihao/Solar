import {
  buildDelimitedFinalizeInstructions,
  hasDelimitedFinalizeMarkers,
  parseDelimitedFinalize,
  parseNdjsonItems,
  shouldUseDelimitedTransport,
} from "../delimited-finalize.transport";

describe("delimited-finalize.transport", () => {
  describe("shouldUseDelimitedTransport", () => {
    it("true for best-effort modes (json_mode / none)", () => {
      expect(shouldUseDelimitedTransport("json_mode")).toBe(true);
      expect(shouldUseDelimitedTransport("none")).toBe(true);
    });
    it("false for grammar-constrained / unknown modes", () => {
      expect(shouldUseDelimitedTransport("json_schema_strict")).toBe(false);
      expect(shouldUseDelimitedTransport("json_schema")).toBe(false);
      expect(shouldUseDelimitedTransport("tool_use")).toBe(false);
      expect(shouldUseDelimitedTransport(null)).toBe(false);
      expect(shouldUseDelimitedTransport(undefined)).toBe(false);
    });
  });

  describe("buildDelimitedFinalizeInstructions", () => {
    it("returns empty when nothing to delimit", () => {
      expect(buildDelimitedFinalizeInstructions({})).toBe("");
    });
    it("documents prose blocks and the omit list", () => {
      const txt = buildDelimitedFinalizeInstructions({ proseFields: ["body"] });
      expect(txt).toContain("<<<FIELD:body>>>");
      expect(txt).toContain("<<<END:body>>>");
      expect(txt).toContain('OMIT "body"');
    });
    it("documents NDJSON block for array field", () => {
      const txt = buildDelimitedFinalizeInstructions({
        ndjsonArrayField: "findings",
      });
      expect(txt).toContain("<<<NDJSON:findings>>>");
      expect(txt).toContain("one JSON object PER LINE");
    });
  });

  describe("hasDelimitedFinalizeMarkers", () => {
    it("detects prose + ndjson markers", () => {
      expect(
        hasDelimitedFinalizeMarkers("x <<<FIELD:body>>> y", {
          proseFields: ["body"],
        }),
      ).toBe(true);
      expect(
        hasDelimitedFinalizeMarkers("x <<<NDJSON:findings>>> y", {
          ndjsonArrayField: "findings",
        }),
      ).toBe(true);
    });
    it("false when absent", () => {
      expect(
        hasDelimitedFinalizeMarkers('{"a":1}', { proseFields: ["body"] }),
      ).toBe(false);
    });
  });

  describe("parseNdjsonItems", () => {
    it("parses one object per line, skipping bad lines (not the whole batch)", () => {
      const block = [
        '{"claim":"a","source":"s1"}',
        "this line is broken {not json",
        '{"claim":"b","source":"s2"}',
        "",
        '{"claim":"c","source":"s3"},', // trailing comma tolerated
      ].join("\n");
      const items = parseNdjsonItems(block);
      expect(items).toHaveLength(3);
      expect(items.map((i) => i.claim)).toEqual(["a", "b", "c"]);
    });
  });

  describe("parseDelimitedFinalize", () => {
    it("returns null when no markers (caller falls back to JSON path)", () => {
      expect(
        parseDelimitedFinalize('{"action":{"kind":"finalize"}}', {
          proseFields: ["body"],
        }),
      ).toBeNull();
    });

    it("reconstructs body with unescaped quotes/newlines that would break JSON", () => {
      const raw = [
        '{"thinking":"分析","action":{"kind":"finalize","output":{"index":4,"heading":"未来"}}}',
        "<<<FIELD:body>>>",
        '不再只是"跑得快"的引擎，更需成为"可信任"的基座。',
        "第二段：含换行与 [1] 引用。",
        "<<<END:body>>>",
      ].join("\n");
      const parsed = parseDelimitedFinalize(raw, { proseFields: ["body"] });
      expect(parsed).not.toBeNull();
      expect(parsed?.thinking).toBe("分析");
      expect(parsed?.output.index).toBe(4);
      expect(parsed?.output.heading).toBe("未来");
      expect(parsed?.output.body).toContain('"跑得快"');
      expect(parsed?.output.body).toContain("第二段");
    });

    it("reconstructs findings via NDJSON + short envelope", () => {
      const raw = [
        '{"action":{"kind":"finalize","output":{"dimension":"人才","summary":"略"}}}',
        "<<<NDJSON:findings>>>",
        '{"claim":"硅谷集中","source":"https://a.com"}',
        "broken line",
        '{"claim":"多伦多 Vector","source":"https://b.org"}',
        "<<<END:findings>>>",
      ].join("\n");
      const parsed = parseDelimitedFinalize(raw, {
        ndjsonArrayField: "findings",
      });
      expect(parsed?.output.dimension).toBe("人才");
      const findings = parsed?.output.findings as Array<{ claim: string }>;
      expect(findings).toHaveLength(2);
      expect(findings[0].claim).toBe("硅谷集中");
    });

    it("survives an unparseable envelope (still grafts blocks)", () => {
      // envelope has its OWN stray quote, but blocks still recover
      const raw = [
        '{"thinking":"他说"你好"","action":{"kind":"finalize","output":{"index":1}}}',
        "<<<FIELD:body>>>",
        "正文内容。",
        "<<<END:body>>>",
      ].join("\n");
      const parsed = parseDelimitedFinalize(raw, { proseFields: ["body"] });
      expect(parsed).not.toBeNull();
      expect(parsed?.output.body).toBe("正文内容。");
    });

    it("handles a truncated prose block (missing close tag)", () => {
      const raw = [
        '{"action":{"kind":"finalize","output":{"index":2}}}',
        "<<<FIELD:body>>>",
        "正文被截断，没有结束标记",
      ].join("\n");
      const parsed = parseDelimitedFinalize(raw, { proseFields: ["body"] });
      expect(parsed?.output.body).toContain("正文被截断");
    });
  });
});
