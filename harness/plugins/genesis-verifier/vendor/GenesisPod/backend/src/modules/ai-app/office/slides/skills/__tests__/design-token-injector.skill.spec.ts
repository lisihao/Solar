/**
 * Unit tests for DesignTokenInjectorSkill
 *
 * NOTE: The skill imports '../../templates/base/themes' which resolves to a
 * non-existent path from the skills/ directory. We mock that path using the
 * actual themes implementation loaded via the correct relative path.
 */

// ---------------------------------------------------------------------------
// Mock the themes path the skill file uses before any imports that load the skill
// ---------------------------------------------------------------------------

const THEME_DATA = {
  "genspark-dark": {
    id: "genspark-dark",
    name: "Genspark Dark",
    nameZh: "深邃金典",
    description: "Classic dark theme",
    descriptionZh: "",
    preview: "",
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
        background: "rgba(30, 41, 59, 0.8)",
        backgroundHover: "rgba(30, 41, 59, 0.95)",
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
    typography: {
      fontFamily: "'Noto Sans SC', 'Inter', sans-serif",
      heading: {},
      body: {},
      stat: {},
      label: {},
    },
    decorations: {},
    effects: {
      cardShadow: "0 4px 6px -1px rgba(0,0,0,0.3)",
      cardShadowHover: "",
      borderRadius: "12px",
      accentGlow: true,
    },
  },
  "tech-purple": {
    id: "tech-purple",
    name: "Tech Purple",
    nameZh: "科技紫韵",
    description: "Purple tech theme",
    descriptionZh: "",
    preview: "",
    colors: {
      background: {
        primary: "#13111C",
        secondary: "#1E1B2E",
        tertiary: "#2D2A40",
        gradient: "linear-gradient(135deg, #13111C 0%, #1E1B2E 100%)",
      },
      accent: { primary: "#A855F7", secondary: "#06B6D4", tertiary: "#F472B6" },
      text: {
        primary: "#F8FAFC",
        secondary: "#C4B5FD",
        muted: "#8B7EC8",
        subtle: "#6B6090",
      },
      card: {
        background: "rgba(30,27,46,0.8)",
        backgroundHover: "",
        border: "#3B3566",
        borderHighlight: "#A855F7",
      },
      functional: {
        success: "#22D3EE",
        warning: "#FBBF24",
        error: "#FB7185",
        info: "#A78BFA",
      },
    },
    typography: {
      fontFamily: "'Inter', 'Noto Sans SC', sans-serif",
      heading: {},
      body: {},
      stat: {},
      label: {},
    },
    decorations: {},
    effects: {
      cardShadow: "0 4px 6px -1px rgba(0,0,0,0.4)",
      cardShadowHover: "",
      borderRadius: "16px",
      accentGlow: true,
    },
  },
  "executive-white": {
    id: "executive-white",
    name: "Executive White",
    nameZh: "商务精英",
    description: "Clean white theme",
    descriptionZh: "",
    preview: "",
    colors: {
      background: {
        primary: "#FFFFFF",
        secondary: "#F8FAFC",
        tertiary: "#F1F5F9",
        gradient: "linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)",
      },
      accent: { primary: "#1E40AF", secondary: "#DC2626", tertiary: "#059669" },
      text: {
        primary: "#1E293B",
        secondary: "#475569",
        muted: "#94A3B8",
        subtle: "#CBD5E1",
      },
      card: {
        background: "#FFFFFF",
        backgroundHover: "#F8FAFC",
        border: "#E2E8F0",
        borderHighlight: "#1E40AF",
      },
      functional: {
        success: "#059669",
        warning: "#D97706",
        error: "#DC2626",
        info: "#2563EB",
      },
    },
    typography: {
      fontFamily: "'Source Sans Pro', 'Noto Sans SC', sans-serif",
      heading: {},
      body: {},
      stat: {},
      label: {},
    },
    decorations: {},
    effects: {
      cardShadow: "0 1px 3px rgba(0,0,0,0.1)",
      cardShadowHover: "",
      borderRadius: "8px",
      accentGlow: false,
    },
  },
  "nature-green": {
    id: "nature-green",
    name: "Nature Green",
    nameZh: "自然清新",
    description: "Natural green theme",
    descriptionZh: "",
    preview: "",
    colors: {
      background: {
        primary: "#0A1F1C",
        secondary: "#132F2A",
        tertiary: "#1C3F38",
        gradient: "linear-gradient(135deg, #0A1F1C 0%, #132F2A 100%)",
      },
      accent: { primary: "#10B981", secondary: "#F59E0B", tertiary: "#06B6D4" },
      text: {
        primary: "#ECFDF5",
        secondary: "#A7F3D0",
        muted: "#6EE7B7",
        subtle: "#34D399",
      },
      card: {
        background: "rgba(19,47,42,0.8)",
        backgroundHover: "",
        border: "#1C3F38",
        borderHighlight: "#10B981",
      },
      functional: {
        success: "#34D399",
        warning: "#FBBF24",
        error: "#F87171",
        info: "#22D3EE",
      },
    },
    typography: {
      fontFamily: "'Nunito', 'Noto Sans SC', sans-serif",
      heading: {},
      body: {},
      stat: {},
      label: {},
    },
    decorations: {},
    effects: {
      cardShadow: "0 4px 6px -1px rgba(0,0,0,0.3)",
      cardShadowHover: "",
      borderRadius: "12px",
      accentGlow: true,
    },
  },
  "warm-sunset": {
    id: "warm-sunset",
    name: "Warm Sunset",
    nameZh: "暖阳晚霞",
    description: "Warm gradient theme",
    descriptionZh: "",
    preview: "",
    colors: {
      background: {
        primary: "#1C1414",
        secondary: "#2A1F1F",
        tertiary: "#3D2C2C",
        gradient: "linear-gradient(135deg, #1C1414 0%, #2A1F1F 100%)",
      },
      accent: { primary: "#F97316", secondary: "#EC4899", tertiary: "#FBBF24" },
      text: {
        primary: "#FEF3E2",
        secondary: "#FCD9BD",
        muted: "#FDBA74",
        subtle: "#FB923C",
      },
      card: {
        background: "rgba(42,31,31,0.8)",
        backgroundHover: "",
        border: "#5C4444",
        borderHighlight: "#F97316",
      },
      functional: {
        success: "#4ADE80",
        warning: "#FBBF24",
        error: "#F87171",
        info: "#38BDF8",
      },
    },
    typography: {
      fontFamily: "'Poppins', 'Noto Sans SC', sans-serif",
      heading: {},
      body: {},
      stat: {},
      label: {},
    },
    decorations: {},
    effects: {
      cardShadow: "0 4px 6px -1px rgba(0,0,0,0.4)",
      cardShadowHover: "",
      borderRadius: "14px",
      accentGlow: true,
    },
  },
} as const;

