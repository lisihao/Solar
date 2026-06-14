/**
 * Tests for research-team.config.ts
 */

import {
  RESEARCH_TEAM_CONFIG,
  RESEARCH_WORKFLOW,
  createResearchTeamConfig,
} from "../teams/research-team.config";

jest.mock("@/modules/ai-harness/facade", () => ({
  BUILTIN_ROLES: {
    RESEARCHER: "researcher",
    ANALYST: "analyst",
    WRITER: "writer",
    REVIEWER: "reviewer",
  },
  BUILTIN_TOOLS: {
    WEB_SEARCH: "web-search",
    WEB_SCRAPER: "web-scraper",
    RAG_SEARCH: "rag-search",
    DATA_ANALYSIS: "data-analysis",
    TEXT_GENERATION: "text-generation",
    EXPORT_DOCX: "export-docx",
    EXPORT_PDF: "export-pdf",
  },
  createConstraintProfile: jest.fn((_preset: string, _overrides?: object) => ({
    preset: _preset,
    overrides: _overrides,
  })),
}));

describe("RESEARCH_WORKFLOW", () => {
  it("should have required fields", () => {
    expect(RESEARCH_WORKFLOW.id).toBe("research-workflow");
    expect(RESEARCH_WORKFLOW.name).toBeDefined();
    expect(RESEARCH_WORKFLOW.type).toBe("hybrid");
    expect(Array.isArray(RESEARCH_WORKFLOW.steps)).toBe(true);
  });

  it("should have multiple workflow steps", () => {
    expect(RESEARCH_WORKFLOW.steps.length).toBeGreaterThan(3);
  });

  it("should have a framework step with no dependencies", () => {
    const frameworkStep = RESEARCH_WORKFLOW.steps.find(
      (s) => s.id === "framework",
    );
    expect(frameworkStep).toBeDefined();
    expect(frameworkStep!.dependsOn).toEqual([]);
  });

  it("should have a review step", () => {
    const reviewStep = RESEARCH_WORKFLOW.steps.find((s) => s.type === "review");
    expect(reviewStep).toBeDefined();
    expect(reviewStep!.reviewConfig).toBeDefined();
  });

  it("should have parallel info-gathering steps", () => {
    const parallelSteps = RESEARCH_WORKFLOW.steps.filter(
      (s) => s.parallel === true,
    );
    expect(parallelSteps.length).toBeGreaterThan(0);
  });

  it("should have a timeout set", () => {
    expect(RESEARCH_WORKFLOW.timeout).toBeGreaterThan(0);
  });
});

describe("RESEARCH_TEAM_CONFIG", () => {
  it("should have required fields", () => {
    expect(RESEARCH_TEAM_CONFIG.id).toBeDefined();
    expect(RESEARCH_TEAM_CONFIG.name).toBeDefined();
    expect(RESEARCH_TEAM_CONFIG.type).toBe("predefined");
  });

  it("should have member roles defined", () => {
    expect(Array.isArray(RESEARCH_TEAM_CONFIG.memberRoles)).toBe(true);
    expect(RESEARCH_TEAM_CONFIG.memberRoles.length).toBeGreaterThan(0);
  });

  it("should have available tools", () => {
    expect(Array.isArray(RESEARCH_TEAM_CONFIG.availableTools)).toBe(true);
    expect(RESEARCH_TEAM_CONFIG.availableTools.length).toBeGreaterThan(0);
  });

  it("should have available skills", () => {
    expect(Array.isArray(RESEARCH_TEAM_CONFIG.availableSkills)).toBe(true);
    expect(RESEARCH_TEAM_CONFIG.availableSkills.length).toBeGreaterThan(0);
  });

  it("should have a workflow attached", () => {
    expect(RESEARCH_TEAM_CONFIG.workflow).toBeDefined();
  });

  it("should have deliverable types", () => {
    expect(Array.isArray(RESEARCH_TEAM_CONFIG.deliverableTypes)).toBe(true);
  });
});

describe("createResearchTeamConfig", () => {
  it("should return the base config when no overrides", () => {
    const config = createResearchTeamConfig();
    expect(config.id).toBe(RESEARCH_TEAM_CONFIG.id);
    expect(config.name).toBe(RESEARCH_TEAM_CONFIG.name);
  });

  it("should apply overrides correctly", () => {
    const override = { name: "Custom Research Team" };
    const config = createResearchTeamConfig(override);
    expect(config.name).toBe("Custom Research Team");
    expect(config.id).toBe(RESEARCH_TEAM_CONFIG.id);
  });

  it("should allow overriding the id", () => {
    const config = createResearchTeamConfig({ id: "custom-research" });
    expect(config.id).toBe("custom-research");
  });

  it("should preserve other fields when overriding name", () => {
    const config = createResearchTeamConfig({ name: "New Name" });
    expect(config.workflow).toBeDefined();
    expect(config.memberRoles).toBeDefined();
  });
});
