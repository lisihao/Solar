/**
 * Unit tests for TemplateSelectionService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TemplateSelectionService } from "../template-selection.service";
import { ContentAnalysisService } from "../../content-analysis/content-analysis.service";
import {
  ContentComplexity,
  ContentCategory,
  DataDensity,
  TemporalDimension,
  HierarchyType,
} from "../../content-analysis/content-analysis.types";

const buildMockFeatures = (overrides = {}) => ({
  category: ContentCategory.INFORMATIONAL,
  complexity: ContentComplexity.MEDIUM,
  dataDensity: DataDensity.BALANCED,
  temporalDimension: TemporalDimension.NONE,
  hierarchyType: HierarchyType.FLAT,
  wordCount: 500,
  paragraphCount: 5,
  listCount: 2,
  hasStatistics: false,
  hasTimeline: false,
  hasComparison: false,
  hasCaseStudy: false,
  hasRiskAnalysis: false,
  hasRecommendations: false,
  hasSteps: false,
  keyTopics: [],
  entities: [],
  sentiment: "neutral" as const,
  ...overrides,
});

describe("TemplateSelectionService", () => {
  let service: TemplateSelectionService;
  let contentAnalysisService: jest.Mocked<ContentAnalysisService>;

  const mockFeatures = buildMockFeatures();

  const mockAnalysisResult = {
    features: mockFeatures,
    summary: "Analysis complete",
  };

  beforeEach(async () => {
    const mockContentAnalysisService = {
      analyzeContent: jest.fn().mockResolvedValue(mockAnalysisResult),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateSelectionService,
        {
          provide: ContentAnalysisService,
          useValue: mockContentAnalysisService,
        },
      ],
    }).compile();

    service = module.get<TemplateSelectionService>(TemplateSelectionService);
    contentAnalysisService = module.get(ContentAnalysisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("planDocument", () => {
    it("should return a planning result for slides output", async () => {
      const result = await service.planDocument(
        "Test content about business analysis",
        {
          outputType: "slides",
          title: "Business Report",
        },
      );

      expect(result).toBeDefined();
      expect(result.slides).toBeDefined();
      expect(result.imageStrategy).toBeDefined();
      expect(result.readingExperience).toBeDefined();
      expect(contentAnalysisService.analyzeContent).toHaveBeenCalledTimes(1);
    });

    it("should return a planning result for docs output", async () => {
      const result = await service.planDocument("Test content", {
        outputType: "docs",
      });

      expect(result).toBeDefined();
      expect(result.docs).toBeDefined();
      expect(result.slides).toBeUndefined();
    });

    it('should return both slides and docs for "both" output type', async () => {
      const result = await service.planDocument("Test content", {
        outputType: "both",
      });

      expect(result.slides).toBeDefined();
      expect(result.docs).toBeDefined();
    });

    it("should include target audience and title in analysis input", async () => {
      await service.planDocument("content", {
        outputType: "slides",
        targetAudience: "executives",
        title: "Q4 Report",
      });

      expect(contentAnalysisService.analyzeContent).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "content",
          context: expect.objectContaining({
            title: "Q4 Report",
            targetAudience: "executives",
          }),
        }),
      );
    });

    it("should produce slides with cover slide always present", async () => {
      const result = await service.planDocument("Some content", {
        outputType: "slides",
        detailLevel: 1,
      });

      const coverSlide = result.slides?.allSlides.find(
        (s) => s.templateType === "cover",
      );
      expect(coverSlide).toBeDefined();
    });

    it("should include table of contents for detailLevel >= 2", async () => {
      const result = await service.planDocument("content", {
        outputType: "slides",
        detailLevel: 2,
      });

      const tocSlide = result.slides?.allSlides.find(
        (s) => s.templateType === "toc",
      );
      expect(tocSlide).toBeDefined();
    });

    it("should NOT include table of contents for detailLevel 1", async () => {
      const result = await service.planDocument("content", {
        outputType: "slides",
        detailLevel: 1,
      });

      const tocSlide = result.slides?.allSlides.find(
        (s) => s.templateType === "toc",
      );
      expect(tocSlide).toBeUndefined();
    });

    it("should include conclusion slide", async () => {
      const result = await service.planDocument("content", {
        outputType: "slides",
        detailLevel: 2,
      });

      const conclusionSlide = result.slides?.allSlides.find(
        (s) => s.templateType === "conclusion",
      );
      expect(conclusionSlide).toBeDefined();
    });

    it("should generate chapters based on key topics when available", async () => {
      const featuresWithTopics = buildMockFeatures({
        keyTopics: ["Topic A", "Topic B", "Topic C"],
      });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: featuresWithTopics,
        summary: "",
      });

      const result = await service.planDocument("content", {
        outputType: "slides",
        detailLevel: 2,
      });

      // Should have chapter title pages for the topics
      const chapterSlides = result.slides?.allSlides.filter(
        (s) => s.templateType === "chapterTitle",
      );
      expect(chapterSlides?.length).toBeGreaterThan(0);
    });

    it("should generate default chapter when no special features", async () => {
      const result = await service.planDocument("simple content", {
        outputType: "slides",
        detailLevel: 1,
      });

      expect(result.slides?.totalSlides).toBeGreaterThan(0);
    });

    it("should generate timeline slides when content has timeline", async () => {
      const featuresWithTimeline = buildMockFeatures({ hasTimeline: true });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: featuresWithTimeline,
        summary: "",
      });

      const result = await service.planDocument("timeline content", {
        outputType: "slides",
        detailLevel: 1,
      });

      expect(result.slides?.totalSlides).toBeGreaterThan(0);
    });

    it("should generate comparison slides when content has comparison", async () => {
      const featuresWithComparison = buildMockFeatures({ hasComparison: true });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: featuresWithComparison,
        summary: "",
      });

      const result = await service.planDocument("comparison content", {
        outputType: "slides",
        detailLevel: 1,
      });

      expect(result.slides?.totalSlides).toBeGreaterThan(0);
    });

    it("should generate case study slides when content has case study", async () => {
      const featuresWithCaseStudy = buildMockFeatures({ hasCaseStudy: true });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: featuresWithCaseStudy,
        summary: "",
      });

      const result = await service.planDocument("case study content", {
        outputType: "slides",
        detailLevel: 1,
      });

      expect(result.slides?.totalSlides).toBeGreaterThan(0);
    });

    it("should generate risk analysis slides when content has risk analysis", async () => {
      const featuresWithRisk = buildMockFeatures({ hasRiskAnalysis: true });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: featuresWithRisk,
        summary: "",
      });

      const result = await service.planDocument("risk content", {
        outputType: "slides",
        detailLevel: 1,
      });

      expect(result.slides?.totalSlides).toBeGreaterThan(0);
    });

    it("should generate recommendations slides when content has recommendations", async () => {
      const featuresWithRecs = buildMockFeatures({ hasRecommendations: true });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: featuresWithRecs,
        summary: "",
      });

      const result = await service.planDocument("recommendations content", {
        outputType: "slides",
        detailLevel: 1,
      });

      expect(result.slides?.totalSlides).toBeGreaterThan(0);
    });

    it("should add chapter summaries in detailLevel 3 for chapters with enough slides", async () => {
      const featuresWithTopics = buildMockFeatures({
        keyTopics: ["Topic A"],
      });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: featuresWithTopics,
        summary: "",
      });

      const result = await service.planDocument("content", {
        outputType: "slides",
        detailLevel: 3,
      });

      expect(result.slides?.totalSlides).toBeGreaterThan(0);
    });

    it("should include executive summary in docs", async () => {
      const result = await service.planDocument("content", {
        outputType: "docs",
      });

      const execSummary = result.docs?.sections.find(
        (s) => s.templateType === "executiveSummary",
      );
      expect(execSummary).toBeDefined();
    });

    it("should include data report in docs when content has statistics", async () => {
      const featuresWithStats = buildMockFeatures({ hasStatistics: true });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: featuresWithStats,
        summary: "",
      });

      const result = await service.planDocument("statistical content", {
        outputType: "docs",
      });

      const dataSection = result.docs?.sections.find(
        (s) => s.templateType === "dataReport",
      );
      expect(dataSection).toBeDefined();
    });

    it("should calculate image strategy with chart and infographic for stats content", async () => {
      const featuresWithStats = buildMockFeatures({ hasStatistics: true });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: featuresWithStats,
        summary: "",
      });

      const result = await service.planDocument("statistical content", {
        outputType: "slides",
      });

      expect(result.imageStrategy.types).toContain("chart");
      expect(result.imageStrategy.types).toContain("infographic");
    });

    it("should set image density to rich for data-heavy content", async () => {
      const featuresDataHeavy = buildMockFeatures({
        hasStatistics: true,
        dataDensity: DataDensity.DATA_HEAVY,
      });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: featuresDataHeavy,
        summary: "",
      });

      const result = await service.planDocument("data heavy content", {
        outputType: "slides",
      });

      expect(result.imageStrategy.density).toBe("rich");
    });

    it("should set image density to sparse for text-heavy content", async () => {
      const featuresTextHeavy = buildMockFeatures({
        dataDensity: DataDensity.TEXT_HEAVY,
      });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: featuresTextHeavy,
        summary: "",
      });

      const result = await service.planDocument("text heavy content", {
        outputType: "slides",
      });

      expect(result.imageStrategy.density).toBe("sparse");
    });

    it("should provide a totalImages count based on complexity", async () => {
      const result = await service.planDocument("content", {
        outputType: "slides",
      });

      expect(result.imageStrategy.totalImages).toBeGreaterThan(0);
    });

    it("should set totalImages to 5 for low complexity", async () => {
      const lowComplexityFeatures = buildMockFeatures({
        complexity: ContentComplexity.LOW,
      });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: lowComplexityFeatures,
        summary: "",
      });

      const result = await service.planDocument("simple content", {
        outputType: "slides",
      });

      expect(result.imageStrategy.totalImages).toBe(5);
    });

    it("should set totalImages to 15 for high complexity", async () => {
      const highComplexityFeatures = buildMockFeatures({
        complexity: ContentComplexity.HIGH,
      });
      contentAnalysisService.analyzeContent.mockResolvedValueOnce({
        features: highComplexityFeatures,
        summary: "",
      });

      const result = await service.planDocument("complex content", {
        outputType: "slides",
      });

      expect(result.imageStrategy.totalImages).toBe(15);
    });

    it("should propagate errors from content analysis", async () => {
      contentAnalysisService.analyzeContent.mockRejectedValueOnce(
        new Error("Analysis failed"),
      );

      await expect(
        service.planDocument("content", { outputType: "slides" }),
      ).rejects.toThrow("Analysis failed");
    });
  });
});
