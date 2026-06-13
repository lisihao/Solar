/**
 * Unit tests for SlideVisualValidatorSkill
 *
 * Puppeteer is fully mocked — no real browser is launched.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SlideVisualValidatorSkill } from "../slide-visual-validator.skill";
import { PuppeteerPoolService } from "../../../../../../common/browser/puppeteer-pool.service";

// ---------------------------------------------------------------------------
// Puppeteer mock setup
// ---------------------------------------------------------------------------

const mockPage = {
  setViewport: jest.fn().mockResolvedValue(undefined),
  setContent: jest.fn().mockResolvedValue(undefined),
  evaluate: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
};

const mockPuppeteerPool = {
  getBrowser: jest.fn().mockResolvedValue(mockBrowser),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-visual-validator",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
});

/**
 * Build a default set of evaluate return values for a successful validation.
 * Override individual metrics as needed.
 */
const makeMetrics = (
  overrides: Partial<{
    hasOverflow: boolean;
    blankRatio: number;
    textDensity: number;
    imageCount: number;
    brokenImages: number;
    accentColors: string[];
    containerFound: boolean;
  }> = {},
) => ({
  hasOverflow: false,
  blankRatio: 0.2,
  textDensity: 1.0,
  imageCount: 0,
  brokenImages: 0,
  accentColors: ["#D4AF37", "#3B82F6"],
  containerFound: true,
  ...overrides,
});

/**
 * Reset mock page and browser, setting up evaluate to return the given metrics.
 * Always re-assigns mockBrowser.newPage so it doesn't return undefined after clearAllMocks.
 */
const setupEvaluateMocks = (...evaluateResults: unknown[]) => {
  mockPage.setViewport.mockResolvedValue(undefined);
  mockPage.setContent.mockResolvedValue(undefined);
  mockPage.close.mockResolvedValue(undefined);
  mockBrowser.newPage.mockResolvedValue(mockPage);
  mockPuppeteerPool.getBrowser.mockResolvedValue(mockBrowser);

  let chain = mockPage.evaluate.mockReset();
  for (const result of evaluateResults) {
    if (result instanceof Error) {
      chain = chain.mockRejectedValueOnce(result);
    } else {
      chain = chain.mockResolvedValueOnce(result);
    }
  }
};

const VALID_HTML = `<!DOCTYPE html><html><head></head><body>
  <div class="slide-container" style="width:1280px;height:720px;">
    <h2 style="font-size:36px;">Title</h2>
    <p>Content paragraph with meaningful text.</p>
  </div>
</body></html>`;

