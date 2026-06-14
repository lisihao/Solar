# AI Slides v3.1 变量映射技术规格

> **文档类型**: 技术规格文档
> **版本**: v1.0
> **作者**: PM Agent
> **创建日期**: 2025-12-31
> **状态**: 待评审
> **关联PRD**: `ai-slides-visual-upgrade.md`

---

## 一、概述

### 1.1 问题描述

AI Slides v3 的模板系统使用 `{{VARIABLE_NAME}}` 占位符语法，但存在以下问题：

1. **Writer 输出与模板期望不匹配**：AI 生成的内容结构不符合模板变量需求
2. **变量命名不统一**：同类数据在不同模板中使用不同变量名
3. **缺乏验证机制**：无法检测必填变量是否已替换
4. **无降级策略**：变量缺失时直接显示 `{{VAR_NAME}}`

### 1.2 解决方案

建立统一的变量映射系统：

```
AI生成内容 -> ContentExtractor -> 标准化数据结构 -> VariableMapper -> 模板变量
```

---

## 二、模板变量分析

### 2.1 模板分类和变量统计

| 类别       | 数量 | 示例模板         | 典型变量                    |
| ---------- | ---- | ---------------- | --------------------------- |
| Narrative  | 8    | N-001 Cover      | TITLE, SUBTITLE, DATE       |
| Structural | 8    | S-003 3-Pillars  | PILLAR1_TITLE, PILLAR1_DESC |
| Data       | 6    | D-001 Big-Number | NUMBER, LABEL, CHANGE       |
| Content    | 6    | C-003 Key-Points | POINT1, POINT2, POINT3      |
| Action     | 4    | A-001 CTA        | ACTION_TITLE, ACTION_DESC   |

### 2.2 变量类型分析

```typescript
// 变量类型枚举
enum VariableType {
  TITLE = "title", // 标题类：TITLE, SUBTITLE, SECTION_TITLE
  TEXT = "text", // 文本类：DESC, CONTENT, INSIGHT
  NUMBER = "number", // 数字类：NUMBER, VALUE, PERCENTAGE
  LIST_ITEM = "list_item", // 列表项：POINT1, ITEM1
  DATE = "date", // 日期类：DATE, PERIOD
  CHANGE = "change", // 变化值：CHANGE, GROWTH, TREND
  LABEL = "label", // 标签类：LABEL, TAG
  CHART = "chart", // 图表类：CHART_DATA, CHART_SVG
}
```

### 2.3 各模板变量详细清单

#### Narrative Templates (N-001 ~ N-008)

| 模板ID | 模板名称       | 必填变量                      | 可选变量               |
| ------ | -------------- | ----------------------------- | ---------------------- |
| N-001  | Cover          | TITLE, SUBTITLE               | DATE, AUTHOR, ORG_NAME |
| N-002  | TOC            | TITLE, ITEMS                  | SUBTITLE               |
| N-003  | Section-Header | SECTION_TITLE, SECTION_NUMBER | SECTION_DESC           |
| N-004  | Quote          | QUOTE_TEXT, QUOTE_AUTHOR      | AUTHOR_TITLE           |
| N-005  | Story-Intro    | TITLE, STORY_TEXT             | BACKGROUND_IMAGE       |
| N-006  | Transition     | CURRENT_SECTION, NEXT_SECTION | TRANSITION_TEXT        |
| N-007  | Recap          | TITLE, RECAP_POINTS           | INSIGHT                |
| N-008  | Closing        | TITLE, CLOSING_TEXT           | CONTACT, THANK_YOU     |

#### Structural Templates (S-001 ~ S-008)

