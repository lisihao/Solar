/**
 * Report Writing Standards — Getter Functions Tests
 *
 * Verifies language-aware resolution and content composition of getter functions.
 */

import {
  getWritingStandards,
  getDimensionResearchStandards,
  getExecutiveSummaryFormat,
  getQualityChecklist,
  HEADING_HIERARCHY,
  HEADING_HIERARCHY_EN,
  NARRATIVE_STRUCTURE,
  NARRATIVE_STRUCTURE_EN,
  PROFESSIONAL_TONE,
  PROFESSIONAL_TONE_EN,
  FORMATTING_LIMITS,
  FORMATTING_LIMITS_EN,
  DIMENSION_OPENING_CONCLUSION,
  DIMENSION_OPENING_CONCLUSION_EN,
  ANALYSIS_DEPTH,
  ANALYSIS_DEPTH_EN,
  CITATION_STANDARDS,
  CITATION_STANDARDS_EN,
  CHART_STANDARDS,
  CHART_STANDARDS_EN,
  TABLE_STANDARDS,
  TABLE_STANDARDS_EN,
  EXECUTIVE_SUMMARY_FORMAT,
  EXECUTIVE_SUMMARY_FORMAT_EN,
  QUALITY_CHECKLIST,
  QUALITY_CHECKLIST_EN,
} from "../report-writing-standards.constants";

// ============================================================
// getWritingStandards
// ============================================================

describe("getWritingStandards", () => {
  it("should return Chinese standards by default", () => {
    const result = getWritingStandards();
    expect(result).toContain(HEADING_HIERARCHY);
    expect(result).toContain(NARRATIVE_STRUCTURE);
    expect(result).toContain(PROFESSIONAL_TONE);
    expect(result).toContain(FORMATTING_LIMITS);
    expect(result).toContain(DIMENSION_OPENING_CONCLUSION);
  });

  it("should return Chinese standards for zh", () => {
    const result = getWritingStandards("zh");
    expect(result).toContain("标题层级规范");
    expect(result).toContain("叙事结构规范");
    expect(result).not.toContain("Heading Hierarchy");
  });

  it("should return English standards for en", () => {
    const result = getWritingStandards("en");
    expect(result).toContain(HEADING_HIERARCHY_EN);
    expect(result).toContain(NARRATIVE_STRUCTURE_EN);
    expect(result).toContain(PROFESSIONAL_TONE_EN);
    expect(result).toContain(FORMATTING_LIMITS_EN);
    expect(result).toContain(DIMENSION_OPENING_CONCLUSION_EN);
  });

  it("should return English standards for en-US prefix", () => {
    const result = getWritingStandards("en-US");
    expect(result).toContain("Heading Hierarchy");
  });

  it("should NOT include analysis depth or citation standards", () => {
    const result = getWritingStandards("zh");
    expect(result).not.toContain(ANALYSIS_DEPTH);
    expect(result).not.toContain(CITATION_STANDARDS);
    expect(result).not.toContain(CHART_STANDARDS);
    expect(result).not.toContain(TABLE_STANDARDS);
  });
});

// ============================================================
// getDimensionResearchStandards
// ============================================================

describe("getDimensionResearchStandards", () => {
  it("should return Chinese research standards by default", () => {
    const result = getDimensionResearchStandards();
    expect(result).toContain(ANALYSIS_DEPTH);
    expect(result).toContain(CITATION_STANDARDS);
    expect(result).toContain(CHART_STANDARDS);
    expect(result).toContain(TABLE_STANDARDS);
  });

  it("should return English research standards for en", () => {
    const result = getDimensionResearchStandards("en");
    expect(result).toContain(ANALYSIS_DEPTH_EN);
    expect(result).toContain(CITATION_STANDARDS_EN);
    expect(result).toContain(CHART_STANDARDS_EN);
    expect(result).toContain(TABLE_STANDARDS_EN);
  });

  it("should NOT include writing standards (heading, tone, etc.)", () => {
    const result = getDimensionResearchStandards("zh");
    expect(result).not.toContain(HEADING_HIERARCHY);
    expect(result).not.toContain(PROFESSIONAL_TONE);
    expect(result).not.toContain(DIMENSION_OPENING_CONCLUSION);
  });

  it("should contain analysis depth keywords", () => {
    const zh = getDimensionResearchStandards("zh");
    expect(zh).toContain("分析深度要求");
    expect(zh).toContain("引用规范");
    expect(zh).toContain("图表规范");
    expect(zh).toContain("表格规范");

    const en = getDimensionResearchStandards("en");
    expect(en).toContain("Analysis Depth");
    expect(en).toContain("Citation Standards");
    expect(en).toContain("Chart Standards");
    expect(en).toContain("Table Standards");
  });
});

// ============================================================
// getExecutiveSummaryFormat
// ============================================================

describe("getExecutiveSummaryFormat", () => {
  it("should return Chinese format by default", () => {
    const result = getExecutiveSummaryFormat();
    expect(result).toBe(EXECUTIVE_SUMMARY_FORMAT);
    expect(result).toContain("McKinsey SCR");
  });

  it("should return English format for en", () => {
    const result = getExecutiveSummaryFormat("en");
    expect(result).toBe(EXECUTIVE_SUMMARY_FORMAT_EN);
  });
});

// ============================================================
// getQualityChecklist
// ============================================================

describe("getQualityChecklist", () => {
  it("should return Chinese checklist by default", () => {
    const result = getQualityChecklist();
    expect(result).toBe(QUALITY_CHECKLIST);
    expect(result).toContain("输出前自检");
  });

  it("should return English checklist for en", () => {
    const result = getQualityChecklist("en");
    expect(result).toBe(QUALITY_CHECKLIST_EN);
    expect(result).toContain("Pre-Output Self-Check");
  });

  it("should return Chinese for zh-CN and zh-TW", () => {
    expect(getQualityChecklist("zh-CN")).toBe(QUALITY_CHECKLIST);
    expect(getQualityChecklist("zh-TW")).toBe(QUALITY_CHECKLIST);
  });
});

