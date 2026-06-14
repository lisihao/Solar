import { Test, TestingModule } from "@nestjs/testing";
import { DimensionSearchService } from "../dimension-search.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DataSourceRouterService } from "../../data/data-source-router.service";
import { ResearchEventEmitterService } from "../../core/research/research-event-emitter.service";
import { AgentActivityService } from "../../monitoring/agent-activity.service";
import { DataEnrichmentService } from "../../data/data-enrichment.service";
import { LeaderToolService } from "../../data/leader-tool.service";
import { DataSourceType } from "../../../types/data-source.types";
import { DimensionStatus, AgentActivityType } from "@prisma/client";

const mockPrisma = {
  topicDimension: {
    update: jest.fn(),
  },
};

const mockDataSourceRouter = {
  fetchDataForDimension: jest.fn(),
};

const mockEventEmitter = {
  emitAgentWorking: jest.fn(),
};

const mockAgentActivity = {
  startThinkingPhase: jest.fn(),
  endThinkingPhase: jest.fn(),
};

const mockDataEnrichment = {
  enrichSearchResults: jest.fn(),
  getEnrichmentStats: jest.fn(),
};

const mockLeaderTool = {
  generateEnhancedPlanningContext: jest.fn(),
};

const mockTopic = {
  id: "topic-123",
  name: "AI Healthcare",
  description: "AI in healthcare research",
  userId: "user-abc",
  topicConfig: null,
};

const mockDimension = {
  id: "dim-456",
  name: "技术趋势",
  searchQueries: ["AI diagnostics", "medical AI"],
  status: DimensionStatus.PENDING,
};

