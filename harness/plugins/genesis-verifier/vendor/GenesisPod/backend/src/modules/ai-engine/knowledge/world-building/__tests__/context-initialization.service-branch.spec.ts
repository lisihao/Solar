/**
 * ContextInitializationService — supplemental branch coverage
 *
 * Targets:
 *  - Line 473: buildWorldBuildingPrompt returns basePrompt for contentType
 *    that is neither "novel" nor "document" (e.g. "research")
 *  - Line 509: parseEra fallback when era is null / non-object
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ContextInitializationService } from "../context-initialization.service";

describe("ContextInitializationService (branch supplement)", () => {
  let service: ContextInitializationService;
  let mockAiCaller: jest.Mock;

  beforeEach(async () => {
    mockAiCaller = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ContextInitializationService],
    }).compile();

    service = module.get<ContextInitializationService>(
      ContextInitializationService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ────────────────────────────────────────────────────────────
  // Line 473: return basePrompt (no novel/document special block)
  // ────────────────────────────────────────────────────────────
  describe("generateWorldSettings with contentType=research (line 473)", () => {
    it("returns settings even for research type (uses base prompt only)", async () => {
      mockAiCaller.mockResolvedValue({
        content: JSON.stringify({
          era: { period: "2024", description: "现代研究" },
          characters: [],
          factions: [],
          coreRules: ["客观准确"],
          prohibitions: [],
        }),
        tokensUsed: 100,
      });

      const result = await service.generateWorldSettings(
        "行业研究",
        "AI行业深度研究分析",
        "research",
        mockAiCaller,
        "gpt-4o",
      );

      expect(result.settings).toBeDefined();
      expect(mockAiCaller).toHaveBeenCalledTimes(1);
    });

    it("returns settings for contentType=other (line 473 else branch)", async () => {
      mockAiCaller.mockResolvedValue({
        content: JSON.stringify({
          era: { period: "未定", description: "" },
          characters: [],
          factions: [],
          coreRules: [],
          prohibitions: [],
        }),
        tokensUsed: 50,
      });

      const result = await service.generateWorldSettings(
        "通用任务",
        "一个普通任务描述",
        "other",
        mockAiCaller,
        "gpt-4o",
      );

      expect(result.settings).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────
  // Line 509: parseEra returns default when era is null/non-object
  // ────────────────────────────────────────────────────────────
  describe("parseWorldSettings with missing/invalid era (line 509)", () => {
    it("uses default era when era is null in response JSON", async () => {
      mockAiCaller.mockResolvedValue({
        content: JSON.stringify({
          era: null, // <-- triggers line 509
          characters: [],
          factions: [],
          coreRules: [],
          prohibitions: [],
        }),
        tokensUsed: 50,
      });

      const result = await service.generateWorldSettings(
        "Novel",
        "Description",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      // parseEra(null) → { period: "未指定", description: "" }
      expect(result.settings.era.period).toBe("未指定");
      expect(result.settings.era.description).toBe("");
    });

    it("uses default era when era is a string (not object)", async () => {
      mockAiCaller.mockResolvedValue({
        content: JSON.stringify({
          era: "明朝", // string, not object → line 509
          characters: [],
          factions: [],
          coreRules: [],
          prohibitions: [],
        }),
        tokensUsed: 50,
      });

      const result = await service.generateWorldSettings(
        "Novel",
        "Description",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      expect(result.settings.era.period).toBe("未指定");
    });

    it("uses default era when era field is missing", async () => {
      mockAiCaller.mockResolvedValue({
        content: JSON.stringify({
          // no era field at all → undefined → falsy → line 509
          characters: [],
          factions: [],
          coreRules: [],
          prohibitions: [],
        }),
        tokensUsed: 50,
      });

      const result = await service.generateWorldSettings(
        "Novel",
        "Description",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      expect(result.settings.era.period).toBe("未指定");
    });
  });

  // ────────────────────────────────────────────────────────────
  // Lines 513-563: parseEra / parseCharacters / parseFactions field fallbacks
  // ────────────────────────────────────────────────────────────
  describe("parseWorldSettings — field-level fallback branches (lines 513-563)", () => {
    it("uses fallback values when era period/year/description are non-strings", async () => {
      mockAiCaller.mockResolvedValue({
        content: JSON.stringify({
          era: {
            period: 42, // not string → "未指定"
            year: true, // not string → undefined
            description: null, // not string → ""
          },
          characters: [],
          factions: [],
          coreRules: [],
          prohibitions: [],
        }),
        tokensUsed: 50,
      });

      const result = await service.generateWorldSettings(
        "Novel",
        "test",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      expect(result.settings.era.period).toBe("未指定");
      expect(result.settings.era.year).toBeUndefined();
      expect(result.settings.era.description).toBe("");
    });

    it("uses fallback character fields when they are non-strings", async () => {
      mockAiCaller.mockResolvedValue({
        content: JSON.stringify({
          era: { period: "明朝", description: "test" },
          characters: [
            {
              name: 123, // not string → "未命名"
              role: null, // not string → "未知"
              identity: true, // not string → "未知"
              traits: "single", // not array → []
              constraints: null, // not array → []
            },
          ],
          factions: [],
          coreRules: [],
          prohibitions: [],
        }),
        tokensUsed: 50,
      });

      const result = await service.generateWorldSettings(
        "Novel",
        "test",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      const char = result.settings.characters[0];
      expect(char.name).toBe("未命名");
      expect(char.role).toBe("未知");
      expect(char.identity).toBe("未知");
      expect(char.traits).toEqual([]);
      expect(char.constraints).toEqual([]);
    });

    it("uses fallback faction fields when they are non-strings", async () => {
      mockAiCaller.mockResolvedValue({
        content: JSON.stringify({
          era: { period: "明朝", description: "test" },
          characters: [],
          factions: [
            {
              name: 42, // not string → "未命名"
              description: null, // not string → ""
              keyMembers: "solo", // not array → []
            },
          ],
          coreRules: [],
          prohibitions: [],
        }),
        tokensUsed: 50,
      });

      const result = await service.generateWorldSettings(
        "Novel",
        "test",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      const faction = result.settings.factions[0];
      expect(faction.name).toBe("未命名");
      expect(faction.description).toBe("");
      expect(faction.keyMembers).toEqual([]);
    });

    it("filters non-string items from coreRules and prohibitions arrays", async () => {
      mockAiCaller.mockResolvedValue({
        content: JSON.stringify({
          era: { period: "明朝", description: "test" },
          characters: [],
          factions: [],
          coreRules: ["valid rule", 42, null, "another rule"],
          prohibitions: [false, "禁止现代元素"],
        }),
        tokensUsed: 50,
      });

      const result = await service.generateWorldSettings(
        "Novel",
        "test",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      expect(result.settings.coreRules).toEqual(["valid rule", "another rule"]);
      expect(result.settings.prohibitions).toEqual(["禁止现代元素"]);
    });

    it("falls back to default settings when JSON parse fails (invalid JSON in response)", async () => {
      mockAiCaller.mockResolvedValue({
        content: "not valid json at all",
        tokensUsed: 50,
      });

      const result = await service.generateWorldSettings(
        "Novel",
        "test",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      // getDefaultSettings("novel") → period: "架空时代"
      expect(result.settings.era.period).toBe("架空时代");
    });
  });

  // ────────────────────────────────────────────────────────────
  // Line 183: settingsToConstraints — era.year ternary true branch
  // ────────────────────────────────────────────────────────────
  describe("settingsToConstraints — era.year present (line 183)", () => {
    it("includes year in era constraint when era.year is defined", () => {
      const constraints = service.settingsToConstraints({
        era: { period: "明朝", year: "天启六年", description: "明末" },
        characters: [],
        factions: [],
        coreRules: [],
        prohibitions: [],
      });

      const eraConstraint = constraints.find((c) => c.id === "WB-ERA-1");
      expect(eraConstraint?.rule).toContain("天启六年");
    });

    it("omits year in era constraint when era.year is undefined", () => {
      const constraints = service.settingsToConstraints({
        era: { period: "明朝", description: "明末" },
        characters: [],
        factions: [],
        coreRules: [],
        prohibitions: [],
      });

      const eraConstraint = constraints.find((c) => c.id === "WB-ERA-1");
      expect(eraConstraint?.rule).not.toContain("具体时间");
    });
  });
});
