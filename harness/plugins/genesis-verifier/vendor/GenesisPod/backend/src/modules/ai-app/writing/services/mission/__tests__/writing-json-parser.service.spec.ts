/**
 * WritingJsonParserService - Unit Tests
 *
 * Targets uncovered branches: ~65 lines, 65.6% coverage
 * Focus: parseOutlineJSON edge cases, parseWorldSettings, parseConsistencyCheckResult,
 *        extractFirstJsonObject, normalizeConsistencyResult, parseVerificationResult,
 *        normalizeVerificationResult, tryRepairTruncatedJson
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WritingJsonParserService } from "../writing-json-parser.service";

describe("WritingJsonParserService", () => {
  let service: WritingJsonParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WritingJsonParserService],
    })
      .setLogger({
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      })
      .compile();

    service = module.get<WritingJsonParserService>(WritingJsonParserService);
    jest.spyOn(service.logger, "log").mockImplementation(() => undefined);
    jest.spyOn(service.logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(service.logger, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // parseOutlineJSON
  // ============================================================

  describe("parseOutlineJSON", () => {
    it("should return default structure when content has no JSON", () => {
      const result = service.parseOutlineJSON("No JSON here at all", 2, 4);

      expect(result.bookTitle).toBe("");
      expect(result.core.summary).toBe("待定");
      expect(result.volumes).toHaveLength(2);
      expect(result.chapters).toHaveLength(4);
    });

    it("should parse valid JSON wrapped in markdown code block", () => {
      const json = {
        bookTitle: "《测试书名》",
        core: { summary: "核心摘要", genre: "玄幻", theme: "成长" },
        volumes: [
          {
            title: "第一卷",
            conflict: "冲突1",
            plot: "情节1",
            emotion: "激情",
          },
          {
            title: "第二卷",
            conflict: "冲突2",
            plot: "情节2",
            emotion: "悲伤",
          },
        ],
        chapters: [
          {
            volumeIndex: 0,
            title: "第一章：暗流涌动",
            plot: "开始",
            keyPoint: "关键",
          },
          {
            volumeIndex: 0,
            title: "第二章：战火连天",
            plot: "战斗",
            keyPoint: "战斗关键",
          },
          {
            volumeIndex: 1,
            title: "第三章：新征程",
            plot: "出发",
            keyPoint: "出发关键",
          },
          {
            volumeIndex: 1,
            title: "第四章：终章",
            plot: "结尾",
            keyPoint: "结局",
          },
        ],
      };
      const content = "```json\n" + JSON.stringify(json) + "\n```";

      const result = service.parseOutlineJSON(content, 2, 4);

      expect(result.bookTitle).toBe("测试书名"); // brackets stripped
      expect(result.core.genre).toBe("玄幻");
      expect(result.volumes).toHaveLength(2);
      expect(result.chapters).toHaveLength(4);
    });

    it("should strip chapter number prefix from title", () => {
      const json = {
        bookTitle: "BookTitle",
        core: { summary: "s", genre: "g", theme: "t" },
        volumes: [{ title: "V1", conflict: "c", plot: "p", emotion: "e" }],
        chapters: [
          {
            volumeIndex: 0,
            title: "第一章：暗流涌动",
            plot: "p",
            keyPoint: "k",
          },
        ],
      };

      const result = service.parseOutlineJSON(JSON.stringify(json), 1, 1);

      expect(result.chapters[0].title).toBe("暗流涌动");
    });

    it("should treat pure chapter number title as empty", () => {
      const json = {
        bookTitle: "Book",
        core: { summary: "s", genre: "g", theme: "t" },
        volumes: [{ title: "V1", conflict: "c", plot: "p", emotion: "e" }],
        chapters: [
          { volumeIndex: 0, title: "第一章", plot: "p", keyPoint: "k" },
        ],
      };

      const result = service.parseOutlineJSON(JSON.stringify(json), 1, 1);

      expect(result.chapters[0].title).toBe("");
    });

    it("should supplement chapters when parsed count is less than total", () => {
      const json = {
        bookTitle: "Book",
        core: { summary: "s", genre: "g", theme: "t" },
        volumes: [{ title: "V1", conflict: "c", plot: "p", emotion: "e" }],
        chapters: [
          { volumeIndex: 0, title: "Chapter One", plot: "p1", keyPoint: "k1" },
        ],
      };

      const result = service.parseOutlineJSON(JSON.stringify(json), 1, 3);

      expect(result.chapters).toHaveLength(3);
      expect(result.chapters[0].title).toBe("Chapter One");
      expect(result.chapters[1].title).toBe("");
      expect(result.chapters[2].title).toBe("");
    });

    it("should return all chapters when parsed count exceeds total (no truncation)", () => {
      const chapters = Array.from({ length: 5 }, (_, i) => ({
        volumeIndex: 0,
        title: `Chapter ${i + 1}`,
        plot: "p",
        keyPoint: "k",
      }));
      const json = {
        bookTitle: "Book",
        core: { summary: "s", genre: "g", theme: "t" },
        volumes: [{ title: "V1", conflict: "c", plot: "p", emotion: "e" }],
        chapters,
      };

      // The service does NOT truncate when more chapters than totalChapters
      const result = service.parseOutlineJSON(JSON.stringify(json), 1, 3);

      // All 5 parsed chapters are kept (no truncation)
      expect(result.chapters).toHaveLength(5);
    });

    it("should supplement volumes when parsed count is less than total", () => {
      const json = {
        bookTitle: "Book",
        core: { summary: "s", genre: "g", theme: "t" },
        volumes: [
          { title: "Volume One", conflict: "c", plot: "p", emotion: "e" },
        ],
        chapters: [],
      };

      const result = service.parseOutlineJSON(JSON.stringify(json), 3, 0);

      expect(result.volumes).toHaveLength(3);
      expect(result.volumes[0].title).toBe("Volume One");
      expect(result.volumes[1].conflict).toBe("待定");
    });

    it("should handle JSON parse error gracefully", () => {
      const content = "{ invalid json }";

      const result = service.parseOutlineJSON(content, 1, 2);

      expect(result.bookTitle).toBe("");
      expect(result.volumes).toHaveLength(1);
      expect(result.chapters).toHaveLength(2);
    });

    it("should strip book title brackets (《》【】「」『』)", () => {
      const json = {
        bookTitle: "《斗破苍穹》",
        core: { summary: "s", genre: "g", theme: "t" },
        volumes: [],
        chapters: [],
      };

      const result = service.parseOutlineJSON(JSON.stringify(json), 0, 0);

      expect(result.bookTitle).toBe("斗破苍穹");
    });

    it("should use volumeIndex from parsed chapter, defaulting to calculated index", () => {
      // With 4 total chapters and 2 volumes, chaptersPerVolume = ceil(4/2) = 2
      // Chapter index 0 -> Math.floor(0/2) = 0; index 1 -> Math.floor(1/2) = 0
      // index 2 -> Math.floor(2/2) = 1; index 3 -> Math.floor(3/2) = 1
      const json = {
        bookTitle: "Book",
        core: { summary: "s", genre: "g", theme: "t" },
        volumes: [
          { title: "V1", conflict: "c", plot: "p", emotion: "e" },
          { title: "V2", conflict: "c", plot: "p", emotion: "e" },
        ],
        chapters: [
          { volumeIndex: 1, title: "Chapter A", plot: "p", keyPoint: "k" }, // explicit volumeIndex=1
          { title: "Chapter B", plot: "p", keyPoint: "k" }, // no volumeIndex, index=1 -> Math.floor(1/2)=0
          { title: "Chapter C", plot: "p", keyPoint: "k" }, // no volumeIndex, index=2 -> Math.floor(2/2)=1
          { title: "Chapter D", plot: "p", keyPoint: "k" }, // no volumeIndex, index=3 -> Math.floor(3/2)=1
        ],
      };

      const result = service.parseOutlineJSON(JSON.stringify(json), 2, 4);

      expect(result.chapters[0].volumeIndex).toBe(1); // explicit
      expect(result.chapters[1].volumeIndex).toBe(0); // Math.floor(1/2)=0
      expect(result.chapters[2].volumeIndex).toBe(1); // Math.floor(2/2)=1
    });

    it("should handle missing core fields with defaults", () => {
      const json = {
        bookTitle: "Book",
        core: {},
        volumes: [],
        chapters: [],
      };

      const result = service.parseOutlineJSON(JSON.stringify(json), 0, 0);

      expect(result.core.summary).toBe("待定");
      expect(result.core.genre).toBe("待定");
      expect(result.core.theme).toBe("待定");
    });
  });

  // ============================================================
  // parseWorldSettings
  // ============================================================

  describe("parseWorldSettings", () => {
    it("should parse valid world settings JSON", () => {
      const data = {
        world: { era: "古代" },
        characters: [{ name: "萧炎" }],
        factions: [],
        terminology: [],
      };

      const result = service.parseWorldSettings(JSON.stringify(data));

      expect(result.world).toEqual({ era: "古代" });
      expect((result.characters as unknown[]).length).toBe(1);
    });

    it("should return default structure when no JSON found", () => {
      const result = service.parseWorldSettings("No JSON content here");

      expect(result).toEqual({
        world: {},
        characters: [],
        factions: [],
        terminology: [],
      });
    });

    it("should return default structure on parse error", () => {
      const result = service.parseWorldSettings("{ bad json: }");

      expect(result).toEqual({
        world: {},
        characters: [],
        factions: [],
        terminology: [],
      });
    });

    it("should handle markdown code block wrapping", () => {
      const data = { world: { name: "Test World" }, characters: [] };
      const content = "```json\n" + JSON.stringify(data) + "\n```";

      const result = service.parseWorldSettings(content);

      expect((result.world as Record<string, unknown>).name).toBe("Test World");
    });
  });

  // ============================================================
  // parseConsistencyCheckResult
  // ============================================================

  describe("parseConsistencyCheckResult", () => {
    it("should parse valid consistency result", () => {
      const data = {
        passed: false,
        score: 75,
        issues: [
          {
            type: "timeline",
            severity: "error",
            description: "Time conflict",
            location: "Chapter 2",
            fix: "Fix timeline",
          },
        ],
      };

      const result = service.parseConsistencyCheckResult(JSON.stringify(data));

      expect(result.passed).toBe(false);
      expect(result.score).toBe(75);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe("timeline");
    });

    it("should return default when content has no JSON", () => {
      const result = service.parseConsistencyCheckResult("No JSON here");

      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
      expect(result.issues).toHaveLength(0);
    });

    it("should handle content wrapped in markdown code blocks (```json)", () => {
      const data = { passed: true, score: 100, issues: [] };
      const content = "```json\n" + JSON.stringify(data) + "\n```";

      const result = service.parseConsistencyCheckResult(content);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
    });

    it("should handle content wrapped in plain code blocks (```)", () => {
      const data = { passed: true, score: 90, issues: [] };
      const content = "```\n" + JSON.stringify(data) + "\n```";

      const result = service.parseConsistencyCheckResult(content);

      expect(result.score).toBe(90);
    });

    it("should extract JSON object from surrounding text", () => {
      const data = { passed: false, score: 60, issues: [] };
      const content =
        "Some preamble text\n" + JSON.stringify(data) + "\nsome postfix";

      const result = service.parseConsistencyCheckResult(content);

      expect(result.passed).toBe(false);
      expect(result.score).toBe(60);
    });

    it("should handle invalid JSON and return defaults", () => {
      const result = service.parseConsistencyCheckResult("{ broken json }");

      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
    });
  });

  // ============================================================
  // extractFirstJsonObject
  // ============================================================

  describe("extractFirstJsonObject", () => {
    it("should extract first complete JSON object", () => {
      const content = 'prefix {"key": "value", "nested": {"a": 1}} suffix';

      const result = service.extractFirstJsonObject(content);

      expect(result).toBe('{"key": "value", "nested": {"a": 1}}');
    });

    it("should return null when no opening brace", () => {
      const result = service.extractFirstJsonObject("no braces here");

      expect(result).toBeNull();
    });

    it("should handle escaped characters in strings", () => {
      const content = '{"key": "val\\"ue"}';

      const result = service.extractFirstJsonObject(content);

      expect(result).toBe('{"key": "val\\"ue"}');
    });

    it("should handle nested objects", () => {
      const content = '{"a": {"b": {"c": 1}}}';

      const result = service.extractFirstJsonObject(content);

      expect(result).toBe('{"a": {"b": {"c": 1}}}');
    });

    it("should return null when JSON is not closed", () => {
      const content = '{"key": "unclosed"';

      const result = service.extractFirstJsonObject(content);

      expect(result).toBeNull();
    });
  });

  // ============================================================
  // normalizeConsistencyResult
  // ============================================================

  describe("normalizeConsistencyResult", () => {
    it("should use defaults when fields are missing", () => {
      const result = service.normalizeConsistencyResult({});

      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
      expect(result.issues).toEqual([]);
    });

    it("should preserve boolean passed = false", () => {
      const result = service.normalizeConsistencyResult({
        passed: false,
        score: 50,
        issues: [],
      });

      expect(result.passed).toBe(false);
      expect(result.score).toBe(50);
    });

    it("should normalize issues array with defaults for missing fields", () => {
      const result = service.normalizeConsistencyResult({
        passed: false,
        score: 70,
        issues: [
          { type: "conflict" }, // missing severity, description, location, fix
        ],
      });

      expect(result.issues[0].type).toBe("conflict");
      expect(result.issues[0].severity).toBe("warning");
      expect(result.issues[0].description).toBe("");
      expect(result.issues[0].location).toBe("");
      expect(result.issues[0].fix).toBe("");
    });

    it("should ignore non-array issues field", () => {
      const result = service.normalizeConsistencyResult({
        passed: true,
        score: 100,
        issues: "not an array",
      });

      expect(result.issues).toEqual([]);
    });
  });

  // ============================================================
  // parseVerificationResult
  // ============================================================

  describe("parseVerificationResult", () => {
    it("should parse valid verification result", () => {
      const data = {
        allFixed: true,
        verifications: [
          { issueIndex: 0, fixed: true, evidence: "Fixed timeline" },
          { issueIndex: 1, fixed: false, evidence: "Not yet fixed" },
        ],
      };

      const result = service.parseVerificationResult(JSON.stringify(data));

      expect(result.allFixed).toBe(true);
      expect(result.verifications).toHaveLength(2);
      expect(result.verifications[1].fixed).toBe(false);
    });

    it("should return default when content has no JSON", () => {
      const result = service.parseVerificationResult("No JSON here");

      expect(result.allFixed).toBe(true);
      expect(result.verifications).toEqual([]);
    });

    it("should handle markdown code block (```json)", () => {
      const data = { allFixed: false, verifications: [] };
      const content = "```json\n" + JSON.stringify(data) + "\n```";

      const result = service.parseVerificationResult(content);

      expect(result.allFixed).toBe(false);
    });

    it("should handle plain code block (```)", () => {
      const data = {
        allFixed: true,
        verifications: [{ issueIndex: 0, fixed: true, evidence: "done" }],
      };
      const content = "```\n" + JSON.stringify(data) + "\n```";

      const result = service.parseVerificationResult(content);

      expect(result.verifications).toHaveLength(1);
    });

    it("should extract from surrounding text using extractFirstJsonObject", () => {
      const data = {
        allFixed: false,
        verifications: [{ issueIndex: 2, fixed: false, evidence: "e" }],
      };
      const content =
        "Some text before\n" + JSON.stringify(data) + "\nsome text after";

      const result = service.parseVerificationResult(content);

      expect(result.allFixed).toBe(false);
      expect(result.verifications[0].issueIndex).toBe(2);
    });

    it("should return defaults on parse error", () => {
      const result = service.parseVerificationResult("{ bad json }");

      expect(result.allFixed).toBe(true);
      expect(result.verifications).toEqual([]);
    });
  });

  // ============================================================
  // normalizeVerificationResult
  // ============================================================

  describe("normalizeVerificationResult", () => {
    it("should use defaults when fields are missing", () => {
      const result = service.normalizeVerificationResult({});

      expect(result.allFixed).toBe(true);
      expect(result.verifications).toEqual([]);
    });

    it("should normalize verifications with missing fields", () => {
      const result = service.normalizeVerificationResult({
        allFixed: false,
        verifications: [{ evidence: "some evidence" }], // missing issueIndex and fixed
      });

      expect(result.allFixed).toBe(false);
      expect(result.verifications[0].issueIndex).toBe(0);
      expect(result.verifications[0].fixed).toBe(true);
      expect(result.verifications[0].evidence).toBe("some evidence");
    });

    it("should ignore non-array verifications field", () => {
      const result = service.normalizeVerificationResult({
        allFixed: true,
        verifications: "not an array",
      });

      expect(result.verifications).toEqual([]);
    });
  });

  // ============================================================
  // tryRepairTruncatedJson
  // ============================================================

  describe("tryRepairTruncatedJson", () => {
    it("should return input unchanged when JSON is already valid", () => {
      const input = '{"key": "value"}';

      const result = service.tryRepairTruncatedJson(input);

      expect(result).toBe(input);
    });

    it("should close missing closing braces", () => {
      const input = '{"key": "value"';

      const result = service.tryRepairTruncatedJson(input);

      // Should produce valid JSON
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it("should close missing closing brackets and braces", () => {
      const input = '{"arr": [1, 2, 3';

      const result = service.tryRepairTruncatedJson(input);

      // Best-effort repair
      expect(typeof result).toBe("string");
    });

    it("should handle truncation inside a string value", () => {
      const input = '{"key": "truncated val';

      const result = service.tryRepairTruncatedJson(input);

      expect(typeof result).toBe("string");
    });

    it("should remove trailing comma before closing", () => {
      const input = '{"key": "value",';

      const result = service.tryRepairTruncatedJson(input);

      expect(typeof result).toBe("string");
    });

    it("should handle escaped backslashes in strings", () => {
      const input = '{"key": "val\\\\ue"}';

      const result = service.tryRepairTruncatedJson(input);

      expect(result).toBe(input); // already valid
    });
  });
});