| 模板ID | 模板名称     | 必填变量                                                                          | 可选变量                  |
| ------ | ------------ | --------------------------------------------------------------------------------- | ------------------------- |
| S-001  | Two-Column   | LEFT_TITLE, LEFT_CONTENT, RIGHT_TITLE, RIGHT_CONTENT                              | TITLE                     |
| S-002  | Comparison   | OPTION_A_TITLE, OPTION_B_TITLE, A_POINTS, B_POINTS                                | TITLE, VERDICT            |
| S-003  | 3-Pillars    | TITLE, P1_TITLE, P1_DESC, P2_TITLE, P2_DESC, P3_TITLE, P3_DESC                    | P1_ICON, P2_ICON, P3_ICON |
| S-004  | 4-Quadrant   | TITLE, Q1_TITLE, Q1_DESC, Q2_TITLE, Q2_DESC, Q3_TITLE, Q3_DESC, Q4_TITLE, Q4_DESC | -                         |
| S-005  | Timeline     | TITLE, EVENTS                                                                     | SUBTITLE                  |
| S-006  | Process-Flow | TITLE, STEPS                                                                      | SUBTITLE                  |
| S-007  | Hierarchy    | TITLE, TOP_ITEM, CHILD_ITEMS                                                      | SUBTITLE                  |
| S-008  | Matrix       | TITLE, ROWS, COLUMNS, CELLS                                                       | SUBTITLE                  |

#### Data Templates (D-001 ~ D-006)

| 模板ID | 模板名称        | 必填变量                                                                                              | 可选变量                                                 |
| ------ | --------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| D-001  | Big-Number      | TITLE, NUMBER, LABEL                                                                                  | CHANGE, DATE                                             |
| D-002  | Dashboard-4KPI  | TITLE, KPI1_VALUE, KPI1_LABEL, KPI2_VALUE, KPI2_LABEL, KPI3_VALUE, KPI3_LABEL, KPI4_VALUE, KPI4_LABEL | KPI1_CHANGE, KPI2_CHANGE, KPI3_CHANGE, KPI4_CHANGE, DATE |
| D-003  | Trend-Chart     | TITLE, CHART_DATA, CURRENT_VALUE                                                                      | MOM_CHANGE, YOY_CHANGE, INSIGHT, PERIOD                  |
| D-004  | Comparison-Dual | TITLE, OPTION_A_TITLE, OPTION_B_TITLE, A_PRO1, B_PRO1                                                 | A_PRO2, A_PRO3, B_PRO2, B_PRO3                           |
| D-005  | Pie-Chart       | TITLE, CHART_DATA                                                                                     | INSIGHT, TOTAL                                           |
| D-006  | Bar-Chart       | TITLE, CHART_DATA                                                                                     | INSIGHT, PERIOD                                          |

#### Content Templates (C-001 ~ C-006)

| 模板ID | 模板名称    | 必填变量                                                                                                             | 可选变量                            |
| ------ | ----------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| C-001  | Text-Block  | TITLE, CONTENT                                                                                                       | SUBTITLE                            |
| C-002  | Image-Text  | TITLE, CONTENT, IMAGE_URL                                                                                            | IMAGE_CAPTION                       |
| C-003  | Key-Points  | TITLE, POINT1, POINT2, POINT3                                                                                        | POINT4, POINT5                      |
| C-004  | Bullet-List | TITLE, ITEMS                                                                                                         | SUBTITLE                            |
| C-005  | Icon-Grid   | TITLE, ITEM1_ICON, ITEM1_TITLE, ITEM1_DESC, ITEM2_ICON, ITEM2_TITLE, ITEM2_DESC, ITEM3_ICON, ITEM3_TITLE, ITEM3_DESC | ITEM4_ICON, ITEM4_TITLE, ITEM4_DESC |
| C-006  | Card-List   | TITLE, CARD1_TITLE, CARD1_DESC, CARD2_TITLE, CARD2_DESC                                                              | CARD3_TITLE, CARD3_DESC             |

#### Action Templates (A-001 ~ A-004)

| 模板ID | 模板名称        | 必填变量                                                                        | 可选变量                            |
| ------ | --------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| A-001  | CTA             | TITLE, ACTION_TEXT, ACTION_DESC                                                 | BUTTON_TEXT                         |
| A-002  | Next-Steps      | TITLE, STEP1, STEP2, STEP3                                                      | STEP4, STEP5                        |
| A-003  | Key-Conclusions | TITLE, CONCLUSION1_TITLE, CONCLUSION1_DESC, CONCLUSION2_TITLE, CONCLUSION2_DESC | CONCLUSION3_TITLE, CONCLUSION3_DESC |
| A-004  | Recommendations | TITLE, REC1, REC2, REC3                                                         | REC4, REC5                          |

