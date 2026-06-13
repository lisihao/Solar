/**
 * Slides Engine v3.6 - Template Requirements System
 *
 * 定义每个模板需要的变量，用于：
 * 1. 指导 Writer 生成正确结构的内容
 * 2. 渲染时验证内容完整性
 * 3. 缺失内容时显示明确警告而非静默填充
 */

/**
 * 变量需求定义
 */
export interface VariableRequirement {
  /** 变量名 */
  name: string;
  /** 变量描述（用于 prompt） */
  description: string;
  /** 是否必需 */
  required: boolean;
  /** 数据类型提示 */
  type: "text" | "number" | "percentage" | "currency" | "date" | "icon";
  /** 示例值（仅用于 prompt，不用于填充） */
  example?: string;
}

/**
 * 模板需求定义
 */
export interface TemplateRequirement {
  /** 模板 ID */
  templateId: string;
  /** 模板名称 */
  templateName: string;
  /** 需要的变量列表 */
  variables: VariableRequirement[];
  /** sections 结构要求 */
  sectionsHint: string;
}

/**
 * 所有模板的变量需求定义
 * 用于指导 Writer AI 生成正确结构的内容
 */
export const TEMPLATE_REQUIREMENTS: Record<string, TemplateRequirement> = {
  // ============================================================================
  // S-002: 章节分隔页
  // ============================================================================
  "S-002": {
    templateId: "S-002",
    templateName: "章节分隔页",
    variables: [
      {
        name: "CHAPTER_NUM",
        description: "章节编号",
        required: true,
        type: "number",
        example: "02",
      },
      {
        name: "TITLE",
        description: "章节标题",
        required: true,
        type: "text",
        example: "市场分析与竞争格局",
      },
      {
        name: "SUBTITLE",
        description: "章节描述（一句话概括本章内容）",
        required: false,
        type: "text",
        example: "深入分析当前市场趋势与主要竞争对手",
      },
    ],
    sectionsHint: "章节分隔页不需要 sections，保持为空数组",
  },

  // ============================================================================
  // S-003: 三支柱
  // ============================================================================
  "S-003": {
    templateId: "S-003",
    templateName: "三支柱",
    variables: [
      {
        name: "TITLE",
        description: "页面主标题",
        required: true,
        type: "text",
      },
      {
        name: "SUBTITLE",
        description: "页面副标题",
        required: true,
        type: "text",
      },
      {
        name: "PILLAR1_ICON",
        description: "第一支柱图标",
        required: false,
        type: "icon",
        example: "🎯",
      },
      {
        name: "PILLAR1_TITLE",
        description: "第一支柱标题",
        required: true,
        type: "text",
      },
      {
        name: "PILLAR1_DESC",
        description: "第一支柱描述",
        required: true,
        type: "text",
      },
      {
        name: "PILLAR1_STAT",
        description: "第一支柱关键数据",
        required: true,
        type: "number",
        example: "85%",
      },
      {
        name: "PILLAR1_LABEL",
        description: "第一支柱数据标签",
        required: true,
        type: "text",
      },
      {
        name: "PILLAR2_ICON",
        description: "第二支柱图标",
        required: false,
        type: "icon",
        example: "⚡",
      },
      {
        name: "PILLAR2_TITLE",
        description: "第二支柱标题",
        required: true,
        type: "text",
      },
      {
        name: "PILLAR2_DESC",
        description: "第二支柱描述",
        required: true,
        type: "text",
      },
      {
        name: "PILLAR2_STAT",
        description: "第二支柱关键数据",
        required: true,
        type: "number",
        example: "120+",
      },
      {
        name: "PILLAR2_LABEL",
        description: "第二支柱数据标签",
        required: true,
        type: "text",
      },
      {
        name: "PILLAR3_ICON",
        description: "第三支柱图标",
        required: false,
        type: "icon",
        example: "👥",
      },
      {
        name: "PILLAR3_TITLE",
        description: "第三支柱标题",
        required: true,
        type: "text",
      },
      {
        name: "PILLAR3_DESC",
        description: "第三支柱描述",
        required: true,
        type: "text",
      },
      {
        name: "PILLAR3_STAT",
        description: "第三支柱关键数据",
        required: true,
        type: "number",
        example: "2.5x",
      },
      {
        name: "PILLAR3_LABEL",
        description: "第三支柱数据标签",
        required: true,
        type: "text",
      },
    ],
    sectionsHint: `需要 3 个 stat 类型的 sections，每个包含：
- content.value: 关键数据（如 "85%", "120+", "2.5x"）
- content.label: 数据标签
- 标题和描述从 section.content 或 citations 提取`,
  },

  // ============================================================================
  // S-004: 四支柱
  // ============================================================================
  "S-004": {
    templateId: "S-004",
    templateName: "四支柱",
    variables: [
      {
        name: "TITLE",
        description: "页面主标题",
        required: true,
        type: "text",
      },
      {
        name: "SUBTITLE",
        description: "页面副标题",
        required: true,
        type: "text",
      },
      // 四个支柱的变量
      ...Array.from({ length: 4 }, (_, i) => [
        {
          name: `PILLAR${i + 1}_ICON`,
          description: `第${i + 1}支柱图标`,
          required: false,
          type: "icon" as const,
        },
        {
          name: `PILLAR${i + 1}_TITLE`,
          description: `第${i + 1}支柱标题`,
          required: true,
          type: "text" as const,
        },
        {
          name: `PILLAR${i + 1}_DESC`,
          description: `第${i + 1}支柱描述`,
          required: true,
          type: "text" as const,
        },
        {
          name: `PILLAR${i + 1}_STAT`,
          description: `第${i + 1}支柱关键数据`,
          required: true,
          type: "number" as const,
        },
        {
          name: `PILLAR${i + 1}_LABEL`,
          description: `第${i + 1}支柱数据标签`,
          required: true,
          type: "text" as const,
        },
      ]).flat(),
    ],
    sectionsHint: "需要 4 个 stat 类型的 sections",
  },

  // ============================================================================
  // D-002: Dashboard KPI
  // ============================================================================
  "D-002": {
    templateId: "D-002",
    templateName: "Dashboard KPI",
    variables: [
      {
        name: "TITLE",
        description: "页面主标题",
        required: true,
        type: "text",
      },
      {
        name: "KPI1_VALUE",
        description: "第一个KPI值",
        required: true,
        type: "number",
        example: "$2.5M",
      },
      {
        name: "KPI1_LABEL",
        description: "第一个KPI标签",
        required: true,
        type: "text",
        example: "年度营收",
      },
      {
        name: "KPI1_CHANGE",
        description: "第一个KPI变化",
        required: false,
        type: "percentage",
        example: "+15%",
      },
      {
        name: "KPI2_VALUE",
        description: "第二个KPI值",
        required: true,
        type: "number",
      },
      {
        name: "KPI2_LABEL",
        description: "第二个KPI标签",
        required: true,
        type: "text",
      },
      {
        name: "KPI2_CHANGE",
        description: "第二个KPI变化",
        required: false,
        type: "percentage",
      },
      {
        name: "KPI3_VALUE",
        description: "第三个KPI值",
        required: true,
        type: "number",
      },
      {
        name: "KPI3_LABEL",
        description: "第三个KPI标签",
        required: true,
        type: "text",
      },
      {
        name: "KPI3_CHANGE",
        description: "第三个KPI变化",
        required: false,
        type: "percentage",
      },
      {
        name: "KPI4_VALUE",
        description: "第四个KPI值",
        required: true,
        type: "number",
      },
      {
        name: "KPI4_LABEL",
        description: "第四个KPI标签",
        required: true,
        type: "text",
      },
      {
        name: "KPI4_CHANGE",
        description: "第四个KPI变化",
        required: false,
        type: "percentage",
      },
    ],
    sectionsHint:
      "需要 4 个 stat 类型的 sections，每个包含 value, label, change",
  },

  // ============================================================================
  // D-003: Trend Chart
  // ============================================================================
  "D-003": {
    templateId: "D-003",
    templateName: "趋势图表",
    variables: [
      {
        name: "TITLE",
        description: "页面主标题",
        required: true,
        type: "text",
      },
      {
        name: "CURRENT_VALUE",
        description: "当前值",
        required: true,
        type: "number",
        example: "95%",
      },
      {
        name: "MOM_CHANGE",
        description: "环比变化",
        required: true,
        type: "percentage",
        example: "+12%",
      },
      {
        name: "YOY_CHANGE",
        description: "同比变化",
        required: true,
        type: "percentage",
        example: "+25%",
      },
      {
        name: "INSIGHT",
        description: "数据洞察",
        required: true,
        type: "text",
      },
      {
        name: "PERIOD",
        description: "数据周期",
        required: true,
        type: "date",
        example: "2024年Q4",
      },
    ],
    sectionsHint: "需要至少 2 个 stat sections 和 1 个 chart section",
  },

  // ============================================================================
  // D-004: Comparison Dual
  // ============================================================================
  "D-004": {
    templateId: "D-004",
    templateName: "双方案对比",
    variables: [
      {
        name: "TITLE",
        description: "页面主标题",
        required: true,
        type: "text",
      },
      {
        name: "OPTION_A_TITLE",
        description: "方案A标题",
        required: true,
        type: "text",
      },
      {
        name: "A_PRO1",
        description: "方案A优势1",
        required: true,
        type: "text",
      },
      {
        name: "A_PRO2",
        description: "方案A优势2",
        required: true,
        type: "text",
      },
      {
        name: "A_CON1",
        description: "方案A劣势",
        required: true,
        type: "text",
      },
      {
        name: "A_COST",
        description: "方案A成本",
        required: true,
        type: "currency",
      },
      {
        name: "OPTION_B_TITLE",
        description: "方案B标题",
        required: true,
        type: "text",
      },
      {
        name: "B_PRO1",
        description: "方案B优势1",
        required: true,
        type: "text",
      },
      {
        name: "B_PRO2",
        description: "方案B优势2",
        required: true,
        type: "text",
      },
      {
        name: "B_CON1",
        description: "方案B劣势",
        required: true,
        type: "text",
      },
      {
        name: "B_COST",
        description: "方案B成本",
        required: true,
        type: "currency",
      },
    ],
    sectionsHint: `需要 2 个 list 类型的 sections：
- 第一个 list: [方案A标题, 优势1, 优势2, 劣势]
- 第二个 list: [方案B标题, 优势1, 优势2, 劣势]`,
  },

  // ============================================================================
  // N-002: Timeline
  // ============================================================================
  "N-002": {
    templateId: "N-002",
    templateName: "时间轴",
    variables: [
      {
        name: "TITLE",
        description: "页面主标题",
        required: true,
        type: "text",
      },
      {
        name: "M1_DATE",
        description: "第一阶段日期",
        required: true,
        type: "date",
        example: "Q1 2024",
      },
      {
        name: "M1_TITLE",
        description: "第一阶段标题",
        required: true,
        type: "text",
      },
      {
        name: "M1_DESC",
        description: "第一阶段描述",
        required: true,
        type: "text",
      },
      {
        name: "M2_DATE",
        description: "第二阶段日期",
        required: true,
        type: "date",
      },
      {
        name: "M2_TITLE",
        description: "第二阶段标题",
        required: true,
        type: "text",
      },
      {
        name: "M2_DESC",
        description: "第二阶段描述",
        required: true,
        type: "text",
      },
      {
        name: "M3_DATE",
        description: "第三阶段日期",
        required: true,
        type: "date",
      },
      {
        name: "M3_TITLE",
        description: "第三阶段标题",
        required: true,
        type: "text",
      },
      {
        name: "M3_DESC",
        description: "第三阶段描述",
        required: true,
        type: "text",
      },
      {
        name: "M4_DATE",
        description: "第四阶段日期",
        required: true,
        type: "date",
      },
      {
        name: "M4_TITLE",
        description: "第四阶段标题",
        required: true,
        type: "text",
      },
      {
        name: "M4_DESC",
        description: "第四阶段描述",
        required: true,
        type: "text",
      },
    ],
    sectionsHint: `需要 4 个 sections，每个代表一个时间节点：
- stat 类型: value=日期, label=标题
- 或 list 类型: [标题, 描述]
- 或 text 类型: 包含标题和描述的文本`,
  },
};

