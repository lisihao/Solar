/**
 * V5 Research Quality Prompts
 *
 * V5 研究质量优化的 Prompt 模板
 */

// ==================== L1: Research Design Prompt ====================

/**
 * 研究设计扩展 Prompt（注入到 GLOBAL_OUTLINE_PROMPT 中）
 */
export const RESEARCH_DESIGN_EXTENSION = `
## 研究设计要求（V5 增强）

除了大纲规划外，你还需要输出以下研究设计信息：

### 分析框架
根据主题特点选择最合适的分析框架，如：
- PESTEL（宏观环境分析）
- Porter's Five Forces（行业竞争分析）
- SWOT（优劣势分析）
- Value Chain（价值链分析）
- 或其他适合的框架

### 初始假设
基于主题和初步证据，提出 3-5 个可验证的研究假设，例如：
- "技术 X 将在未来 2 年内成为主流" (predictive)
- "政策 Y 的实施导致了市场变化 Z" (causal)

在 JSON 输出中新增 researchDesign 字段：

\`\`\`json
{
  "researchDesign": {
    "analyticalFramework": "框架名称",
    "frameworkRationale": "选择理由",
    "hypotheses": [
      {
        "id": "H1",
        "statement": "假设陈述",
        "type": "causal|correlational|descriptive|predictive",
        "evidenceNeeded": "需要什么证据来验证",
        "counterQuery": "反方向搜索查询（用于寻找反对证据）"
      }
    ],
    "deliverables": [
      {
        "name": "交付物名称",
        "qualityCriteria": ["标准1", "标准2"]
      }
    ]
  }
}
\`\`\`
`;

// ==================== L3: Claim Extraction Prompt ====================

/**
 * 从章节内容中提取事实断言的 Prompt
 */
export const CLAIM_EXTRACTION_PROMPT = `你是事实核查专家，从以下研究内容中提取所有可验证的事实断言（claims）。

## 章节内容
{sectionContent}

## 提取规则
1. 只提取**具体的、可验证的事实断言**（包含数据、日期、具体事件）
2. 忽略主观判断、一般性描述、过渡语句
3. 标注每个 claim 引用的证据编号（[n] 格式中的 n）
4. 评估每个 claim 的重要性（high=核心论点, medium=支撑论据, low=背景信息）

## 输出格式
\`\`\`json
{
  "claims": [
    {
      "id": "C1",
      "statement": "具体的事实断言",
      "sectionId": "{sectionId}",
      "sourceEvidenceIndices": [1, 3],
      "importance": "high|medium|low"
    }
  ]
}
\`\`\`

只输出 JSON，不要其他内容。`;

// ==================== L3: Claim Validation Prompt ====================

/**
 * 批量验证 Claims 的 Prompt
 */
export const CLAIM_VALIDATION_PROMPT = `你是严谨的事实核查专家，负责验证以下研究断言（claims）与已有证据的一致性。

## 待验证 Claims
{claimsJson}

## 可用证据摘要
{evidenceSummary}

## 验证规则
1. **verified** - 至少 2 个独立来源支持，且无矛盾证据
2. **unverified** - 缺乏足够证据支持（不等于错误，只是未验证）
3. **disputed** - 不同来源给出矛盾信息

## 输出格式
\`\`\`json
{
  "results": [
    {
      "claimId": "C1",
      "status": "verified|unverified|disputed",
      "supportingSourceIndices": [1, 3],
      "contradictingSourceIndices": [],
      "explanation": "验证说明"
    }
  ]
}
\`\`\`

只输出 JSON，不要其他内容。`;

// ==================== L3: Gap Search Query Generation Prompt ====================

/**
 * 根据 disputed/unverified claims 生成补充搜索查询
 */
