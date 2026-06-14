/**
 * Agent Roles Config Tests
 *
 * Covers AGENT_ROLE_REGISTRY, ROLE_RECOMMENDATIONS_BY_TOPIC_TYPE,
 * ROLE_RECOMMENDATIONS_BY_DEPTH, getAgentRoleDefinition,
 * getAgentSystemPrompt, and recommendRolesForResearch.
 */

import {
  AGENT_ROLE_REGISTRY,
  ROLE_RECOMMENDATIONS_BY_TOPIC_TYPE,
  ROLE_RECOMMENDATIONS_BY_DEPTH,
  getAgentRoleDefinition,
  getAgentSystemPrompt,
  recommendRolesForResearch,
} from "../agent-roles.config";
import {
  SpecializedAgentType,
  AgentCollaborationPattern,
} from "../../types/specialized-agents.types";

describe("AGENT_ROLE_REGISTRY", () => {
  it("should define all SpecializedAgentType entries", () => {
    const expectedTypes = Object.values(SpecializedAgentType);
    for (const type of expectedTypes) {
      expect(AGENT_ROLE_REGISTRY[type]).toBeDefined();
    }
  });

  describe("DIMENSION_RESEARCHER", () => {
    const role = AGENT_ROLE_REGISTRY[SpecializedAgentType.DIMENSION_RESEARCHER];

    it("should have correct type", () => {
      expect(role.type).toBe(SpecializedAgentType.DIMENSION_RESEARCHER);
    });

    it("should have non-empty displayName and description", () => {
      expect(role.displayName).toBeTruthy();
      expect(role.description).toBeTruthy();
    });

    it("should have non-empty systemPrompt", () => {
      expect(role.systemPrompt.length).toBeGreaterThan(10);
    });

    it("should have recommendedTools including web-search", () => {
      expect(role.recommendedTools).toContain("web-search");
    });

    it("should have collaboration patterns with FACT_CHECKER and DOMAIN_EXPERT", () => {
      const withTypes = role.collaborationPatterns.map((p) => p.withRole);
      expect(withTypes).toContain(SpecializedAgentType.FACT_CHECKER);
      expect(withTypes).toContain(SpecializedAgentType.DOMAIN_EXPERT);
    });

    it("should have priority 0", () => {
      expect(role.priority).toBe(0);
    });

    it("should not require domain knowledge", () => {
      expect(role.requiresDomainKnowledge).toBe(false);
    });

    it("should have medium creativity task profile", () => {
      expect(role.taskProfile.creativity).toBe("medium");
      expect(role.taskProfile.outputLength).toBe("long");
    });
  });

  describe("QUALITY_REVIEWER", () => {
    const role = AGENT_ROLE_REGISTRY[SpecializedAgentType.QUALITY_REVIEWER];

    it("should have correct type and priority 4", () => {
      expect(role.type).toBe(SpecializedAgentType.QUALITY_REVIEWER);
      expect(role.priority).toBe(4);
    });

    it("should have low creativity task profile", () => {
      expect(role.taskProfile.creativity).toBe("low");
    });

    it("should have collaboration pattern with DIMENSION_RESEARCHER", () => {
      const withTypes = role.collaborationPatterns.map((p) => p.withRole);
      expect(withTypes).toContain(SpecializedAgentType.DIMENSION_RESEARCHER);
    });

    it("collaboration pattern should be REVIEW", () => {
      const pattern = role.collaborationPatterns.find(
        (p) => p.withRole === SpecializedAgentType.DIMENSION_RESEARCHER,
      );
      expect(pattern?.pattern).toBe(AgentCollaborationPattern.REVIEW);
    });
  });

  describe("REPORT_WRITER", () => {
    const role = AGENT_ROLE_REGISTRY[SpecializedAgentType.REPORT_WRITER];

    it("should have priority 6", () => {
      expect(role.priority).toBe(6);
    });

    it("should collaborate with SYNTHESIZER via SEQUENTIAL pattern", () => {
      const pattern = role.collaborationPatterns.find(
        (p) => p.withRole === SpecializedAgentType.SYNTHESIZER,
      );
      expect(pattern?.pattern).toBe(AgentCollaborationPattern.SEQUENTIAL);
    });

    it("should have empty recommendedTools", () => {
      expect(role.recommendedTools).toHaveLength(0);
    });
  });

  describe("FACT_CHECKER", () => {
    const role = AGENT_ROLE_REGISTRY[SpecializedAgentType.FACT_CHECKER];

    it("should have correct type and priority 2", () => {
      expect(role.type).toBe(SpecializedAgentType.FACT_CHECKER);
      expect(role.priority).toBe(2);
    });

    it("should have cross_reference in recommendedSkills", () => {
      expect(role.recommendedSkills).toContain("cross_reference");
    });

    it("should have collaboration with DEVIL_ADVOCATE via PARALLEL pattern", () => {
      const pattern = role.collaborationPatterns.find(
        (p) => p.withRole === SpecializedAgentType.DEVIL_ADVOCATE,
      );
      expect(pattern?.pattern).toBe(AgentCollaborationPattern.PARALLEL);
    });

    it("should apply to data-intensive scenarios", () => {
      expect(role.applicableScenarios).toContain("数据密集型研究");
    });
  });

  describe("DEVIL_ADVOCATE", () => {
    const role = AGENT_ROLE_REGISTRY[SpecializedAgentType.DEVIL_ADVOCATE];

    it("should have priority 2 and medium creativity", () => {
      expect(role.priority).toBe(2);
      expect(role.taskProfile.creativity).toBe("medium");
    });

    it("should collaborate with DIMENSION_RESEARCHER via DEBATE pattern", () => {
      const pattern = role.collaborationPatterns.find(
        (p) => p.withRole === SpecializedAgentType.DIMENSION_RESEARCHER,
      );
      expect(pattern?.pattern).toBe(AgentCollaborationPattern.DEBATE);
    });

    it("should have bias_detection skill", () => {
      expect(role.recommendedSkills).toContain("bias_detection");
    });
  });

  describe("TREND_ANALYST", () => {
    const role = AGENT_ROLE_REGISTRY[SpecializedAgentType.TREND_ANALYST];

    it("should have priority 3", () => {
      expect(role.priority).toBe(3);
    });

    it("should collaborate with DATA_ANALYST via PARALLEL pattern", () => {
      const pattern = role.collaborationPatterns.find(
        (p) => p.withRole === SpecializedAgentType.DATA_ANALYST,
      );
      expect(pattern?.pattern).toBe(AgentCollaborationPattern.PARALLEL);
    });

    it("should apply to market research and strategic planning scenarios", () => {
      expect(role.applicableScenarios).toContain("市场研究");
      expect(role.applicableScenarios).toContain("战略规划");
    });
  });

  describe("DOMAIN_EXPERT", () => {
    const role = AGENT_ROLE_REGISTRY[SpecializedAgentType.DOMAIN_EXPERT];

    it("should require domain knowledge", () => {
      expect(role.requiresDomainKnowledge).toBe(true);
    });

    it("should have low creativity task profile", () => {
      expect(role.taskProfile.creativity).toBe("low");
    });

    it("should have priority 1", () => {
      expect(role.priority).toBe(1);
    });

    it("should collaborate with TREND_ANALYST via SEQUENTIAL pattern", () => {
      const pattern = role.collaborationPatterns.find(
        (p) => p.withRole === SpecializedAgentType.TREND_ANALYST,
      );
      expect(pattern?.pattern).toBe(AgentCollaborationPattern.SEQUENTIAL);
    });
  });

  describe("SYNTHESIZER", () => {
    const role = AGENT_ROLE_REGISTRY[SpecializedAgentType.SYNTHESIZER];

    it("should have priority 5 and medium creativity", () => {
      expect(role.priority).toBe(5);
      expect(role.taskProfile.creativity).toBe("medium");
    });

    it("should hand off to REPORT_WRITER", () => {
      const pattern = role.collaborationPatterns.find(
        (p) => p.withRole === SpecializedAgentType.REPORT_WRITER,
      );
      expect(pattern?.pattern).toBe(AgentCollaborationPattern.HANDOFF);
    });

    it("should have empty recommendedTools", () => {
      expect(role.recommendedTools).toHaveLength(0);
    });
  });

  describe("DATA_ANALYST", () => {
    const role = AGENT_ROLE_REGISTRY[SpecializedAgentType.DATA_ANALYST];

    it("should have priority 1 and not require domain knowledge", () => {
      expect(role.priority).toBe(1);
      expect(role.requiresDomainKnowledge).toBe(false);
    });

    it("should have data_interpretation skill", () => {
      expect(role.recommendedSkills).toContain("data_interpretation");
    });

    it("should collaborate with TREND_ANALYST via PARALLEL pattern", () => {
      const pattern = role.collaborationPatterns.find(
        (p) => p.withRole === SpecializedAgentType.TREND_ANALYST,
      );
      expect(pattern?.pattern).toBe(AgentCollaborationPattern.PARALLEL);
    });
  });
});

