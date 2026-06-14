/**
 * Tests for prompt-locale.ts
 * Tests the resolveLanguage function and locale data structures
 */

import {
  resolveLanguage,
  AGENT_NAMES,
  RESEARCHER_PERSPECTIVES,
  PLANNER_PROMPTS,
  REFLECTION_PROMPTS,
  REPORT_PROMPTS,
  STEP_COUNT_GUIDE,
  SEARCH_ENHANCE,
  PHASE_MESSAGES,
  ORCHESTRATOR_PROMPTS,
  SEARCH_MESSAGES,
} from "../prompt-locale";

describe("resolveLanguage", () => {
  it('should return en-US for "en-US" input', () => {
    expect(resolveLanguage("en-US")).toBe("en-US");
  });

  it('should return en-US for "en" input', () => {
    expect(resolveLanguage("en")).toBe("en-US");
  });

  it('should return zh-CN for "zh-CN" input', () => {
    expect(resolveLanguage("zh-CN")).toBe("zh-CN");
  });

  it("should return zh-CN for undefined input", () => {
    expect(resolveLanguage(undefined)).toBe("zh-CN");
  });

  it("should return zh-CN for any other language", () => {
    expect(resolveLanguage("fr")).toBe("zh-CN");
    expect(resolveLanguage("ja")).toBe("zh-CN");
    expect(resolveLanguage("")).toBe("zh-CN");
  });
});

describe("AGENT_NAMES", () => {
  it("should have zh-CN and en-US entries", () => {
    expect(AGENT_NAMES["zh-CN"]).toBeDefined();
    expect(AGENT_NAMES["en-US"]).toBeDefined();
  });

  it("should have director in both languages", () => {
    expect(AGENT_NAMES["zh-CN"].director).toBeDefined();
    expect(AGENT_NAMES["en-US"].director).toBe("Research Director");
  });

  it("should have researcher roles in both languages", () => {
    expect(AGENT_NAMES["zh-CN"]["researcher-a"]).toBeDefined();
    expect(AGENT_NAMES["en-US"]["researcher-a"]).toBe("Researcher A");
  });
});

describe("RESEARCHER_PERSPECTIVES", () => {
  it("should have perspectives for both languages", () => {
    expect(RESEARCHER_PERSPECTIVES["zh-CN"]).toBeDefined();
    expect(RESEARCHER_PERSPECTIVES["en-US"]).toBeDefined();
  });

  it("should have A, B, C perspectives", () => {
    expect(RESEARCHER_PERSPECTIVES["zh-CN"].A).toBeDefined();
    expect(RESEARCHER_PERSPECTIVES["zh-CN"].B).toBeDefined();
    expect(RESEARCHER_PERSPECTIVES["zh-CN"].C).toBeDefined();
  });
});