export const GAP_SEARCH_QUERY_PROMPT = `你是研究策略专家，负责分析验证不充分的研究断言并生成针对性搜索查询。

## 需要补充证据的断言
{disputedClaimsJson}

## 已有证据摘要
{existingEvidenceSummary}

## 任务
1. 分析每个断言缺少什么类型的证据（数据来源、权威报告、学术论文等）
2. 生成 2-4 条精准的搜索查询，优先覆盖最重要的知识缺口
3. 查询应具体、可执行，包含关键术语和时间范围

## 查询策略
- 对 **disputed** 断言：搜索支持和反对两个方向的证据
- 对 **unverified** 断言：搜索权威来源以确认或否定
- 使用英文查询词获取更广泛的结果
- 加入时间限定（如 2024 2025）确保结果时效性

## 输出格式
\`\`\`json
{
  "queries": [
    {
      "query": "搜索查询文本",
      "targetClaimIds": ["C1", "C3"],
      "searchType": "web"
    }
  ]
}
\`\`\`

只输出 JSON，不要其他内容。`;

// ==================== L3: Hypothesis Verification Prompt ====================

/**
 * 验证研究假设的 Prompt
 */
export const HYPOTHESIS_VERIFICATION_PROMPT = `你是研究方法论专家，根据收集到的证据验证以下研究假设。

## 研究假设
{hypothesesJson}

## 证据摘要
{evidenceSummary}

## 验证标准
- **supported** - 多数证据支持，无强力反对
- **refuted** - 多数证据反对，或核心前提不成立
- **partially_supported** - 部分成立，需要修正
- **inconclusive** - 证据不足以做出判断

## 输出格式
\`\`\`json
{
  "results": [
    {
      "hypothesisId": "H1",
      "status": "supported|refuted|partially_supported|inconclusive",
      "supportingEvidence": "支持证据概述",
      "contradictingEvidence": "反对证据概述",
      "confidence": 75,
      "refinedStatement": "修正后的假设陈述（仅 partially_supported 时需要）"
    }
  ]
}
\`\`\`

只输出 JSON，不要其他内容。`;

// ==================== L2: Literature Baseline Prompt ====================

/**
 * 构造学术导向搜索查询的 Prompt
 */
export const LITERATURE_BASELINE_QUERY_PROMPT = `你是研究助手，需要为以下研究主题生成 3-5 个学术导向的搜索查询。

## 研究主题
{topicName}

## 维度
{dimensionName}: {dimensionDescription}

## 要求
1. 查询应包含学术来源限定（如 site:arxiv.org, site:mckinsey.com, site:hbr.org 等）
2. 使用英文查询词以获取更多学术结果
3. 包含行业报告来源（如 Gartner, McKinsey, BCG 等）

## 输出格式
\`\`\`json
{
  "queries": [
    "site:mckinsey.com OR site:hbr.org topic keyword analysis 2024 2025",
    "site:arxiv.org topic keyword research paper"
  ]
}
\`\`\`

只输出 JSON，不要其他内容。`;

// ==================== L2: Hypothesis-Driven Query Prompt ====================

/**
 * 基于假设生成正反方向搜索查询
 */
export const HYPOTHESIS_DRIVEN_QUERY_PROMPT = `你是搜索策略专家，为以下研究假设生成正反两个方向的搜索查询。

## 假设
{hypothesisStatement}

## 要求
为每个假设生成：
1. **支持方向查询** - 寻找支持该假设的证据
2. **反对方向查询** - 寻找反驳该假设的证据

## 输出格式
\`\`\`json
{
  "supportQueries": ["查询1", "查询2"],
  "counterQueries": ["反方向查询1", "反方向查询2"]
}
\`\`\`

只输出 JSON，不要其他内容。`;

// ==================== L5: Fact Check Prompt ====================

/**
 * 报告事实核查 Prompt
 */
