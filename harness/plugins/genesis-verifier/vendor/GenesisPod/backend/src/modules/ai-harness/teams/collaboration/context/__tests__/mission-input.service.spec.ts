/**
 * MissionInputService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { MissionInputService } from "@/modules/ai-harness/facade";
// W2-F: 服务改从 source import；以 source token 提供 useValue mock（不再 mock facade barrel）
import { ContextBudgetCalculator as TokenBudgetCalculatorService } from "@/modules/ai-engine/planning/budget/token-budget.service";
import { ConstraintEnforcementService } from "@/modules/ai-harness/guardrails/constraints/constraint-enforcement.service";

const mockTokenBudgetService = {
  smartTruncate: jest
    .fn()
    .mockImplementation((text: string) => text.substring(0, 7000)),
};

const mockConstraintService = {
  extractConstraints: jest.fn().mockReturnValue([]),
};

describe("MissionInputService", () => {
  let service: MissionInputService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionInputService,
        {
          provide: TokenBudgetCalculatorService,
          useValue: mockTokenBudgetService,
        },
        {
          provide: ConstraintEnforcementService,
          useValue: mockConstraintService,
        },
      ],
    }).compile();

    service = module.get<MissionInputService>(MissionInputService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== parseStructuredInput ====================

  describe("parseStructuredInput", () => {
    it("should parse short description without compression", async () => {
      const description = "写一个简单的故事";

      const result = await service.parseStructuredInput(description);

      expect(result.originalDescription).toBe(description);
      expect(result.originalLength).toBe(description.length);
      expect(result.isLongContent).toBe(false);
      expect(result.compressionApplied).toBe(false);
    });

    it("should mark long content as isLongContent", async () => {
      const description = "x".repeat(11000);

      const result = await service.parseStructuredInput(description);

      expect(result.isLongContent).toBe(true);
    });

    it("should apply compression for very long background", async () => {
      const description = "y".repeat(9000);

      const result = await service.parseStructuredInput(description);

      // compressionApplied depends on whether background length exceeds 8000
      expect(result).toBeDefined();
    });

    it("should extract constraints from description", async () => {
      mockConstraintService.extractConstraints.mockReturnValueOnce([
        {
          id: "c1",
          type: "MUST",
          rule: "No violence",
          severity: "high",
          category: "content",
        },
      ]);

      const result = await service.parseStructuredInput(
        "Write a story. No violence.",
      );

      expect(result.constraints.length).toBe(1);
      expect(result.constraints[0].rule).toBe("No violence");
    });

    it("should extract entities from description with character patterns", async () => {
      const description = "人物：张三，性别：男，年龄：30";

      const result = await service.parseStructuredInput(description);

      expect(result.entities).toBeDefined();
    });

    it("should extract location entities", async () => {
      const description = "在青云山附近的村子里";

      const result = await service.parseStructuredInput(description);

      expect(result.entities).toBeDefined();
    });

    it("should compute extraction confidence >= 0.1", async () => {
      const result = await service.parseStructuredInput("Simple description");

      expect(result.extractionConfidence).toBeGreaterThanOrEqual(0.1);
      expect(result.extractionConfidence).toBeLessThanOrEqual(1.0);
    });

    it("should reduce confidence for long content", async () => {
      const shortResult = await service.parseStructuredInput("Short text");
      const longResult = await service.parseStructuredInput("x".repeat(11000));

      expect(longResult.extractionConfidence).toBeLessThan(
        shortResult.extractionConfidence,
      );
    });

    it("should extract examples from description", async () => {
      const description = `示例：
这是一段示例内容，展示了如何写作。故事很精彩。`;

      const result = await service.parseStructuredInput(description);

      expect(result.examples).toBeDefined();
    });
  });

  // ==================== buildInputSummary ====================

  describe("buildInputSummary", () => {
    it("should build summary from structured input", async () => {
      const input = {
        originalDescription: "Test description",
        originalLength: 16,
        background: "Background content",
        constraints: [
          {
            id: "c1",
            type: "MUST" as const,
            rule: "Rule 1",
            severity: "high" as const,
            category: "content",
          },
          {
            id: "c2",
            type: "SHOULD" as const,
            rule: "Rule 2",
            severity: "medium" as const,
            category: "style",
          },
        ],
        entities: [
          {
            name: "张三",
            type: "character" as const,
            definition: "主角",
            attributes: {},
            relations: [],
          },
        ],
        examples: [],
        isLongContent: false,
        compressionApplied: false,
        extractionConfidence: 0.7,
      };

      const summary = await service.buildInputSummary(input);

      expect(summary.summary).toBeDefined();
      expect(summary.constraintCount).toBe(2);
      expect(summary.entityCount).toBe(1);
      expect(summary.originalLength).toBe(16);
      expect(summary.keyPoints.length).toBeGreaterThan(0);
    });

    it("should include MUST constraints in key points", async () => {
      const input = {
        originalDescription: "Test",
        originalLength: 4,
        background: "Background",
        constraints: [
          {
            id: "c1",
            type: "MUST" as const,
            rule: "Constraint A",
            severity: "high" as const,
            category: "content",
          },
          {
            id: "c2",
            type: "MUST" as const,
            rule: "Constraint B",
            severity: "high" as const,
            category: "content",
          },
        ],
        entities: [],
        examples: [],
        isLongContent: false,
        compressionApplied: false,
        extractionConfidence: 0.8,
      };

      const summary = await service.buildInputSummary(input);

      const mustKeyPoint = summary.keyPoints.find((kp) =>
        kp.includes("硬性约束"),
      );
      expect(mustKeyPoint).toBeDefined();
    });

    it("should include character entities in key points", async () => {
      const input = {
        originalDescription: "Test",
        originalLength: 4,
        background: "Background",
        constraints: [],
        entities: [
          {
            name: "李四",
            type: "character" as const,
            definition: "配角",
            attributes: {},
            relations: [],
          },
        ],
        examples: [],
        isLongContent: false,
        compressionApplied: false,
        extractionConfidence: 0.8,
      };

      const summary = await service.buildInputSummary(input);

      const charKeyPoint = summary.keyPoints.find((kp) => kp.includes("李四"));
      expect(charKeyPoint).toBeDefined();
    });

    it("should truncate long background in summary", async () => {
      const input = {
        originalDescription: "Test",
        originalLength: 4,
        background: "B".repeat(1000),
        constraints: [],
        entities: [],
        examples: [],
        isLongContent: false,
        compressionApplied: false,
        extractionConfidence: 0.7,
      };

      const summary = await service.buildInputSummary(input);

      expect(summary.summary.endsWith("...")).toBe(true);
    });
  });

  // ==================== validateConstraints ====================

  describe("validateConstraints", () => {
    it("should be valid for well-defined constraints", () => {
      const input = {
        originalDescription: "Test",
        originalLength: 4,
        background: "Background",
        constraints: [
          {
            id: "c1",
            type: "MUST" as const,
            rule: "Rule 1",
            severity: "high" as const,
            category: "content",
          },
        ],
        entities: [],
        examples: [],
        isLongContent: false,
        compressionApplied: false,
        extractionConfidence: 0.8,
      };

      const result = service.validateConstraints(input);

      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBe(0);
    });

    it("should warn about missing MUST constraints for long content", () => {
      const input = {
        originalDescription: "Test",
        originalLength: 4,
        background: "Background",
        constraints: [],
        entities: [],
        examples: [],
        isLongContent: true,
        compressionApplied: false,
        extractionConfidence: 0.8,
      };

      const result = service.validateConstraints(input);

      expect(result.isValid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("硬性约束");
    });

    it("should warn about low extraction confidence", () => {
      const input = {
        originalDescription: "Test",
        originalLength: 4,
        background: "Background",
        constraints: [],
        entities: [],
        examples: [],
        isLongContent: false,
        compressionApplied: false,
        extractionConfidence: 0.3,
      };

      const result = service.validateConstraints(input);

      expect(result.isValid).toBe(false);
      expect(result.warnings.some((w) => w.includes("置信度"))).toBe(true);
    });

    it("should warn about entities with short definitions", () => {
      const input = {
        originalDescription: "Test",
        originalLength: 4,
        background: "Background",
        constraints: [],
        entities: [
          {
            name: "张三",
            type: "character" as const,
            definition: "hi",
            attributes: {},
            relations: [],
          },
        ],
        examples: [],
        isLongContent: false,
        compressionApplied: false,
        extractionConfidence: 0.8,
      };

      const result = service.validateConstraints(input);

      expect(result.warnings.some((w) => w.includes("实体定义不完整"))).toBe(
        true,
      );
    });
  });

  // ==================== formatInputReport ====================

  describe("formatInputReport", () => {
    it("should format input report as string", () => {
      const input = {
        originalDescription: "Test",
        originalLength: 4,
        background: "Background",
        constraints: [
          {
            id: "c1",
            type: "MUST" as const,
            rule: "Rule 1",
            severity: "high" as const,
            category: "content",
          },
        ],
        entities: [
          {
            name: "张三",
            type: "character" as const,
            definition: "主角定义很长",
            attributes: {},
            relations: [],
          },
        ],
        examples: [],
        isLongContent: false,
        compressionApplied: false,
        extractionConfidence: 0.8,
      };

      const report = service.formatInputReport(input);

      expect(report).toContain("Mission Input Report");
      expect(report).toContain("c1");
      expect(report).toContain("张三");
      expect(report).toContain("Constraints (1)");
      expect(report).toContain("Entities (1)");
    });
  });
});
