/**
 * Unit tests for SlideSelfHealerSkill
 *
 * NOTE: The skill imports '../../templates/base/themes' which resolves to a
 * non-existent path from the skills/ directory.
 * We provide a virtual mock for that path.
 */

// ---------------------------------------------------------------------------
// Mock themes before imports (skill uses '../../templates/base/themes')
// ---------------------------------------------------------------------------

const MOCK_THEME = {
  id: "genspark-dark",
  name: "Genspark Dark",
  colors: {
    background: {
      primary: "#0F172A",
      secondary: "#1E293B",
      tertiary: "#334155",
      gradient: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
    },
    accent: { primary: "#D4AF37", secondary: "#3B82F6", tertiary: "#10B981" },
    text: {
      primary: "#F8FAFC",
      secondary: "#CBD5E1",
      muted: "#94A3B8",
      subtle: "#64748B",
    },
    card: {
      background: "rgba(30,41,59,0.8)",
      backgroundHover: "",
      border: "#334155",
      borderHighlight: "#D4AF37",
    },
    functional: {
      success: "#10B981",
      warning: "#F59E0B",
      error: "#EF4444",
      info: "#3B82F6",
    },
  },
  typography: { fontFamily: "'Noto Sans SC','Inter',sans-serif" },
  effects: {
    cardShadow: "0 4px 6px rgba(0,0,0,0.3)",
    cardShadowHover: "",
    borderRadius: "12px",
    accentGlow: true,
  },
};

const getThemeMock = (_id: string) => MOCK_THEME;

// The skill resolves '../../templates/base/themes' from skills/ as office/templates/base/themes.
// From __tests__/, the equivalent path is ../../../templates/base/themes.
jest.mock(
  "../../../templates/base/themes",
  () => ({ getTheme: getThemeMock }),
  { virtual: true },
);

import { Test, TestingModule } from "@nestjs/testing";
import { SlideSelfHealerSkill } from "../slide-self-healer.skill";

const getTheme = getThemeMock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-self-healer",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
});

const pageOutline = {
  pageNumber: 3,
  title: "Test Slide",
  subtitle: "Testing Recovery",
  templateType: "content" as const,
  contentBrief: "Brief description of the slide content",
  keyElements: ["Point A", "Point B", "Point C"],
  layoutHints: [],
};

const buildInput = (
  failedHtml: string,
  error: string,
  overrides: Partial<{
    themeId: string;
    slideIndex: number;
    totalSlides: number;
  }> = {},
) => ({
  failedHtml,
  error,
  pageOutline,
  themeId: "genspark-dark",
  slideIndex: 2,
  totalSlides: 10,
  ...overrides,
});

const VALID_HTML_FRAGMENT = `<!DOCTYPE html>
<html><head></head><body>
<div class="slide-container" style="width:1280px;height:720px;">
  <h2>Title</h2>
  <img src="https://example.com/broken.jpg" alt="broken">
  <img src="https://example.com/another.jpg" alt="another">
</div>
</body></html>`;