describe("ROLE_RECOMMENDATIONS_BY_TOPIC_TYPE", () => {
  it("should define market_research recommendation including TREND_ANALYST and DATA_ANALYST", () => {
    const roles = ROLE_RECOMMENDATIONS_BY_TOPIC_TYPE["market_research"];
    expect(roles).toContain(SpecializedAgentType.TREND_ANALYST);
    expect(roles).toContain(SpecializedAgentType.DATA_ANALYST);
    expect(roles).toContain(SpecializedAgentType.DIMENSION_RESEARCHER);
    expect(roles).toContain(SpecializedAgentType.QUALITY_REVIEWER);
  });

  it("should define technical_analysis recommendation including DOMAIN_EXPERT and FACT_CHECKER", () => {
    const roles = ROLE_RECOMMENDATIONS_BY_TOPIC_TYPE["technical_analysis"];
    expect(roles).toContain(SpecializedAgentType.DOMAIN_EXPERT);
    expect(roles).toContain(SpecializedAgentType.FACT_CHECKER);
  });

  it("should define academic_research recommendation including DEVIL_ADVOCATE", () => {
    const roles = ROLE_RECOMMENDATIONS_BY_TOPIC_TYPE["academic_research"];
    expect(roles).toContain(SpecializedAgentType.DEVIL_ADVOCATE);
    expect(roles).toContain(SpecializedAgentType.FACT_CHECKER);
    expect(roles).toContain(SpecializedAgentType.DOMAIN_EXPERT);
  });

  it("should define strategic_planning recommendation including SYNTHESIZER", () => {
    const roles = ROLE_RECOMMENDATIONS_BY_TOPIC_TYPE["strategic_planning"];
    expect(roles).toContain(SpecializedAgentType.SYNTHESIZER);
    expect(roles).toContain(SpecializedAgentType.DEVIL_ADVOCATE);
  });

  it("should define competitive_analysis recommendation", () => {
    const roles = ROLE_RECOMMENDATIONS_BY_TOPIC_TYPE["competitive_analysis"];
    expect(roles).toContain(SpecializedAgentType.DATA_ANALYST);
    expect(roles).toContain(SpecializedAgentType.TREND_ANALYST);
  });

  it("should define default recommendation with at least DIMENSION_RESEARCHER and QUALITY_REVIEWER", () => {
    const roles = ROLE_RECOMMENDATIONS_BY_TOPIC_TYPE["default"];
    expect(roles).toContain(SpecializedAgentType.DIMENSION_RESEARCHER);
    expect(roles).toContain(SpecializedAgentType.QUALITY_REVIEWER);
  });
});

