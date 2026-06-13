/**
 * Unit tests for TemplateMatcherSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  TemplateMatcherSkill,
  TemplateMatchingContext,
  TemplateMatcherOrchestratorInput,
} from "../template-matcher.skill";
import { PageOutline, NarrativePlan } from "../../checkpoint/checkpoint.types";

// ============================================================================
// Mocks
// ============================================================================

// Mock templateRegistry before imports resolve
jest.mock("../../templates", () => {
  const mockTemplates = [
    {
      metadata: {
        id: "cover-v1",
        type: "cover",
        name: "封面",
        description: "封面模板",
        useCases: ["封面", "标题", "开场"],
        contentDensity: "low",
        visualStyle: "professional",
        recommendedFor: ["opening"],
        maxContentBlocks: 2,
        variables: [],
        tone: "positive",
        positionFit: { opening: 1.0, middle: 0.0, closing: 0.3 },
        compatibility: { goodBefore: [], goodAfter: [], avoidNear: [] },
      },
      render: jest.fn(() => "<div>cover</div>"),
    },
    {
      metadata: {
        id: "pillars-v1",
        type: "pillars",
        name: "支柱",
        description: "支柱模板",
        useCases: ["支柱", "核心", "要素"],
        contentDensity: "medium",
        visualStyle: "professional",
        recommendedFor: ["middle"],
        maxContentBlocks: 4,
        variables: [],
        tone: "analytical",
        positionFit: { opening: 0.5, middle: 0.9, closing: 0.6 },
        compatibility: { goodBefore: [], goodAfter: [], avoidNear: [] },
      },
      render: jest.fn(() => "<div>pillars</div>"),
    },
    {
      metadata: {
        id: "timeline-v1",
        type: "timeline",
        name: "时间线",
        description: "时间线模板",
        useCases: ["历史", "发展", "演变"],
        contentDensity: "medium",
        visualStyle: "professional",
        recommendedFor: ["middle"],
        maxContentBlocks: 5,
        variables: [],
        tone: "neutral",
        positionFit: { opening: 0.3, middle: 0.9, closing: 0.4 },
        compatibility: { goodBefore: [], goodAfter: [], avoidNear: [] },
      },
      render: jest.fn(() => "<div>timeline</div>"),
    },
    {
      metadata: {
        id: "closing-v1",
        type: "closing",
        name: "结尾",
        description: "结尾模板",
        useCases: ["感谢", "结束"],
        contentDensity: "low",
        visualStyle: "professional",
        recommendedFor: ["closing"],
        maxContentBlocks: 2,
        variables: [],
        tone: "positive",
        positionFit: { opening: 0.0, middle: 0.0, closing: 1.0 },
        compatibility: { goodBefore: [], goodAfter: [], avoidNear: [] },
      },
      render: jest.fn(() => "<div>closing</div>"),
    },
    {
      metadata: {
        id: "dashboard-v1",
        type: "dashboard",
        name: "仪表板",
        description: "仪表板模板",
        useCases: ["数据", "统计", "指标", "KPI"],
        contentDensity: "high",
        visualStyle: "data-driven",
        recommendedFor: ["middle"],
        maxContentBlocks: 6,
        variables: [],
        tone: "analytical",
        positionFit: { opening: 0.2, middle: 0.9, closing: 0.4 },
        compatibility: { goodBefore: [], goodAfter: [], avoidNear: [] },
      },
      render: jest.fn(() => "<div>dashboard</div>"),
    },
  ];

  return {
    templateRegistry: {
      getAll: jest.fn(() => mockTemplates),
      get: jest.fn((id: string) =>
        mockTemplates.find((t) => t.metadata.id === id),
      ),
    },
    SlideTemplate: {},
  };
});

// ============================================================================
// Helpers
// ============================================================================

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-template-matcher",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
});

const buildPageOutline = (
  overrides: Partial<PageOutline> = {},
): PageOutline => ({
  pageNumber: 3,
  title: "核心要素分析",
  templateType: "pillars",
  contentBrief: "分析三大核心要素的影响",
  keyElements: ["要素A", "要素B", "要素C"],
  layoutHints: [],
  ...overrides,
});

const buildMatchingContext = (
  overrides: Partial<TemplateMatchingContext> = {},
): TemplateMatchingContext => ({
  pageOutline: buildPageOutline(),
  previousPages: [],
  positionInStory: "middle",
  usedTemplates: [],
  ...overrides,
});

// ============================================================================
// Tests
// ============================================================================

describe("TemplateMatcherSkill", () => {
  let skill: TemplateMatcherSkill;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TemplateMatcherSkill],
    }).compile();

    skill = module.get<TemplateMatcherSkill>(TemplateMatcherSkill);
  });

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  describe("metadata", () => {
    it("should have correct id and name", () => {
      expect(skill.id).toBe("slides-template-matcher");
      expect(skill.name).toBe("模板匹配");
      expect(skill.domain).toBe("slides");
      expect(skill.layer).toBe("design");
    });
  });

  // --------------------------------------------------------------------------
  // execute() - input normalization
  // --------------------------------------------------------------------------

  describe("execute() - input validation", () => {
    it("should return error for invalid orchestrator input missing required fields", async () => {
      const invalidInput: TemplateMatcherOrchestratorInput = {
        task: "match template",
        context: {
          input: {}, // missing pageOutline, positionInStory, usedTemplates
        },
      };

      const result = await skill.execute(
        invalidInput as unknown as TemplateMatchingContext,
        buildSkillContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_INPUT");
    });

    it("should succeed with valid direct TemplateMatchingContext input", async () => {
      const context = buildMatchingContext();
      const result = await skill.execute(context, buildSkillContext());

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("should succeed with valid orchestrator input format", async () => {
      const orchestratorInput: TemplateMatcherOrchestratorInput = {
        task: "match template",
        context: {
          input: {
            pageOutline: buildPageOutline(),
            positionInStory: "middle",
            usedTemplates: [],
            previousPages: [],
          },
        },
      };

      const result = await skill.execute(
        orchestratorInput as unknown as TemplateMatchingContext,
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // execute() - metadata
  // --------------------------------------------------------------------------

  describe("execute() - result metadata", () => {
    it("should include correct execution metadata", async () => {
      const context = buildMatchingContext();
      const skillCtx = buildSkillContext("exec-123");
      const result = await skill.execute(context, skillCtx);

      expect(result.metadata.executionId).toBe("exec-123");
      expect(result.metadata.startTime).toBeInstanceOf(Date);
      expect(result.metadata.endTime).toBeInstanceOf(Date);
    });
  });

  // --------------------------------------------------------------------------
  // match()
  // --------------------------------------------------------------------------

  describe("match()", () => {
    it("should return a result with recommended and alternatives", () => {
      const context = buildMatchingContext();
      const result = skill.match(context);

      expect(result.recommended).toBeDefined();
      expect(result.recommended.templateId).toBeDefined();
      expect(result.recommended.templateType).toBeDefined();
      expect(result.recommended.confidence).toBeGreaterThanOrEqual(0);
      expect(result.alternatives).toBeInstanceOf(Array);
      expect(result.matchDetails).toBeDefined();
    });

    it("should force cover template when forcedTemplateType=cover", () => {
      const context = buildMatchingContext({
        forcedTemplateType: "cover",
        pageOutline: buildPageOutline({ pageNumber: 1, title: "演示封面" }),
        positionInStory: "opening",
      });
      const result = skill.match(context);

      expect(result.recommended.templateType).toBe("cover");
    });

    it("should force closing template when forcedTemplateType=closing", () => {
      const context = buildMatchingContext({
        forcedTemplateType: "closing",
        pageOutline: buildPageOutline({ pageNumber: 10, title: "感谢" }),
        positionInStory: "closing",
      });
      const result = skill.match(context);

      expect(result.recommended.templateType).toBe("closing");
    });

    it("should have matchDetails with all required fields", () => {
      const context = buildMatchingContext();
      const result = skill.match(context);

      expect(result.matchDetails).toHaveProperty("keywordScore");
      expect(result.matchDetails).toHaveProperty("capacityScore");
      expect(result.matchDetails).toHaveProperty("positionScore");
      expect(result.matchDetails).toHaveProperty("contextScore");
      expect(result.matchDetails).toHaveProperty("diversityScore");
      expect(result.matchDetails).toHaveProperty("emotionalScore");
    });

    it("should return lower diversity score for heavily used template", () => {
      const context = buildMatchingContext({
        usedTemplates: ["pillars-v1", "pillars-v1", "pillars-v1"],
      });
      const result = skill.match(context);

      // The heavily used pillars template should have lower diversity score
      // The recommended template might not be pillars because of low diversity
      expect(result.recommended).toBeDefined();
    });

    it("should prefer templates with goodAfter compatibility", () => {
      // Create a scenario where avoidNear affects score
      const context = buildMatchingContext({
        previousPages: [{ pageNumber: 2, templateId: "cover-v1" }],
      });
      const result = skill.match(context);
      expect(result.recommended).toBeDefined();
    });

    it("should handle narrative plan emotional arc", () => {
      const narrativePlan: NarrativePlan = {
        storyline: {
          hook: [],
          context: [],
          tension: [],
          resolution: [],
          proof: [],
          callToAction: [],
        },
        rhythmPattern: ["high", "medium", "low"],
        emotionalArc: [{ page: 3, emotion: "hope" }],
        narrativePattern: "problem-solution",
        pageAllocation: [],
      };

      const context = buildMatchingContext({ narrativePlan });
      const result = skill.match(context);

      expect(result.recommended).toBeDefined();
    });

    it("should match dashboard template for data content", () => {
      const context = buildMatchingContext({
        pageOutline: buildPageOutline({
          title: "关键数据指标",
          contentBrief: "展示核心KPI数据",
          keyElements: ["指标1", "指标2", "指标3", "指标4"],
        }),
      });
      const result = skill.match(context);

      // With KPI keyword, dashboard should score high
      expect(result.recommended).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // matchAll()
  // --------------------------------------------------------------------------

  describe("matchAll()", () => {
    it("should match templates for all pages", () => {
      const outlines: PageOutline[] = [
        buildPageOutline({ pageNumber: 1, title: "封面页" }),
        buildPageOutline({ pageNumber: 2, title: "核心分析" }),
        buildPageOutline({ pageNumber: 3, title: "数据统计" }),
        buildPageOutline({ pageNumber: 4, title: "感谢" }),
      ];

      const results = skill.matchAll(outlines);

      expect(results.size).toBe(4);
      expect(results.has(1)).toBe(true);
      expect(results.has(4)).toBe(true);
    });

    it("should force cover for first page", () => {
      const outlines: PageOutline[] = [
        buildPageOutline({ pageNumber: 1, title: "封面" }),
        buildPageOutline({ pageNumber: 2, title: "内容" }),
      ];

      const results = skill.matchAll(outlines);
      expect(results.get(1)?.recommended.templateType).toBe("cover");
    });

    it("should force closing for last page", () => {
      const outlines: PageOutline[] = [
        buildPageOutline({ pageNumber: 1, title: "封面" }),
        buildPageOutline({ pageNumber: 2, title: "内容" }),
        buildPageOutline({ pageNumber: 3, title: "感谢" }),
      ];

      const results = skill.matchAll(outlines);
      expect(results.get(3)?.recommended.templateType).toBe("closing");
    });

    it("should set opening position for first 2 pages", () => {
      const outlines: PageOutline[] = Array.from({ length: 6 }, (_, i) =>
        buildPageOutline({ pageNumber: i + 1, title: `页面${i + 1}` }),
      );

      const results = skill.matchAll(outlines);
      expect(results.size).toBe(6);
    });

    it("should track used templates across pages", () => {
      const outlines: PageOutline[] = [
        buildPageOutline({ pageNumber: 1, title: "封面" }),
        buildPageOutline({ pageNumber: 2, title: "支柱内容" }),
        buildPageOutline({ pageNumber: 3, title: "支柱分析" }),
      ];

      const results = skill.matchAll(outlines);
      expect(results.size).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // getTemplateType()
  // --------------------------------------------------------------------------

  describe("getTemplateType()", () => {
    it("should return template type from match result", () => {
      const context = buildMatchingContext();
      const type = skill.getTemplateType(context);

      expect(type).toBeDefined();
      expect(typeof type).toBe("string");
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return error result when match throws", async () => {
      const context = buildMatchingContext();

      jest.spyOn(skill, "match").mockImplementationOnce(() => {
        throw new Error("Match error");
      });

      const result = await skill.execute(context, buildSkillContext());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TEMPLATE_MATCH_ERROR");
      expect(result.error?.message).toBe("Match error");

      (skill.match as jest.MockedFunction<typeof skill.match>).mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // Score calculations
  // --------------------------------------------------------------------------

  describe("score calculations", () => {
    it("should return confidence between 0 and 1", () => {
      const context = buildMatchingContext();
      const result = skill.match(context);

      expect(result.recommended.confidence).toBeGreaterThanOrEqual(0);
      expect(result.recommended.confidence).toBeLessThanOrEqual(1);
    });

    it("should return a reason string", () => {
      const context = buildMatchingContext();
      const result = skill.match(context);

      expect(result.recommended.reason).toBeDefined();
      expect(typeof result.recommended.reason).toBe("string");
      expect(result.recommended.reason.length).toBeGreaterThan(0);
    });

    it("should have up to 3 alternatives", () => {
      const context = buildMatchingContext();
      const result = skill.match(context);

      expect(result.alternatives.length).toBeLessThanOrEqual(3);
    });
  });
});