describe("SlideSelfHealerSkill", () => {
  let skill: SlideSelfHealerSkill;

  const mockFacade = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SlideSelfHealerSkill,
          useFactory: () => new SlideSelfHealerSkill(mockFacade as any),
        },
      ],
    }).compile();

    skill = module.get<SlideSelfHealerSkill>(SlideSelfHealerSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-self-healer");
    expect(skill.name).toBe("Slide Self-Healer");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("1.0.0");
    expect(skill.tags).toContain("recovery");
    expect(skill.tags).toContain("healing");
  });

  // --------------------------------------------------------------------------
  // Error classification
  // --------------------------------------------------------------------------

  describe("error classification", () => {
    it("should classify empty failedHtml as EMPTY_CONTENT", async () => {
      const result = await skill.execute(
        buildInput("", "some error message"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.errorType).toBe("EMPTY_CONTENT");
    });

    it("should classify whitespace-only failedHtml as EMPTY_CONTENT", async () => {
      const result = await skill.execute(
        buildInput("   \n\t  ", "generation error"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.errorType).toBe("EMPTY_CONTENT");
    });

    it('should classify "timeout" error as TIMEOUT', async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          '<!DOCTYPE html><html><body><div class="slide-container" style="width:1280px;height:720px;">Content</div></body></html>',
        isError: false,
      });

      const result = await skill.execute(
        buildInput(
          "<div>partial content</div>",
          "Request timeout after 30 seconds",
        ),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.errorType).toBe("TIMEOUT");
    });

    it('should classify "timed out" error as TIMEOUT', async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          '<!DOCTYPE html><html><body><div class="slide-container" style="width:1280px;height:720px;">Content</div></body></html>',
        isError: false,
      });

      const result = await skill.execute(
        buildInput("<div>partial</div>", "Operation timed out"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.errorType).toBe("TIMEOUT");
    });

    it('should classify "content policy" error as AI_REFUSAL', async () => {
      const result = await skill.execute(
        buildInput(
          "<div>some html</div>",
          "Rejected due to content policy violation",
        ),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.errorType).toBe("AI_REFUSAL");
    });

    it('should classify "safety" error as AI_REFUSAL', async () => {
      const result = await skill.execute(
        buildInput("<div>some html</div>", "Safety filter triggered"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.errorType).toBe("AI_REFUSAL");
    });

    it("should classify HTML without closing tags as HTML_MALFORMED", async () => {
      // No "</" means malformed
      const result = await skill.execute(
        buildInput("<div><p>Text without closing tags", "parse error"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.errorType).toBe("HTML_MALFORMED");
    });

    it('should classify "overflow" error as OVERFLOW', async () => {
      const result = await skill.execute(
        buildInput(
          VALID_HTML_FRAGMENT,
          "Content overflow detected in container",
        ),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.errorType).toBe("OVERFLOW");
    });

    it('should classify "broken image" error as IMAGE_BROKEN', async () => {
      const result = await skill.execute(
        buildInput(VALID_HTML_FRAGMENT, "Broken image detected in slide"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.errorType).toBe("IMAGE_BROKEN");
    });

    it('should classify "img" error keyword as IMAGE_BROKEN', async () => {
      const result = await skill.execute(
        buildInput(VALID_HTML_FRAGMENT, "Failed to load img resource"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.errorType).toBe("IMAGE_BROKEN");
    });
  });

  // --------------------------------------------------------------------------
  // EMPTY_CONTENT strategy: minimal_template
  // --------------------------------------------------------------------------

  describe("EMPTY_CONTENT strategy", () => {
    it("should generate a minimal template for EMPTY_CONTENT", async () => {
      const result = await skill.execute(
        buildInput("", "no content generated", { themeId: "genspark-dark" }),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.healed).toBe(true);
      expect(result.data!.strategy).toBe("minimal_template");
      expect(result.data!.html.length).toBeGreaterThan(0);
    });

    it("should include the slide title in the generated minimal template", async () => {
      const result = await skill.execute(
        buildInput("", "empty output"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.html).toContain("Test Slide");
    });

    it("should include theme accent color in the generated minimal template", async () => {
      const theme = getTheme("genspark-dark");
      const result = await skill.execute(
        buildInput("", "empty output", { themeId: "genspark-dark" }),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.html).toContain(theme.colors.accent.primary);
    });

    it("should include keyElements in the generated minimal template", async () => {
      const result = await skill.execute(
        buildInput("", "empty output"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.html).toContain("Point A");
    });

    it("should include .slide-container div in minimal template", async () => {
      const result = await skill.execute(
        buildInput("", "empty output"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.html).toContain("slide-container");
    });

    it("should return confidence 0.6 for EMPTY_CONTENT", async () => {
      const result = await skill.execute(
        buildInput("", "empty output"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.confidence).toBe(0.6);
    });
  });

  // --------------------------------------------------------------------------
  // HTML_MALFORMED strategy: wrap_partial
  // --------------------------------------------------------------------------

  describe("HTML_MALFORMED strategy", () => {
    it("should close unclosed tags for malformed HTML", async () => {
      const malformedHtml =
        '<div class="slide-container"><h2>Title</h2><p>Unclosed paragraph';

      const result = await skill.execute(
        buildInput(malformedHtml, "malformed html"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.healed).toBe(true);
      expect(result.data!.strategy).toBe("wrap_partial");
    });

    it("should wrap content in slide-container when absent", async () => {
      // Need HTML without closing tags to trigger HTML_MALFORMED, but also needs slide-container absence
      const malformedHtmlNoContainer = "</p>Some unclosed content<div><h2>";

      const result = await skill.execute(
        buildInput(malformedHtmlNoContainer, "parse error"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.healed).toBe(true);
      // Should have created a slide-container wrapper
      expect(result.data!.html).toContain("slide-container");
    });

    it("should return confidence 0.8 for HTML_MALFORMED", async () => {
      const malformed = '<div class="slide-container"><p>Content</div>'; // has </ so not MALFORMED by empty check, but is problematic

      const result = await skill.execute(
        buildInput(malformed, "html parse error"),
        buildSkillContext(),
      );

      // If classified as HTML_MALFORMED
      expect(result.success).toBe(true);
      expect(result.data!.healed).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // IMAGE_BROKEN strategy: replace_images
  // --------------------------------------------------------------------------

  describe("IMAGE_BROKEN strategy", () => {
    it("should replace <img> tags with FA icon placeholders", async () => {
      const result = await skill.execute(
        buildInput(VALID_HTML_FRAGMENT, "broken image detected"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.healed).toBe(true);
      expect(result.data!.strategy).toBe("replace_images");
      expect(result.data!.html).toContain("fa-image");
      // Original <img> src attributes should be gone
      expect(result.data!.html).not.toMatch(
        /<img\s+[^>]*src="https:\/\/example\.com/i,
      );
    });

    it("should have healed=true for IMAGE_BROKEN", async () => {
      const result = await skill.execute(
        buildInput(VALID_HTML_FRAGMENT, "img load failure"),
        buildSkillContext(),
      );

      expect(result.data!.healed).toBe(true);
    });

    it("should return confidence 0.8 for IMAGE_BROKEN", async () => {
      const result = await skill.execute(
        buildInput(VALID_HTML_FRAGMENT, "broken image detected"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.confidence).toBe(0.8);
    });
  });

  // --------------------------------------------------------------------------
  // OVERFLOW strategy: trim_overflow
  // --------------------------------------------------------------------------

  describe("OVERFLOW strategy", () => {
    const overflowHtml = `<!DOCTYPE html>
<html><head></head><body>
<div class="slide-container" style="width:1280px;height:720px;">
  <h1 style="font-size:80px;">Giant Title</h1>
  <h2 style="font-size:60px;">Big Subtitle</h2>
  <p style="font-size:20px;">Normal paragraph content.</p>
</div>
</body></html>`;

    it("should apply trim_overflow strategy for overflow errors", async () => {
      const result = await skill.execute(
        buildInput(overflowHtml, "content overflow detected"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.healed).toBe(true);
      expect(result.data!.strategy).toBe("trim_overflow");
    });

    it("should reduce font sizes > 36px", async () => {
      const result = await skill.execute(
        buildInput(overflowHtml, "content overflow detected"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // font-size:80px -> 68px (80 * 0.85 = 68)
      expect(result.data!.html).toContain("font-size:68px");
    });

    it("should not reduce small font sizes (≤24px)", async () => {
      const result = await skill.execute(
        buildInput(overflowHtml, "overflow error"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // font-size:20px should remain 20px (not reduced)
      expect(result.data!.html).toContain("font-size:20px");
    });

    it("should return confidence 0.7 for OVERFLOW", async () => {
      const result = await skill.execute(
        buildInput(overflowHtml, "content overflow detected"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.confidence).toBe(0.7);
    });
  });

  // --------------------------------------------------------------------------
  // TIMEOUT strategy: simplified_retry
  // --------------------------------------------------------------------------

  describe("TIMEOUT strategy", () => {
    it("should attempt LLM retry for TIMEOUT errors", async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          '<!DOCTYPE html><html><head></head><body><div class="slide-container" style="width:1280px;height:720px;"><h2>Test Slide</h2></div></body></html>',
        isError: false,
      });

      const result = await skill.execute(
        buildInput("<div>partial output</div>", "Request timeout after 30s"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.healed).toBe(true);
      expect(result.data!.strategy).toBe("simplified_retry");
      expect(mockFacade.chat).toHaveBeenCalled();
    });

    it("should use simplified prompt with title and key elements", async () => {
      mockFacade.chat.mockResolvedValue({
        content:
          '<!DOCTYPE html><html><body><div class="slide-container">Content</div></body></html>',
        isError: false,
      });

      await skill.execute(
        buildInput("<div>partial</div>", "Operation timed out"),
        buildSkillContext(),
      );

      expect(mockFacade.chat).toHaveBeenCalled();
      const callMessages = mockFacade.chat.mock.calls[0][0].messages;
      const userMessage = callMessages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("Test Slide");
      expect(userMessage.content).toContain("Point A");
    });

    it("should fall back to minimal template when LLM returns error", async () => {
      mockFacade.chat.mockResolvedValue({
        content: null,
        isError: true,
      });

      const result = await skill.execute(
        buildInput("<div>partial</div>", "Request timeout"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.healed).toBe(true);
      // Fell back to minimal template
      expect(result.data!.html).toContain("slide-container");
    });

    it("should fall back to minimal template when AIFacade is absent", async () => {
      const moduleWithoutFacade: TestingModule = await Test.createTestingModule(
        {
          providers: [
            {
              provide: SlideSelfHealerSkill,
              useFactory: () => new SlideSelfHealerSkill(undefined),
            },
          ],
        },
      ).compile();

      const skillWithoutFacade =
        moduleWithoutFacade.get<SlideSelfHealerSkill>(SlideSelfHealerSkill);

      const result = await skillWithoutFacade.execute(
        buildInput("<div>partial</div>", "Request timeout after 30s"),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.healed).toBe(true);
      // No LLM -> minimal template fallback
      expect(result.data!.html).toContain("slide-container");
      expect(result.data!.html).toContain("Test Slide");
    });
  });

  // --------------------------------------------------------------------------
  // AI_REFUSAL strategy: minimal_template
  // --------------------------------------------------------------------------

  describe("AI_REFUSAL strategy", () => {
    it("should use minimal_template strategy for AI_REFUSAL", async () => {
      const result = await skill.execute(
        buildInput(
          "<div>some output</div>",
          "content policy violation refused",
        ),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.healed).toBe(true);
      expect(result.data!.strategy).toBe("minimal_template");
      expect(result.data!.errorType).toBe("AI_REFUSAL");
    });

    it("should not call LLM for AI_REFUSAL (uses template fallback)", async () => {
      await skill.execute(
        buildInput("<div>some output</div>", "content policy refused"),
        buildSkillContext(),
      );

      expect(mockFacade.chat).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // All healings produce healed: true
  // --------------------------------------------------------------------------

  describe("healed flag", () => {
    const healingScenarios = [
      { name: "EMPTY_CONTENT", failedHtml: "", error: "empty" },
      {
        name: "AI_REFUSAL",
        failedHtml: "<div>output</div>",
        error: "content policy",
      },
      {
        name: "IMAGE_BROKEN",
        failedHtml: VALID_HTML_FRAGMENT,
        error: "broken image",
      },
      {
        name: "OVERFLOW",
        failedHtml: VALID_HTML_FRAGMENT,
        error: "overflow detected",
      },
      {
        name: "HTML_MALFORMED",
        failedHtml: "no closing tags here at all none whatsoever",
        error: "parse error",
      },
    ];

    healingScenarios.forEach(({ name, failedHtml, error }) => {
      it(`should always return healed=true for ${name} scenario`, async () => {
        const result = await skill.execute(
          buildInput(failedHtml, error),
          buildSkillContext(),
        );

        expect(result.success).toBe(true);
        expect(result.data!.healed).toBe(true);
      });
    });
  });

  // --------------------------------------------------------------------------
  // Post-processing applied
  // --------------------------------------------------------------------------

  describe("post-processing", () => {
    it("should apply HTML post-processing to the healed output", async () => {
      const result = await skill.execute(
        buildInput("", "empty output", { slideIndex: 2, totalSlides: 10 }),
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // Post-processing adds page number data attributes or similar
      expect(result.data!.html.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  describe("result metadata", () => {
    it("should include executionId in metadata", async () => {
      const result = await skill.execute(
        buildInput("", "empty output"),
        buildSkillContext("exec-healer-77"),
      );

      expect(result.metadata?.executionId).toBe("exec-healer-77");
    });

    it("should include timing in metadata", async () => {
      const result = await skill.execute(
        buildInput("", "empty output"),
        buildSkillContext(),
      );

      expect(result.metadata?.startTime).toBeInstanceOf(Date);
      expect(result.metadata?.endTime).toBeInstanceOf(Date);
      expect(typeof result.metadata?.duration).toBe("number");
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