/**
 * 获取模板的变量需求
 */
export function getTemplateRequirements(
  templateId: string,
): TemplateRequirement | undefined {
  return TEMPLATE_REQUIREMENTS[templateId];
}

/**
 * 生成用于 Writer Prompt 的模板需求描述
 */
export function generateRequirementsPrompt(templateId: string): string {
  const req = TEMPLATE_REQUIREMENTS[templateId];
  if (!req) {
    return "";
  }

  const requiredVars = req.variables.filter((v) => v.required);
  const optionalVars = req.variables.filter((v) => !v.required);

  let prompt = `## 模板要求：${req.templateName} (${req.templateId})\n\n`;

  prompt += `### 必需变量（必须从源文本中提取真实数据）\n`;
  for (const v of requiredVars) {
    prompt += `- **${v.name}**: ${v.description}`;
    if (v.example) {
      prompt += ` (格式示例: "${v.example}"，但必须使用源文本中的真实数据)`;
    }
    prompt += `\n`;
  }

  if (optionalVars.length > 0) {
    prompt += `\n### 可选变量\n`;
    for (const v of optionalVars) {
      prompt += `- ${v.name}: ${v.description}\n`;
    }
  }

  prompt += `\n### Sections 结构\n${req.sectionsHint}\n`;

  prompt += `\n### 重要提醒\n`;
  prompt += `- 所有数据必须来自源文本，禁止编造\n`;
  prompt += `- 如果源文本缺少某项数据，用相关内容替代，不要使用通用占位符\n`;
  prompt += `- 数据格式要与主题相关（如 AI 主题用 "175B参数"，不要用 "520+"）\n`;

  return prompt;
}

/**
 * 验证变量是否完整，返回缺失的必需变量
 */
export function validateVariables(
  templateId: string,
  variables: Record<string, string>,
): string[] {
  const req = TEMPLATE_REQUIREMENTS[templateId];
  if (!req) {
    return [];
  }

  const missing: string[] = [];
  for (const v of req.variables) {
    if (v.required && (!variables[v.name] || variables[v.name].trim() === "")) {
      missing.push(v.name);
    }
  }

  return missing;
}

/**
 * 缺失变量占位符（明确显示这是缺失内容，而非伪装成真实数据）
 */
export const MISSING_PLACEHOLDER = "[内容缺失]";
export const MISSING_NUMBER_PLACEHOLDER = "[--]";
export const MISSING_ICON_PLACEHOLDER = "•";
