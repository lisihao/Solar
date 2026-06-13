import {
  isOffloadKeyAllowed,
  OFFLOAD_KEY_PREFIXES,
} from "../offload-key-allowlist";

describe("offload-key-allowlist", () => {
  describe("OFFLOAD_KEY_PREFIXES", () => {
    it("includes all 6 known off-load tables", () => {
      expect(OFFLOAD_KEY_PREFIXES).toEqual(
        expect.arrayContaining([
          "topic-reports/",
          "dimension-analyses/",
          "research-tasks/",
          "kb-documents/",
          "wiki-revisions/",
          "wiki-diffs/",
        ]),
      );
    });

    it("every prefix ends with /", () => {
      for (const p of OFFLOAD_KEY_PREFIXES) {
        expect(p.endsWith("/")).toBe(true);
      }
    });
  });

  describe("isOffloadKeyAllowed", () => {
    it.each([
      ["kb-documents/abc-123/raw.txt", true],
      ["wiki-revisions/uuid/body.md", true],
      ["wiki-diffs/d1/items.json", true],
      ["topic-reports/r1/v1.md", true],
      ["dimension-analyses/d1/data_points.json", true],
      ["research-tasks/t1/result.json", true],
    ])("allows %s", (key, expected) => {
      expect(isOffloadKeyAllowed(key)).toBe(expected);
    });

    it.each([
      ["../../etc/passwd", false],
      ["secrets/api-keys.txt", false],
      ["users/abc/profile.json", false],
      ["", false],
      ["topic-reports", false], // missing trailing /
      ["/topic-reports/r1/v1.md", false], // leading /
      ["http://evil.com/topic-reports/x", false],
    ])("rejects %s", (key, expected) => {
      expect(isOffloadKeyAllowed(key)).toBe(expected);
    });
  });
});