---

## 三、数据结构设计

### 3.1 标准化内容结构

```typescript
/**
 * AI生成的内容首先转换为此标准结构
 */
interface StandardizedContent {
  // 页面基本信息
  title: string;
  subtitle?: string;

  // 主要内容区块
  sections: ContentSection[];

  // 数据点（用于数据型模板）
  dataPoints?: DataPoint[];

  // 图表数据
  chartData?: ChartData;

  // 元数据
  metadata?: {
    date?: string;
    author?: string;
    source?: string;
    period?: string;
  };
}

interface ContentSection {
  title?: string;
  content?: string;
  points?: string[]; // 要点列表
  icon?: string; // 图标名称
}

interface DataPoint {
  label: string;
  value: string | number;
  unit?: string;
  change?: string;
  trend?: "up" | "down" | "stable";
}

interface ChartData {
  type: "line" | "bar" | "pie" | "radar";
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    color?: string;
  }[];
}
```

### 3.2 变量映射配置

```typescript
/**
 * 模板变量映射配置
 */
interface TemplateVariableMapping {
  templateId: string;
  templateName: string;
  templateType: string;

  // 必填变量列表
  required: string[];

  // 可选变量列表
  optional: string[];

  // 变量提取器：从StandardizedContent提取变量值
  extractors: Record<string, (content: StandardizedContent) => string>;

  // 默认值：当提取失败时使用
  fallbacks: Record<string, string>;

  // 验证规则
  validators?: Record<string, (value: string) => boolean>;
}
```

### 3.3 完整映射表结构

