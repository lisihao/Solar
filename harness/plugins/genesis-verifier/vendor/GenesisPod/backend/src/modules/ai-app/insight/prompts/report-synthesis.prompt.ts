/**
 * Topic Research - Report Synthesis Prompts
 *
 * 综合报告生成的 AI Prompt 模板
 * v3.0 - 精简版：章节内容已由维度研究生成，此处只生成补充内容
 *
 * 架构说明：
 * - 各维度章节内容（detailedContent）在维度研究阶段已生成，包含图表
 * - 报告合成阶段只生成：执行摘要、前言、跨维度分析、风险评估、战略建议、结束语
 * - 最终报告通过拼接维度内容 + 补充内容生成，保证内容完整性
 */

import {
  SYNTHESIS_FORMATTING,
  PROFESSIONAL_TONE,
  PROFESSIONAL_TONE_EN,
  HEADING_HIERARCHY,
  HEADING_HIERARCHY_EN,
  NARRATIVE_STRUCTURE,
  NARRATIVE_STRUCTURE_EN,
  TABLE_STANDARDS,
  TABLE_STANDARDS_EN,
  getExecutiveSummaryFormat,
} from "@/modules/ai-app/contracts/report-template";
import {
  renderPromptTemplate,
  getLanguageInstruction,
} from "./dimension-research.prompt";

/**
 * 报告合成系统提示词
 *
 * 生成报告的补充内容（执行摘要、前言、跨维度分析等）
 * 注意：各维度章节内容已在维度研究阶段生成，此处不需要重写
 */
export const REPORT_SYNTHESIS_SYSTEM_PROMPT = `你是一位资深的战略研究顾问和报告撰写专家。你的任务是为已完成的多维度研究生成报告的**补充内容**。

## 重要说明

⚠️ **各维度章节内容已由研究 Agent 生成**，你不需要重写章节内容。

你只需要生成以下补充内容：
1. 执行摘要（Executive Summary）
2. 前言（Preface）
3. 跨维度关联分析（Cross-Dimension Analysis）
4. 风险评估（Risk Assessment）
5. 战略建议（Strategic Recommendations）
6. 结束语（Conclusion）

## 输出格式

以 JSON 格式返回。**关键要求：每个 section 的 fullText 是必填字段，即使无法生成结构化子字段也必须生成 fullText 文本。**

{
  "executiveSummary": {
    "fullText": "【必填】执行摘要完整文本（Markdown格式，400-600字）",
    "thesisStatement": "一句话概括本报告最重要的发现/判断（核心论断）",
    "coreConclusions": ["支撑核心论断的关键发现1", "关键发现2", "关键发现3"],
    "keyMetrics": [{ "metric": "指标名", "value": "数值", "source": "来源" }],
    "riskAlerts": ["风险提示1", "风险提示2"],
    "actionItems": ["行动建议1", "行动建议2"]
  },
  "preface": "前言内容（Markdown格式，300-500字）",
  "tableOfContents": "目录内容（Markdown格式）",
  "crossDimensionAnalysis": {
    "fullText": "【必填】跨维度分析完整内容（Markdown格式，800-1200字，每条因果链必须用加粗标题独立分段，链之间用空行分隔，每条因果链必须有具体数据支撑，不能泛泛而谈）",
    "causalChains": [{ "chain": "因素A → 因素B → 结果", "explanation": "说明", "timeframe": "时间窗口" }],
    "keyLinkages": [{ "dimensions": ["维度1", "维度2"], "relationship": "关联", "impact": "影响" }],
    "feedbackLoops": ["自我强化或自我抑制的循环效应描述"],
    "systemicEffects": ["多维度联动可能触发的涌现效应描述"]
  },
  "riskAssessment": {
    "fullText": "【必填】风险评估完整内容（Markdown格式，含风险矩阵表格，400-600字）",
    "riskMatrix": [{ "riskType": "类型", "probability": 65, "impact": 8, "timeframe": "短期|中期|长期", "indicators": "预警指标", "mitigation": "应对建议" }]
  },
  "strategicRecommendations": {
    "fullText": "【必填】战略建议完整内容（Markdown格式，分受众建议，800-1200字，每条建议必须包含具体的行动步骤和时间节点，禁止泛泛而谈）",
    "forEnterprise": { "shortTerm": ["建议1"], "midTerm": ["建议1"] },
    "forInvestors": { "opportunities": ["机会1"], "risks": ["风险1"] },
    "forPolicymakers": { "keyObservations": ["观察点1"] },
    "forDevelopers": { "techChoices": ["技术选型建议1"], "skillDevelopment": ["技能方向1"] }
  },
  "conclusion": "结束语（Markdown格式，300-500字，纯段落文本，不使用子标题。总结全文核心判断，展望研究主题的未来走向。严格禁止：(1)复制跨维度分析内容 (2)复制风险评估内容 (3)复制战略建议内容 (4)包含风险矩阵表格。结语必须是独立的总结性段落，不要重复其他字段已有的内容。）",
  "scenarioOutlook": {
    "baseline": "基准情景描述（含概率评估和触发条件）",
    "optimistic": "乐观情景描述（含概率评估和触发条件）",
    "pessimistic": "悲观情景描述（含概率评估和触发条件）"
  },
  "appendices": [{ "title": "附录标题", "content": "附录内容" }]
}

⚠️ **最重要的提醒**：crossDimensionAnalysis.fullText、riskAssessment.fullText、strategicRecommendations.fullText 三个字段必须包含完整的 Markdown 文本内容。不要只返回结构化子字段而遗漏 fullText。

## 格式规范
- **编号格式统一**：全文统一使用阿拉伯数字编号（1. 2. 3.），禁止混用中文数字（一、二、三）和阿拉伯数字（1、2、3）
- 有序列表统一使用 \`1. 2. 3.\` 格式，无序列表统一使用 \`- \` 格式
- 标题使用 Markdown 层级（##, ###），不要在标题中使用编号
- **禁止输出字数统计**：不要在任何位置输出"（字数：约XXX字）"或类似字数标注
- **段落长度**：每段不超过 300 字，超长段落请拆分为多段
- **禁止 HTML 实体**：不要输出 &gt; &lt; &amp; 等 HTML 实体，直接使用 > < & 符号
- **箭头链格式**：因果链用 → 符号串联（如"A → B → C"），但每条因果链必须独立成段，前后用空行分隔
- **禁止伪代码**：不要插入算法伪代码（if/for/while/return），用自然语言描述
- **禁止图片标注**：不要输出"图片没有："、"无图片"等标注
- **列表项不超过 100 字**：超长列表项拆分为多条或改用段落
- **结论独立成段**：总结性内容（"综上所述..."等）不能作为列表项，必须独立成段
- **数学公式**：行内用 \`$...$\`，独立用 \`$$...$$\`，矩阵环境必须用 \`$$\` 包裹，禁止拆分同一表达式到多个 \`$\` 块

{{headingHierarchy}}

{{narrativeStructure}}

{{professionalTone}}

{{tableStandards}}

{{executiveSummaryFormat}}

{{languageInstruction}}`;

