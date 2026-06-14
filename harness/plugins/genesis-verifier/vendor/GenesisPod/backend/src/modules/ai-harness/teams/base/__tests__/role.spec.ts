/**
 * Unit tests for Role class and createRole factory function
 */

import { Role, createRole } from "../role";
import {
  RoleConfig,
  DEFAULT_WORK_STYLE,
  LEADER_WORK_STYLE,
} from "../../abstractions/role.interface";

// ==================== Test fixtures ====================

function buildMemberConfig(overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    id: "test-member-role",
    name: "Test Member",
    description: "A test member role",
    type: "member",
    coreSkills: ["research", "analysis"],
    optionalSkills: ["writing", "design"],
    coreTools: ["web-search", "calculator"],
    optionalTools: ["pdf-reader"],
    responsibilities: ["Conduct research", "Write reports"],
    limitations: ["No direct user interaction"],
    systemPromptTemplate:
      "You are {{role_name}}. {{role_description}}\n\nResponsibilities:\n{{responsibilities}}\n\nLimitations:\n{{limitations}}",
    ...overrides,
  };
}

function buildLeaderConfig(overrides: Partial<RoleConfig> = {}): RoleConfig {
  return buildMemberConfig({
    id: "test-leader-role",
    name: "Test Leader",
    type: "leader",
    ...overrides,
  });
}

// ==================== Constructor ====================

describe("Role constructor", () => {
  it("assigns id from config", () => {
    const role = new Role(buildMemberConfig());
    expect(role.id).toBe("test-member-role");
  });

  it("assigns name from config", () => {
    const role = new Role(buildMemberConfig());
    expect(role.name).toBe("Test Member");
  });

  it("assigns description from config", () => {
    const role = new Role(buildMemberConfig());
    expect(role.description).toBe("A test member role");
  });

  it("assigns type from config", () => {
    const role = new Role(buildMemberConfig());
    expect(role.type).toBe("member");
  });

  it("assigns icon when provided", () => {
    const role = new Role(buildMemberConfig({ icon: "user" }));
    expect(role.icon).toBe("user");
  });

  it("assigns undefined icon when not provided", () => {
    const role = new Role(buildMemberConfig());
    expect(role.icon).toBeUndefined();
  });

  it("assigns coreSkills from config", () => {
    const role = new Role(buildMemberConfig());
    expect(role.coreSkills).toEqual(["research", "analysis"]);
  });

  it("assigns optionalSkills from config", () => {
    const role = new Role(buildMemberConfig());
    expect(role.optionalSkills).toEqual(["writing", "design"]);
  });

  it("defaults optionalSkills to empty array when not provided", () => {
    const config = buildMemberConfig();
    delete config.optionalSkills;
    const role = new Role(config);
    expect(role.optionalSkills).toEqual([]);
  });

  it("assigns coreTools from config", () => {
    const role = new Role(buildMemberConfig());
    expect(role.coreTools).toEqual(["web-search", "calculator"]);
  });

  it("assigns optionalTools from config", () => {
    const role = new Role(buildMemberConfig());
    expect(role.optionalTools).toEqual(["pdf-reader"]);
  });

  it("defaults optionalTools to empty array when not provided", () => {
    const config = buildMemberConfig();
    delete config.optionalTools;
    const role = new Role(config);
    expect(role.optionalTools).toEqual([]);
  });

  it("assigns responsibilities from config", () => {
    const role = new Role(buildMemberConfig());
    expect(role.responsibilities).toEqual([
      "Conduct research",
      "Write reports",
    ]);
  });

  it("assigns limitations from config", () => {
    const role = new Role(buildMemberConfig());
    expect(role.limitations).toEqual(["No direct user interaction"]);
  });

  it("defaults limitations to empty array when not provided", () => {
    const config = buildMemberConfig();
    delete config.limitations;
    const role = new Role(config);
    expect(role.limitations).toEqual([]);
  });

  it("assigns metadata from config", () => {
    const role = new Role(buildMemberConfig({ metadata: { version: 2 } }));
    expect(role.metadata).toEqual({ version: 2 });
  });
});