```typescript
// variable-mapping.ts

export const TEMPLATE_VARIABLE_MAPPINGS: Record<
  string,
  TemplateVariableMapping
> = {
  // ============================================================================
  // Narrative Templates
  // ============================================================================

  "N-001": {
    templateId: "N-001",
    templateName: "Cover",
    templateType: "cover",
    required: ["TITLE", "SUBTITLE"],
    optional: ["DATE", "AUTHOR", "ORG_NAME"],
    extractors: {
      TITLE: (c) => c.title,
      SUBTITLE: (c) => c.subtitle || "",
      DATE: (c) => c.metadata?.date || new Date().toLocaleDateString("zh-CN"),
      AUTHOR: (c) => c.metadata?.author || "",
      ORG_NAME: (c) => "GenesisPod",
    },
    fallbacks: {
      SUBTITLE: "专业分析报告",
      DATE: new Date().toLocaleDateString("zh-CN"),
    },
  },

  "N-003": {
    templateId: "N-003",
    templateName: "Section-Header",
    templateType: "section-header",
    required: ["SECTION_TITLE", "SECTION_NUMBER"],
    optional: ["SECTION_DESC"],
    extractors: {
      SECTION_TITLE: (c) => c.title,
      SECTION_NUMBER: (c) => c.metadata?.["sectionNumber"] || "01",
      SECTION_DESC: (c) => c.subtitle || "",
    },
    fallbacks: {
      SECTION_NUMBER: "01",
      SECTION_DESC: "",
    },
  },

  // ============================================================================
  // Structural Templates
  // ============================================================================

  "S-003": {
    templateId: "S-003",
    templateName: "3-Pillars",
    templateType: "framework",
    required: [
      "TITLE",
      "P1_TITLE",
      "P1_DESC",
      "P2_TITLE",
      "P2_DESC",
      "P3_TITLE",
      "P3_DESC",
    ],
    optional: ["P1_ICON", "P2_ICON", "P3_ICON"],
    extractors: {
      TITLE: (c) => c.title,
      P1_TITLE: (c) => c.sections[0]?.title || "要点一",
      P1_DESC: (c) =>
        c.sections[0]?.content || c.sections[0]?.points?.[0] || "",
      P2_TITLE: (c) => c.sections[1]?.title || "要点二",
      P2_DESC: (c) =>
        c.sections[1]?.content || c.sections[1]?.points?.[0] || "",
      P3_TITLE: (c) => c.sections[2]?.title || "要点三",
      P3_DESC: (c) =>
        c.sections[2]?.content || c.sections[2]?.points?.[0] || "",
      P1_ICON: (c) => c.sections[0]?.icon || "star",
      P2_ICON: (c) => c.sections[1]?.icon || "chart",
      P3_ICON: (c) => c.sections[2]?.icon || "target",
    },
    fallbacks: {
      P1_TITLE: "核心优势",
      P2_TITLE: "关键能力",
      P3_TITLE: "未来展望",
    },
  },

  // ============================================================================
  // Data Templates
  // ============================================================================

  "D-001": {
    templateId: "D-001",
    templateName: "Big-Number",
    templateType: "dashboard",
    required: ["TITLE", "NUMBER", "LABEL"],
    optional: ["CHANGE", "DATE"],
    extractors: {
      TITLE: (c) => c.title,
      NUMBER: (c) => {
        const dp = c.dataPoints?.[0];
        return dp ? String(dp.value) : "0";
      },
      LABEL: (c) => {
        const dp = c.dataPoints?.[0];
        return dp?.label || "关键指标";
      },
      CHANGE: (c) => {
        const dp = c.dataPoints?.[0];
        return dp?.change || "+0%";
      },
      DATE: (c) => c.metadata?.date || new Date().toLocaleDateString("zh-CN"),
    },
    fallbacks: {
      NUMBER: "100",
      LABEL: "核心指标",
      CHANGE: "+10%",
    },
    validators: {
      NUMBER: (v) => /^[\d,\.]+[%万亿]?$/.test(v),
      CHANGE: (v) => /^[+-]?\d+(\.\d+)?%?$/.test(v),
    },
  },

  "D-002": {
    templateId: "D-002",
    templateName: "Dashboard-4KPI",
    templateType: "dashboard",
    required: [
      "TITLE",
      "KPI1_VALUE",
      "KPI1_LABEL",
      "KPI2_VALUE",
      "KPI2_LABEL",
      "KPI3_VALUE",
      "KPI3_LABEL",
      "KPI4_VALUE",
      "KPI4_LABEL",
    ],
    optional: [
      "KPI1_CHANGE",
      "KPI2_CHANGE",
      "KPI3_CHANGE",
      "KPI4_CHANGE",
      "DATE",
    ],
    extractors: {
      TITLE: (c) => c.title,
      KPI1_VALUE: (c) => String(c.dataPoints?.[0]?.value || "0"),
      KPI1_LABEL: (c) => c.dataPoints?.[0]?.label || "指标1",
      KPI1_CHANGE: (c) => c.dataPoints?.[0]?.change || "+0%",
      KPI2_VALUE: (c) => String(c.dataPoints?.[1]?.value || "0"),
      KPI2_LABEL: (c) => c.dataPoints?.[1]?.label || "指标2",
      KPI2_CHANGE: (c) => c.dataPoints?.[1]?.change || "+0%",
      KPI3_VALUE: (c) => String(c.dataPoints?.[2]?.value || "0"),
      KPI3_LABEL: (c) => c.dataPoints?.[2]?.label || "指标3",
      KPI3_CHANGE: (c) => c.dataPoints?.[2]?.change || "+0%",
      KPI4_VALUE: (c) => String(c.dataPoints?.[3]?.value || "0"),
      KPI4_LABEL: (c) => c.dataPoints?.[3]?.label || "指标4",
      KPI4_CHANGE: (c) => c.dataPoints?.[3]?.change || "+0%",
      DATE: (c) => c.metadata?.date || new Date().toLocaleDateString("zh-CN"),
    },
    fallbacks: {
      KPI1_CHANGE: "+10%",
      KPI2_CHANGE: "+8%",
      KPI3_CHANGE: "+15%",
      KPI4_CHANGE: "+12%",
    },
  },

  "D-003": {
    templateId: "D-003",
    templateName: "Trend-Chart",
    templateType: "dashboard",
    required: ["TITLE", "CHART_DATA", "CURRENT_VALUE"],
    optional: ["MOM_CHANGE", "YOY_CHANGE", "INSIGHT", "PERIOD"],
    extractors: {
      TITLE: (c) => c.title,
      CHART_DATA: (c) => JSON.stringify(c.chartData || {}),
      CURRENT_VALUE: (c) => {
        const dp = c.dataPoints?.[0];
        return dp ? String(dp.value) : "0";
      },
      MOM_CHANGE: (c) =>
        c.dataPoints?.find((dp) => dp.label.includes("环比"))?.change || "+0%",
      YOY_CHANGE: (c) =>
        c.dataPoints?.find((dp) => dp.label.includes("同比"))?.change || "+0%",
      INSIGHT: (c) => c.sections?.[0]?.content || "数据分析洞察",
      PERIOD: (c) => c.metadata?.period || "2024年",
    },
    fallbacks: {
      CHART_DATA: "{}",
      CURRENT_VALUE: "0",
      MOM_CHANGE: "+5%",
      YOY_CHANGE: "+10%",
    },
  },

  // ============================================================================
  // Content Templates
  // ============================================================================

  "C-003": {
    templateId: "C-003",
    templateName: "Key-Points",
    templateType: "content",
    required: ["TITLE", "POINT1", "POINT2", "POINT3"],
    optional: ["POINT4", "POINT5"],
    extractors: {
      TITLE: (c) => c.title,
      POINT1: (c) => c.sections[0]?.points?.[0] || c.sections[0]?.content || "",
      POINT2: (c) => c.sections[0]?.points?.[1] || c.sections[1]?.content || "",
      POINT3: (c) => c.sections[0]?.points?.[2] || c.sections[2]?.content || "",
      POINT4: (c) => c.sections[0]?.points?.[3] || "",
      POINT5: (c) => c.sections[0]?.points?.[4] || "",
    },
    fallbacks: {
      POINT1: "核心要点一",
      POINT2: "核心要点二",
      POINT3: "核心要点三",
    },
  },

  // ============================================================================
  // Action Templates
  // ============================================================================

  "A-003": {
    templateId: "A-003",
    templateName: "Key-Conclusions",
    templateType: "closing",
    required: [
      "TITLE",
      "CONCLUSION1_TITLE",
      "CONCLUSION1_DESC",
      "CONCLUSION2_TITLE",
      "CONCLUSION2_DESC",
    ],
    optional: ["CONCLUSION3_TITLE", "CONCLUSION3_DESC"],
    extractors: {
      TITLE: (c) => c.title || "核心结论",
      CONCLUSION1_TITLE: (c) => c.sections[0]?.title || "结论一",
      CONCLUSION1_DESC: (c) => c.sections[0]?.content || "",
      CONCLUSION2_TITLE: (c) => c.sections[1]?.title || "结论二",
      CONCLUSION2_DESC: (c) => c.sections[1]?.content || "",
      CONCLUSION3_TITLE: (c) => c.sections[2]?.title || "",
      CONCLUSION3_DESC: (c) => c.sections[2]?.content || "",
    },
    fallbacks: {
      CONCLUSION1_TITLE: "关键发现",
      CONCLUSION2_TITLE: "核心建议",
    },
  },

  // ... 其他模板映射配置
};
```

