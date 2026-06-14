/**
 * AgentCardRegistry Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { AgentCardRegistry } from "../agent-card.registry";
import { APP_CONFIG } from "@/common/config/app.config";

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

describe("AgentCardRegistry", () => {
  let registry: AgentCardRegistry;
  let _configService: jest.Mocked<ConfigService>;

  const mockConfigGet = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentCardRegistry,
        {
          provide: ConfigService,
          useValue: {
            get: mockConfigGet,
          },
        },
      ],
    }).compile();

    registry = module.get<AgentCardRegistry>(AgentCardRegistry);
    _configService = module.get(ConfigService);
  });

  afterEach(() => jest.clearAllMocks());

  // ===================== getAgentCard =====================

  describe("getAgentCard()", () => {
    it("returns agent card with AGENT_BASE_URL when configured", () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === "AGENT_BASE_URL") return "https://api.example.com";
        return undefined;
      });

      const card = registry.getAgentCard();

      expect(card.url).toBe("https://api.example.com/a2a/tasks");
      expect(card.provider.url).toBe("https://api.example.com");
    });

    it("falls back to API_URL when AGENT_BASE_URL is not set", () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === "AGENT_BASE_URL") return undefined;
        if (key === "API_URL") return "https://fallback-api.example.com";
        return undefined;
      });

      const card = registry.getAgentCard();

      expect(card.url).toBe("https://fallback-api.example.com/a2a/tasks");
      expect(card.provider.url).toBe("https://fallback-api.example.com");
    });

    it("falls back to localhost with PORT when neither URL is configured", () => {
      mockConfigGet.mockImplementation(
        (key: string, defaultValue?: unknown) => {
          if (key === "AGENT_BASE_URL") return undefined;
          if (key === "API_URL") return undefined;
          if (key === "PORT") return defaultValue; // returns 3001
          return undefined;
        },
      );

      const card = registry.getAgentCard();

      expect(card.url).toBe("http://localhost:3001/a2a/tasks");
    });

    it("uses custom PORT when configured", () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === "AGENT_BASE_URL") return undefined;
        if (key === "API_URL") return undefined;
        if (key === "PORT") return 8080;
        return undefined;
      });

      const card = registry.getAgentCard();

      expect(card.url).toBe("http://localhost:8080/a2a/tasks");
    });

    it("handles PORT returning undefined (uses 3001 default via get fallback)", () => {
      mockConfigGet.mockImplementation(
        (key: string, defaultValue?: unknown) => {
          if (key === "AGENT_BASE_URL") return undefined;
          if (key === "API_URL") return undefined;
          // Return the defaultValue for PORT as the framework would
          return defaultValue;
        },
      );

      const card = registry.getAgentCard();

      // With PORT=3001 (the default), URL should be localhost:3001
      expect(card.url).toBe("http://localhost:3001/a2a/tasks");
    });

    it("returns empty string AGENT_BASE_URL as falsy (falls through to API_URL)", () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === "AGENT_BASE_URL") return ""; // falsy
        if (key === "API_URL") return "https://api-url.example.com";
        return undefined;
      });

      const card = registry.getAgentCard();

      // Empty string is falsy, so should fall through to API_URL
      expect(card.url).toBe("https://api-url.example.com/a2a/tasks");
    });

    it("returns card with correct name and description from APP_CONFIG", () => {
      mockConfigGet.mockReturnValue(undefined);

      const card = registry.getAgentCard();

      expect(card.name).toBe(APP_CONFIG.brand.fullName);
      expect(typeof card.description).toBe("string");
      expect(card.description.length).toBeGreaterThan(0);
    });

    it("returns card with correct provider info", () => {
      mockConfigGet.mockImplementation((key: string) => {
        if (key === "AGENT_BASE_URL") return "https://api.example.com";
        return undefined;
      });

      const card = registry.getAgentCard();

      expect(card.provider.organization).toBe(APP_CONFIG.brand.name);
      expect(card.provider.url).toBe("https://api.example.com");
    });

    it("returns card with version 1.0.0", () => {
      mockConfigGet.mockReturnValue(undefined);
      const card = registry.getAgentCard();
      expect(card.version).toBe("1.0.0");
    });

    it("returns card with correct capabilities", () => {
      mockConfigGet.mockReturnValue(undefined);
      const card = registry.getAgentCard();

      // T4: pushNotifications advertised as false until the config methods are
      // implemented (currently return METHOD_NOT_FOUND).
      expect(card.capabilities).toMatchObject({
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: true,
      });
    });

    it("returns card with correct authentication schemes", () => {
      mockConfigGet.mockReturnValue(undefined);
      const card = registry.getAgentCard();

      expect(card.authentication?.schemes).toContain("Bearer");
      expect(card.authentication?.schemes).toContain("X-API-Key");
    });

    it("returns card with correct input/output modes", () => {
      mockConfigGet.mockReturnValue(undefined);
      const card = registry.getAgentCard();

      expect(card.defaultInputModes).toContain("text");
      expect(card.defaultOutputModes).toContain("text/markdown");
    });

    it("returns card with 5 skills", () => {
      mockConfigGet.mockReturnValue(undefined);
      const card = registry.getAgentCard();

      expect(card.skills).toHaveLength(5);
    });
  });

  // ===================== getSkills =====================

  describe("getSkills()", () => {
    it("returns array of 5 skills", () => {
      const skills = registry.getSkills();
      expect(skills).toHaveLength(5);
    });

    it("includes deep-research skill", () => {
      const skills = registry.getSkills();
      const skill = skills.find((s) => s.id === "deep-research");

      expect(skill).toBeDefined();
      expect(skill?.name).toBe("Deep Research");
      expect(skill?.tags).toContain("research");
    });

    it("includes ai-ask skill", () => {
      const skills = registry.getSkills();
      const skill = skills.find((s) => s.id === "ai-ask");

      expect(skill).toBeDefined();
      expect(skill?.name).toBe("AI Ask");
    });

    it("includes team-debate skill", () => {
      const skills = registry.getSkills();
      const skill = skills.find((s) => s.id === "team-debate");

      expect(skill).toBeDefined();
      expect(skill?.tags).toContain("debate");
    });

    it("includes document-generation skill", () => {
      const skills = registry.getSkills();
      const skill = skills.find((s) => s.id === "document-generation");

      expect(skill).toBeDefined();
      expect(skill?.outputModes).toContain(
        "application/vnd.openxmlformats-officedocument",
      );
    });

    it("includes ai-writing skill", () => {
      const skills = registry.getSkills();
      const skill = skills.find((s) => s.id === "ai-writing");

      expect(skill).toBeDefined();
      expect(skill?.tags).toContain("writing");
    });

    it("each skill has required fields", () => {
      const skills = registry.getSkills();
      for (const skill of skills) {
        expect(skill.id).toBeTruthy();
        expect(skill.name).toBeTruthy();
        expect(skill.description).toBeTruthy();
        expect(Array.isArray(skill.tags)).toBe(true);
      }
    });

    it("each skill has examples", () => {
      const skills = registry.getSkills();
      for (const skill of skills) {
        expect(Array.isArray(skill.examples)).toBe(true);
        expect(skill.examples!.length).toBeGreaterThan(0);
      }
    });
  });

  // ===================== getSkillById =====================

  describe("getSkillById()", () => {
    it("returns skill when valid id provided", () => {
      const skill = registry.getSkillById("deep-research");
      expect(skill).toBeDefined();
      expect(skill?.id).toBe("deep-research");
    });

    it("returns undefined for unknown skill id", () => {
      const skill = registry.getSkillById("non-existent-skill");
      expect(skill).toBeUndefined();
    });

    it("returns correct skill for each valid id", () => {
      const ids = [
        "deep-research",
        "ai-ask",
        "team-debate",
        "document-generation",
        "ai-writing",
      ];
      for (const id of ids) {
        const skill = registry.getSkillById(id);
        expect(skill).toBeDefined();
        expect(skill?.id).toBe(id);
      }
    });

    it("returns undefined for empty string", () => {
      const skill = registry.getSkillById("");
      expect(skill).toBeUndefined();
    });
  });

  // ===================== isValidSkill =====================

  describe("isValidSkill()", () => {
    it("returns true for valid skill id", () => {
      expect(registry.isValidSkill("deep-research")).toBe(true);
      expect(registry.isValidSkill("ai-ask")).toBe(true);
      expect(registry.isValidSkill("team-debate")).toBe(true);
      expect(registry.isValidSkill("document-generation")).toBe(true);
      expect(registry.isValidSkill("ai-writing")).toBe(true);
    });

    it("returns false for invalid skill id", () => {
      expect(registry.isValidSkill("unknown-skill")).toBe(false);
      expect(registry.isValidSkill("")).toBe(false);
      expect(registry.isValidSkill("DEEP-RESEARCH")).toBe(false); // case sensitive
    });
  });
});