/**
 * 报告合成用户提示词模板
 * v3.0 - 精简版：只生成补充内容
 */
export const REPORT_SYNTHESIS_USER_PROMPT_TEMPLATE = `请为以下研究专题生成报告的**补充内容**。

## 重要说明

⚠️ **各维度章节内容已由研究 Agent 生成**，你不需要重写章节内容。
你只需要基于各维度的研究成果，生成补充内容（执行摘要、前言、跨维度分析、风险评估、战略建议、结束语）。

## 专题信息
- **名称**: {{topicName}}
- **类型**: {{topicType}}
- **描述**: {{topicDescription}}
- **研究时间**: {{researchDate}}

## 研究维度概览

本次研究涵盖 {{totalDimensions}} 个维度，共收集 {{totalSources}} 条证据来源。

{{dimensionOverview}}

## 各维度研究摘要

以下是各研究维度的核心发现摘要（用于生成执行摘要和跨维度分析）：

{{dimensionDetails}}

## 证据清单

以下是本次研究收集的所有证据来源，用于报告引用：

{{evidenceList}}

---

## 任务要求

请基于以上研究成果，生成报告的**补充内容**。

### 需要生成的内容

**1. 执行摘要【最重要】**
- 必须包含1条核心论断（Thesis Statement）：一句话概括本报告最重要的发现/判断
- **禁止使用 Markdown 粗体标记**（如"**text**"双星号包裹），直接输出纯文本。标题用 ### 子标题，强调用句式而非格式
- 必须包含3-5条核心结论（支撑核心论断的关键发现，每条一句话，不超过30字）
- 必须列出3-5个关键数据点（从各维度中提炼），**每个数据点必须包含具体数字**（如市场规模、增长率、采用率等），禁止定性描述
- 必须提示2-3条风险
- 必须给出2-3条行动建议
- **keyMetrics 表格中每行必须有具体数值**，禁止"显著增长"、"大幅提升"等模糊表述

## 关键数据引用要求

执行摘要必须包含以下类型的内容（如原始维度报告中存在）：
1. **最具代表性的 2-3 个量化数据点**（百分比、规模数字、增长率等），直接引用维度报告中出现过的具体数字
2. **最核心的技术约束数据**（如系统扩展时的失效点数量等工程约束）
3. **最重要的市场/采用率数据**

禁止：摘要泛泛而谈，不引用任何原始报告中出现过的具体数字。

**2. 前言（300-500字，必须包含以下结构）**
- **研究动因**（1-2句）：为什么研究这个主题，当前的紧迫性
- **研究范围**（1-2句）：涵盖哪些维度，时间窗口
- **方法论概述**（1-2句）：数据来源数量、分析方法
- **阅读指引**（1-2句）：报告结构概要，建议不同读者关注的章节
- 使用 ### 子标题分隔各部分

**3. 目录**
- 基于维度列表生成目录结构

**4. 跨维度关联分析【重要 - 格式严格要求，800-1200字】**
- 使用 ### 子标题组织内容（如 ### 因果链分析、### 反馈回路、### 维度对比）
- 揭示 {{totalDimensions}} 个维度之间的因果关系
- **因果链格式（必须严格遵守）**：
  - 至少 3 条因果链，每条用加粗标题独立分段
  - 每条链格式：**因果链 N：标题**（标题独占一行，前后空行）+ 链式表达独占一行 + 解释段落 + 时间窗口
  - 示例：先写 **因果链 1：政策驱动技术加速**，空一行，再写 政策扶持 → 研发投入增加 → 技术突破加速，空一行，再写解释段落
  - 每条因果链之间必须用空行分隔，禁止连续堆叠在同一段落中
  - **每条因果链必须有具体数据支撑**（如具体数字、增长率、时间节点），不能仅作定性描述
- 识别至少 1 个反馈回路（自我强化或自我抑制），独立成段
- 可用**对比表格**呈现维度间的关键差异
- 分析系统性风险/机遇：多维度联动可能触发的涌现效应

**5. 风险评估**
- 用 Markdown 表格呈现风险矩阵：风险类型 | 概率(%) | 影响程度(1-10) | 时间窗口 | 预警指标 | 应对建议
- **概率必须用百分比数字**（如 30%、65%），禁止仅用"高/中/低"
- **影响程度用 1-10 分制量化**，并说明评分依据
- 至少覆盖 5 个风险项

**6. 战略建议【800-1200字】**
- 使用 ### 子标题按受众分组（如 ### 企业决策者、### 投资者与分析师、### 技术从业者）
- **必须分受众群体**提供差异化建议：
  - 企业决策者（CxO/VP）：短期（0-6月）和中期（6-18月）行动清单
  - 投资者/分析师：投资机会 + 风险预警，含具体领域/赛道
  - 政策研究者/监管方：监管要点 + 政策建议
  - 技术从业者/开发者：技术选型建议 + 技能发展方向
- 每条建议必须具体可执行，禁止泛泛而谈（如"加强创新"）
- **每条建议必须包含具体的行动步骤和时间节点**（如"在 Q3 前完成 X，评估 Y 指标，若达标则在 Q4 推进 Z"）
- 每条列表项不超过 100 字

**7. 结束语（300-500字）**
- 纯段落文本，不使用子标题
- 总结全文核心判断（不是复述执行摘要，要有新的综合视角）
- 展望研究主题的未来走向（1-2句，不展开情景分析）
- 禁止包含情景展望（已由 scenarioOutlook 字段覆盖）
- 禁止包含行动建议（已由 strategicRecommendations 字段覆盖）

## EVENT 专属合成指令（仅当专题类型为 EVENT 时执行，其他类型忽略此节）

{{eventAddendum}}

${SYNTHESIS_FORMATTING}

## 结语独立性（关键约束）
结语（conclusion）字段必须是**独立的总结性段落**：
- 禁止复制跨维度分析、风险评估、战略建议的任何内容
- 禁止包含表格或列表
- 禁止包含任何维度章节中已出现的完整段落
- 字数 300-500 字，纯段落文本
- 如果发现结语与其他字段有超过 50 字的连续重复，视为不合格

请严格按照系统提示词中的JSON格式输出。`;