describe("SlideVisualValidatorSkill", () => {
  let skill: SlideVisualValidatorSkill;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: fonts.ready resolves, then main evaluate returns good metrics
    setupEvaluateMocks(true, makeMetrics());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlideVisualValidatorSkill,
        { provide: PuppeteerPoolService, useValue: mockPuppeteerPool },
      ],
    }).compile();

    skill = module.get<SlideVisualValidatorSkill>(SlideVisualValidatorSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-visual-validator");
    expect(skill.name).toBe("Slide Visual Validator");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("1.0.0");
    expect(skill.tags).toContain("validation");
    expect(skill.tags).toContain("puppeteer");
  });

  // --------------------------------------------------------------------------
  // Empty HTML
  // --------------------------------------------------------------------------

  describe("empty HTML input", () => {
    it("should return score 0 and passed=false for empty HTML", async () => {
      const result = await skill.execute({ html: "" }, buildSkillContext());

      expect(result.success).toBe(true);
      expect(result.data!.score).toBe(0);
      expect(result.data!.passed).toBe(false);
    });

    it("should not launch puppeteer for empty HTML", async () => {
      await skill.execute({ html: "" }, buildSkillContext());

      expect(mockPuppeteerPool.getBrowser).not.toHaveBeenCalled();
    });

    it("should return blankRatio=1 and textDensity=0 for empty HTML", async () => {
      const result = await skill.execute({ html: "" }, buildSkillContext());

      expect(result.data!.metrics.blankRatio).toBe(1);
      expect(result.data!.metrics.textDensity).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Successful validation
  // --------------------------------------------------------------------------

  describe("successful validation", () => {
    it("should pass validation when all metrics are good", async () => {
      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.passed).toBe(true);
      expect(result.data!.score).toBeGreaterThanOrEqual(70);
      expect(result.data!.issues).toHaveLength(0);
    });

    it("should return metrics with correct structure on success", async () => {
      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const { metrics } = result.data!;
      expect(typeof metrics.hasOverflow).toBe("boolean");
      expect(typeof metrics.blankRatio).toBe("number");
      expect(typeof metrics.textDensity).toBe("number");
      expect(typeof metrics.imageCount).toBe("number");
      expect(typeof metrics.brokenImages).toBe("number");
      expect(Array.isArray(metrics.accentColors)).toBe(true);
    });

    it("should always call page.close() after successful validation", async () => {
      await skill.execute({ html: VALID_HTML }, buildSkillContext());

      expect(mockPage.close).toHaveBeenCalledTimes(1);
    });

    it("should call page.setViewport with 1280x720", async () => {
      await skill.execute({ html: VALID_HTML }, buildSkillContext());

      expect(mockPage.setViewport).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1280, height: 720 }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Overflow detection
  // --------------------------------------------------------------------------

  describe("overflow detection", () => {
    it("should detect overflow and add overflow issue when hasOverflow=true", async () => {
      jest.clearAllMocks();
      setupEvaluateMocks(true, makeMetrics({ hasOverflow: true }));

      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.metrics.hasOverflow).toBe(true);
      const overflowIssues = result.data!.issues.filter(
        (i) => i.type === "overflow",
      );
      expect(overflowIssues.length).toBeGreaterThan(0);
    });

    it("should produce a lower score when overflow is detected", async () => {
      // Run 1: no overflow
      jest.clearAllMocks();
      setupEvaluateMocks(true, makeMetrics({ hasOverflow: false }));
      const noOverflowResult = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      // Run 2: overflow
      jest.clearAllMocks();
      setupEvaluateMocks(true, makeMetrics({ hasOverflow: true }));
      const overflowResult = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(overflowResult.data!.score).toBeLessThan(
        noOverflowResult.data!.score,
      );
    });
  });

  // --------------------------------------------------------------------------
  // Blank area detection
  // --------------------------------------------------------------------------

  describe("blank area detection", () => {
    it("should add blank_area warning when blankRatio > 0.65", async () => {
      jest.clearAllMocks();
      setupEvaluateMocks(true, makeMetrics({ blankRatio: 0.75 }));

      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const blankIssues = result.data!.issues.filter(
        (i) => i.type === "blank_area",
      );
      expect(blankIssues.length).toBeGreaterThan(0);
    });

    it("should not add blank_area warning when blankRatio is low (< 0.65)", async () => {
      // Default setup already uses blankRatio: 0.2
      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const blankIssues = result.data!.issues.filter(
        (i) => i.type === "blank_area",
      );
      expect(blankIssues).toHaveLength(0);
    });

    it("should produce lower score for high blank ratio (> 0.7)", async () => {
      jest.clearAllMocks();
      setupEvaluateMocks(true, makeMetrics({ blankRatio: 0.8 }));

      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      // blankRatio > 0.7 gives blankScore = 5 instead of 20 → lower total
      expect(result.data!.score).toBeLessThan(100);
    });
  });

  // --------------------------------------------------------------------------
  // Broken image detection
  // --------------------------------------------------------------------------

  describe("broken image detection", () => {
    it("should add image_broken warning when brokenImages > 0", async () => {
      jest.clearAllMocks();
      setupEvaluateMocks(true, makeMetrics({ imageCount: 2, brokenImages: 2 }));

      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const brokenIssues = result.data!.issues.filter(
        (i) => i.type === "image_broken",
      );
      expect(brokenIssues.length).toBeGreaterThan(0);
      expect(brokenIssues[0].message).toContain("broken image");
    });

    it("should include brokenImages count in issue details", async () => {
      jest.clearAllMocks();
      setupEvaluateMocks(true, makeMetrics({ brokenImages: 3 }));

      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      const brokenIssue = result.data!.issues.find(
        (i) => i.type === "image_broken",
      );
      expect(brokenIssue).toBeDefined();
      expect(brokenIssue!.details).toBeDefined();
    });

    it("should reduce imageScore proportionally for each broken image", async () => {
      // Run 1: zero broken images
      jest.clearAllMocks();
      setupEvaluateMocks(true, makeMetrics({ brokenImages: 0 }));
      const goodResult = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      // Run 2: 3 broken images
      jest.clearAllMocks();
      setupEvaluateMocks(true, makeMetrics({ brokenImages: 3 }));
      const brokenResult = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(brokenResult.data!.score).toBeLessThan(goodResult.data!.score);
    });
  });

  // --------------------------------------------------------------------------
  // browser.close() always called
  // --------------------------------------------------------------------------

  describe("browser cleanup", () => {
    it("should return error result when page.evaluate throws", async () => {
      jest.clearAllMocks();
      // fonts.ready resolves, then main evaluate throws
      setupEvaluateMocks(true, new Error("DOM evaluation failed"));

      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("DOM evaluation failed");
    });

    it("should return error result when browser.newPage throws", async () => {
      jest.clearAllMocks();
      setupEvaluateMocks(true, makeMetrics());
      mockBrowser.newPage.mockRejectedValueOnce(
        new Error("Failed to create new page"),
      );

      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Failed to create new page");
    });
  });

  // --------------------------------------------------------------------------
  // Score calculation
  // --------------------------------------------------------------------------

  describe("score calculation", () => {
    it("should return maximum possible score for perfect metrics", async () => {
      jest.clearAllMocks();
      setupEvaluateMocks(
        true,
        makeMetrics({
          hasOverflow: false,
          blankRatio: 0.1,
          textDensity: 0.5,
          brokenImages: 0,
          accentColors: ["#D4AF37", "#3B82F6"],
        }),
      );

      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      // Max score: overflow(30) + blank(20) + density(20) + image(15) + color(15) = 100
      expect(result.data!.score).toBe(100);
    });

    it("should return passed=true when score >= 70", async () => {
      // Default setup produces perfect metrics → score 100 → passed
      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(result.data!.passed).toBe(true);
    });

    it("should return passed=false when score < 70", async () => {
      jest.clearAllMocks();
      // Worst case: overflow(0) + blank(5) + density(5) + image(0) + color(5) = 15
      setupEvaluateMocks(
        true,
        makeMetrics({
          hasOverflow: true,
          blankRatio: 0.8,
          textDensity: 3.5,
          brokenImages: 3,
          accentColors: [],
        }),
      );

      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(result.data!.passed).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  describe("result metadata", () => {
    it("should include executionId in metadata", async () => {
      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext("exec-validator-1"),
      );

      expect(result.metadata?.executionId).toBe("exec-validator-1");
    });

    it("should include timing in metadata on success", async () => {
      const result = await skill.execute(
        { html: VALID_HTML },
        buildSkillContext(),
      );

      expect(result.metadata?.startTime).toBeInstanceOf(Date);
      expect(result.metadata?.endTime).toBeInstanceOf(Date);
      expect(typeof result.metadata?.duration).toBe("number");
    });
  });
});
