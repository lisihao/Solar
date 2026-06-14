import { Test, TestingModule } from "@nestjs/testing";
import { ResearchTemplateService } from "../research-template.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import { TemplateCategory } from "../../../../types/research-template.types";

const mockFacade = {
  chat: jest.fn(),
};

const mockPrisma = {
  researchTemplate: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

describe("ResearchTemplateService", () => {
  let service: ResearchTemplateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchTemplateService,
        { provide: ChatFacade, useValue: mockFacade },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ResearchTemplateService>(ResearchTemplateService);
    jest.clearAllMocks();
  });

  describe("getTemplates", () => {
    it("should return all built-in templates", () => {
      const templates = service.getTemplates();

      expect(templates.length).toBeGreaterThanOrEqual(4);
      expect(templates.every((t) => t.id && t.name)).toBe(true);
    });

    it("should filter templates by category", () => {
      const competitiveTemplates = service.getTemplates(
        TemplateCategory.COMPETITIVE_ANALYSIS,
      );

      expect(competitiveTemplates.length).toBeGreaterThanOrEqual(1);
      expect(
        competitiveTemplates.every(
          (t) => t.category === TemplateCategory.COMPETITIVE_ANALYSIS,
        ),
      ).toBe(true);
    });

    it("should return empty array for nonexistent category filter", () => {
      const templates = service.getTemplates("NONEXISTENT" as TemplateCategory);

      expect(templates).toHaveLength(0);
    });

    it("should include custom templates alongside built-in ones", () => {
      const customTemplate = {
        id: "custom-1",
        name: "My Custom Template",
        description: "Custom",
        category: TemplateCategory.MARKET_RESEARCH,
        tags: [],
        dimensions: [],
        recommendedSources: [],
        recommendedDepth: "standard" as const,
        parameters: [],
        guidancePrompt: "Custom prompt",
        usageCount: 0,
        isBuiltIn: false,
      };
      service.saveCustomTemplate(customTemplate);

      const all = service.getTemplates();

      expect(all.find((t) => t.id === "custom-1")).toBeDefined();
    });
  });

  describe("getTemplate", () => {
    it("should return built-in template by ID", () => {
      const template = service.getTemplate("competitive-analysis");

      expect(template).toBeDefined();
      expect(template?.id).toBe("competitive-analysis");
      expect(template?.isBuiltIn).toBe(true);
    });

    it("should return undefined for unknown template ID", () => {
      const template = service.getTemplate("nonexistent-id");

      expect(template).toBeUndefined();
    });

    it("should return custom template from in-memory store", () => {
      service.saveCustomTemplate({
        id: "my-template",
        name: "My Template",
        description: "",
        category: TemplateCategory.TECHNOLOGY_EVALUATION,
        tags: [],
        dimensions: [],
        recommendedSources: [],
        recommendedDepth: "standard",
        parameters: [],
        guidancePrompt: "",
        usageCount: 0,
        isBuiltIn: false,
      });

      const template = service.getTemplate("my-template");

      expect(template).toBeDefined();
      expect(template?.isBuiltIn).toBe(false);
    });
  });

  describe("getTemplateAsync", () => {
    it("should check DB first and return DB template if found", async () => {
      const dbRecord = {
        templateId: "db-template-1",
        name: "DB Template",
        description: "From database",
        category: TemplateCategory.MARKET_RESEARCH,
        dimensions: [],
        dataSources: ["web"],
        guidancePrompt: "Guidance",
        reportStructure: null,
        usageCount: 5,
        isBuiltIn: false,
      };
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(dbRecord);

      const template = await service.getTemplateAsync("db-template-1");

      expect(template).toBeDefined();
      expect(template?.name).toBe("DB Template");
    });

    it("should fall back to in-memory when DB lookup fails", async () => {
      mockPrisma.researchTemplate.findUnique.mockRejectedValue(
        new Error("DB error"),
      );

      const template = await service.getTemplateAsync("competitive-analysis");

      expect(template?.id).toBe("competitive-analysis");
    });

    it("should fall back to in-memory when not in DB", async () => {
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(null);

      const template = await service.getTemplateAsync("market-research");

      expect(template?.id).toBe("market-research");
    });
  });

  describe("applyTemplate", () => {
    it("should apply competitive analysis template with required params", () => {
      const result = service.applyTemplate("competitive-analysis", {
        company: "OpenAI",
        competitor: "Anthropic",
      });

      expect(result).not.toBeNull();
      expect(result!.topicName).toContain("OpenAI");
      expect(result!.dimensions.length).toBeGreaterThan(0);
    });

    it("should replace parameter placeholders in dimension names and queries", () => {
      const result = service.applyTemplate("technology-evaluation", {
        technology: "Rust",
        alternative: "Go",
      });

      expect(result).not.toBeNull();
      const firstDim = result!.dimensions[0];
      expect(JSON.stringify(firstDim)).toContain("Rust");
    });

    it("should return null for unknown template ID", () => {
      const result = service.applyTemplate("nonexistent", {});

      expect(result).toBeNull();
    });

    it("should return null when required parameter is missing", () => {
      const result = service.applyTemplate("competitive-analysis", {});

      expect(result).toBeNull();
    });

    it("should include research config with depth and sources", () => {
      const result = service.applyTemplate("market-research", {
        market: "AI Software",
      });

      expect(result!.researchConfig.depth).toBeDefined();
      expect(result!.researchConfig.sources.length).toBeGreaterThan(0);
    });
  });

  describe("recommendTemplate", () => {
    it("should return template recommendations based on AI response", async () => {
      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify([
          {
            templateId: "competitive-analysis",
            score: 0.9,
            reason: "Best fit",
          },
          { templateId: "market-research", score: 0.7, reason: "Good fit" },
        ]),
        tokensUsed: 100,
        model: "gpt-4",
      });

      const recommendations = await service.recommendTemplate(
        "Analyze OpenAI vs competitors in AI space",
      );

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0].template).toBeDefined();
      expect(recommendations[0].score).toBeGreaterThan(0);
    });

    it("should return empty array when AI throws error", async () => {
      mockFacade.chat.mockRejectedValue(new Error("API error"));

      const recommendations = await service.recommendTemplate("Some topic");

      expect(recommendations).toHaveLength(0);
    });

    it("should filter out recommendations with unknown template IDs", async () => {
      mockFacade.chat.mockResolvedValue({
        content: JSON.stringify([
          {
            templateId: "nonexistent-template",
            score: 0.9,
            reason: "Top pick",
          },
          { templateId: "competitive-analysis", score: 0.8, reason: "Good" },
        ]),
        tokensUsed: 100,
        model: "gpt-4",
      });

      const recommendations =
        await service.recommendTemplate("Market analysis");

      expect(recommendations.every((r) => r.template !== undefined)).toBe(true);
      expect(
        recommendations.find(
          (r) =>
            (r.template as unknown as { id: string })?.id ===
            "nonexistent-template",
        ),
      ).toBeUndefined();
    });
  });

  describe("getCategories", () => {
    it("should return all template categories with counts", () => {
      const categories = service.getCategories();

      expect(categories.length).toBeGreaterThan(0);
      expect(categories.every((c) => c.count > 0)).toBe(true);
    });

    it("should include custom template categories", () => {
      service.saveCustomTemplate({
        id: "custom-lit",
        name: "Custom Literature",
        description: "",
        category: TemplateCategory.LITERATURE_REVIEW,
        tags: [],
        dimensions: [],
        recommendedSources: [],
        recommendedDepth: "standard",
        parameters: [],
        guidancePrompt: "",
        usageCount: 0,
        isBuiltIn: false,
      });

      const categories = service.getCategories();
      const litCategory = categories.find(
        (c) => c.category === TemplateCategory.LITERATURE_REVIEW,
      );

      expect(litCategory).toBeDefined();
      expect(litCategory!.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe("saveCustomTemplate", () => {
    it("should save a custom template and mark it as non-built-in", () => {
      const template = {
        id: "save-test",
        name: "Save Test",
        description: "Test",
        category: TemplateCategory.POLICY_ANALYSIS,
        tags: [],
        dimensions: [],
        recommendedSources: [],
        recommendedDepth: "deep" as const,
        parameters: [],
        guidancePrompt: "Guidance",
        usageCount: 0,
        isBuiltIn: true, // Will be overridden to false
      };

      service.saveCustomTemplate(template);

      const saved = service.getTemplate("save-test");
      expect(saved).toBeDefined();
      expect(saved!.isBuiltIn).toBe(false);
    });
  });

  describe("syncBuiltInTemplates", () => {
    it("should sync templates not yet in DB", async () => {
      mockPrisma.researchTemplate.findUnique.mockResolvedValue(null);
      mockPrisma.researchTemplate.create.mockResolvedValue({});

      const count = await service.syncBuiltInTemplates();

      expect(count).toBeGreaterThan(0);
      expect(mockPrisma.researchTemplate.create).toHaveBeenCalled();
    });

    it("should skip templates already in DB", async () => {
      mockPrisma.researchTemplate.findUnique.mockResolvedValue({
        templateId: "existing",
      });

      const count = await service.syncBuiltInTemplates();

      expect(count).toBe(0);
      expect(mockPrisma.researchTemplate.create).not.toHaveBeenCalled();
    });
  });
});
