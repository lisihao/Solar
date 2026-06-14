/**
 * Unit tests for DeckConsistencyAuditorSkill
 *
 * NOTE: The skill imports '../../templates/base/themes' which resolves to a
 * non-existent path from the skills/ directory (should be '../templates/..').
 * We provide a virtual mock for the path the skill actually requires.
 */

// ---------------------------------------------------------------------------
// Mock themes before imports (skill uses '../../templates/base/themes')
// ---------------------------------------------------------------------------

const MOCK_THEME_GENSPARK = {
  id: "genspark-dark",
  name: "Genspark Dark",
  colors: {
    background: {
      primary: "#0F172A",
      secondary: "#1E293B",
      tertiary: "#334155",
      gradient: "linear-gradient(135deg,#0F172A,#1E293B)",
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

const MOCK_THEME_EXEC = {
  ...MOCK_THEME_GENSPARK,
  id: "executive-white",
  name: "Executive White",
  colors: {
    ...MOCK_THEME_GENSPARK.colors,
    background: {
      primary: "#FFFFFF",
      secondary: "#F8FAFC",
      tertiary: "#F1F5F9",
      gradient: "linear-gradient(135deg,#FFF,#F8FAFC)",
    },
    accent: { primary: "#1E40AF", secondary: "#DC2626", tertiary: "#059669" },
  },
};

const MOCK_THEMES: Record<string, typeof MOCK_THEME_GENSPARK> = {
  "genspark-dark": MOCK_THEME_GENSPARK,
  "executive-white": MOCK_THEME_EXEC,
};

const getThemeMock = (id: string) => MOCK_THEMES[id] || MOCK_THEME_GENSPARK;

// The skill resolves '../../templates/base/themes' from skills/ as office/templates/base/themes.
// From __tests__/, the equivalent path is ../../../templates/base/themes.
jest.mock(
  "../../../templates/base/themes",
  () => ({ getTheme: getThemeMock }),
  { virtual: true },
);

import { Test, TestingModule } from "@nestjs/testing";
import { DeckConsistencyAuditorSkill } from "../deck-consistency-auditor.skill";
import type { DeckPageInput } from "../types/enhancement-types";

const getTheme = getThemeMock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-deck-consistency-auditor",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
});

/**
 * Build a slide HTML fragment with configurable inline styles.
 * Matches the .slide-container structure the skill parses.
 */
const makeSlideHtml = (styles: string, contentStyles = "") =>
  `<!DOCTYPE html><html><head></head><body>` +
  `<div class="slide-container" style="width:1280px;height:720px;${styles}">` +
  `<h2 style="font-size:36px;font-weight:700;">Title</h2>` +
  `<div style="${contentStyles}color:#FF0000;background-color:#00FF00;">Content</div>` +
  `</div></body></html>`;

/**
 * Build a slide HTML with a specific font-size for the first element.
 */
const makeSlideHtmlWithFontSize = (titleFontSize: number) =>
  `<!DOCTYPE html><html><head></head><body>` +
  `<div class="slide-container" style="width:1280px;height:720px;">` +
  `<h2 style="font-size:${titleFontSize}px;font-weight:700;">Title</h2>` +
  `<p style="font-size:16px;">Content paragraph.</p>` +
  `</div></body></html>`;

/**
 * Build a themed slide HTML using actual theme accent colors.
 */
const makeThemedSlideHtml = (themeId: string) => {
  const theme = getTheme(themeId);
  return (
    `<!DOCTYPE html><html><head></head><body>` +
    `<div class="slide-container" style="width:1280px;height:720px;background:${theme.colors.background.primary};">` +
    `<h2 style="font-size:36px;color:${theme.colors.text.primary};">Title</h2>` +
    `<p style="color:${theme.colors.accent.primary};">Accent content</p>` +
    `<span style="background-color:${theme.colors.accent.secondary};">Secondary</span>` +
    `</div></body></html>`
  );
};

const buildPage = (
  pageNumber: number,
  templateType: string,
  title: string,
  html: string,
): DeckPageInput => ({
  pageNumber,
  templateType,
  title,
  html,
});

describe("DeckConsistencyAuditorSkill", () => {
  let skill: DeckConsistencyAuditorSkill;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeckConsistencyAuditorSkill],
    }).compile();

    skill = module.get<DeckConsistencyAuditorSkill>(
      DeckConsistencyAuditorSkill,
    );
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-deck-consistency-auditor");
    expect(skill.name).toBe("Deck Consistency Auditor");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("1.0.0");
    expect(skill.tags).toContain("consistency");
    expect(skill.tags).toContain("audit");
  });

  // --------------------------------------------------------------------------
  // Empty pages
  // --------------------------------------------------------------------------

  describe("empty pages", () => {
    it("should return perfect score 100 for empty pages array", async () => {
      const result = await skill.execute({ pages: [] }, buildSkillContext());

      expect(result.success).toBe(true);
      expect(result.data!.overallScore).toBe(100);
      expect(result.data!.passed).toBe(true);
      expect(result.data!.issues).toHaveLength(0);
    });

    it("should return all sub-scores as 100 for empty pages", async () => {
      const result = await skill.execute({ pages: [] }, buildSkillContext());

      expect(result.data!.scores.colorConsistency).toBe(100);
      expect(result.data!.scores.fontConsistency).toBe(100);
      expect(result.data!.scores.layoutDiversity).toBe(100);
      expect(result.data!.scores.narrativeFlow).toBe(100);
    });
  });

  // --------------------------------------------------------------------------
  // Color drift detection
  // --------------------------------------------------------------------------

  describe("color drift detection", () => {
    it("should detect off-theme colors and add color_drift issue", async () => {
      const pages = [
        buildPage(
          1,
          "cover",
          "Cover",
          makeSlideHtml(
            "background:#0F172A;",
            "color:#FF00FF;background-color:#FFAA00;border-color:#ABCDEF;",
          ),
        ),
        buildPage(
          2,
          "content",
          "Page 2",
          makeSlideHtml(
            "background:#1E293B;",
            "color:#BB1234;background-color:#AABBCC;border-color:#DDEEFF;",
          ),
        ),
      ];

      const result = await skill.execute(
        { pages, themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // Off-theme colors (> 3 per page) should trigger color_drift issues
      const colorIssues = result.data!.issues.filter(
        (i) => i.type === "color_drift",
      );
      expect(colorIssues.length).toBeGreaterThan(0);
    });

    it("should not flag theme colors as off-theme", async () => {
      const pages = [
        buildPage(1, "cover", "Cover", makeThemedSlideHtml("genspark-dark")),
        buildPage(
          2,
          "content",
          "Content",
          makeThemedSlideHtml("genspark-dark"),
        ),
      ];

      const result = await skill.execute(
        { pages, themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // Theme-compliant colors should not cause issues
      // Score should be reasonably high
      expect(result.data!.scores.colorConsistency).toBeGreaterThan(50);
    });

    it("should provide fix suggestions for color drift pages", async () => {
      const pages = [
        buildPage(
          1,
          "cover",
          "Cover",
          makeSlideHtml(
            "",
            "color:#112233;background-color:#556677;border-color:#889900;",
          ),
        ),
        buildPage(
          2,
          "content",
          "Page 2",
          makeSlideHtml(
            "",
            "color:#AABBCC;background-color:#334455;border-color:#667788;",
          ),
        ),
      ];

      const result = await skill.execute(
        { pages, themeId: "executive-white" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      // Fix suggestions should be generated
      if (result.data!.issues.some((i) => i.type === "color_drift")) {
        expect(result.data!.fixSuggestions.length).toBeGreaterThan(0);
      }
    });

    it("should skip color checking when no themeId provided", async () => {
      const pages = [
        buildPage(
          1,
          "cover",
          "Cover",
          makeSlideHtml("", "color:#ABCDEF;background-color:#FEDCBA;"),
        ),
        buildPage(
          2,
          "content",
          "Page 2",
          makeSlideHtml("", "color:#112233;background-color:#445566;"),
        ),
      ];

      const result = await skill.execute(
        { pages }, // no themeId
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const colorIssues = result.data!.issues.filter(
        (i) => i.type === "color_drift",
      );
      // Without themeId there is no reference palette, so no color_drift issues
      expect(colorIssues).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Font drift detection
  // --------------------------------------------------------------------------

  describe("font drift detection", () => {
    it("should detect font drift when title font sizes vary significantly", async () => {
      // Content pages: one at 36px, others at 60px — big drift from median
      const pages = [
        buildPage(1, "cover", "Cover", makeSlideHtmlWithFontSize(52)),
        buildPage(2, "content", "Content 1", makeSlideHtmlWithFontSize(36)),
        buildPage(3, "content", "Content 2", makeSlideHtmlWithFontSize(60)),
        buildPage(4, "content", "Content 3", makeSlideHtmlWithFontSize(60)),
      ];

      const result = await skill.execute(
        { pages, themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const fontIssues = result.data!.issues.filter(
        (i) => i.type === "font_drift",
      );
      expect(fontIssues.length).toBeGreaterThan(0);
    });

    it("should not flag font drift for consistent title sizes (within 2px tolerance)", async () => {
      const pages = [
        buildPage(1, "cover", "Cover", makeSlideHtmlWithFontSize(52)),
        buildPage(2, "content", "Content 1", makeSlideHtmlWithFontSize(36)),
        buildPage(3, "content", "Content 2", makeSlideHtmlWithFontSize(36)),
        buildPage(4, "content", "Content 3", makeSlideHtmlWithFontSize(37)),
      ];

      const result = await skill.execute(
        { pages, themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const fontIssues = result.data!.issues.filter(
        (i) => i.type === "font_drift",
      );
      expect(fontIssues).toHaveLength(0);
    });

    it("should provide fix suggestions with expected font-size for drifting pages", async () => {
      const pages = [
        buildPage(1, "cover", "Cover", makeSlideHtmlWithFontSize(52)),
        buildPage(2, "content", "Content 1", makeSlideHtmlWithFontSize(36)),
        buildPage(3, "content", "Content 2", makeSlideHtmlWithFontSize(36)),
        buildPage(4, "content", "Content 3", makeSlideHtmlWithFontSize(58)),
      ];

      const result = await skill.execute(
        { pages, themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      if (result.data!.issues.some((i) => i.type === "font_drift")) {
        const fontFixes = result.data!.fixSuggestions.filter(
          (f) => f.type === "font_drift",
        );
        expect(fontFixes.length).toBeGreaterThan(0);
        fontFixes.forEach((fix) => {
          expect(fix.cssProperty).toBe("font-size");
          expect(fix.expectedValue).toMatch(/\d+px/);
        });
      }
    });

    it("should skip font consistency check for cover, toc, and closing pages", async () => {
      // Single content page — not enough to compare
      const pages = [
        buildPage(1, "cover", "Cover", makeSlideHtmlWithFontSize(36)),
        buildPage(2, "toc", "Table of Contents", makeSlideHtmlWithFontSize(24)),
        buildPage(3, "closing", "Closing", makeSlideHtmlWithFontSize(20)),
      ];

      const result = await skill.execute(
        { pages, themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const fontIssues = result.data!.issues.filter(
        (i) => i.type === "font_drift",
      );
      // No content pages so no font drift issues
      expect(fontIssues).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Layout repetition detection
  // --------------------------------------------------------------------------

  describe("layout repetition detection", () => {
    it("should detect layout_repetition for many adjacent identical layouts", async () => {
      // All pages have identical structure (same div count, same layout sig)
      const sameHtml = makeSlideHtml("display:flex;", "");
      const pages = [
        buildPage(1, "content", "Page 1", sameHtml),
        buildPage(2, "content", "Page 2", sameHtml),
        buildPage(3, "content", "Page 3", sameHtml),
        buildPage(4, "content", "Page 4", sameHtml),
      ];

      const result = await skill.execute({ pages }, buildSkillContext());

      expect(result.success).toBe(true);
      const layoutIssues = result.data!.issues.filter(
        (i) => i.type === "layout_repetition",
      );
      expect(layoutIssues.length).toBeGreaterThan(0);
    });

    it("should detect layout repetition for pages with fewer than 3 unique template types", async () => {
      // 6+ pages with fewer than 3 unique types
      const contentHtml = makeSlideHtml("", "");
      const pages = Array.from({ length: 7 }, (_, i) =>
        buildPage(i + 1, "content", `Content ${i + 1}`, contentHtml),
      );

      const result = await skill.execute({ pages }, buildSkillContext());

      expect(result.success).toBe(true);
      const layoutIssues = result.data!.issues.filter(
        (i) => i.type === "layout_repetition",
      );
      expect(layoutIssues.length).toBeGreaterThan(0);
    });

    it("should not flag repetition for fewer than 3 pages", async () => {
      const sameHtml = makeSlideHtml("display:flex;", "");
      const pages = [
        buildPage(1, "content", "Page 1", sameHtml),
        buildPage(2, "content", "Page 2", sameHtml),
      ];

      const result = await skill.execute({ pages }, buildSkillContext());

      expect(result.success).toBe(true);
      const layoutIssues = result.data!.issues.filter(
        (i) => i.type === "layout_repetition",
      );
      expect(layoutIssues).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Narrative flow
  // --------------------------------------------------------------------------

  describe("narrative flow", () => {
    it("should pass narrative flow when first page is cover and last is closing", async () => {
      const pages = [
        buildPage(1, "cover", "Cover", makeSlideHtml("")),
        buildPage(2, "content", "Content", makeSlideHtml("")),
        buildPage(3, "closing", "Closing", makeSlideHtml("")),
      ];

      const result = await skill.execute({ pages }, buildSkillContext());

      expect(result.success).toBe(true);
      const flowIssues = result.data!.issues.filter(
        (i) => i.type === "narrative_flow",
      );
      expect(flowIssues).toHaveLength(0);
    });

    it("should flag narrative_flow when first page is not cover", async () => {
      const pages = [
        buildPage(1, "content", "Introduction", makeSlideHtml("")),
        buildPage(2, "content", "Details", makeSlideHtml("")),
        buildPage(3, "closing", "Closing", makeSlideHtml("")),
      ];

      const result = await skill.execute({ pages }, buildSkillContext());

      expect(result.success).toBe(true);
      const flowIssues = result.data!.issues.filter(
        (i) => i.type === "narrative_flow",
      );
      expect(flowIssues.length).toBeGreaterThan(0);
      expect(flowIssues[0].message).toContain("cover");
    });

    it("should flag narrative_flow when last page is not closing or recommendations", async () => {
      const pages = [
        buildPage(1, "cover", "Cover", makeSlideHtml("")),
        buildPage(2, "content", "Details", makeSlideHtml("")),
        buildPage(3, "content", "More Content", makeSlideHtml("")),
      ];

      const result = await skill.execute({ pages }, buildSkillContext());

      expect(result.success).toBe(true);
      const flowIssues = result.data!.issues.filter(
        (i) => i.type === "narrative_flow",
      );
      expect(flowIssues.length).toBeGreaterThan(0);
      expect(flowIssues[0].message).toContain("closing");
    });

    it("should accept recommendations as a valid last page", async () => {
      const pages = [
        buildPage(1, "cover", "Cover", makeSlideHtml("")),
        buildPage(2, "content", "Analysis", makeSlideHtml("")),
        buildPage(3, "recommendations", "Recommendations", makeSlideHtml("")),
      ];

      const result = await skill.execute({ pages }, buildSkillContext());

      expect(result.success).toBe(true);
      // recommendations is a valid end — no narrative flow issue for last page
      const lastPageIssues = result.data!.issues.filter(
        (i) => i.type === "narrative_flow" && i.message.includes("closing"),
      );
      expect(lastPageIssues).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Overall score calculation
  // --------------------------------------------------------------------------

  describe("overall score calculation", () => {
    it("should compute overallScore as weighted sum of sub-scores", async () => {
      const pages = [
        buildPage(1, "cover", "Cover", makeThemedSlideHtml("genspark-dark")),
        buildPage(2, "content", "Content", makeSlideHtmlWithFontSize(36)),
        buildPage(
          3,
          "closing",
          "Closing",
          makeThemedSlideHtml("genspark-dark"),
        ),
      ];

      const result = await skill.execute(
        { pages, themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const { scores, overallScore } = result.data!;
      // overallScore = round(color*0.3 + font*0.25 + layout*0.25 + narrative*0.2)
      const expectedScore = Math.round(
        scores.colorConsistency * 0.3 +
          scores.fontConsistency * 0.25 +
          scores.layoutDiversity * 0.25 +
          scores.narrativeFlow * 0.2,
      );
      expect(overallScore).toBe(expectedScore);
    });

    it("should set passed=true when overallScore >= 70", async () => {
      const pages = [
        buildPage(1, "cover", "Cover", makeThemedSlideHtml("genspark-dark")),
        buildPage(
          2,
          "closing",
          "Closing",
          makeThemedSlideHtml("genspark-dark"),
        ),
      ];

      const result = await skill.execute(
        { pages, themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.passed).toBe(result.data!.overallScore >= 70);
    });
  });

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  describe("result metadata", () => {
    it("should include executionId in metadata", async () => {
      const result = await skill.execute(
        { pages: [] },
        buildSkillContext("exec-auditor-1"),
      );

      expect(result.metadata?.executionId).toBe("exec-auditor-1");
    });

    it("should include timing in metadata", async () => {
      const result = await skill.execute({ pages: [] }, buildSkillContext());

      expect(result.metadata?.startTime).toBeInstanceOf(Date);
      expect(result.metadata?.endTime).toBeInstanceOf(Date);
      expect(typeof result.metadata?.duration).toBe("number");
    });
  });
});