---

## 四、实现方案

### 4.1 VariableMapperSkill 类

```typescript
// variable-mapper.skill.ts

import {
  TEMPLATE_VARIABLE_MAPPINGS,
  TemplateVariableMapping,
  StandardizedContent,
} from "./variable-mapping";

export interface VariableMapperInput {
  templateId: string;
  content: StandardizedContent;
}

export interface VariableMapperOutput {
  variables: Record<string, string>;
  validation: {
    valid: boolean;
    missingRequired: string[];
    emptyOptional: string[];
  };
  substitutionRate: number;
}

export class VariableMapperSkill {
  /**
   * 根据模板配置从内容中提取变量
   */
  extract(input: VariableMapperInput): VariableMapperOutput {
    const mapping = TEMPLATE_VARIABLE_MAPPINGS[input.templateId];

    if (!mapping) {
      // 未知模板，返回基础变量
      return this.extractBasicVariables(input.content);
    }

    const variables: Record<string, string> = {};
    const missingRequired: string[] = [];
    const emptyOptional: string[] = [];

    // 提取必填变量
    for (const varName of mapping.required) {
      const extractor = mapping.extractors[varName];
      if (extractor) {
        const value = extractor(input.content);
        if (value && value.trim()) {
          variables[varName] = value;
        } else {
          // 使用fallback
          const fallback = mapping.fallbacks[varName];
          if (fallback) {
            variables[varName] = fallback;
          } else {
            missingRequired.push(varName);
          }
        }
      } else {
        missingRequired.push(varName);
      }
    }

    // 提取可选变量
    for (const varName of mapping.optional) {
      const extractor = mapping.extractors[varName];
      if (extractor) {
        const value = extractor(input.content);
        if (value && value.trim()) {
          variables[varName] = value;
        } else {
          const fallback = mapping.fallbacks[varName];
          if (fallback) {
            variables[varName] = fallback;
          } else {
            emptyOptional.push(varName);
            variables[varName] = ""; // 空字符串，避免显示{{VAR_NAME}}
          }
        }
      }
    }

    // 验证变量值
    if (mapping.validators) {
      for (const [varName, validator] of Object.entries(mapping.validators)) {
        if (variables[varName] && !validator(variables[varName])) {
          // 验证失败，使用fallback
          const fallback = mapping.fallbacks[varName];
          if (fallback) {
            variables[varName] = fallback;
          }
        }
      }
    }

    // 计算替换率
    const totalVars = mapping.required.length + mapping.optional.length;
    const filledVars = Object.values(variables).filter(
      (v) => v && v.trim(),
    ).length;
    const substitutionRate = totalVars > 0 ? filledVars / totalVars : 1;

    return {
      variables,
      validation: {
        valid: missingRequired.length === 0,
        missingRequired,
        emptyOptional,
      },
      substitutionRate,
    };
  }

  /**
   * 基础变量提取（用于未知模板）
   */
  private extractBasicVariables(
    content: StandardizedContent,
  ): VariableMapperOutput {
    const variables: Record<string, string> = {
      TITLE: content.title || "标题",
      SUBTITLE: content.subtitle || "",
      CONTENT: content.sections[0]?.content || "",
    };

    return {
      variables,
      validation: { valid: true, missingRequired: [], emptyOptional: [] },
      substitutionRate: 1,
    };
  }

  /**
   * 验证模板变量是否完整
   */
  validate(
    templateId: string,
    variables: Record<string, string>,
  ): {
    valid: boolean;
    missing: string[];
  } {
    const mapping = TEMPLATE_VARIABLE_MAPPINGS[templateId];
    if (!mapping) {
      return { valid: true, missing: [] };
    }

    const missing: string[] = [];
    for (const varName of mapping.required) {
      if (!variables[varName] || !variables[varName].trim()) {
        missing.push(varName);
      }
    }

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  /**
   * 填充缺失变量（使用fallback）
   */
  fillMissing(
    templateId: string,
    variables: Record<string, string>,
  ): Record<string, string> {
    const mapping = TEMPLATE_VARIABLE_MAPPINGS[templateId];
    if (!mapping) {
      return variables;
    }

    const filled = { ...variables };

    for (const varName of [...mapping.required, ...mapping.optional]) {
      if (!filled[varName] || !filled[varName].trim()) {
        const fallback = mapping.fallbacks[varName];
        if (fallback) {
          filled[varName] = fallback;
        } else {
          filled[varName] = ""; // 确保不显示{{VAR_NAME}}
        }
      }
    }

    return filled;
  }
}
```