describe("ROLE_RECOMMENDATIONS_BY_DEPTH", () => {
  it("quick depth should only include DIMENSION_RESEARCHER", () => {
    expect(ROLE_RECOMMENDATIONS_BY_DEPTH.quick).toEqual([
      SpecializedAgentType.DIMENSION_RESEARCHER,
    ]);
  });

  it("standard depth should include FACT_CHECKER and QUALITY_REVIEWER", () => {
    const roles = ROLE_RECOMMENDATIONS_BY_DEPTH.standard;
    expect(roles).toContain(SpecializedAgentType.FACT_CHECKER);
    expect(roles).toContain(SpecializedAgentType.QUALITY_REVIEWER);
    expect(roles).toContain(SpecializedAgentType.DIMENSION_RESEARCHER);
  });

  it("thorough depth should include all major specialized roles", () => {
    const roles = ROLE_RECOMMENDATIONS_BY_DEPTH.thorough;
    expect(roles).toContain(SpecializedAgentType.DEVIL_ADVOCATE);
    expect(roles).toContain(SpecializedAgentType.DOMAIN_EXPERT);
    expect(roles).toContain(SpecializedAgentType.SYNTHESIZER);
    expect(roles).toContain(SpecializedAgentType.QUALITY_REVIEWER);
  });
});