describe("PLANNER_PROMPTS", () => {
  it("should have prompts for both languages", () => {
    expect(PLANNER_PROMPTS["zh-CN"]).toBeDefined();
    expect(PLANNER_PROMPTS["en-US"]).toBeDefined();
  });

  it("should have systemPrompt function", () => {
    const prompt = PLANNER_PROMPTS["zh-CN"].systemPrompt("3-5步", true);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("should have followUpSystemPrompt function", () => {
    const prompt = PLANNER_PROMPTS["zh-CN"].followUpSystemPrompt(
      "3-5步",
      false,
      "之前的上下文",
    );
    expect(typeof prompt).toBe("string");
  });

  it("should have userPrompt function", () => {
    const prompt = PLANNER_PROMPTS["zh-CN"].userPrompt("测试查询");
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("测试查询");
  });

  it("should have defaultRationale with required fields", () => {
    expect(PLANNER_PROMPTS["zh-CN"].defaultRationale.initial).toBeDefined();
    expect(PLANNER_PROMPTS["zh-CN"].defaultRationale.deepDive).toBeDefined();
    expect(PLANNER_PROMPTS["zh-CN"].defaultRationale.academic).toBeDefined();
  });
});

describe("REFLECTION_PROMPTS", () => {
  it("should have prompts for both languages", () => {
    expect(REFLECTION_PROMPTS["zh-CN"]).toBeDefined();
    expect(REFLECTION_PROMPTS["en-US"]).toBeDefined();
  });

  it("should have systemPrompt string", () => {
    expect(typeof REFLECTION_PROMPTS["zh-CN"].systemPrompt).toBe("string");
  });

  it("should have resultsSummaryTemplate function", () => {
    const summary = REFLECTION_PROMPTS["zh-CN"].resultsSummaryTemplate(
      10,
      3,
      "domain1, domain2",
      "- source1\n- source2",
    );
    expect(typeof summary).toBe("string");
  });
});

describe("REPORT_PROMPTS", () => {
  it("should have prompts for both languages", () => {
    expect(REPORT_PROMPTS["zh-CN"]).toBeDefined();
    expect(REPORT_PROMPTS["en-US"]).toBeDefined();
  });

  it("should have sectionTopicsSystem prompt", () => {
    expect(typeof REPORT_PROMPTS["zh-CN"].sectionTopicsSystem).toBe("string");
  });

  it("should have fallbackSectionTopics function", () => {
    const topics = REPORT_PROMPTS["zh-CN"].fallbackSectionTopics("AI测试");
    expect(Array.isArray(topics)).toBe(true);
    expect(topics.length).toBeGreaterThan(0);
  });
});

describe("STEP_COUNT_GUIDE", () => {
  it("should have step guides for both languages", () => {
    expect(STEP_COUNT_GUIDE["zh-CN"]).toBeDefined();
    expect(STEP_COUNT_GUIDE["en-US"]).toBeDefined();
  });

  it("should have quick, standard, thorough entries", () => {
    expect(STEP_COUNT_GUIDE["zh-CN"].quick).toBeDefined();
    expect(STEP_COUNT_GUIDE["zh-CN"].standard).toBeDefined();
    expect(STEP_COUNT_GUIDE["zh-CN"].thorough).toBeDefined();
  });
});

describe("SEARCH_ENHANCE", () => {
  it("should have entries for both languages", () => {
    expect(SEARCH_ENHANCE["zh-CN"]).toBeDefined();
    expect(SEARCH_ENHANCE["en-US"]).toBeDefined();
  });

  it("should have detailedAnalysis field", () => {
    expect(SEARCH_ENHANCE["zh-CN"].detailedAnalysis).toBeDefined();
    expect(typeof SEARCH_ENHANCE["zh-CN"].detailedAnalysis).toBe("string");
  });

  it("should have latest function", () => {
    const result = SEARCH_ENHANCE["zh-CN"].latest(2025);
    expect(typeof result).toBe("string");
  });
});

describe("PHASE_MESSAGES", () => {
  it("should have messages for both languages", () => {
    expect(PHASE_MESSAGES["zh-CN"]).toBeDefined();
    expect(PHASE_MESSAGES["en-US"]).toBeDefined();
  });

  it("should have ideation, execution, findings, synthesis fields", () => {
    expect(PHASE_MESSAGES["zh-CN"].ideation).toBeDefined();
    expect(PHASE_MESSAGES["zh-CN"].execution).toBeDefined();
    expect(PHASE_MESSAGES["zh-CN"].findings).toBeDefined();
    expect(PHASE_MESSAGES["zh-CN"].synthesis).toBeDefined();
  });
});

describe("ORCHESTRATOR_PROMPTS", () => {
  it("should have prompts for both languages", () => {
    expect(ORCHESTRATOR_PROMPTS["zh-CN"]).toBeDefined();
    expect(ORCHESTRATOR_PROMPTS["en-US"]).toBeDefined();
  });

  it("should have directorOpener function", () => {
    const prompt = ORCHESTRATOR_PROMPTS["zh-CN"].directorOpener("测试主题");
    expect(typeof prompt).toBe("string");
  });

  it("should have fallbackDirectionCore function", () => {
    const dir = ORCHESTRATOR_PROMPTS["zh-CN"].fallbackDirectionCore("测试");
    expect(dir).toHaveProperty("title");
    expect(dir).toHaveProperty("description");
  });
});

describe("SEARCH_MESSAGES", () => {
  it("should have messages for both languages", () => {
    expect(SEARCH_MESSAGES["zh-CN"]).toBeDefined();
    expect(SEARCH_MESSAGES["en-US"]).toBeDefined();
  });

  it("should have searchProgress function", () => {
    const msg = SEARCH_MESSAGES["zh-CN"].searchProgress("研究员A", "测试查询");
    expect(typeof msg).toBe("string");
  });

  it("should have searchComplete function", () => {
    const msg = SEARCH_MESSAGES["zh-CN"].searchComplete("研究员A", 5);
    expect(typeof msg).toBe("string");
  });
});
