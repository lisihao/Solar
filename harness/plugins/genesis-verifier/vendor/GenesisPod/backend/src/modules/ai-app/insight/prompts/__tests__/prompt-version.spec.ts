/**
 * Prompt Version Unit Tests
 *
 * 验证：hashPrompt 稳定性、版本表完整性、hash 不重复（前 4 个真实 prompt）
 */

import {
  PROMPT_VERSIONS,
  PROMPT_METADATA,
  getPromptMetadata,
  hashPrompt,
} from "../prompt-version";

describe("prompt-version", () => {
  describe("hashPrompt", () => {
    it("produces stable 16-hex hash", () => {
      const h = hashPrompt("hello world");
      expect(h).toMatch(/^[0-9a-f]{16}$/);
    });

    it("same input → same hash", () => {
      expect(hashPrompt("a")).toBe(hashPrompt("a"));
    });

    it("different input → different hash", () => {
      expect(hashPrompt("a")).not.toBe(hashPrompt("b"));
    });

    it("whitespace-sensitive (modification of a single char changes hash)", () => {
      expect(hashPrompt("you are an assistant")).not.toBe(
        hashPrompt("You are an assistant"),
      );
    });
  });

  describe("PROMPT_VERSIONS table", () => {
    it("contains all expected prompt names", () => {
      expect(Object.keys(PROMPT_VERSIONS).sort()).toEqual(
        [
          "SECTION_WRITING",
          "DIMENSION_RESEARCH",
          "REPORT_SYNTHESIS",
          "REPORT_EDITING",
          "SECTION_SELF_EVAL",
          "REPORT_EVALUATION",
          "SECTION_REMEDIATION",
        ].sort(),
      );
    });

    it("all versions follow vX.Y format", () => {
      for (const v of Object.values(PROMPT_VERSIONS)) {
        expect(v).toMatch(/^v\d+\.\d+$/);
      }
    });
  });

  describe("PROMPT_METADATA", () => {
    it("covers every PROMPT_VERSIONS key", () => {
      for (const key of Object.keys(PROMPT_VERSIONS)) {
        expect(PROMPT_METADATA).toHaveProperty(key);
        expect(
          PROMPT_METADATA[key as keyof typeof PROMPT_METADATA],
        ).toHaveProperty("version");
        expect(
          PROMPT_METADATA[key as keyof typeof PROMPT_METADATA],
        ).toHaveProperty("hash");
      }
    });

    it("prompt hashes are unique for the four real-template prompts", () => {
      const realHashes = [
        PROMPT_METADATA.SECTION_WRITING.hash,
        PROMPT_METADATA.DIMENSION_RESEARCH.hash,
        PROMPT_METADATA.REPORT_SYNTHESIS.hash,
        PROMPT_METADATA.REPORT_EDITING.hash,
      ];
      const unique = new Set(realHashes);
      expect(unique.size).toBe(realHashes.length);
      for (const h of realHashes) {
        expect(h).toMatch(/^[0-9a-f]{16}$/);
      }
    });

    it("inline-prompt entries use 'inline' sentinel for hash", () => {
      expect(PROMPT_METADATA.SECTION_SELF_EVAL.hash).toBe("inline");
      expect(PROMPT_METADATA.REPORT_EVALUATION.hash).toBe("inline");
      expect(PROMPT_METADATA.SECTION_REMEDIATION.hash).toBe("inline");
    });
  });

  describe("getPromptMetadata", () => {
    it("returns matching entry", () => {
      const m = getPromptMetadata("SECTION_WRITING");
      expect(m.version).toBe(PROMPT_VERSIONS.SECTION_WRITING);
      expect(m.hash).toBe(PROMPT_METADATA.SECTION_WRITING.hash);
    });
  });
});