### 4.2 集成到渲染层

```typescript
// template-rendering.skill.ts 修改

import { VariableMapperSkill } from "./variable-mapper.skill";
import { ContentStandardizerSkill } from "./content-standardizer.skill";

export class TemplateRenderingSkill {
  private variableMapper = new VariableMapperSkill();
  private contentStandardizer = new ContentStandardizerSkill();

  render(input: TemplateRenderingInput): TemplateRenderingResult {
    // 1. 标准化内容
    const standardizedContent = this.contentStandardizer.standardize(
      input.content,
    );

    // 2. 提取变量
    const { variables, validation, substitutionRate } =
      this.variableMapper.extract({
        templateId: input.templateId,
        content: standardizedContent,
      });

    // 3. 日志记录
    if (!validation.valid) {
      console.warn(
        `[TemplateRendering] Missing required variables for ${input.templateId}:`,
        validation.missingRequired,
      );
    }

    // 4. 填充缺失变量
    const filledVariables = this.variableMapper.fillMissing(
      input.templateId,
      variables,
    );

    // 5. 应用变量到模板
    let html = this.applyVariables(template.html, filledVariables);

    // 6. 清理残留的{{}}
    html = this.cleanupUnmatchedVariables(html);

    return {
      html,
      validation,
      substitutionRate,
    };
  }

  /**
   * 清理未替换的变量占位符
   */
  private cleanupUnmatchedVariables(html: string): string {
    // 匹配 {{VARIABLE_NAME}} 格式
    return html.replace(/\{\{[A-Z_0-9]+\}\}/g, "");
  }
}
```