describe("DimensionSearchService", () => {
  let service: DimensionSearchService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default mocks
    mockPrisma.topicDimension.update.mockResolvedValue({});
    mockAgentActivity.startThinkingPhase.mockResolvedValue(undefined);
    mockAgentActivity.endThinkingPhase.mockResolvedValue(undefined);
    mockEventEmitter.emitAgentWorking.mockResolvedValue(undefined);

    mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
      items: [
        {
          sourceType: DataSourceType.WEB,
          title: "AI Diagnostics Breakthrough",
          url: "https://example.com/ai-diagnostics",
          snippet: "New AI system for medical diagnosis",
          domain: "example.com",
          publishedAt: new Date("2024-01-15"),
          metadata: {},
        },
        {
          sourceType: DataSourceType.ACADEMIC,
          title: "Deep Learning in Radiology",
          url: "https://arxiv.org/abs/2401.12345",
          snippet: "Academic paper on deep learning",
          domain: "arxiv.org",
          publishedAt: new Date("2024-01-10"),
          metadata: {},
        },
      ],
      sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      totalCount: 2,
      metadata: {
        searchQuery: "AI diagnostics",
        executionTimeMs: 500,
        sourceResults: {},
      },
    });

    mockDataEnrichment.enrichSearchResults.mockResolvedValue([
      {
        sourceType: DataSourceType.WEB,
        title: "AI Diagnostics Breakthrough",
        url: "https://example.com/ai-diagnostics",
        snippet: "New AI system for medical diagnosis",
        domain: "example.com",
        publishedAt: new Date("2024-01-15"),
        metadata: {},
        fullContent: "Full content of the article...",
        contentSource: "fetch",
        extractedFigures: [],
      },
    ]);

    mockDataEnrichment.getEnrichmentStats.mockReturnValue({
      total: 2,
      fetched: 1,
      validUrls: 2,
      invalidUrls: 0,
      avgContentLength: 500,
    });

    mockLeaderTool.generateEnhancedPlanningContext.mockResolvedValue({
      contextSummary: "Latest AI developments in healthcare",
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DimensionSearchService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DataSourceRouterService, useValue: mockDataSourceRouter },
        {
          provide: ResearchEventEmitterService,
          useValue: mockEventEmitter,
        },
        { provide: AgentActivityService, useValue: mockAgentActivity },
        { provide: DataEnrichmentService, useValue: mockDataEnrichment },
        { provide: LeaderToolService, useValue: mockLeaderTool },
      ],
    }).compile();

    service = module.get<DimensionSearchService>(DimensionSearchService);
  });

  describe("executeSearchPhase", () => {
    it("should return a complete search phase result", async () => {
      const result = await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
      );

      expect(result).toBeDefined();
      expect(result.dimensionId).toBe(mockDimension.id);
      expect(result.dimensionName).toBe(mockDimension.name);
      expect(result.enrichedResults).toBeDefined();
      expect(result.evidenceData).toBeDefined();
      expect(result.evidenceSummary).toBeDefined();
      expect(result.searchResultsRecord).toBeDefined();
      expect(result.temporalContext).toBeDefined();
      expect(result.figuresSummary).toBeDefined();
      expect(result.leaderContextSummary).toBeDefined();
    });

    it("should update dimension status to RESEARCHING", async () => {
      await service.executeSearchPhase(mockTopic as any, mockDimension as any);

      expect(mockPrisma.topicDimension.update).toHaveBeenCalledWith({
        where: { id: mockDimension.id },
        data: { status: DimensionStatus.RESEARCHING },
      });
    });

    it("should call dataSourceRouter.fetchDataForDimension", async () => {
      await service.executeSearchPhase(mockTopic as any, mockDimension as any);

      expect(mockDataSourceRouter.fetchDataForDimension).toHaveBeenCalledWith(
        mockDimension,
        mockTopic,
        expect.objectContaining({
          assignedTools: undefined,
          assignedSkills: undefined,
        }),
      );
    });

    it("should pass assignedTools and assignedSkills to router", async () => {
      const tools = ["web-search", "arxiv-search"];
      const skills = ["summarize"];

      await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
        undefined,
        undefined,
        undefined,
        tools,
        skills,
      );

      expect(mockDataSourceRouter.fetchDataForDimension).toHaveBeenCalledWith(
        mockDimension,
        mockTopic,
        expect.objectContaining({
          assignedTools: tools,
          assignedSkills: skills,
        }),
      );
    });

    it("should call enrichSearchResults with items from router", async () => {
      await service.executeSearchPhase(mockTopic as any, mockDimension as any);

      expect(mockDataEnrichment.enrichSearchResults).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ title: "AI Diagnostics Breakthrough" }),
        ]),
        expect.objectContaining({
          topN: 15,
          maxContentLength: 3000,
          enableFigures: true,
        }),
      );
    });

    it("should include leader context in evidenceSummary when available", async () => {
      const result = await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
      );

      expect(result.evidenceSummary).toContain("最新背景");
      expect(result.leaderContextSummary).toBe(
        "Latest AI developments in healthcare",
      );
    });

    it("should handle leader context failure gracefully", async () => {
      mockLeaderTool.generateEnhancedPlanningContext.mockRejectedValue(
        new Error("Leader tool failed"),
      );

      const result = await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
      );

      // Should still return a result without leader context
      expect(result).toBeDefined();
      expect(result.leaderContextSummary).toBe("");
    });

    it("should set temporalContext with current date and freshness requirement", async () => {
      const result = await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
      );

      expect(result.temporalContext.currentDate).toBeTruthy();
      expect(result.temporalContext.freshnessRequirement).toBeTruthy();
    });

    it("should call agentActivity.startThinkingPhase with correct args", async () => {
      await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
        "mission-789",
      );

      expect(mockAgentActivity.startThinkingPhase).toHaveBeenCalledWith(
        expect.objectContaining({
          topicId: mockTopic.id,
          missionId: "mission-789",
          dimensionId: mockDimension.id,
          dimensionName: mockDimension.name,
          agentRole: "researcher",
          activityType: AgentActivityType.RESEARCHING,
          phase: "searching",
          thinkingPhase: "searching",
        }),
      );
    });

    it("should call agentActivity.endThinkingPhase after search", async () => {
      await service.executeSearchPhase(mockTopic as any, mockDimension as any);

      expect(mockAgentActivity.endThinkingPhase).toHaveBeenCalledWith(
        mockTopic.id,
        expect.stringContaining("researcher_"),
        "searching",
        expect.objectContaining({
          searchResults: expect.any(Object),
        }),
      );
    });

    it("should call emitProgressFn when provided", async () => {
      const emitProgressFn = jest.fn().mockResolvedValue(undefined);

      await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
        "mission-789",
        undefined,
        undefined,
        undefined,
        undefined,
        emitProgressFn,
      );

      expect(emitProgressFn).toHaveBeenCalledWith(
        mockTopic.id,
        mockDimension.name,
        expect.objectContaining({ stage: "planning" }),
        "mission-789",
        5,
        undefined,
      );
    });

    it("should use missionId as effectiveMissionId when provided", async () => {
      await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
        "explicit-mission-id",
      );

      expect(mockEventEmitter.emitAgentWorking).toHaveBeenCalledWith(
        mockTopic.id,
        expect.any(Object),
        "explicit-mission-id",
      );
    });

    it("should fall back to dimension.id as effectiveMissionId when no missionId", async () => {
      await service.executeSearchPhase(mockTopic as any, mockDimension as any);

      expect(mockEventEmitter.emitAgentWorking).toHaveBeenCalledWith(
        mockTopic.id,
        expect.any(Object),
        mockDimension.id,
      );
    });

    it("should build searchResultsRecord with correct structure", async () => {
      const result = await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
      );

      const record = result.searchResultsRecord;
      expect(record.total).toBe(2); // from router mock
      expect(record.filtered).toBe(1); // from enrichment mock
      expect(record.searchedAt).toBeTruthy();
      expect(record.sources).toBeDefined();
    });

    it("should create evidence summary with count information", async () => {
      const result = await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
      );

      expect(result.evidenceSummary).toContain("共收集到");
      expect(result.evidenceSummary).toContain("条证据");
    });

    it("should handle topic with topicConfig enrichment settings", async () => {
      const topicWithConfig = {
        ...mockTopic,
        topicConfig: {
          enrichmentTopN: 10,
          enrichmentMaxLength: 5000,
          enableFigures: false,
        },
      };

      await service.executeSearchPhase(
        topicWithConfig as any,
        mockDimension as any,
      );

      expect(mockDataEnrichment.enrichSearchResults).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          topN: 10,
          maxContentLength: 5000,
          enableFigures: false,
        }),
      );
    });

    it("should report invalid URLs when enrichment has invalid ones", async () => {
      mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 3,
        fetched: 2,
        validUrls: 2,
        invalidUrls: 1,
        avgContentLength: 400,
      });

      // Should not throw even with invalid URLs
      const result = await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
      );

      expect(result).toBeDefined();
    });

    it("should include figures in summary when enriched results have figures", async () => {
      mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        {
          sourceType: DataSourceType.WEB,
          title: "Article with Figures",
          url: "https://example.com/figures",
          snippet: "Article snippet",
          domain: "example.com",
          publishedAt: new Date("2024-01-15"),
          metadata: {},
          fullContent: "Content",
          contentSource: "fetch",
          extractedFigures: [
            {
              type: "chart",
              caption: "Market share chart",
              alt: "Market share",
              imageUrl: "https://example.com/chart.png",
            },
          ],
        },
      ]);

      const result = await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
      );

      expect(result.figuresSummary).toContain("图表");
      expect(result.figuresSummary).toContain("Market share chart");
    });

    it("should return empty figuresSummary when no figures extracted", async () => {
      // Default mock returns empty extractedFigures
      const result = await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
      );

      expect(result.figuresSummary).toBe("");
    });

    it("should include modelId and assignedTools in result", async () => {
      const tools = ["web-search"];
      const skills = ["analyze"];
      const modelId = "gpt-4o-model-id";

      const result = await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
        "mission-id",
        modelId,
        undefined,
        tools,
        skills,
      );

      expect(result.modelId).toBe(modelId);
      expect(result.assignedTools).toEqual(tools);
      expect(result.assignedSkills).toEqual(skills);
    });

    it("should handle knowledge base results in searchResultsRecord", async () => {
      const kbItem = {
        sourceType: "local",
        title: "Internal Report",
        url: "https://internal/report",
        snippet: "Internal document",
        domain: null,
        publishedAt: null,
        metadata: {
          knowledgeBaseSource: true,
          similarity: 0.87,
          documentId: "doc-001",
        },
      };

      // Knowledge base count comes from searchResult.items (before enrichment)
      mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
        items: [kbItem],
        sources: ["local"],
        totalCount: 1,
        metadata: { searchQuery: "", executionTimeMs: 100, sourceResults: {} },
      });

      mockDataEnrichment.enrichSearchResults.mockResolvedValue([
        {
          ...kbItem,
          fullContent: "Report content",
          contentSource: "knowledge-base",
          extractedFigures: [],
        },
      ]);

      mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 1,
        fetched: 1,
        validUrls: 1,
        invalidUrls: 0,
        avgContentLength: 300,
      });

      const topicWithKB = {
        ...mockTopic,
        topicConfig: { knowledgeBaseIds: ["kb-001"] },
      };

      const result = await service.executeSearchPhase(
        topicWithKB as any,
        mockDimension as any,
      );

      expect(result.searchResultsRecord.knowledgeBaseInfo?.enabled).toBe(true);
      expect(result.searchResultsRecord.knowledgeBaseInfo?.matchedCount).toBe(
        1,
      );
    });

    it("should handle empty search results gracefully", async () => {
      mockDataSourceRouter.fetchDataForDimension.mockResolvedValue({
        items: [],
        sources: [],
        totalCount: 0,
        metadata: { searchQuery: "", executionTimeMs: 100, sourceResults: {} },
      });

      mockDataEnrichment.enrichSearchResults.mockResolvedValue([]);
      mockDataEnrichment.getEnrichmentStats.mockReturnValue({
        total: 0,
        fetched: 0,
        validUrls: 0,
        invalidUrls: 0,
        avgContentLength: 0,
      });

      const result = await service.executeSearchPhase(
        mockTopic as any,
        mockDimension as any,
      );

      expect(result).toBeDefined();
      expect(result.enrichedResults).toHaveLength(0);
      expect(result.evidenceData).toHaveLength(0);
      expect(result.searchResultsRecord.total).toBe(0);
    });
  });
});
