/**
 * ReportEditorService Unit Tests
 *
 * Tests for cross-dimension deduplication and editing functionality
 * Type checking is disabled due to Jest mock compatibility issues.
 */

// Must mock before any import that triggers the @nestjs/cache-manager chain
jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient { $connect = jest.fn(); $disconnect = jest.fn(); $on = jest.fn(); }, AIModelType: { CHAT: "CHAT" },
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: class {},
  RAGFacade: class {},
  ToolRegistry: class {},
  AgentFacade: class {},
  EvalPipelineService: class {},
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: class {},
  RAGFacade: class {},
  ToolRegistry: class {},
  AgentFacade: class {},
  EvalPipelineService: class {},
}));

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { ReportEditorService } from "../report-editor.service";
import { createMockAiEngineFacade } from "../../../__tests__/mocks";

describe("ReportEditorService", () => {
  let service: ReportEditorService;
  let mockAiFacade: ReturnType<typeof createMockAiEngineFacade>;

  beforeEach(() => {
    mockAiFacade = createMockAiEngineFacade();
    service = new ReportEditorService(mockAiFacade as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== editDimensionInputs Tests ====================

  describe("editDimensionInputs", () => {
    it("should return unchanged for empty array", async () => {
      // Arrange
      const dimensionInputs: unknown[] = [];
      const topicName = "Test Topic";

      // Act
      const result = await service.editDimensionInputs(
        dimensionInputs as any,
        topicName,
      );

      // Assert
      expect(result.dimensions).toEqual([]);
      expect(result.deduplicationStats.duplicateClaims).toBe(0);
      expect(result.deduplicationStats.removedParagraphs).toBe(0);
      expect(result.deduplicationStats.affectedDimensions).toEqual([]);
      expect(result.transitions).toEqual([]);
      expect(mockAiFacade.chatWithSkills).not.toHaveBeenCalled();
    });

    it("should return unchanged for single dimension (no dedup needed)", async () => {
      // Arrange
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "Market Analysis",
          dimensionDescription: "Market overview",
          summary: "Market is growing",
          keyFindings: [{ finding: "Growth rate 15%", evidenceIds: [] }],
          detailedContent: "# Market Analysis\n\nThe market is growing at 15%.",
          sourcesUsed: 3,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];
      const topicName = "Test Topic";

      // Act
      const result = await service.editDimensionInputs(
        dimensionInputs as any,
        topicName,
      );

      // Assert
      expect(result.dimensions).toEqual(dimensionInputs);
      expect(result.deduplicationStats.duplicateClaims).toBe(0);
      expect(result.deduplicationStats.removedParagraphs).toBe(0);
      expect(result.transitions).toEqual([]);
      expect(mockAiFacade.chatWithSkills).not.toHaveBeenCalled();
    });

    it("should call AI and apply dedup for 2+ dimensions", async () => {
      // Arrange
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "Market Analysis",
          dimensionDescription: "Market overview",
          summary: "Market is growing",
          keyFindings: [{ finding: "Growth rate 15%", evidenceIds: [] }],
          detailedContent:
            "# Market Analysis\n\nThe global market reached $10B in 2024.\n\nGrowth is accelerating.",
          sourcesUsed: 3,
          trends: [],
          challenges: [],
          opportunities: [],
        },
        {
          dimensionId: "dim-2",
          dimensionName: "Competitive Landscape",
          dimensionDescription: "Competitor analysis",
          summary: "Competition is intense",
          keyFindings: [
            { finding: "Top 3 players control 60%", evidenceIds: [] },
          ],
          detailedContent:
            "# Competitive Landscape\n\nThe global market reached $10B in 2024.\n\nTop players dominate.",
          sourcesUsed: 2,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];

      const dedupResponse = {
        duplicates: [
          {
            claim: "Market size $10B",
            dimensions: ["Market Analysis", "Competitive Landscape"],
            keepIn: "Market Analysis",
            removeFrom: ["Competitive Landscape"],
            paragraphHints: ["The global market reached $10B"],
          },
        ],
        suggestions: ["Keep market size data in Market Analysis only"],
      };

      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(dedupResponse),
        usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
      });

      // Act
      const result = await service.editDimensionInputs(
        dimensionInputs as any,
        "AI Market",
      );

      // Assert
      expect(mockAiFacade.chatWithSkills).toHaveBeenCalledTimes(1);
      expect(result.deduplicationStats.duplicateClaims).toBe(1);
      expect(result.deduplicationStats.removedParagraphs).toBe(1);
      expect(result.deduplicationStats.affectedDimensions).toContain(
        "Competitive Landscape",
      );

      // Check that the duplicate paragraph was removed
      const editedDim2 = result.dimensions.find(
        (d) => d.dimensionName === "Competitive Landscape",
      );
      expect(editedDim2!.detailedContent).not.toContain(
        "The global market reached $10B in 2024.",
      );
      expect(editedDim2!.detailedContent).toContain("Top players dominate.");
    });

    it("should match paragraphs with normalized whitespace", async () => {
      // Arrange
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "Dimension A",
          dimensionDescription: null,
          summary: "Summary A",
          keyFindings: [],
          detailedContent: "Para 1",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
        {
          dimensionId: "dim-2",
          dimensionName: "Dimension B",
          dimensionDescription: null,
          summary: "Summary B",
          keyFindings: [],
          detailedContent:
            "Para 1\n\nThe   market    has   grown   significantly.\n\nPara 2",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];

      const dedupResponse = {
        duplicates: [
          {
            claim: "Market growth",
            dimensions: ["Dimension A", "Dimension B"],
            keepIn: "Dimension A",
            removeFrom: ["Dimension B"],
            // Note: extra spaces in hint
            paragraphHints: ["The market has grown"],
          },
        ],
        suggestions: [],
      };

      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(dedupResponse),
        usage: { promptTokens: 300, completionTokens: 100, totalTokens: 400 },
      });

      // Act
      const result = await service.editDimensionInputs(
        dimensionInputs,
        "Topic",
      );

      // Assert
      expect(result.deduplicationStats.removedParagraphs).toBe(1);
      const editedDimB = result.dimensions.find(
        (d) => d.dimensionName === "Dimension B",
      );
      expect(editedDimB!.detailedContent).toBe("Para 1\n\nPara 2");
    });

    it("should never remove headings (starting with #)", async () => {
      // Arrange
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "Dimension A",
          dimensionDescription: null,
          summary: "Summary A",
          keyFindings: [],
          detailedContent: "Content A",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
        {
          dimensionId: "dim-2",
          dimensionName: "Dimension B",
          dimensionDescription: null,
          summary: "Summary B",
          keyFindings: [],
          detailedContent:
            "# Heading 1\n\n## Subheading\n\nSome paragraph content here.",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];

      const dedupResponse = {
        duplicates: [
          {
            claim: "Duplicate heading",
            dimensions: ["Dimension A", "Dimension B"],
            keepIn: "Dimension A",
            removeFrom: ["Dimension B"],
            paragraphHints: ["# Heading 1", "## Subheading"],
          },
        ],
        suggestions: [],
      };

      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(dedupResponse),
        usage: { promptTokens: 300, completionTokens: 100, totalTokens: 400 },
      });

      // Act
      const result = await service.editDimensionInputs(
        dimensionInputs,
        "Topic",
      );

      // Assert
      // Headings should NOT be removed
      const editedDimB = result.dimensions.find(
        (d) => d.dimensionName === "Dimension B",
      );
      expect(editedDimB!.detailedContent).toContain("# Heading 1");
      expect(editedDimB!.detailedContent).toContain("## Subheading");
      expect(result.deduplicationStats.removedParagraphs).toBe(0);
    });

    it("should gracefully handle AI call failure and return original dimensions", async () => {
      // Arrange
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "Dimension A",
          dimensionDescription: null,
          summary: "Summary A",
          keyFindings: [],
          detailedContent: "Content A",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
        {
          dimensionId: "dim-2",
          dimensionName: "Dimension B",
          dimensionDescription: null,
          summary: "Summary B",
          keyFindings: [],
          detailedContent: "Content B",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];

      mockAiFacade.chatWithSkills.mockRejectedValue(new Error("API timeout"));

      // Act
      const result = await service.editDimensionInputs(
        dimensionInputs,
        "Topic",
      );

      // Assert
      expect(result.dimensions).toEqual(dimensionInputs);
      expect(result.deduplicationStats.duplicateClaims).toBe(0);
      expect(result.deduplicationStats.removedParagraphs).toBe(0);
    });

    it("should handle invalid AI response gracefully", async () => {
      // Arrange
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "Dimension A",
          dimensionDescription: null,
          summary: "Summary A",
          keyFindings: [],
          detailedContent: "Content A",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
        {
          dimensionId: "dim-2",
          dimensionName: "Dimension B",
          dimensionDescription: null,
          summary: "Summary B",
          keyFindings: [],
          detailedContent: "Content B",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];

      // Return invalid JSON
      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: "This is not JSON",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      // Act
      const result = await service.editDimensionInputs(
        dimensionInputs,
        "Topic",
      );

      // Assert
      expect(result.dimensions).toEqual(dimensionInputs);
      expect(result.deduplicationStats.duplicateClaims).toBe(0);
      expect(result.deduplicationStats.removedParagraphs).toBe(0);
    });
  });

  // ==================== generateTransitionHints Tests ====================

  describe("generateTransitionHints", () => {
    it("should generate N-1 transitions for N dimensions", async () => {
      // Arrange
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "Market Overview",
          dimensionDescription: null,
          summary: "Market summary",
          keyFindings: [],
          detailedContent: "Market content",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
        {
          dimensionId: "dim-2",
          dimensionName: "Technology Trends",
          dimensionDescription: null,
          summary: "Tech summary",
          keyFindings: [],
          detailedContent: "Tech content",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
        {
          dimensionId: "dim-3",
          dimensionName: "Competitive Analysis",
          dimensionDescription: null,
          summary: "Competition summary",
          keyFindings: [],
          detailedContent: "Competition content",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];

      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({ duplicates: [], suggestions: [] }),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      // Act
      const result = await service.editDimensionInputs(
        dimensionInputs,
        "AI Topic",
      );

      // Assert
      expect(result.transitions).toHaveLength(2); // N-1 = 3-1 = 2
      expect(result.transitions[0].fromDimension).toBe("Market Overview");
      expect(result.transitions[0].toDimension).toBe("Technology Trends");
      expect(result.transitions[1].fromDimension).toBe("Technology Trends");
      expect(result.transitions[1].toDimension).toBe("Competitive Analysis");
    });

    it("should generate no transitions for single dimension", async () => {
      // Arrange
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "Single Dimension",
          dimensionDescription: null,
          summary: "Summary",
          keyFindings: [],
          detailedContent: "Content",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];

      // Act
      const result = await service.editDimensionInputs(
        dimensionInputs,
        "Topic",
      );

      // Assert
      expect(result.transitions).toEqual([]);
    });

    it("should include dimension names in transition text", async () => {
      // Arrange
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "市场规模",
          dimensionDescription: null,
          summary: "市场摘要",
          keyFindings: [],
          detailedContent: "市场内容",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
        {
          dimensionId: "dim-2",
          dimensionName: "技术创新",
          dimensionDescription: null,
          summary: "技术摘要",
          keyFindings: [],
          detailedContent: "技术内容",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];

      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({ duplicates: [], suggestions: [] }),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      // Act
      const result = await service.editDimensionInputs(
        dimensionInputs,
        "AI 主题",
      );

      // Assert
      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0].transitionText).toContain("市场规模");
      expect(result.transitions[0].transitionText).toContain("技术创新");
    });
  });

  // ==================== V5 terminology/data consistency Tests ====================

  describe("V5 terminology and data consistency issues", () => {
    it("should include terminologyIssues in result when AI returns them", async () => {
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "Dimension A",
          dimensionDescription: null,
          summary: "Summary A",
          keyFindings: [],
          detailedContent: "Content about AI/ML",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
        {
          dimensionId: "dim-2",
          dimensionName: "Dimension B",
          dimensionDescription: null,
          summary: "Summary B",
          keyFindings: [],
          detailedContent: "Content about machine learning",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];

      const dedupResponse = {
        duplicates: [],
        suggestions: [],
        terminologyIssues: [
          {
            term: "AI",
            variants: ["AI", "Artificial Intelligence", "机器智能"],
            standardForm: "AI（人工智能）",
            affectedDimensions: ["Dimension A", "Dimension B"],
          },
        ],
        dataConsistencyIssues: [
          {
            dataPoint: "Market size",
            values: [
              { dimension: "Dimension A", value: "$10B", source: "source1" },
              { dimension: "Dimension B", value: "$12B", source: "source2" },
            ],
            resolution: "Use $10B from the 2024 market report",
          },
        ],
      };

      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(dedupResponse),
        usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      });

      const result = await service.editDimensionInputs(
        dimensionInputs,
        "AI Market",
      );

      expect(result.terminologyIssues).toBeDefined();
      expect(result.terminologyIssues).toHaveLength(1);
      expect(result.terminologyIssues![0].term).toBe("AI");
      expect(result.dataConsistencyIssues).toBeDefined();
      expect(result.dataConsistencyIssues).toHaveLength(1);
    });

    it("should detect duplicate statistics in claim and log warning", async () => {
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "Market Overview",
          dimensionDescription: null,
          summary: "Market growing 25%",
          keyFindings: [],
          detailedContent: "Market grew 25% in 2024.\n\nOther insights here.",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
        {
          dimensionId: "dim-2",
          dimensionName: "Competition",
          dimensionDescription: null,
          summary: "Competition is intense",
          keyFindings: [],
          detailedContent:
            "Market grew 25% in 2024.\n\nOther competitive data.",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];

      const dedupResponse = {
        duplicates: [
          {
            claim: "Market grew 25% in 2024",
            dimensions: ["Market Overview", "Competition"],
            keepIn: "Market Overview",
            removeFrom: ["Competition"],
            paragraphHints: ["Market grew 25% in 2024"],
          },
        ],
        suggestions: [],
      };

      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(dedupResponse),
        usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      });

      const result = await service.editDimensionInputs(
        dimensionInputs,
        "AI Market",
      );

      // Should detect and remove the duplicate stat
      expect(result.deduplicationStats.duplicateClaims).toBe(1);
      expect(result.deduplicationStats.removedParagraphs).toBe(1);
    });

    it("should skip paragraph hints shorter than 10 chars", async () => {
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "Dim A",
          dimensionDescription: null,
          summary: "Summary A",
          keyFindings: [],
          detailedContent: "Short para",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
        {
          dimensionId: "dim-2",
          dimensionName: "Dim B",
          dimensionDescription: null,
          summary: "Summary B",
          keyFindings: [],
          detailedContent: "Short para\n\nAnother paragraph here.",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];

      const dedupResponse = {
        duplicates: [
          {
            claim: "Short",
            dimensions: ["Dim A", "Dim B"],
            keepIn: "Dim A",
            removeFrom: ["Dim B"],
            paragraphHints: ["ab"], // too short, should be skipped
          },
        ],
        suggestions: [],
      };

      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(dedupResponse),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      const result = await service.editDimensionInputs(
        dimensionInputs,
        "Topic",
      );

      // Hint too short, so no paragraphs removed
      expect(result.deduplicationStats.removedParagraphs).toBe(0);
    });

    it("should handle dim with no detailedContent gracefully", async () => {
      const dimensionInputs = [
        {
          dimensionId: "dim-1",
          dimensionName: "Dim A",
          dimensionDescription: null,
          summary: "Summary A",
          keyFindings: [],
          detailedContent: "Some content",
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
        {
          dimensionId: "dim-2",
          dimensionName: "Dim B",
          dimensionDescription: null,
          summary: "Summary B",
          keyFindings: [],
          detailedContent: null as unknown as string,
          sourcesUsed: 1,
          trends: [],
          challenges: [],
          opportunities: [],
        },
      ];

      const dedupResponse = {
        duplicates: [
          {
            claim: "Duplicate content",
            dimensions: ["Dim A", "Dim B"],
            keepIn: "Dim A",
            removeFrom: ["Dim B"],
            paragraphHints: ["Some content"],
          },
        ],
        suggestions: [],
      };

      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify(dedupResponse),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      // Should not throw even when detailedContent is null
      const result = await service.editDimensionInputs(
        dimensionInputs,
        "Topic",
      );
      expect(result.deduplicationStats.removedParagraphs).toBe(0);
    });
  });
});