---

## 五、测试策略

### 5.1 单元测试

```typescript
// variable-mapper.skill.spec.ts

describe("VariableMapperSkill", () => {
  const skill = new VariableMapperSkill();

  describe("extract", () => {
    it("should extract all required variables for D-001", () => {
      const content: StandardizedContent = {
        title: "年度营收增长",
        dataPoints: [{ label: "营收", value: "1.2亿", change: "+23%" }],
      };

      const result = skill.extract({
        templateId: "D-001",
        content,
      });

      expect(result.validation.valid).toBe(true);
      expect(result.variables["TITLE"]).toBe("年度营收增长");
      expect(result.variables["NUMBER"]).toBe("1.2亿");
      expect(result.variables["LABEL"]).toBe("营收");
      expect(result.variables["CHANGE"]).toBe("+23%");
    });

    it("should use fallbacks for missing variables", () => {
      const content: StandardizedContent = {
        title: "数据概览",
      };

      const result = skill.extract({
        templateId: "D-001",
        content,
      });

      expect(result.variables["NUMBER"]).toBe("100"); // fallback
      expect(result.variables["LABEL"]).toBe("核心指标"); // fallback
    });

    it("should calculate substitution rate correctly", () => {
      const content: StandardizedContent = {
        title: "测试",
        dataPoints: [{ label: "测试", value: 100 }],
      };

      const result = skill.extract({
        templateId: "D-001",
        content,
      });

      // D-001 有 3 必填 + 2 可选 = 5 变量
      // title, number, label 填充 + change, date 用fallback = 5/5 = 100%
      expect(result.substitutionRate).toBeGreaterThan(0.8);
    });
  });

  describe("validate", () => {
    it("should detect missing required variables", () => {
      const result = skill.validate("D-001", {
        TITLE: "测试",
        // missing NUMBER and LABEL
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain("NUMBER");
      expect(result.missing).toContain("LABEL");
    });
  });
});
```

### 5.2 集成测试

```typescript
// template-rendering.integration.spec.ts

describe("TemplateRendering Integration", () => {
  const renderingSkill = new TemplateRenderingSkill();

  it("should render D-001 without {{}} residuals", () => {
    const result = renderingSkill.render({
      templateId: "D-001",
      content: { title: "测试" },
      themeId: "genspark-dark",
    });

    expect(result.html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("should render all 32 templates without {{}} residuals", () => {
    const templateIds = Object.keys(TEMPLATE_VARIABLE_MAPPINGS);

    for (const templateId of templateIds) {
      const result = renderingSkill.render({
        templateId,
        content: { title: "测试标题", sections: [{ content: "测试内容" }] },
        themeId: "genspark-dark",
      });

      expect(result.html).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
  });
});
```

### 5.3 替换率统计

```typescript
// 批量测试所有模板的变量替换率

describe("Variable Substitution Rate", () => {
  it("should achieve >95% substitution rate for all templates", () => {
    const templateIds = Object.keys(TEMPLATE_VARIABLE_MAPPINGS);
    const results: Record<string, number> = {};

    for (const templateId of templateIds) {
      const result = skill.extract({
        templateId,
        content: generateMinimalContent(templateId),
      });

      results[templateId] = result.substitutionRate;
      expect(result.substitutionRate).toBeGreaterThanOrEqual(0.95);
    }

    console.log("Substitution Rates:", results);
  });
});
```