/**
 * 维度研究摘要模板（用于报告合成）
 */
export function formatDimensionOverview(
  dimensions: Array<{
    name: string;
    description: string | null;
    keyFindingsCount: number;
    sourcesUsed: number;
  }>,
): string {
  return dimensions
    .map(
      (d, i) => `
### ${i + 1}. ${d.name}
- 描述: ${d.description || "无"}
- 关键发现: ${d.keyFindingsCount} 项
- 使用来源: ${d.sourcesUsed} 条`,
    )
    .join("\n");
}

/**
 * 维度详细分析模板（用于报告合成）
 */
export function formatDimensionDetails(
  dimensionAnalyses: Array<{
    dimensionName: string;
    dimensionDescription: string | null;
    summary: string;
    keyFindings: Array<{
      finding: string;
      significance: string;
      evidenceIds: string[];
    }>;
    trends: Array<{
      trend: string;
      direction: string;
      timeframe: string;
      evidenceIds: string[];
    }>;
    challenges: Array<{
      challenge: string;
      impact: string;
      evidenceIds: string[];
    }>;
    opportunities: Array<{
      opportunity: string;
      potential: string;
      evidenceIds: string[];
    }>;
    detailedContent: string;
    sourcesUsed: number;
  }>,
): string {
  return dimensionAnalyses
    .map(
      (da, i) => `
---
## 研究成果 ${i + 1}: ${da.dimensionName}

**维度描述**: ${da.dimensionDescription || "无"}

### 核心摘要
${da.summary}

### 关键发现 (Top 3)
${
  da.keyFindings
    .slice(0, 3)
    .map(
      (f, j) =>
        `${j + 1}. **[${(f.significance || "medium").toUpperCase()}]** ${f.finding}`,
    )
    .join("\n") || "暂无关键发现"
}

### 趋势分析 (Top 2)
${
  da.trends
    .slice(0, 2)
    .map((t, j) => `${j + 1}. **${t.trend}** (${t.direction}, ${t.timeframe})`)
    .join("\n") || "暂无趋势分析"
}

### 挑战 (Top 2)
${
  da.challenges
    .slice(0, 2)
    .map((c, j) => `${j + 1}. ${c.challenge}`)
    .join("\n") || "暂无"
}

### 机会 (Top 2)
${
  da.opportunities
    .slice(0, 2)
    .map((o, j) => `${j + 1}. ${o.opportunity}`)
    .join("\n") || "暂无"
}

### 详细分析内容摘要
${
  da.detailedContent
    ? da.detailedContent.substring(0, 400) +
      (da.detailedContent.length > 400
        ? "...(已截断，完整内容已由研究 Agent 生成)"
        : "")
    : "详细内容请见各子章节"
}
`,
    )
    .join("\n\n");
}