describe("getAgentRoleDefinition", () => {
  it("should return role definition for a valid type", () => {
    const definition = getAgentRoleDefinition(
      SpecializedAgentType.DIMENSION_RESEARCHER,
    );
    expect(definition).toBeDefined();
    expect(definition?.type).toBe(SpecializedAgentType.DIMENSION_RESEARCHER);
  });

  it("should return role definition for FACT_CHECKER", () => {
    const definition = getAgentRoleDefinition(
      SpecializedAgentType.FACT_CHECKER,
    );
    expect(definition).toBeDefined();
    expect(definition?.type).toBe(SpecializedAgentType.FACT_CHECKER);
  });

  it("should return role definition for SYNTHESIZER", () => {
    const definition = getAgentRoleDefinition(SpecializedAgentType.SYNTHESIZER);
    expect(definition).toBeDefined();
    expect(definition?.displayName).toBe("跨维度整合者");
  });

  it("should return undefined for an unknown type", () => {
    const definition = getAgentRoleDefinition(
      "unknown_type" as SpecializedAgentType,
    );
    expect(definition).toBeUndefined();
  });
});

describe("getAgentSystemPrompt", () => {
  it("should return non-empty system prompt for DIMENSION_RESEARCHER", () => {
    const prompt = getAgentSystemPrompt(
      SpecializedAgentType.DIMENSION_RESEARCHER,
    );
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(10);
  });

  it("should return non-empty system prompt for QUALITY_REVIEWER", () => {
    const prompt = getAgentSystemPrompt(SpecializedAgentType.QUALITY_REVIEWER);
    expect(prompt).toBeTruthy();
  });

  it("should return empty string for unknown type", () => {
    const prompt = getAgentSystemPrompt("unknown_type" as SpecializedAgentType);
    expect(prompt).toBe("");
  });

  it("should include core responsibility keywords for FACT_CHECKER", () => {
    const prompt = getAgentSystemPrompt(SpecializedAgentType.FACT_CHECKER);
    expect(prompt).toContain("验证");
  });

  it("should include trend-related keywords for TREND_ANALYST", () => {
    const prompt = getAgentSystemPrompt(SpecializedAgentType.TREND_ANALYST);
    expect(prompt).toContain("趋势");
  });
});

describe("recommendRolesForResearch", () => {
  it("should merge type roles and depth roles without duplicates", () => {
    const roles = recommendRolesForResearch("market_research", "standard");
    // Result should be a set (no duplicates)
    const unique = new Set(roles);
    expect(unique.size).toBe(roles.length);
  });

  it("should include DIMENSION_RESEARCHER for any combination", () => {
    const roles = recommendRolesForResearch("market_research", "quick");
    expect(roles).toContain(SpecializedAgentType.DIMENSION_RESEARCHER);
  });

  it("should use default topic type for unknown topic type", () => {
    const roles = recommendRolesForResearch("totally_unknown_type", "standard");
    expect(roles).toContain(SpecializedAgentType.DIMENSION_RESEARCHER);
    expect(roles).toContain(SpecializedAgentType.QUALITY_REVIEWER);
  });

  it("should return more roles for thorough depth", () => {
    const quickRoles = recommendRolesForResearch("market_research", "quick");
    const thoroughRoles = recommendRolesForResearch(
      "market_research",
      "thorough",
    );
    expect(thoroughRoles.length).toBeGreaterThan(quickRoles.length);
  });

  it("should be case-insensitive for topic type lookup", () => {
    const rolesLower = recommendRolesForResearch("market_research", "standard");
    const rolesUpper = recommendRolesForResearch("MARKET_RESEARCH", "standard");
    expect(rolesUpper).toEqual(rolesLower);
  });

  it("should include thorough-specific roles for academic_research + thorough", () => {
    const roles = recommendRolesForResearch("academic_research", "thorough");
    expect(roles).toContain(SpecializedAgentType.SYNTHESIZER);
    expect(roles).toContain(SpecializedAgentType.DEVIL_ADVOCATE);
    expect(roles).toContain(SpecializedAgentType.DOMAIN_EXPERT);
  });

  it("should return an array", () => {
    const roles = recommendRolesForResearch("default", "standard");
    expect(Array.isArray(roles)).toBe(true);
  });
});
