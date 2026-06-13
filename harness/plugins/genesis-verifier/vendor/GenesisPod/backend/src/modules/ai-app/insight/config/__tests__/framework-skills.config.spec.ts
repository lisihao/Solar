/**
 * Framework Skills Configuration Unit Tests
 *
 * Coverage:
 * - resolveFrameworkSkills: 主类型映射、EVENT 子类型叠加、未知类型兜底
 * - detectEventSubType: 关键词匹配、中英文、无匹配返回 undefined
 * - DEBATE_SKILLS_BY_TOPIC_TYPE: 类型→辩论技能映射存在性
 * - RECOMMENDED_DEPTH_BY_TOPIC_TYPE: 类型→深度推荐存在性
 */

import {
  resolveFrameworkSkills,
  detectEventSubType,
  FRAMEWORK_SKILLS_BY_TOPIC_TYPE,
  EVENT_SUBTYPE_SKILLS,
  DEBATE_SKILLS_BY_TOPIC_TYPE,
  RECOMMENDED_DEPTH_BY_TOPIC_TYPE,
} from "../framework-skills.config";

describe("framework-skills.config", () => {
  // ===========================================================================
  // resolveFrameworkSkills
  // ===========================================================================

  describe("resolveFrameworkSkills", () => {
    it("should return macro-analysis for MACRO type", () => {
      const skills = resolveFrameworkSkills("MACRO");
      expect(skills).toEqual(["macro-analysis"]);
    });

    it("should return technology-analysis for TECHNOLOGY type", () => {
      const skills = resolveFrameworkSkills("TECHNOLOGY");
      expect(skills).toEqual(["technology-analysis"]);
    });

    it("should return company-analysis for COMPANY type", () => {
      const skills = resolveFrameworkSkills("COMPANY");
      expect(skills).toEqual(["company-analysis"]);
    });

    it("should return event-analysis for EVENT type without subtype", () => {
      const skills = resolveFrameworkSkills("EVENT");
      expect(skills).toEqual(["event-analysis"]);
    });

    it("should return base + subtype skills for EVENT with subtype", () => {
      const skills = resolveFrameworkSkills("EVENT", "acquisition");
      expect(skills).toEqual(["event-analysis", "event-ma"]);
    });

    it("should return only base skills for EVENT with unknown subtype", () => {
      const skills = resolveFrameworkSkills("EVENT", "unknown_subtype");
      expect(skills).toEqual(["event-analysis"]);
    });

    it("should return empty array for unknown topic type", () => {
      const skills = resolveFrameworkSkills("UNKNOWN_TYPE");
      expect(skills).toEqual([]);
    });

    it("should not add subtype skills for non-EVENT types even if subtype is provided", () => {
      const skills = resolveFrameworkSkills("MACRO", "acquisition");
      expect(skills).toEqual(["macro-analysis"]);
    });

    it("should return correct skills for all EVENT subtypes", () => {
      for (const [subType, expectedSkills] of Object.entries(
        EVENT_SUBTYPE_SKILLS,
      )) {
        const skills = resolveFrameworkSkills("EVENT", subType);
        expect(skills).toEqual(["event-analysis", ...expectedSkills]);
      }
    });
  });

  // ===========================================================================
  // detectEventSubType
  // ===========================================================================

  describe("detectEventSubType", () => {
    it("should detect acquisition from Chinese keywords", () => {
      expect(detectEventSubType("微软收购动视暴雪")).toBe("acquisition");
      expect(detectEventSubType("两家公司合并")).toBe("acquisition");
    });

    it("should detect acquisition from English keywords", () => {
      expect(detectEventSubType("Microsoft Acquisition of Activision")).toBe(
        "acquisition",
      );
      expect(detectEventSubType("Major M&A deal")).toBe("acquisition");
    });

    it("should detect policy", () => {
      expect(detectEventSubType("欧盟新数据保护法规")).toBe("policy");
      expect(detectEventSubType("EU AI Regulation Act")).toBe("policy");
    });

    it("should detect product", () => {
      expect(detectEventSubType("Apple 发布新产品")).toBe("product");
      expect(detectEventSubType("Product Launch Event")).toBe("product");
    });

    it("should detect incident", () => {
      expect(detectEventSubType("数据泄露事故")).toBe("incident");
      expect(detectEventSubType("Security Breach Incident")).toBe("incident");
    });

    it("should detect funding", () => {
      expect(detectEventSubType("公司完成 B 轮融资")).toBe("funding");
      expect(detectEventSubType("IPO filing")).toBe("funding");
    });

    it("should detect geopolitical", () => {
      expect(detectEventSubType("美中贸易关税升级")).toBe("geopolitical");
      expect(detectEventSubType("New Tariff Sanctions")).toBe("geopolitical");
    });

    it("should detect leadership", () => {
      expect(detectEventSubType("CEO 离职")).toBe("leadership");
      expect(detectEventSubType("New CTO Appointment")).toBe("leadership");
    });

    it("should detect tech_breakthrough", () => {
      expect(detectEventSubType("量子计算突破")).toBe("tech_breakthrough");
      expect(detectEventSubType("AI Breakthrough Milestone")).toBe(
        "tech_breakthrough",
      );
    });

    it("should return undefined for unrecognized topics", () => {
      expect(detectEventSubType("普通话题讨论")).toBeUndefined();
      expect(detectEventSubType("General Discussion")).toBeUndefined();
    });

    it("should use description when name has no keywords", () => {
      expect(detectEventSubType("Some Topic", "这涉及一次重大收购交易")).toBe(
        "acquisition",
      );
    });

    it("should handle null/undefined description", () => {
      expect(detectEventSubType("普通话题", null)).toBeUndefined();
      expect(detectEventSubType("普通话题", undefined)).toBeUndefined();
    });
  });

  // ===========================================================================
  // Static mappings validation
  // ===========================================================================

  describe("FRAMEWORK_SKILLS_BY_TOPIC_TYPE", () => {
    it("should have mappings for MACRO, TECHNOLOGY, COMPANY, EVENT", () => {
      expect(FRAMEWORK_SKILLS_BY_TOPIC_TYPE).toHaveProperty("MACRO");
      expect(FRAMEWORK_SKILLS_BY_TOPIC_TYPE).toHaveProperty("TECHNOLOGY");
      expect(FRAMEWORK_SKILLS_BY_TOPIC_TYPE).toHaveProperty("COMPANY");
      expect(FRAMEWORK_SKILLS_BY_TOPIC_TYPE).toHaveProperty("EVENT");
    });

    it("should have non-empty skill arrays for all types", () => {
      for (const skills of Object.values(FRAMEWORK_SKILLS_BY_TOPIC_TYPE)) {
        expect(skills.length).toBeGreaterThan(0);
      }
    });
  });

  describe("DEBATE_SKILLS_BY_TOPIC_TYPE", () => {
    it("should have debate skills for all four types", () => {
      expect(DEBATE_SKILLS_BY_TOPIC_TYPE).toHaveProperty("MACRO");
      expect(DEBATE_SKILLS_BY_TOPIC_TYPE).toHaveProperty("TECHNOLOGY");
      expect(DEBATE_SKILLS_BY_TOPIC_TYPE).toHaveProperty("COMPANY");
      expect(DEBATE_SKILLS_BY_TOPIC_TYPE).toHaveProperty("EVENT");
    });

    it("should include critical-thinking in all debate skill sets", () => {
      for (const skills of Object.values(DEBATE_SKILLS_BY_TOPIC_TYPE)) {
        expect(skills).toContain("critical-thinking");
      }
    });

    it("should include competitive-analysis only for COMPANY", () => {
      expect(DEBATE_SKILLS_BY_TOPIC_TYPE["COMPANY"]).toContain(
        "competitive-analysis",
      );
      expect(DEBATE_SKILLS_BY_TOPIC_TYPE["MACRO"]).not.toContain(
        "competitive-analysis",
      );
      expect(DEBATE_SKILLS_BY_TOPIC_TYPE["TECHNOLOGY"]).not.toContain(
        "competitive-analysis",
      );
    });
  });

  describe("RECOMMENDED_DEPTH_BY_TOPIC_TYPE", () => {
    it("should recommend thorough for MACRO and COMPANY", () => {
      expect(RECOMMENDED_DEPTH_BY_TOPIC_TYPE["MACRO"]).toBe("thorough");
      expect(RECOMMENDED_DEPTH_BY_TOPIC_TYPE["COMPANY"]).toBe("thorough");
    });

    it("should recommend standard for TECHNOLOGY", () => {
      expect(RECOMMENDED_DEPTH_BY_TOPIC_TYPE["TECHNOLOGY"]).toBe("standard");
    });

    it("should recommend thorough for EVENT", () => {
      expect(RECOMMENDED_DEPTH_BY_TOPIC_TYPE["EVENT"]).toBe("thorough");
    });
  });
});
