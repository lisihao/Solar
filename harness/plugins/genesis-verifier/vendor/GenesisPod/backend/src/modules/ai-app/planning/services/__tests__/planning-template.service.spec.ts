import { Test, TestingModule } from "@nestjs/testing";
import { PlanningTemplateService } from "../planning-template.service";

describe("PlanningTemplateService", () => {
  let service: PlanningTemplateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PlanningTemplateService],
    }).compile();

    service = module.get<PlanningTemplateService>(PlanningTemplateService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getTemplates", () => {
    it("should return all planning templates", () => {
      const templates = service.getTemplates();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);
    });

    it("should return templates with required fields", () => {
      const templates = service.getTemplates();
      for (const template of templates) {
        expect(template).toHaveProperty("id");
        expect(template).toHaveProperty("name");
        expect(template).toHaveProperty("description");
        expect(template).toHaveProperty("icon");
        expect(template).toHaveProperty("defaultGoalPrompt");
        expect(template).toHaveProperty("phasePrompts");
      }
    });

    it("should include general template", () => {
      const templates = service.getTemplates();
      const generalTemplate = templates.find((t) => t.id === "general");
      expect(generalTemplate).toBeDefined();
      expect(generalTemplate!.name).toBe("通用策划");
    });

    it("should include marketing template", () => {
      const templates = service.getTemplates();
      const marketingTemplate = templates.find((t) => t.id === "marketing");
      expect(marketingTemplate).toBeDefined();
    });

    it("should include product template", () => {
      const templates = service.getTemplates();
      const productTemplate = templates.find((t) => t.id === "product");
      expect(productTemplate).toBeDefined();
    });

    it("should include event template", () => {
      const templates = service.getTemplates();
      const eventTemplate = templates.find((t) => t.id === "event");
      expect(eventTemplate).toBeDefined();
    });

    it("should return templates with phase prompts for all 6 phases", () => {
      const templates = service.getTemplates();
      for (const template of templates) {
        for (let phase = 1; phase <= 6; phase++) {
          expect(template.phasePrompts[phase]).toBeDefined();
          expect(typeof template.phasePrompts[phase]).toBe("string");
        }
      }
    });
  });

  describe("getTemplate", () => {
    it("should return template by id", () => {
      const template = service.getTemplate("general");
      expect(template).toBeDefined();
      expect(template!.id).toBe("general");
    });

    it("should return marketing template", () => {
      const template = service.getTemplate("marketing");
      expect(template).toBeDefined();
      expect(template!.id).toBe("marketing");
    });

    it("should return undefined for non-existent template", () => {
      const template = service.getTemplate("non-existent-id");
      expect(template).toBeUndefined();
    });

    it("should return undefined for empty string id", () => {
      const template = service.getTemplate("");
      expect(template).toBeUndefined();
    });
  });

  describe("getDefaultTemplate", () => {
    it("should return the first template as default", () => {
      const defaultTemplate = service.getDefaultTemplate();
      expect(defaultTemplate).toBeDefined();
      expect(defaultTemplate.id).toBe("general");
    });

    it("should return template with all required fields", () => {
      const defaultTemplate = service.getDefaultTemplate();
      expect(defaultTemplate).toHaveProperty("id");
      expect(defaultTemplate).toHaveProperty("name");
      expect(defaultTemplate).toHaveProperty("phasePrompts");
    });
  });
});
