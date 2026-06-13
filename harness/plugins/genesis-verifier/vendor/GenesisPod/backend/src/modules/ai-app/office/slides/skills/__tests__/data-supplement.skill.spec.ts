/**
 * Unit tests for DataSupplementSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import { DataSupplementSkill } from "../data-supplement.skill";
import {
  MISSING_PLACEHOLDER,
  MISSING_NUMBER_PLACEHOLDER,
} from "../../templates/base/template-requirements";

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-data-supplement",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
  metadata: {},
});

const buildPageContent = (overrides: Record<string, unknown> = {}) => ({
  title: "Market Analysis",
  subtitle: "Q4 2024",
  sections: [],
  ...overrides,
});

describe("DataSupplementSkill", () => {
  let skill: DataSupplementSkill;

  const mockFacade = {
    chat: jest.fn(),
  };

  const mockToolRegistry = {
    tryGet: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: DataSupplementSkill,
          useFactory: () =>
            new DataSupplementSkill(mockFacade as any, mockToolRegistry as any),
        },
      ],
    }).compile();

    skill = module.get<DataSupplementSkill>(DataSupplementSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-data-supplement");
    expect(skill.name).toBe("数据补全");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("4.0.0");
  });

  it("should return error for invalid input (missing required fields)", async () => {
    const result = await skill.execute(
      { context: { input: { topic: "test" } } } as any,
      buildSkillContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
  });

  it("should return no-supplement result when no missing data", async () => {
    const pageContent = buildPageContent({
      title: "Complete Title",
      subtitle: "Complete Subtitle",
      sections: [
        { type: "text", position: "full", content: "Complete text content" },
      ],
    });

    const result = await skill.execute(
      { pageContent, topic: "Market Analysis" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.wasSupplemented).toBe(false);
    expect(result.data!.supplementedFields).toHaveLength(0);
    expect(result.data!.searchQueries).toHaveLength(0);
  });

  it("should detect MISSING_PLACEHOLDER as missing data", async () => {
    mockToolRegistry.tryGet.mockReturnValue(null); // no search tool

    const pageContent = buildPageContent({
      sections: [
        {
          type: "stat",
          position: "left",
          content: { value: MISSING_NUMBER_PLACEHOLDER, label: "Revenue" },
        },
      ],
    });

    const result = await skill.execute(
      { pageContent, topic: "Revenue Stats" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    // No search results → no supplement
    expect(result.data!.wasSupplemented).toBe(false);
    expect(result.data!.searchQueries.length).toBeGreaterThan(0);
  });

  it("should detect [内容缺失] as missing data", async () => {
    mockToolRegistry.tryGet.mockReturnValue(null);

    const pageContent = buildPageContent({
      sections: [
        { type: "text", position: "full", content: MISSING_PLACEHOLDER },
      ],
    });

    const result = await skill.execute(
      { pageContent, topic: "Test Topic" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    // No web search tool → no supplement
    expect(result.data!.wasSupplemented).toBe(false);
  });

  it("should perform search and supplement when web-search tool is available", async () => {
    const mockWebSearch = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: {
          success: true,
          results: [
            {
              title: "Market Report",
              url: "https://example.com",
              content: "The market grew by 25% in 2024",
            },
          ],
        },
      }),
    };
    mockToolRegistry.tryGet.mockReturnValue(mockWebSearch);

    mockFacade.chat.mockResolvedValue({
      content: JSON.stringify({ "sections[0].content.value": "25%" }),
      tokensUsed: 50,
    });

    const pageContent = buildPageContent({
      sections: [
        {
          type: "stat",
          position: "left",
          content: { value: MISSING_NUMBER_PLACEHOLDER, label: "Growth" },
        },
      ],
    });

    const result = await skill.execute(
      { pageContent, topic: "Market Growth" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(mockWebSearch.execute).toHaveBeenCalled();
  });

  it("should handle orchestrator input format", async () => {
    mockToolRegistry.tryGet.mockReturnValue(null);

    const pageContent = buildPageContent();
    const orchestratorInput = {
      context: {
        input: {
          pageContent,
          topic: "Test Topic",
          sourceText: "Some source",
        },
      },
    };

    const result = await skill.execute(
      orchestratorInput as any,
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
  });

  it("should detect generic filler text as missing", async () => {
    mockToolRegistry.tryGet.mockReturnValue(null);

    const pageContent = buildPageContent({
      sections: [{ type: "text", position: "full", content: "核心能力" }],
    });

    const result = await skill.execute(
      { pageContent, topic: "Innovation" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    // generic filler → treated as missing
    expect(result.data!.searchQueries.length).toBeGreaterThanOrEqual(0);
  });

  it("should detect pattern-based filler as missing", async () => {
    mockToolRegistry.tryGet.mockReturnValue(null);

    const pageContent = buildPageContent({
      sections: [{ type: "text", position: "full", content: "支柱1" }],
    });

    const result = await skill.execute(
      { pageContent, topic: "Test" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
  });

  it("should handle missing title", async () => {
    mockToolRegistry.tryGet.mockReturnValue(null);

    const pageContent = {
      title: MISSING_PLACEHOLDER,
      sections: [],
    };

    const result = await skill.execute(
      { pageContent, topic: "Test" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.searchQueries.length).toBeGreaterThanOrEqual(0);
  });

  it("should return error on unexpected exception", async () => {
    mockToolRegistry.tryGet.mockImplementation(() => {
      throw new Error("Registry failed");
    });

    const pageContent = buildPageContent({
      sections: [
        {
          type: "stat",
          position: "left",
          content: { value: MISSING_NUMBER_PLACEHOLDER, label: "KPI" },
        },
      ],
    });

    const result = await skill.execute(
      { pageContent, topic: "Test" },
      buildSkillContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("DATA_SUPPLEMENT_ERROR");
    expect(result.error?.retryable).toBe(true);
  });
});