---

## 六、监控和指标

### 6.1 运行时指标

```typescript
// 添加到渲染服务的指标收集

interface RenderingMetrics {
  templateId: string;
  substitutionRate: number;
  missingVariables: string[];
  renderTimeMs: number;
  themeId: string;
}

class MetricsCollector {
  private metrics: RenderingMetrics[] = [];

  record(metric: RenderingMetrics) {
    this.metrics.push(metric);

    // 低替换率告警
    if (metric.substitutionRate < 0.9) {
      console.warn(
        `[LowSubstitutionRate] ${metric.templateId}: ${metric.substitutionRate}`,
      );
    }
  }

  getAverageSubstitutionRate(): number {
    if (this.metrics.length === 0) return 1;
    return (
      this.metrics.reduce((sum, m) => sum + m.substitutionRate, 0) /
      this.metrics.length
    );
  }

  getMostProblematicTemplates(): string[] {
    const templateRates: Record<string, number[]> = {};

    for (const m of this.metrics) {
      if (!templateRates[m.templateId]) {
        templateRates[m.templateId] = [];
      }
      templateRates[m.templateId].push(m.substitutionRate);
    }

    return Object.entries(templateRates)
      .map(([id, rates]) => ({
        id,
        avgRate: rates.reduce((a, b) => a + b, 0) / rates.length,
      }))
      .filter((t) => t.avgRate < 0.9)
      .sort((a, b) => a.avgRate - b.avgRate)
      .map((t) => t.id);
  }
}
```

### 6.2 仪表盘指标

| 指标         | 目标 | 告警阈值 |
| ------------ | ---- | -------- |
| 全局替换率   | >95% | <90%     |
| 单模板替换率 | >90% | <80%     |
| 缺失变量数   | 0    | >2       |
| 渲染失败率   | <1%  | >5%      |

---

## 七、附录

### A. 变量命名规范

| 类型   | 格式            | 示例                      |
| ------ | --------------- | ------------------------- |
| 标题   | `{TYPE}_TITLE`  | SECTION_TITLE, CARD_TITLE |
| 描述   | `{TYPE}_DESC`   | PILLAR1_DESC, CARD_DESC   |
| 数值   | `{TYPE}_VALUE`  | KPI1_VALUE, CURRENT_VALUE |
| 变化   | `{TYPE}_CHANGE` | KPI1_CHANGE, MOM_CHANGE   |
| 列表项 | `{TYPE}{N}`     | POINT1, STEP2, ITEM3      |
| 图表   | `CHART_*`       | CHART_DATA, CHART_SVG     |

### B. 数据点格式规范

```typescript
// 数值格式化规范
const NUMBER_FORMATS = {
  integer: /^\d+$/, // 123
  decimal: /^\d+\.\d+$/, // 123.45
  percentage: /^\d+(\.\d+)?%$/, // 23.5%
  currency: /^[\$\u00a5]\d+(\.\d+)?$/, // $100, ¥100
  chinese: /^\d+(\.\d+)?[万亿]$/, // 1.2亿
  change: /^[+-]\d+(\.\d+)?%?$/, // +23%, -5
};
```

### C. 图表数据格式规范

```typescript
// 折线图/柱状图数据
interface LineBarChartData {
  type: "line" | "bar";
  labels: string[]; // X轴标签
  datasets: {
    label: string; // 数据集名称
    data: number[]; // 数据点
    color?: string; // 颜色
  }[];
}

// 饼图数据
interface PieChartData {
  type: "pie";
  labels: string[]; // 分类标签
  data: number[]; // 数据
  colors?: string[]; // 颜色数组
}

// 雷达图数据
interface RadarChartData {
  type: "radar";
  indicators: { name: string; max: number }[];
  data: number[][];
}
```

---

## 变更记录

| 版本 | 日期       | 变更内容 | 作者     |
| ---- | ---------- | -------- | -------- |
| 1.0  | 2025-12-31 | 初始版本 | PM Agent |
