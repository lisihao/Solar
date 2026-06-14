/**
 * ReportEditorService - Supplemental Tests
 *
 * Covers uncovered branches:
 * - terminologyIssues logging branch (line 203)
 * - dataConsistencyIssues logging branch (line 208)
 * - dimInput has no detailedContent → continue (line 218)
 * - hint is too short (< 10 chars) → continue (line 224)
 */

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

describe("ReportEditorService (supplemental)", () => {
  let service: ReportEditorService;
  let mockAiFacade: ReturnType<typeof createMockAiEngineFacade>;

  beforeEach(() => {
    mockAiFacade = createMockAiEngineFacade();
    service = new ReportEditorService(mockAiFacade as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== terminologyIssues + dataConsistencyIssues logging ====================

  it("should log terminologyIssues when present in dedup result", async () => {
    const dimensionInputs = [
      {
        dimensionId: "dim-1",
        dimensionName: "Market Analysis",
        dimensionDescription: null,
        summary: "Summary A",
        keyFindings: [],
        detailedContent: "# Market\n\nThe market grew 15% in 2024.",
        sourcesUsed: 1,
        trends: [],
        challenges: [],
        opportunities: [],
      },
      {
        dimensionId: "dim-2",
        dimensionName: "Tech Trends",
        dimensionDescription: null,
        summary: "Summary B",
        keyFindings: [],
        detailedContent: "# Tech\n\nMarket growth was 15%.",
        sourcesUsed: 1,
        trends: [],
        challenges: [],
        opportunities: [],
      },
    ];

    const dedupResponse = {
      duplicates: [
        {
          claim: "15% growth",
          dimensions: ["Market Analysis", "Tech Trends"],
          keepIn: "Market Analysis",
          removeFrom: ["Tech Trends"],
          paragraphHints: ["Market growth was 15%"],
        },
      ],
      terminologyIssues: [
        {
          term: "growth",
          variants: ["growth", "grew"],
          recommendation: "Use 'growth' consistently",
        },
      ],
      dataConsistencyIssues: [
        {
          claim: "15% growth",
          inconsistency: "Different phrasing",
        },
      ],
      suggestions: [],
    };

    mockAiFacade.chatWithSkills.mockResolvedValue({
      content: JSON.stringify(dedupResponse),
      usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    });

    const result = await service.editDimensionInputs(
      dimensionInputs as any,
      "Test Topic",
    );

    // terminologyIssues and dataConsistencyIssues logged — verify stats still correct
    expect(result.deduplicationStats.duplicateClaims).toBe(1);
    expect(result.terminologyIssues).toBeDefined();
    expect(result.dataConsistencyIssues).toBeDefined();
  });

  // ==================== dimInput has no detailedContent → continue ====================

  it("should skip dimension with no detailedContent when removing duplicates", async () => {
    const dimensionInputs = [
      {
        dimensionId: "dim-1",
        dimensionName: "Dimension A",
        dimensionDescription: null,
        summary: "Summary A",
        keyFindings: [],
        detailedContent: "Some content here.",
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
        detailedContent: null, // no detailedContent → continue
        sourcesUsed: 1,
        trends: [],
        challenges: [],
        opportunities: [],
      },
    ];

    const dedupResponse = {
      duplicates: [
        {
          claim: "Some claim",
          dimensions: ["Dimension A", "Dimension B"],
          keepIn: "Dimension A",
          removeFrom: ["Dimension B"],
          paragraphHints: ["Some content here"],
        },
      ],
      suggestions: [],
    };

    mockAiFacade.chatWithSkills.mockResolvedValue({
      content: JSON.stringify(dedupResponse),
      usage: { promptTokens: 300, completionTokens: 100, totalTokens: 400 },
    });

    const result = await service.editDimensionInputs(
      dimensionInputs as any,
      "Test Topic",
    );

    // Should not throw; removedParagraphs stays 0 because Dimension B had no detailedContent
    expect(result.deduplicationStats.removedParagraphs).toBe(0);
  });

  // ==================== hint is too short (< 10 chars) → continue ====================

  it("should skip paragraph hints shorter than 10 characters", async () => {
    const dimensionInputs = [
      {
        dimensionId: "dim-1",
        dimensionName: "Dimension A",
        dimensionDescription: null,
        summary: "Summary A",
        keyFindings: [],
        detailedContent: "Short.",
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
        detailedContent: "Short paragraph.\n\nAnother paragraph here.",
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
          dimensions: ["Dimension A", "Dimension B"],
          keepIn: "Dimension A",
          removeFrom: ["Dimension B"],
          // Short hints (< 10 chars) are skipped
          paragraphHints: ["", "tiny", null],
        },
      ],
      suggestions: [],
    };

    mockAiFacade.chatWithSkills.mockResolvedValue({
      content: JSON.stringify(dedupResponse),
      usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
    });

    const result = await service.editDimensionInputs(
      dimensionInputs as any,
      "Test Topic",
    );

    // All hints skipped → no paragraphs removed
    expect(result.deduplicationStats.removedParagraphs).toBe(0);
    // Dimension B content unchanged
    const dimB = result.dimensions.find(
      (d) => d.dimensionName === "Dimension B",
    );
    expect(dimB!.detailedContent).toContain("Short paragraph.");
    expect(dimB!.detailedContent).toContain("Another paragraph here.");
  });

  // ==================== duplicate with numeric data → triggers warn log ====================

  it("should log warning for duplicate claims containing numeric data (statistics)", async () => {
    const dimensionInputs = [
      {
        dimensionId: "dim-1",
        dimensionName: "Market",
        dimensionDescription: null,
        summary: "Market summary",
        keyFindings: [],
        detailedContent: "Revenue was $10,000 in Q1.",
        sourcesUsed: 1,
        trends: [],
        challenges: [],
        opportunities: [],
      },
      {
        dimensionId: "dim-2",
        dimensionName: "Finance",
        dimensionDescription: null,
        summary: "Finance summary",
        keyFindings: [],
        detailedContent: "Revenue was $10,000 in Q1.\n\nOther finance data.",
        sourcesUsed: 1,
        trends: [],
        challenges: [],
        opportunities: [],
      },
    ];

    const dedupResponse = {
      duplicates: [
        {
          claim: "Revenue was $10,000", // contains numeric data pattern
          dimensions: ["Market", "Finance"],
          keepIn: "Market",
          removeFrom: ["Finance"],
          paragraphHints: ["Revenue was $10,000 in Q1"],
        },
      ],
      suggestions: [],
    };

    mockAiFacade.chatWithSkills.mockResolvedValue({
      content: JSON.stringify(dedupResponse),
      usage: { promptTokens: 400, completionTokens: 150, totalTokens: 550 },
    });

    const result = await service.editDimensionInputs(
      dimensionInputs as any,
      "Finance Topic",
    );

    // Paragraph was removed
    expect(result.deduplicationStats.removedParagraphs).toBe(1);
    const dimFinance = result.dimensions.find(
      (d) => d.dimensionName === "Finance",
    );
    expect(dimFinance!.detailedContent).not.toContain(
      "Revenue was $10,000 in Q1.",
    );
    expect(dimFinance!.detailedContent).toContain("Other finance data.");
  });
});
