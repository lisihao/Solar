import { Test, TestingModule } from "@nestjs/testing";
import { ReportTemplateService } from "../report-template.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

const mockTemplate = {
  id: "tpl-1",
  name: "Research Analysis",
  category: "research",
  structure: { sections: ["intro", "findings", "conclusion"] },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const mockTemplates = [
  mockTemplate,
  {
    id: "tpl-2",
    name: "Market Report",
    category: "business",
    structure: { sections: ["executive_summary", "market_analysis"] },
    createdAt: new Date("2026-01-02"),
    updatedAt: new Date("2026-01-02"),
  },
  {
    id: "tpl-3",
    name: "Technical Deep Dive",
    category: "research",
    structure: { sections: ["overview", "technical_details", "benchmark"] },
    createdAt: new Date("2026-01-03"),
    updatedAt: new Date("2026-01-03"),
  },
];

const mockPrisma = {
  reportTemplate: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
};

describe("ReportTemplateService", () => {
  let service: ReportTemplateService;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportTemplateService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReportTemplateService>(ReportTemplateService);
  });

  describe("listTemplates", () => {
    it("returns all templates when no category filter is provided", async () => {
      mockPrisma.reportTemplate.findMany.mockResolvedValue(mockTemplates);

      const result = await service.listTemplates();

      expect(result).toEqual(mockTemplates);
      expect(mockPrisma.reportTemplate.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: [{ category: "asc" }, { name: "asc" }],
      });
    });

    it("filters templates by category when provided", async () => {
      const researchTemplates = mockTemplates.filter(
        (t) => t.category === "research",
      );
      mockPrisma.reportTemplate.findMany.mockResolvedValue(researchTemplates);

      const result = await service.listTemplates("research");

      expect(result).toEqual(researchTemplates);
      expect(mockPrisma.reportTemplate.findMany).toHaveBeenCalledWith({
        where: { category: "research" },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      });
    });

    it("returns empty array when no templates match the category", async () => {
      mockPrisma.reportTemplate.findMany.mockResolvedValue([]);

      const result = await service.listTemplates("nonexistent_category");

      expect(result).toEqual([]);
    });

    it("orders results by category asc then name asc", async () => {
      mockPrisma.reportTemplate.findMany.mockResolvedValue(mockTemplates);

      await service.listTemplates();

      expect(mockPrisma.reportTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ category: "asc" }, { name: "asc" }],
        }),
      );
    });

    it("passes undefined where clause when no category is given", async () => {
      mockPrisma.reportTemplate.findMany.mockResolvedValue([]);

      await service.listTemplates(undefined);

      expect(mockPrisma.reportTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });

    it("returns correct template count for filtered query", async () => {
      const businessTemplates = mockTemplates.filter(
        (t) => t.category === "business",
      );
      mockPrisma.reportTemplate.findMany.mockResolvedValue(businessTemplates);

      const result = await service.listTemplates("business");

      expect(result.length).toBe(1);
      expect(result[0].category).toBe("business");
    });
  });

  describe("getTemplate", () => {
    it("returns a template by ID", async () => {
      mockPrisma.reportTemplate.findUnique.mockResolvedValue(mockTemplate);

      const result = await service.getTemplate("tpl-1");

      expect(result).toEqual(mockTemplate);
      expect(mockPrisma.reportTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: "tpl-1" },
      });
    });

    it("returns null when template does not exist", async () => {
      mockPrisma.reportTemplate.findUnique.mockResolvedValue(null);

      const result = await service.getTemplate("nonexistent");

      expect(result).toBeNull();
    });

    it("queries with correct ID in where clause", async () => {
      mockPrisma.reportTemplate.findUnique.mockResolvedValue(mockTemplate);

      await service.getTemplate("tpl-2");

      expect(mockPrisma.reportTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: "tpl-2" },
      });
    });

    it("returns template with structure field", async () => {
      mockPrisma.reportTemplate.findUnique.mockResolvedValue(mockTemplate);

      const result = await service.getTemplate("tpl-1");

      expect(result?.structure).toEqual({
        sections: ["intro", "findings", "conclusion"],
      });
    });
  });
});