// ==================== WorkStyle merging ====================

describe("defaultWorkStyle", () => {
  it("uses DEFAULT_WORK_STYLE base for non-leader types", () => {
    const role = new Role(buildMemberConfig({ defaultWorkStyle: undefined }));
    expect(role.defaultWorkStyle).toEqual(DEFAULT_WORK_STYLE);
  });

  it("uses LEADER_WORK_STYLE base for leader type", () => {
    const role = new Role(buildLeaderConfig({ defaultWorkStyle: undefined }));
    expect(role.defaultWorkStyle).toEqual(LEADER_WORK_STYLE);
  });

  it("merges partial override into DEFAULT_WORK_STYLE for member", () => {
    const role = new Role(
      buildMemberConfig({
        defaultWorkStyle: { thinkingDepth: "deep" },
      }),
    );
    expect(role.defaultWorkStyle.thinkingDepth).toBe("deep");
    // Other fields come from DEFAULT_WORK_STYLE
    expect(role.defaultWorkStyle.outputStyle).toBe(
      DEFAULT_WORK_STYLE.outputStyle,
    );
  });

  it("merges partial override into LEADER_WORK_STYLE for leader", () => {
    const role = new Role(
      buildLeaderConfig({
        defaultWorkStyle: { riskTolerance: "aggressive" },
      }),
    );
    expect(role.defaultWorkStyle.riskTolerance).toBe("aggressive");
    // Other fields come from LEADER_WORK_STYLE
    expect(role.defaultWorkStyle.thinkingDepth).toBe(
      LEADER_WORK_STYLE.thinkingDepth,
    );
  });
});

// ==================== getAllSkills ====================

describe("getAllSkills", () => {
  it("returns core + optional skills combined", () => {
    const role = new Role(buildMemberConfig());
    expect(role.getAllSkills()).toEqual([
      "research",
      "analysis",
      "writing",
      "design",
    ]);
  });

  it("returns only core skills when no optional skills", () => {
    const config = buildMemberConfig();
    delete config.optionalSkills;
    const role = new Role(config);
    expect(role.getAllSkills()).toEqual(["research", "analysis"]);
  });
});

// ==================== getAllTools ====================

describe("getAllTools", () => {
  it("returns core + optional tools combined", () => {
    const role = new Role(buildMemberConfig());
    expect(role.getAllTools()).toEqual([
      "web-search",
      "calculator",
      "pdf-reader",
    ]);
  });

  it("returns only core tools when no optional tools", () => {
    const config = buildMemberConfig();
    delete config.optionalTools;
    const role = new Role(config);
    expect(role.getAllTools()).toEqual(["web-search", "calculator"]);
  });
});

// ==================== hasSkill ====================

describe("hasSkill", () => {
  it("returns true for a core skill", () => {
    const role = new Role(buildMemberConfig());
    expect(role.hasSkill("research")).toBe(true);
  });

  it("returns true for an optional skill", () => {
    const role = new Role(buildMemberConfig());
    expect(role.hasSkill("writing")).toBe(true);
  });

  it("returns false for a skill not in the role", () => {
    const role = new Role(buildMemberConfig());
    expect(role.hasSkill("coding")).toBe(false);
  });
});

// ==================== hasTool ====================

describe("hasTool", () => {
  it("returns true for a core tool", () => {
    const role = new Role(buildMemberConfig());
    expect(role.hasTool("web-search")).toBe(true);
  });

  it("returns true for an optional tool", () => {
    const role = new Role(buildMemberConfig());
    expect(role.hasTool("pdf-reader")).toBe(true);
  });

  it("returns false for a tool not in the role", () => {
    const role = new Role(buildMemberConfig());
    expect(role.hasTool("image-generator")).toBe(false);
  });
});

// ==================== generateSystemPrompt ====================