export const FACT_CHECK_PROMPT = `你是严谨的事实核查编辑，负责核对研究报告中的引用是否与原始证据一致。

## 报告引用摘录
以下是报告中使用 [n] 格式引用的片段：

{citationsWithContext}

## 原始证据
{originalEvidence}

## 核查任务
逐一检查每个引用：
1. 引用的数据/事实是否与原始证据一致？
2. 是否存在歪曲、夸大或断章取义？
3. 引用编号是否指向正确的来源？

## 输出格式
\`\`\`json
{
  "citations": [
    {
      "citationMark": "[1]",
      "context": "引用上下文",
      "consistent": true,
      "inconsistencyNote": "不一致说明（仅当 consistent=false 时）"
    }
  ],
  "accuracyScore": 85,
  "issues": ["发现的问题列表"]
}
\`\`\`

只输出 JSON，不要其他内容。`;

// ==================== L5: Enhanced Dedup Prompt Extension ====================

/**
 * 增强的去重 Prompt（追加到现有 DEDUP_CHECK_PROMPT）
 */
export const ENHANCED_DEDUP_EXTENSION = `
## 额外检查（V5 增强）

除了内容去重，还需检查：

### 术语一致性
- 同一概念在不同维度是否使用相同术语？
- 缩写是否在首次出现时展开？

### 数据一致性
- 同一数据点在不同维度的引用是否一致？
- 数据的时间范围和统计口径是否匹配？

在 JSON 输出中新增：
\`\`\`json
{
  "terminologyIssues": [
    {
      "term": "术语A",
      "variants": ["变体1", "变体2"],
      "standardForm": "统一形式",
      "affectedDimensions": ["维度1", "维度2"]
    }
  ],
  "dataConsistencyIssues": [
    {
      "dataPoint": "数据描述",
      "values": [
        {"dimension": "维度1", "value": "值1", "source": "来源1"},
        {"dimension": "维度2", "value": "值2", "source": "来源2"}
      ],
      "resolution": "建议统一为哪个值"
    }
  ]
}
\`\`\``;

// ==================== L4: Writing with Validation Context ====================

/**
 * 写作时注入验证结果的上下文片段
 */
export function buildValidationContextForWriting(
  claimResults?: Array<{
    claimId: string;
    status: import("../types/research-depth.types").ClaimVerificationStatus;
    explanation: string;
  }>,
  hypothesisResults?: Array<{
    hypothesisId: string;
    status: "supported" | "refuted" | "partially_supported" | "inconclusive";
    refinedStatement?: string;
  }>,
): string {
  const parts: string[] = [];

  if (claimResults && claimResults.length > 0) {
    const disputed = claimResults.filter((c) => c.status === "disputed");
    const unverified = claimResults.filter((c) => c.status === "unverified");

    if (disputed.length > 0 || unverified.length > 0) {
      parts.push("## 验证注意事项");
      if (disputed.length > 0) {
        parts.push(
          `以下断言存在争议，写作时需标注不同观点：\n${disputed.map((c) => `- ${c.claimId}: ${c.explanation}`).join("\n")}`,
        );
      }
      if (unverified.length > 0) {
        parts.push(
          `以下断言尚未验证，写作时需用谨慎措辞（如"据...报告"）：\n${unverified.map((c) => `- ${c.claimId}: ${c.explanation}`).join("\n")}`,
        );
      }
    }
  }

  if (hypothesisResults && hypothesisResults.length > 0) {
    const refined = hypothesisResults.filter(
      (h) => h.status === "partially_supported" && h.refinedStatement,
    );
    const refuted = hypothesisResults.filter((h) => h.status === "refuted");

    if (refined.length > 0 || refuted.length > 0) {
      parts.push("## 假设验证结果");
      if (refuted.length > 0) {
        parts.push(
          `以下假设已被证据否定，不要在报告中作为结论：\n${refuted.map((h) => `- ${h.hypothesisId}`).join("\n")}`,
        );
      }
      if (refined.length > 0) {
        parts.push(
          `以下假设需修正：\n${refined.map((h) => `- ${h.hypothesisId}: 修正为 "${h.refinedStatement}"`).join("\n")}`,
        );
      }
    }
  }

  return parts.join("\n\n");
}
