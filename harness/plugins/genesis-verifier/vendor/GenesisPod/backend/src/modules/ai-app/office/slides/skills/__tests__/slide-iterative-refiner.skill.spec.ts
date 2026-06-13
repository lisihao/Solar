/**
 * Unit tests for SlideIterativeRefinerSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SlideIterativeRefinerSkill } from "../slide-iterative-refiner.skill";
import type { SlideVisualValidatorOutput } from "../types/enhancement-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-iterative-refiner",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
});

const buildPageOutline = () => ({
  pageNumber: 2,
  title: "Market Analysis",
  subtitle: "Q4 Results",
  templateType: "content" as const,
  contentBrief: "Analysis of market trends",
  keyElements: ["Revenue growth", "Market share", "Key drivers"],
  layoutHints: [],
});

/**
 * Build a failing validation report (score < 70, not passed)
 */
const buildFailingReport = (
  overrides: Partial<SlideVisualValidatorOutput> = {},
): SlideVisualValidatorOutput => ({
  passed: false,
  score: 40,
  issues: [
    {
      type: "image_broken",
      severity: "warning",
      message: "2 broken image(s) detected",
      details: { brokenImages: 2 },
    },
  ],
  metrics: {
    hasOverflow: false,
    blankRatio: 0.2,
    textDensity: 1.0,
    imageCount: 2,
    brokenImages: 2,
    accentColors: ["#D4AF37"],
  },
  ...overrides,
});

/**
 * Build a passing validation report (score >= 70)
 */
const buildPassingReport = (): SlideVisualValidatorOutput => ({
  passed: true,
  score: 90,
  issues: [],
  metrics: {
    hasOverflow: false,
    blankRatio: 0.2,
    textDensity: 1.0,
    imageCount: 0,
    brokenImages: 0,
    accentColors: ["#D4AF37", "#3B82F6"],
  },
});

const SLIDE_WITH_IMAGES = `<!DOCTYPE html>
<html><head></head><body>
<div class="slide-container" style="width:1280px;height:720px;">
  <h2 style="font-size:36px;font-weight:700;">Title</h2>
  <img src="https://example.com/image1.jpg" alt="Chart" />
  <img src="https://example.com/image2.jpg" alt="Graph" />
</div>
</body></html>`;

const SLIDE_WITH_LARGE_FONTS = `<!DOCTYPE html>
<html><head></head><body>
<div class="slide-container" style="width:1280px;height:720px;">
  <h1 style="font-size:72px;">Big Title</h1>
  <h2 style="font-size:48px;">Subtitle</h2>
  <p style="font-size:28px;">Content with large font that might overflow.</p>
</div>
</body></html>`;

