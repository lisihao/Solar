import { OFFLOAD_PREFIXES } from "../offload-prefixes";
import { OFFLOAD_KEY_PREFIXES } from "../../../../../common/storage/offload-key-allowlist";

describe("offload-prefixes (platform registry)", () => {
  it("covers every entry in OFFLOAD_KEY_PREFIXES (allow-list = registry parity)", () => {
    const registered = new Set(OFFLOAD_PREFIXES.map((p) => p.prefix));
    for (const allow of OFFLOAD_KEY_PREFIXES) {
      expect(registered.has(allow)).toBe(true);
    }
  });

  it("every entry has extractId + listLiveIds + valid prefix", () => {
    for (const entry of OFFLOAD_PREFIXES) {
      expect(entry.prefix.endsWith("/")).toBe(true);
      expect(typeof entry.extractId).toBe("function");
      expect(typeof entry.listLiveIds).toBe("function");
    }
  });

  describe("extractId", () => {
    it.each([
      ["kb-documents/", "kb-documents/abc-123/raw.txt", "abc-123"],
      ["wiki-revisions/", "wiki-revisions/rev-uuid/body.md", "rev-uuid"],
      ["wiki-diffs/", "wiki-diffs/diff-id/items.json", "diff-id"],
      ["topic-reports/", "topic-reports/report-id/v3.md", "report-id"],
      ["research-tasks/", "research-tasks/task-id/result.json", "task-id"],
      [
        "dimension-analyses/",
        "dimension-analyses/dim-id/data_points.json",
        "dim-id",
      ],
    ])("%s extractId(%s) = %s", (prefix, key, expected) => {
      const entry = OFFLOAD_PREFIXES.find((p) => p.prefix === prefix);
      expect(entry).toBeDefined();
      expect(entry!.extractId(key)).toBe(expected);
    });

    it("returns null for non-matching prefix", () => {
      const entry = OFFLOAD_PREFIXES.find((p) => p.prefix === "kb-documents/")!;
      expect(entry.extractId("wiki-revisions/x/body.md")).toBeNull();
    });

    it("handles legacy single-segment style {prefix}{id}.{ext}", () => {
      // 旧风格 wiki-revisions/{id}.md 应该也能 extract（向后兼容已有 R2 对象）
      const entry = OFFLOAD_PREFIXES.find(
        (p) => p.prefix === "wiki-revisions/",
      )!;
      expect(entry.extractId("wiki-revisions/legacy-id.md")).toBe("legacy-id");
    });
  });
});