const getThemeMock = (themeId: string) =>
  (THEME_DATA as Record<string, (typeof THEME_DATA)["genspark-dark"]>)[
    themeId
  ] || THEME_DATA["genspark-dark"];

// The skill file resolves '../../templates/base/themes' from skills/ as office/templates/base/themes.
// From __tests__/, the equivalent path to office/templates/base/themes is ../../../templates/base/themes.
jest.mock(
  "../../../templates/base/themes",
  () => ({
    getTheme: getThemeMock,
    getAllThemes: () => Object.values(THEME_DATA),
    getThemeIds: () => Object.keys(THEME_DATA),
  }),
  { virtual: true },
);

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Test, TestingModule } from "@nestjs/testing";
import { DesignTokenInjectorSkill } from "../design-token-injector.skill";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-design-token-injector",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
});

const getTheme = getThemeMock;

describe("DesignTokenInjectorSkill", () => {
  let skill: DesignTokenInjectorSkill;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DesignTokenInjectorSkill],
    }).compile();

    skill = module.get<DesignTokenInjectorSkill>(DesignTokenInjectorSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-design-token-injector");
    expect(skill.name).toBe("Design Token Injector");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("1.0.0");
    expect(skill.tags).toContain("slides");
    expect(skill.tags).toContain("theme");
    expect(skill.tags).toContain("tokens");
  });

  // --------------------------------------------------------------------------
  // Theme token generation for all 5 themeIds
  // --------------------------------------------------------------------------

  describe("theme token generation", () => {
    const themeIds = [
      "genspark-dark",
      "tech-purple",
      "executive-white",
      "nature-green",
      "warm-sunset",
    ] as const;

    themeIds.forEach((themeId) => {
      it(`should generate correct tokens for themeId: ${themeId}`, async () => {
        const result = await skill.execute({ themeId }, buildSkillContext());

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();

        const { tokens } = result.data!;
        const expectedTheme = getTheme(themeId);

        expect(tokens.themeId).toBe(expectedTheme.id);
        expect(tokens.themeName).toBe(expectedTheme.name);
        expect(tokens.background.primary).toBe(
          expectedTheme.colors.background.primary,
        );
        expect(tokens.background.secondary).toBe(
          expectedTheme.colors.background.secondary,
        );
        expect(tokens.background.gradient).toBe(
          expectedTheme.colors.background.gradient,
        );
        expect(tokens.accent.primary).toBe(expectedTheme.colors.accent.primary);
        expect(tokens.accent.secondary).toBe(
          expectedTheme.colors.accent.secondary,
        );
        expect(tokens.text.primary).toBe(expectedTheme.colors.text.primary);
        expect(tokens.text.secondary).toBe(expectedTheme.colors.text.secondary);
        expect(tokens.text.muted).toBe(expectedTheme.colors.text.muted);
        expect(tokens.card.border).toBe(expectedTheme.colors.card.border);
        expect(tokens.effects.borderRadius).toBe(
          expectedTheme.effects.borderRadius,
        );
        expect(tokens.fontFamily).toBe(expectedTheme.typography.fontFamily);
      });
    });

    it("should generate tokens with accent.primary for genspark-dark matching #D4AF37", async () => {
      const result = await skill.execute(
        { themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.tokens.accent.primary).toBe("#D4AF37");
    });

    it("should generate tokens with accent.primary for tech-purple matching #A855F7", async () => {
      const result = await skill.execute(
        { themeId: "tech-purple" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.tokens.accent.primary).toBe("#A855F7");
    });

    it("should generate tokens with accent.primary for executive-white matching #1E40AF", async () => {
      const result = await skill.execute(
        { themeId: "executive-white" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.tokens.accent.primary).toBe("#1E40AF");
    });

    it("should generate tokens with accent.primary for nature-green matching #10B981", async () => {
      const result = await skill.execute(
        { themeId: "nature-green" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.tokens.accent.primary).toBe("#10B981");
    });

    it("should generate tokens with accent.primary for warm-sunset matching #F97316", async () => {
      const result = await skill.execute(
        { themeId: "warm-sunset" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.tokens.accent.primary).toBe("#F97316");
    });
  });

  // --------------------------------------------------------------------------
  // promptFragment content
  // --------------------------------------------------------------------------

  describe("promptFragment generation", () => {
    it("should include primary accent color in promptFragment for genspark-dark", async () => {
      const result = await skill.execute(
        { themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.promptFragment).toContain("#D4AF37");
    });

    it("should include secondary accent color in promptFragment for tech-purple", async () => {
      const result = await skill.execute(
        { themeId: "tech-purple" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.promptFragment).toContain("#06B6D4");
    });

    it("should include theme name in promptFragment", async () => {
      const result = await skill.execute(
        { themeId: "executive-white" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.promptFragment).toContain("Executive White");
    });

    it("should include background color values in promptFragment", async () => {
      const result = await skill.execute(
        { themeId: "nature-green" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const theme = getTheme("nature-green");
      expect(result.data!.promptFragment).toContain(
        theme.colors.background.primary,
      );
    });

    it("should include font family in promptFragment", async () => {
      const result = await skill.execute(
        { themeId: "warm-sunset" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const theme = getTheme("warm-sunset");
      const fontFamilyPart = theme.typography.fontFamily
        .split(",")[0]
        .replace(/'/g, "")
        .trim();
      expect(result.data!.promptFragment).toContain(fontFamilyPart);
    });

    it("should include tertiary accent in promptFragment when available", async () => {
      const result = await skill.execute(
        { themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.promptFragment).toContain("#10B981");
    });

    it("should produce non-empty promptFragment", async () => {
      const result = await skill.execute(
        { themeId: "executive-white" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data!.promptFragment.length).toBeGreaterThan(100);
    });
  });

  // --------------------------------------------------------------------------
  // CompactDesignTokens required fields
  // --------------------------------------------------------------------------

  describe("CompactDesignTokens structure", () => {
    it("should have all required top-level fields", async () => {
      const result = await skill.execute(
        { themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const tokens = result.data!.tokens;

      expect(tokens).toHaveProperty("themeId");
      expect(tokens).toHaveProperty("themeName");
      expect(tokens).toHaveProperty("background");
      expect(tokens).toHaveProperty("accent");
      expect(tokens).toHaveProperty("text");
      expect(tokens).toHaveProperty("card");
      expect(tokens).toHaveProperty("effects");
      expect(tokens).toHaveProperty("fontFamily");
    });

    it("should have all required background sub-fields", async () => {
      const result = await skill.execute(
        { themeId: "genspark-dark" },
        buildSkillContext(),
      );

      const { background } = result.data!.tokens;
      expect(background).toHaveProperty("primary");
      expect(background).toHaveProperty("secondary");
      expect(background).toHaveProperty("gradient");
    });

    it("should have all required accent sub-fields", async () => {
      const result = await skill.execute(
        { themeId: "genspark-dark" },
        buildSkillContext(),
      );

      const { accent } = result.data!.tokens;
      expect(accent).toHaveProperty("primary");
      expect(accent).toHaveProperty("secondary");
    });

    it("should have all required text sub-fields", async () => {
      const result = await skill.execute(
        { themeId: "genspark-dark" },
        buildSkillContext(),
      );

      const { text } = result.data!.tokens;
      expect(text).toHaveProperty("primary");
      expect(text).toHaveProperty("secondary");
      expect(text).toHaveProperty("muted");
    });

    it("should have all required card sub-fields", async () => {
      const result = await skill.execute(
        { themeId: "genspark-dark" },
        buildSkillContext(),
      );

      const { card } = result.data!.tokens;
      expect(card).toHaveProperty("background");
      expect(card).toHaveProperty("border");
    });

    it("should have all required effects sub-fields", async () => {
      const result = await skill.execute(
        { themeId: "genspark-dark" },
        buildSkillContext(),
      );

      const { effects } = result.data!.tokens;
      expect(effects).toHaveProperty("borderRadius");
      expect(effects).toHaveProperty("cardShadow");
    });

    it("should have fontFamily as a non-empty string", async () => {
      const result = await skill.execute(
        { themeId: "nature-green" },
        buildSkillContext(),
      );

      expect(typeof result.data!.tokens.fontFamily).toBe("string");
      expect(result.data!.tokens.fontFamily.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Fallback to genspark-dark for unknown themeId
  // --------------------------------------------------------------------------

  describe("unknown themeId fallback", () => {
    it("should fall back to genspark-dark for unknown themeId", async () => {
      const result = await skill.execute(
        { themeId: "unknown-theme-xyz" },
        buildSkillContext(),
      );

      expect(result.success).toBe(true);
      const expectedTheme = getTheme("genspark-dark");
      expect(result.data!.tokens.themeId).toBe(expectedTheme.id);
      expect(result.data!.tokens.accent.primary).toBe("#D4AF37");
    });

    it("should fall back to genspark-dark for empty themeId string", async () => {
      const result = await skill.execute({ themeId: "" }, buildSkillContext());

      expect(result.success).toBe(true);
      expect(result.data!.tokens.themeId).toBe("genspark-dark");
    });
  });

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  describe("result metadata", () => {
    it("should include executionId in result metadata", async () => {
      const result = await skill.execute(
        { themeId: "genspark-dark" },
        buildSkillContext("exec-abc"),
      );

      expect(result.metadata?.executionId).toBe("exec-abc");
    });

    it("should include timing in metadata", async () => {
      const result = await skill.execute(
        { themeId: "genspark-dark" },
        buildSkillContext(),
      );

      expect(result.metadata?.startTime).toBeInstanceOf(Date);
      expect(result.metadata?.endTime).toBeInstanceOf(Date);
      expect(typeof result.metadata?.duration).toBe("number");
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