describe("SlideIterativeRefinerSkill", () => {
  let skill: SlideIterativeRefinerSkill;

  const mockFacade = {
    chat: jest.fn(),
  };

  const mockValidator = {
    execute: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SlideIterativeRefinerSkill,
          useFactory: () =>
            new SlideIterativeRefinerSkill(
              mockFacade as any,
              mockValidator as any,
            ),
        },
      ],
    }).compile();

    skill = module.get<SlideIterativeRefinerSkill>(SlideIterativeRefinerSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-iterative-refiner");
    expect(skill.name).toBe("Slide Iterative Refiner");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("1.0.0");
    expect(skill.tags).toContain("iterative");
    expect(skill.tags).toContain("refiner");
  });

  // --------------------------------------------------------------------------
  // Skip loop when already passing
  // --------------------------------------------------------------------------

  describe("skip when already passing", () => {
    it("should not iterate when validationReport is already passed", async () => {
      const result = await skill.execute(
        {
          html: SLIDE_WITH_IMAGES,
          validationReport: buildPassingReport(),
          pageOutline: buildPageOutline(),
          slideIndex: 1,
          totalSlides: 5,
          maxIterations: 3,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.iterations).toBe(0);
      expect(mockValidator.execute).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Programmatic fix: image_broken
  // --------------------------------------------------------------------------

  describe("programmatic fix: image_broken", () => {
    it("should replace <img> tags with FA icon placeholders for broken images", async () => {
      mockValidator.execute.mockResolvedValue({
        success: true,
        data: buildPassingReport(),
        metadata: {
          executionId: "revalidate-1",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      const result = await skill.execute(
        {
          html: SLIDE_WITH_IMAGES,
          validationReport: buildFailingReport(),
          pageOutline: buildPageOutline(),
          slideIndex: 1,
          totalSlides: 5,
          maxIterations: 1,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // The fix should have been applied and recorded
      const imageFix = result.data!.fixes.find(
        (f) =>
          f.toLowerCase().includes("image") ||
          f.toLowerCase().includes("broken") ||
          f.toLowerCase().includes("replaced"),
      );
      expect(imageFix).toBeDefined();
    });

    it("should not contain <img> tags in output after image_broken fix", async () => {
      mockValidator.execute.mockResolvedValue({
        success: true,
        data: buildPassingReport(),
        metadata: {
          executionId: "revalidate-1",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      const result = await skill.execute(
        {
          html: SLIDE_WITH_IMAGES,
          validationReport: buildFailingReport({
            issues: [
              {
                type: "image_broken",
                severity: "warning",
                message: "2 broken image(s) detected",
                details: { brokenImages: 2 },
              },
            ],
          }),
          pageOutline: buildPageOutline(),
          slideIndex: 1,
          totalSlides: 5,
          maxIterations: 1,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // After fix, the output HTML should have FA icons, not bare <img> tags
      expect(result.data!.html).toContain("fa-image");
      expect(result.data!.html).not.toMatch(/<img\s+[^>]*src="[^"]*"/i);
    });
  });

  // --------------------------------------------------------------------------
  // Programmatic fix: overflow
  // --------------------------------------------------------------------------

  describe("programmatic fix: overflow", () => {
    it("should reduce font sizes for overflow issues", async () => {
      mockValidator.execute.mockResolvedValue({
        success: true,
        data: buildPassingReport(),
        metadata: {
          executionId: "revalidate-1",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      const result = await skill.execute(
        {
          html: SLIDE_WITH_LARGE_FONTS,
          validationReport: buildFailingReport({
            issues: [
              {
                type: "overflow",
                severity: "error",
                message: "Content overflows the 1280x720 container",
              },
            ],
          }),
          pageOutline: buildPageOutline(),
          slideIndex: 0,
          totalSlides: 5,
          maxIterations: 1,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const overflowFix = result.data!.fixes.find(
        (f) =>
          f.toLowerCase().includes("font") ||
          f.toLowerCase().includes("overflow"),
      );
      expect(overflowFix).toBeDefined();
    });

    it("should reduce font sizes > 36px by 4px", async () => {
      mockValidator.execute.mockResolvedValue({
        success: true,
        data: buildPassingReport(),
        metadata: {
          executionId: "revalidate-1",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      const result = await skill.execute(
        {
          html: '<div class="slide-container"><p style="font-size:72px;">Big text</p></div>',
          validationReport: buildFailingReport({
            issues: [
              { type: "overflow", severity: "error", message: "Overflow" },
            ],
          }),
          pageOutline: buildPageOutline(),
          slideIndex: 0,
          totalSlides: 5,
          maxIterations: 1,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // font-size:72px should become font-size:68px (72 - 4)
      expect(result.data!.html).toContain("font-size:68px");
    });
  });

  // --------------------------------------------------------------------------
  // Max iterations limit
  // --------------------------------------------------------------------------

  describe("max iterations limit", () => {
    it("should respect maxIterations and not exceed it", async () => {
      // Always return failing report to force multiple iterations
      mockValidator.execute.mockResolvedValue({
        success: true,
        data: buildFailingReport({ score: 45 }),
        metadata: {
          executionId: "revalidate",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      const result = await skill.execute(
        {
          html: SLIDE_WITH_IMAGES,
          validationReport: buildFailingReport(),
          pageOutline: buildPageOutline(),
          slideIndex: 1,
          totalSlides: 5,
          maxIterations: 2,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.iterations).toBeLessThanOrEqual(2);
    });

    it("should default to 2 iterations when maxIterations is not provided", async () => {
      mockValidator.execute.mockResolvedValue({
        success: true,
        data: buildFailingReport({ score: 45 }),
        metadata: {
          executionId: "revalidate",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      const result = await skill.execute(
        {
          html: SLIDE_WITH_IMAGES,
          validationReport: buildFailingReport(),
          pageOutline: buildPageOutline(),
          slideIndex: 1,
          totalSlides: 5,
          // maxIterations not provided -> defaults to 2
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.iterations).toBeLessThanOrEqual(2);
    });
  });

  // --------------------------------------------------------------------------
  // Without visual validator
  // --------------------------------------------------------------------------

  describe("without visual validator", () => {
    let skillWithoutValidator: SlideIterativeRefinerSkill;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          {
            provide: SlideIterativeRefinerSkill,
            useFactory: () =>
              new SlideIterativeRefinerSkill(mockFacade as any, undefined),
          },
        ],
      }).compile();

      skillWithoutValidator = module.get<SlideIterativeRefinerSkill>(
        SlideIterativeRefinerSkill,
      );
    });

    it("should return after one fix pass when no visual validator is provided", async () => {
      const result = await skillWithoutValidator.execute(
        {
          html: SLIDE_WITH_IMAGES,
          validationReport: buildFailingReport(),
          pageOutline: buildPageOutline(),
          slideIndex: 1,
          totalSlides: 5,
          maxIterations: 3,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // Without validator there is no re-validation loop — exits after one fix
      expect(result.data!.iterations).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // improved flag
  // --------------------------------------------------------------------------

  describe("improved flag", () => {
    it("should set improved=true when final score is higher than initial", async () => {
      mockValidator.execute.mockResolvedValue({
        success: true,
        data: buildFailingReport({ score: 75, passed: true }),
        metadata: {
          executionId: "revalidate",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      const result = await skill.execute(
        {
          html: SLIDE_WITH_IMAGES,
          validationReport: buildFailingReport({ score: 40 }),
          pageOutline: buildPageOutline(),
          slideIndex: 1,
          totalSlides: 5,
          maxIterations: 1,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.improved).toBe(true);
      expect(result.data!.finalScore).toBe(75);
    });

    it("should set improved=false when score does not improve", async () => {
      // Re-validation returns the same score
      mockValidator.execute.mockResolvedValue({
        success: true,
        data: buildFailingReport({ score: 40 }),
        metadata: {
          executionId: "revalidate",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      const result = await skill.execute(
        {
          html: SLIDE_WITH_IMAGES,
          validationReport: buildFailingReport({ score: 40 }),
          pageOutline: buildPageOutline(),
          slideIndex: 1,
          totalSlides: 5,
          maxIterations: 1,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.improved).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // LLM refinement
  // --------------------------------------------------------------------------

  describe("LLM refinement", () => {
    it("should call LLM when there are non-programmatic issues", async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          '```html\n<!DOCTYPE html><html><head></head><body><div class="slide-container" style="width:1280px;height:720px;"><h2>Fixed Title</h2></div></body></html>\n```',
        isError: false,
      });

      mockValidator.execute.mockResolvedValue({
        success: true,
        data: buildPassingReport(),
        metadata: {
          executionId: "revalidate",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      await skill.execute(
        {
          html: SLIDE_WITH_IMAGES,
          validationReport: buildFailingReport({
            issues: [
              {
                type: "blank_area",
                severity: "warning",
                message: "Excessive blank area: 70% empty space",
              },
            ],
          }),
          pageOutline: buildPageOutline(),
          slideIndex: 1,
          totalSlides: 5,
          maxIterations: 1,
        },
        buildSkillContext(),
      );

      expect(mockFacade.chat).toHaveBeenCalled();
    });

    it("should continue gracefully when LLM refinement fails", async () => {
      mockFacade.chat.mockRejectedValue(new Error("LLM unavailable"));

      mockValidator.execute.mockResolvedValue({
        success: true,
        data: buildPassingReport(),
        metadata: {
          executionId: "revalidate",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      const result = await skill.execute(
        {
          html: SLIDE_WITH_IMAGES,
          validationReport: buildFailingReport({
            issues: [
              {
                type: "blank_area",
                severity: "warning",
                message: "Excessive blank area",
              },
            ],
          }),
          pageOutline: buildPageOutline(),
          slideIndex: 1,
          totalSlides: 5,
          maxIterations: 1,
        },
        buildSkillContext(),
      );

      // Should succeed even when LLM throws
      expect(result.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Output fields
  // --------------------------------------------------------------------------

  describe("output structure", () => {
    it("should return all required output fields", async () => {
      mockValidator.execute.mockResolvedValue({
        success: true,
        data: buildPassingReport(),
        metadata: {
          executionId: "revalidate",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      const result = await skill.execute(
        {
          html: SLIDE_WITH_IMAGES,
          validationReport: buildFailingReport(),
          pageOutline: buildPageOutline(),
          slideIndex: 1,
          totalSlides: 5,
          maxIterations: 1,
        },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("html");
      expect(result.data).toHaveProperty("improved");
      expect(result.data).toHaveProperty("finalScore");
      expect(result.data).toHaveProperty("iterations");
      expect(result.data).toHaveProperty("fixes");
      expect(Array.isArray(result.data!.fixes)).toBe(true);
    });

    it("should include executionId in metadata", async () => {
      mockValidator.execute.mockResolvedValue({
        success: true,
        data: buildPassingReport(),
        metadata: {
          executionId: "revalidate",
          startTime: new Date(),
          endTime: new Date(),
          duration: 10,
        },
      });

      const result = await skill.execute(
        {
          html: SLIDE_WITH_IMAGES,
          validationReport: buildPassingReport(),
          pageOutline: buildPageOutline(),
          slideIndex: 1,
          totalSlides: 5,
        },
        buildSkillContext("exec-refiner-99"),
      );

      expect(result.metadata?.executionId).toBe("exec-refiner-99");
    });
  });
});