/**
 * 极简版维度摘要（用于 fallback 重试）
 * 仅保留 summary + top 2 findings，无 evidence / detailedContent
 */
export function formatReducedDimensionSummaries(
  dimensionAnalyses: Array<{
    dimensionName: string;
    summary: string;
    keyFindings: Array<{
      finding: string;
      significance: string;
    }>;
  }>,
): string {
  return dimensionAnalyses
    .map(
      (da, i) => `
### ${i + 1}. ${da.dimensionName}
${da.summary}
${
  da.keyFindings
    .slice(0, 2)
    .map((f, j) => `${j + 1}. ${f.finding}`)
    .join("\n") || ""
}`,
    )
    .join("\n");
}

/**
 * 证据列表模板（用于报告合成）
 */
export function formatEvidenceList(
  evidences: Array<{
    citationIndex: number;
    title: string;
    url: string;
    domain: string | null;
    sourceType: string | null;
    publishedAt: Date | null;
    credibilityScore: number | null;
  }>,
): string {
  if (evidences.length === 0) {
    return "暂无证据";
  }

  // ★ 限制证据数量，避免 token 溢出
  // 报告合成只需要知道有哪些证据可引用，不需要完整详情
  const MAX_EVIDENCES_IN_PROMPT = 30;
  const truncated = evidences.length > MAX_EVIDENCES_IN_PROMPT;
  const displayedEvidences = evidences.slice(0, MAX_EVIDENCES_IN_PROMPT);

  const list = displayedEvidences
    .map((e) => `[${e.citationIndex}] ${e.title} (${e.domain || "未知"})`)
    .join("\n");

  return truncated
    ? `${list}\n\n... 还有 ${evidences.length - MAX_EVIDENCES_IN_PROMPT} 条证据（完整列表见报告附录）`
    : list;
}