describe("generateSystemPrompt", () => {
  it("replaces {{role_name}} with the role name", () => {
    const role = new Role(buildMemberConfig());
    const prompt = role.generateSystemPrompt();
    expect(prompt).toContain("Test Member");
    expect(prompt).not.toContain("{{role_name}}");
  });

  it("replaces {{role_description}} with the role description", () => {
    const role = new Role(buildMemberConfig());
    const prompt = role.generateSystemPrompt();
    expect(prompt).toContain("A test member role");
    expect(prompt).not.toContain("{{role_description}}");
  });

  it("replaces {{responsibilities}} with formatted responsibility list", () => {
    const role = new Role(buildMemberConfig());
    const prompt = role.generateSystemPrompt();
    expect(prompt).toContain("- Conduct research");
    expect(prompt).toContain("- Write reports");
    expect(prompt).not.toContain("{{responsibilities}}");
  });

  it("replaces {{limitations}} with formatted limitation list", () => {
    const role = new Role(buildMemberConfig());
    const prompt = role.generateSystemPrompt();
    expect(prompt).toContain("- No direct user interaction");
    expect(prompt).not.toContain("{{limitations}}");
  });

  it("replaces custom context variables", () => {
    const config = buildMemberConfig({
      systemPromptTemplate: "Hello {{role_name}}, today is {{date}}.",
    });
    const role = new Role(config);
    const prompt = role.generateSystemPrompt({ date: "2026-01-01" });
    expect(prompt).toContain("today is 2026-01-01");
    expect(prompt).not.toContain("{{date}}");
  });

  it("context variables override built-in ones when same key", () => {
    const config = buildMemberConfig({
      systemPromptTemplate: "Name: {{role_name}}",
    });
    const role = new Role(config);
    // If context provides role_name, it should override
    const prompt = role.generateSystemPrompt({ role_name: "Override Name" });
    expect(prompt).toContain("Override Name");
  });

  it("replaces all occurrences of a placeholder globally", () => {
    const config = buildMemberConfig({
      systemPromptTemplate: "{{role_name}} is {{role_name}}.",
    });
    const role = new Role(config);
    const prompt = role.generateSystemPrompt();
    expect(prompt).toBe("Test Member is Test Member.");
  });

  it("returns prompt unchanged for template with no placeholders", () => {
    const config = buildMemberConfig({
      systemPromptTemplate: "Static prompt with no variables.",
    });
    const role = new Role(config);
    const prompt = role.generateSystemPrompt();
    expect(prompt).toBe("Static prompt with no variables.");
  });
});

// ==================== toJSON ====================

describe("toJSON", () => {
  it("returns a RoleConfig matching the original config fields", () => {
    const config = buildMemberConfig();
    const role = new Role(config);
    const json = role.toJSON();

    expect(json.id).toBe(config.id);
    expect(json.name).toBe(config.name);
    expect(json.description).toBe(config.description);
    expect(json.type).toBe(config.type);
    expect(json.coreSkills).toEqual(config.coreSkills);
    expect(json.optionalSkills).toEqual(config.optionalSkills);
    expect(json.coreTools).toEqual(config.coreTools);
    expect(json.optionalTools).toEqual(config.optionalTools);
    expect(json.responsibilities).toEqual(config.responsibilities);
    expect(json.limitations).toEqual(config.limitations);
    expect(json.systemPromptTemplate).toBe(config.systemPromptTemplate);
  });

  it("returns the merged defaultWorkStyle (not the raw config partial)", () => {
    const config = buildMemberConfig({
      defaultWorkStyle: { thinkingDepth: "deep" },
    });
    const role = new Role(config);
    const json = role.toJSON();
    // Should be the fully merged work style, not just { thinkingDepth: "deep" }
    expect(json.defaultWorkStyle).toEqual(role.defaultWorkStyle);
    expect(json.defaultWorkStyle?.thinkingDepth).toBe("deep");
  });
});

// ==================== createRole factory ====================

describe("createRole", () => {
  it("returns a Role instance", () => {
    const role = createRole(buildMemberConfig());
    expect(role).toBeInstanceOf(Role);
  });

  it("creates role with the same fields as constructing directly", () => {
    const config = buildMemberConfig();
    const direct = new Role(config);
    const factory = createRole(config);

    expect(factory.id).toBe(direct.id);
    expect(factory.name).toBe(direct.name);
    expect(factory.type).toBe(direct.type);
  });
});
