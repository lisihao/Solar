import { Test, TestingModule } from "@nestjs/testing";
import { InfographicLayoutService } from "../infographic-layout.service";
import { InfographicSection } from "../../types";

describe("InfographicLayoutService", () => {
  let service: InfographicLayoutService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InfographicLayoutService],
    }).compile();

    service = module.get<InfographicLayoutService>(InfographicLayoutService);
  });

  describe("calculateColumns", () => {
    describe("vertical orientation (height > width)", () => {
      const width = 800;
      const height = 1200;

      it("should return min(totalItems, 2) for 1 item", () => {
        expect(service.calculateColumns(1, width, height)).toBe(1);
      });

      it("should return 2 for 2 items", () => {
        expect(service.calculateColumns(2, width, height)).toBe(2);
      });

      it("should return 2 for 5 items (capped at 2)", () => {
        expect(service.calculateColumns(5, width, height)).toBe(2);
      });

      it("should return 2 for 10 items (capped at 2)", () => {
        expect(service.calculateColumns(10, width, height)).toBe(2);
      });
    });

    describe("horizontal orientation (width >= height)", () => {
      const width = 1200;
      const height = 800;

      it("should return 1 for 1 item", () => {
        expect(service.calculateColumns(1, width, height)).toBe(1);
      });

      it("should return 2 for 2 items", () => {
        expect(service.calculateColumns(2, width, height)).toBe(2);
      });

      it("should return 2 for 4 items", () => {
        expect(service.calculateColumns(4, width, height)).toBe(2);
      });

      it("should return 3 for 3 items", () => {
        expect(service.calculateColumns(3, width, height)).toBe(3);
      });

      it("should return 3 for 5 items", () => {
        expect(service.calculateColumns(5, width, height)).toBe(3);
      });

      it("should return 3 for 6 items", () => {
        expect(service.calculateColumns(6, width, height)).toBe(3);
      });

      it("should return 4 for 7 items", () => {
        expect(service.calculateColumns(7, width, height)).toBe(4);
      });

      it("should return 4 for 8 items", () => {
        expect(service.calculateColumns(8, width, height)).toBe(4);
      });

      it("should return 5 for 9 items", () => {
        expect(service.calculateColumns(9, width, height)).toBe(5);
      });

      it("should return 5 for 10 items", () => {
        expect(service.calculateColumns(10, width, height)).toBe(5);
      });

      it("should return 5 for 11+ items", () => {
        expect(service.calculateColumns(11, width, height)).toBe(5);
        expect(service.calculateColumns(20, width, height)).toBe(5);
      });
    });

    describe("square orientation (width === height)", () => {
      it("should use horizontal path when width === height", () => {
        expect(service.calculateColumns(5, 1000, 1000)).toBe(3);
      });
    });
  });

  describe("allocateSections", () => {
    const makeSection = (
      sectionType?: "main" | "summary",
    ): InfographicSection => ({
      title: "Test",
      bullets: [],
      metrics: [],
      sectionType,
    });

    it("should separate main and summary sections", () => {
      const sections = [
        makeSection("main"),
        makeSection("main"),
        makeSection("summary"),
      ];
      const { mainSections, summarySection } = service.allocateSections(
        sections,
        1200,
        800,
      );
      expect(mainSections).toHaveLength(2);
      expect(summarySection).not.toBeNull();
    });

    it("should return null summarySection when no summary section exists", () => {
      const sections = [makeSection("main"), makeSection("main")];
      const { summarySection } = service.allocateSections(sections, 1200, 800);
      expect(summarySection).toBeNull();
    });

    it("should use only first summary section when multiple exist", () => {
      const s1: InfographicSection = {
        title: "Sum1",
        bullets: [],
        metrics: [],
        sectionType: "summary",
      };
      const s2: InfographicSection = {
        title: "Sum2",
        bullets: [],
        metrics: [],
        sectionType: "summary",
      };
      const { summarySection } = service.allocateSections([s1, s2], 1200, 800);
      expect(summarySection?.title).toBe("Sum1");
    });

    it("should cap mainSections at 15 for horizontal layout", () => {
      const sections = Array.from({ length: 20 }, () => makeSection("main"));
      const { mainSections } = service.allocateSections(sections, 1200, 800);
      expect(mainSections).toHaveLength(15);
    });

    it("should cap mainSections at 12 for vertical layout", () => {
      const sections = Array.from({ length: 20 }, () => makeSection("main"));
      const { mainSections } = service.allocateSections(sections, 800, 1200);
      expect(mainSections).toHaveLength(12);
    });

    it("should handle sections with no sectionType set (not summary)", () => {
      const sections = [makeSection(undefined), makeSection(undefined)];
      const { mainSections, summarySection } = service.allocateSections(
        sections,
        1200,
        800,
      );
      expect(mainSections).toHaveLength(2);
      expect(summarySection).toBeNull();
    });
  });

  describe("calculateDimensions", () => {
    it("should calculate correct scale", () => {
      const { scale } = service.calculateDimensions(1200, 800, 5);
      expect(scale).toBeCloseTo(1.0);
    });

    it("should calculate half scale for 600px width", () => {
      const { scale } = service.calculateDimensions(600, 400, 5);
      expect(scale).toBeCloseTo(0.5);
    });

    it("should set isCompactCards false for 8 or fewer sections", () => {
      const { isCompactCards } = service.calculateDimensions(1200, 800, 8);
      expect(isCompactCards).toBe(false);
    });

    it("should set isCompactCards true for more than 8 sections", () => {
      const { isCompactCards } = service.calculateDimensions(1200, 800, 9);
      expect(isCompactCards).toBe(true);
    });

    it("should set isVeryCompactCards false for 12 or fewer sections", () => {
      const { isVeryCompactCards } = service.calculateDimensions(1200, 800, 12);
      expect(isVeryCompactCards).toBe(false);
    });

    it("should set isVeryCompactCards true for more than 12 sections", () => {
      const { isVeryCompactCards } = service.calculateDimensions(1200, 800, 13);
      expect(isVeryCompactCards).toBe(true);
    });

    it("should use wideScreen compactScale 0.85 when aspect ratio >= 1.5", () => {
      // 1200/800 = 1.5 → isWideScreen true
      const { compactScale } = service.calculateDimensions(1200, 800, 5);
      expect(compactScale).toBeCloseTo(0.85);
    });

    it("should use compactScale 1 for non-wideScreen", () => {
      // 800/800 = 1.0 → isWideScreen false
      const { compactScale } = service.calculateDimensions(800, 800, 5);
      expect(compactScale).toBe(1);
    });

    it("should return all expected fields", () => {
      const result = service.calculateDimensions(1200, 800, 5);
      expect(result).toHaveProperty("scale");
      expect(result).toHaveProperty("compactScale");
      expect(result).toHaveProperty("padding");
      expect(result).toHaveProperty("titleSize");
      expect(result).toHaveProperty("subtitleSize");
      expect(result).toHaveProperty("sectionTitleSize");
      expect(result).toHaveProperty("bulletSize");
      expect(result).toHaveProperty("isCompactCards");
      expect(result).toHaveProperty("isVeryCompactCards");
    });
  });

  describe("calculateTruncation", () => {
    it("should use veryCompact values when isVeryCompactCards is true", () => {
      const result = service.calculateTruncation(1200, 800, true, true);
      expect(result.summaryMaxLen).toBe(30);
      expect(result.bulletMaxLen).toBe(25);
      expect(result.bulletsToShow).toBe(1);
      expect(result.metricsToShow).toBe(2);
    });

    it("should use compact values when isCompactCards true but not veryCompact", () => {
      const result = service.calculateTruncation(1200, 800, true, false);
      expect(result.summaryMaxLen).toBe(40);
      expect(result.bulletMaxLen).toBe(30);
      expect(result.bulletsToShow).toBe(2);
      expect(result.metricsToShow).toBe(3);
    });

    it("should use wideScreen values when neither compact flag set and aspect ratio >= 1.5", () => {
      // 1200/800 = 1.5 → isWideScreen
      const result = service.calculateTruncation(1200, 800, false, false);
      expect(result.summaryMaxLen).toBe(45);
      expect(result.bulletMaxLen).toBe(35);
      expect(result.bulletsToShow).toBe(2);
      expect(result.metricsToShow).toBe(2);
    });

    it("should use normal values when not compact and not wideScreen", () => {
      // 800/800 = 1.0 → not wideScreen
      const result = service.calculateTruncation(800, 800, false, false);
      expect(result.summaryMaxLen).toBe(60);
      expect(result.bulletMaxLen).toBe(50);
      expect(result.bulletsToShow).toBe(3);
      expect(result.metricsToShow).toBe(3);
    });

    it("should return all expected fields", () => {
      const result = service.calculateTruncation(1200, 800, false, false);
      expect(result).toHaveProperty("summaryMaxLen");
      expect(result).toHaveProperty("bulletMaxLen");
      expect(result).toHaveProperty("bulletsToShow");
      expect(result).toHaveProperty("metricsToShow");
    });
  });

  describe("getBorderRadius", () => {
    const scale = 1;

    it('should fall back to baseBorderRadius for "none" due to falsy 0 in || expression', () => {
      // borderRadiusMap['none'] = 0, then 0 || baseBorderRadius = baseBorderRadius
      expect(service.getBorderRadius("none", 12, scale, false)).toBe(12);
    });

    it('should return 4 for "small" (no wideScreen)', () => {
      expect(service.getBorderRadius("small", 12, scale, false)).toBe(4);
    });

    it('should return 12 for "medium" (no wideScreen)', () => {
      expect(service.getBorderRadius("medium", 12, scale, false)).toBe(12);
    });

    it('should return 24 for "large" (no wideScreen)', () => {
      expect(service.getBorderRadius("large", 12, scale, false)).toBe(24);
    });

    it("should reduce radius by 0.7 factor when isWideScreen is true", () => {
      // "medium" = 12, scale=1, wideScreen → 12 * 1 * 0.7 = 8.4 → round to 8
      expect(service.getBorderRadius("medium", 12, scale, true)).toBe(8);
    });

    it("should scale the result by the given scale factor", () => {
      // "medium" = 12, scale=0.5 → 12 * 0.5 * 1 = 6
      expect(service.getBorderRadius("medium", 12, 0.5, false)).toBe(6);
    });

    it('should use "medium" (12) when borderRadius is undefined', () => {
      // undefined → borderRadius || "medium" → "medium" = 12
      expect(service.getBorderRadius(undefined, 10, scale, false)).toBe(12);
    });
  });
});