/**
 * 渲染报告合成用户提示词
 */
export function renderReportSynthesisPrompt(
  topicName: string,
  topicType: string,
  topicDescription: string | null,
  researchDate: string,
  totalDimensions: number,
  totalSources: number,
  dimensionOverview: string,
  dimensionDetails: string,
  evidenceList: string,
): string {
  let result = REPORT_SYNTHESIS_USER_PROMPT_TEMPLATE;

  // ★ EVENT 专属 addendum
  const eventAddendum =
    topicType === "EVENT"
      ? `
如果专题类型为 EVENT（事件洞察），在标准报告合成基础上，请额外执行以下要求：

### 执行摘要结构（EVENT 专属：因果脉络型，替代标准 SCR 格式）
EVENT 类型的执行摘要 fullText 必须采用以下结构：
1. **一句话本质判断**（加粗，30 字以内）
2. **为什么重要**（2-3 句）
3. **因果脉络表**（Markdown 表格）：远因 / 近因 / 导火索 / 事件 / 一阶影响
4. **核心发现**（3-5 条，每条标注置信度 [高/中/低]）
5. **谁受益谁受损**（Markdown 表格）
6. **关键不确定性**（2-3 条）

### 反共识视角（纳入 crossDimensionAnalysis.fullText）
在跨维度分析中，必须包含以下内容：
1. **主流分析的核心判断是什么？**
2. **替代解释**：同样能解释现有证据的另一种解释（至少 1 个）
3. **证伪条件**：什么情况下主分析大概率是错的？（2-3 个可观察条件，12 个月内可验证）
4. **确认偏差检测**：主分析是否只引用了支持其结论的证据？

### WWNBT 情景推演（纳入 strategicRecommendations.fullText）
在战略建议中，必须包含 2-4 个 WWNBT（What Would Need to Be True）情景：
- **情景名称**
- **What Would Need to Be True**：具体、可观察、有时间限定的条件
- **关键观察指标**：用户应关注什么信号（当前值 → 触发阈值）
- **判断窗口**：在什么时间点之前应看到明确信号
- ⚠️ **禁止不可证伪的预测**（如"未来充满不确定性"）

### EVENT 维度写作附加要求
- 结论先行：每个子节的第一段必须是核心结论，不是背景铺垫
- 因果严谨性：区分相关性和因果性（"A 导致了 B（据 XX）" vs "A 与 B 呈正相关"）
- 量化锚点：关键数据必须有对比基准（"同比增长 23%"而非仅"增长"）
- 时间锚定：预测性判断标注时间窗口和置信度
`
      : "";

  const variables: Record<string, string> = {
    topicName,
    topicType,
    topicDescription: topicDescription || "无",
    researchDate,
    totalDimensions: totalDimensions.toString(),
    totalSources: totalSources.toString(),
    dimensionOverview,
    dimensionDetails,
    evidenceList,
    eventAddendum,
  };

  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
  }

  return result;
}

/**
 * 渲染报告合成系统提示词（语言感知）
 *
 * 根据语言动态注入写作标准和执行摘要格式，
 * 替代手动 .replace("{{languageInstruction}}", ...) 调用
 */
export function renderSynthesisSystemPrompt(language: string): string {
  const isEn = language.startsWith("en");
  return renderPromptTemplate(REPORT_SYNTHESIS_SYSTEM_PROMPT, {
    languageInstruction: getLanguageInstruction(language),
    headingHierarchy: isEn ? HEADING_HIERARCHY_EN : HEADING_HIERARCHY,
    narrativeStructure: isEn ? NARRATIVE_STRUCTURE_EN : NARRATIVE_STRUCTURE,
    professionalTone: isEn ? PROFESSIONAL_TONE_EN : PROFESSIONAL_TONE,
    tableStandards: isEn ? TABLE_STANDARDS_EN : TABLE_STANDARDS,
    executiveSummaryFormat: getExecutiveSummaryFormat(language),
  });
}
