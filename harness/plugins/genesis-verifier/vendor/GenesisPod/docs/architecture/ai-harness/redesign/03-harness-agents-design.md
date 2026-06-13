# Topic Insights · 17 Agents 详细设计

> 版本：v1（Gate 2）
>
> 每个 agent：identity / goal / persona / constraints / skills / tools / input / output schema / tier。

---

## 一、Tier 划分

| Tier                | Agents                                                         | 作用                                                        |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| **Core (6)**        | AG-01 LD, AG-03 SW, AG-04 SR, AG-05 ME, AG-06 QR, AG-11 SY     | 完成 standard 深度的基本研究 report 流程                    |
| **Enhancement (5)** | AG-02 DP, AG-07 FC, AG-08 GS, AG-09 HV, AG-10 FX               | 补齐 thorough 深度（outline / fact check / cognitive loop） |
| **Advanced (6)**    | AG-12 SREM, AG-13 RE, AG-14 LX, AG-15 RED, AG-16 MA, AG-17 LDP | 长尾能力（质量修复、10 维评审、LaTeX、交互 chat）           |

Tier Core 的 agents 优先实现并上线。

---

## 二、公共 spec 字段模板

```typescript
IAgentSpec = {
  identity: {
    role: { id, name, description, workStyle },
    goal: { summary, successCriteria },
    persona: { tone, language, style },
    constraints: { maxIterations, maxTokens, maxWallTimeMs, safetyLevel },
    skills: string[],  // 对应 SKILL.md id
    tools: string[],   // 对应 access matrix（02 文档第四节）
  },
  sessionId: string,
  userId: string,
  promptCachePrefix?: string,  // ST-00 注入
}
```

---

## 三、Core Tier 6 Agents

### AG-01-LD · Leader

**Tier**: Core
**用于 Stage**: ST-01-PLAN
**Skills**: SK-01-PLAN
**Tools**: `short-term-memory`, `long-term-memory`, `rag-search`, `knowledge-graph`, `TL-07-MODEL`（access matrix 只读）

#### Identity

- role.id: `topic-insights.leader.${missionId}`
- role.name: `研究协调专家 (Research Leader)`
- role.description: `对研究主题进行全局规划：分析目标、决定维度、分配 agent 和模型、制定执行策略。`
- workStyle: `structured`

#### Goal

- summary: 动态构建，包含 topic name + topic type + userPrompt + existingDimensions + availableModels + anchorArticle (if EVENT)
- successCriteria:
  - 3-8 个 dimension（topicType 决定）
  - 每个 dimension 有 searchQueries ≥ 1 + dataSources ≥ 1
  - 每个 agentAssignment 的 modelId 必须在 availableModels 中
  - 总 agentAssignments 包含 dimension_researcher + quality_reviewer + report_writer 三种角色

#### Persona

- tone: `formal`
- language: `ctx.topic.language`
- style: `资深研究战略顾问`

#### Constraints

- maxIterations: 4（这是规划，不需要 ReAct loop 深度）
- maxTokens: 30_000
- maxWallTimeMs: 60_000
- safetyLevel: `standard`

#### Input (buildTask)

```typescript
{
  goal: `为主题「${topic.name}」制定研究规划`,
  input: {
    topicId, topicName, topicType,
    userPrompt,
    // ★ v2.1（2026-04-23）：传整个 CapabilitySnapshot，取代离散的 availableModels 字段
    //   详见 11-capability-discovery.md
    capabilities: identity.capabilities, // CapabilitySnapshot
    anchorArticleContent,        // CP-1.5: EVENT 类型必传
    existingDimensions,          // CP-1.6
    language: topic.language,
    depthConfig: { researchDepth, maxDimensions, ... },
  },
}
```

system prompt 自动展开 `capabilities`：

```
可用 CHAT 模型：gpt-4o / claude-sonnet-4-5 / grok-4
可用 REASONING 模型：o1-preview
可用工具：TL-01-SEARCH (healthy) / TL-03-RAG (healthy)
可用 agent：AG-01-LD, AG-03-SW, AG-04-SR, AG-05-MEX, AG-06-QR, AG-11-SY
recommendedDepth：standard（已根据 capabilities 降级）
规则：agentAssignments[].modelId 必须在上述 CHAT/REASONING 列表内或留空
```

#### Output

`LeaderPlanSchema`（09-data-contracts.md 定义）+ custom `validateLeaderPlan`（检查 `modelId ∈ capabilities.availableModels`，`dataSources ⊆ capabilities.availableTools`）。

Zod 或 business-rule 校验失败 → `LlmInvokerService` 自动 error-fed retry（最多 3 轮），把"上次你选了 X，但不可用"反喂到下一轮 prompt。

---

### AG-03-SW · SectionWriter

**Tier**: Core
**用于 Stage**: ST-03-WRITE（per section）
**Skills**: SK-03-WRITE
**Tools**: `TL-06-SEARCHMULTI`, `rag-search`, `arxiv-search`, `semantic-scholar`, `pubmed`, `github-search`, `hackernews-search`, `web-search`, `knowledge-graph`, `TL-03-FIGEXT`, `TL-02-EVSAVE` (WRITE), `short-term-memory`

#### Identity

- role.id: `topic-insights.section-writer.${dimensionId}.${sectionId}`
- role.name: `章节研究写作员`
- role.description: `根据 section outline（keyPoints / targetWords）完成该 section 的深度研究和写作。搜集证据、评估可信度、引用数据，产出结构化 SectionResult。`
- workStyle: `structured`

#### Goal

- successCriteria:
  - targetWords 达成（± 15%）
  - 至少 keyPoints.length 个 keyFindings，每个引用 ≥ 2 evidence
  - 调用 `TL-02-EVSAVE` 保存所有使用过的 evidence（citationIndex 自动分配）
  - 不违反 iron-wall 规则（UT-IW-\*）

#### Constraints

- maxIterations: 10
- maxTokens: 20_000 per section
- maxWallTimeMs: 180_000

#### Input (buildTask)

```typescript
{
  goal: `写作 dimension "${dimensionName}" 的 section "${sectionTitle}"`,
  input: {
    topicId, topicName, topicType,
    dimensionId, dimensionName, dimensionDescription,
    sectionPlan: {               // from DimensionOutline
      id, title, description, targetWords, keyPoints, dependsOn,
    },
    evidenceSummary,             // UT-RS-EVSUM from ST-02
    figureSummary,               // UT-RS-FIGSUM from ST-02
    upstreamSectionSummaries?: Array<{id, title, summary}>, // for dependsOn
    language: topic.language,
  },
}
```

#### Output

`SectionResultSchema`

**Zod validation 外的业务规则**：

- `wordCount` 必须 ≥ targetWords × 0.85
- `citationCount` 必须 ≥ keyFindings.length × 1.5

---

### AG-04-SR · SectionReviewer

**Tier**: Core
**用于 Stage**: ST-04-REVIEW
**Skills**: SK-04-REVIEW
**Tools**: `rag-search`, `knowledge-graph`, `TL-04-DIMMEM`（**禁止 TL-02-EVSAVE**）

#### Identity

- role.name: `章节审核员`
- role.description: `独立审核 section 质量：9 维评审 + 5 条扣分规则。输出 5 轴独立评分（禁止 fan-out）+ 修订指令。附带抽取 claims 供 V5 认知循环使用。`
- workStyle: `structured`

#### Constraints

- maxIterations: 6
- maxTokens: 15_000
- maxWallTimeMs: 120_000
- safetyLevel: `strict`

#### Input

```typescript
{
  goal: `审核 section "${title}"`,
  input: {
    sectionResult: SectionResult,  // AG-03 输出
    sectionPlan: SectionPlan,
    dimensionContext: { name, description },
    revisionRound: number,         // 1 or 2
    priorReview?: SectionReview,   // if this is round 2
  },
}
```

#### Output

`SectionReviewSchema` + custom `validateSectionReview`（检测 fan-out 模式）

---

### AG-05-ME · DimensionMetaExtractor

**Tier**: Core
**用于 Stage**: ST-05-INTEGRATE
**Skills**: SK-13-META
**Tools**: 无（纯 LLM transformation）

#### Identity

- role.name: `维度元信息提取员`
- role.description: `从整合后的 section 合集中提取 dimension 级 summary + keyFindings + trends + challenges + opportunities。不创造新内容，只做总结提炼。`

#### Constraints

- maxIterations: 3
- maxTokens: 10_000

#### Input

```typescript
{
  goal: `提取 dimension "${name}" 的元信息`,
  input: {
    dimensionId, dimensionName,
    integratedSections: string,  // 由 UT-ASM-INTEGRATE 合成
    evidenceCount: number,       // from DB (CP-2.6c)
  },
}
```

#### Output

`DimensionMetaSchema`

---

### AG-06-QR · QualityReviewer（dimension + overall scopes）

**Tier**: Core
**用于 Stage**: ST-04（dimension scope 可选）+ ST-07 前置（overall scope）
**Skills**: SK-06-QR-DIM, SK-07-QR-OVR
**Tools**: `rag-search`（read-only）, `TL-04-DIMMEM`（**禁止 TL-02-EVSAVE**）

#### Identity（动态）

根据 `ctx.scope` 决定：

- `dimension`: role.name = `维度质量审核员`, 使用 SK-06
- `overall`: role.name = `跨维度综合审核员`, 使用 SK-07

#### Constraints

- maxIterations: 6
- maxTokens: 20_000

#### Input

```typescript
{
  goal: scope === 'dimension'
    ? `审核 dimension "${dimensionName}" 的质量`
    : `审核整体研究 mission 的质量`,
  input: {
    scope,
    // if dimension:
    dimensionId?, dimensionName?, dimensionMeta?, sectionReviews?,
    // if overall:
    dimensionMetas?: DimensionMeta[],
    crossDimensionIssues?,
  },
}
```

#### Output

`QualityReviewSchema`（discriminated union by scope）

---

### AG-11-SY · Synthesizer

**Tier**: Core
**用于 Stage**: ST-07-SYNTH
**Skills**: SK-12-SYN
**Tools**: `rag-search`（read-only）, `TL-04-DIMMEM`（**严禁** `TL-02-EVSAVE`，防止假证据）

#### Identity

- role.name: `报告综合专家`
- role.description: `基于 dimension metas + cross-dimension facts 产出 executive summary + preface + fullMarkdown + highlights + risk matrix + recommendations。严禁重写 dimension 正文；严禁新增来源；严禁臆造数据。`
- workStyle: `structured`

#### Goal

- successCriteria:
  - executiveSummary 300-2000 字（含 3-5 核心结论、3-5 量化指标、2-3 风险、2-3 行动建议）
  - crossDimensionAnalysis 识别 2-3 因果链
  - riskMatrix 分 高/中/低 三档
  - recommendations 对应具体维度发现
  - 不修改 dimension metas

#### Constraints

- maxIterations: 8
- maxTokens: 40_000
- maxWallTimeMs: 180_000

#### Input

```typescript
{
  goal: `为 topic "${name}" 生成综合报告`,
  input: {
    topicId, topicName, topicType,
    dimensionMetas: DimensionMeta[],        // ST-05 输出
    integratedSectionsPerDim: Record<string, string>, // UT-ASM-INTEGRATE
    crossDimensionFacts?: ExtractedFact[],  // ST-06（if 存在）
    overallReview?: QualityReview,          // ST-04 overall scope（if 存在）
    userPrompt?,
  },
}
```

#### Output

`SynthesisResultSchema`

---

## 四、Enhancement Tier 5 Agents

### AG-02-DP · DimensionPlanner

**Tier**: Enhancement
**用于 Stage**: ST-03A（在 SectionWriter 之前出 outline）
**Skills**: SK-02-OUTLINE
**Tools**: `TL-04-DIMMEM`, `rag-search`

#### Identity

- role.name: `维度规划员`
- role.description: `对单个 dimension 规划 sections：带所有其他 dimensions 的名字和描述作为上下文，避免跨维度重复。输出 3-8 个 section，含 dependsOn 图。`

#### Constraints

- maxIterations: 4
- maxTokens: 15_000

#### Input

```typescript
{
  goal: `为 dimension "${name}" 规划 sections`,
  input: {
    dimensionId, dimensionName, dimensionDescription,
    allDimensions: Array<{id, name, description}>,  // cross-dim context
    researchDepth,
    existingSections?: SectionPlan[],  // incremental mode
  },
}
```

#### Output

`DimensionOutlineSchema`

---

### AG-07-FC · FactChecker

**Tier**: Enhancement
**用于 Stage**: ST-10-FACT（thorough+）
**Skills**: SK-08-FC
**Tools**: `rag-search`, `knowledge-graph`

#### Identity

- role.name: `事实核查员`
- role.description: `针对最终 report 的 claims（AG-04 附带提取）+ 整体文本，对照 evidence 库验证每个事实性陈述。产出 accuracy score + issue list。`
- safetyLevel: `strict`

#### Constraints

- maxIterations: 8
- maxTokens: 30_000

#### Input

```typescript
{
  goal: `核查 report 事实准确性`,
  input: {
    reportContent: string,        // full markdown
    allClaims: Array<{id, statement, sectionId, evidenceIds}>,
    evidenceSummaries: Array<{id, title, snippet}>,
  },
}
```

#### Output

`FactCheckResultSchema`（包含 validateClaims 结果，CP-3.4 合并）

---

### AG-08-GS · GapSearcher

**Tier**: Enhancement
**用于 Stage**: ST-06B（cognitive loop 第 2 步）
**Skills**: SK-10-GAPQ
**Tools**: 无（只出 queries）

#### Constraints

- maxIterations: 2
- maxTokens: 5_000

#### Input

```typescript
{
  goal: `为未验证的 claims 生成补充搜索 queries`,
  input: {
    unverifiedClaims: Array<{id, statement, failureReason}>,
    existingEvidenceSummary: string,
  },
}
```

#### Output

`GapSearchResultSchema`

---

### AG-09-HV · HypothesisVerifier

**Tier**: Enhancement
**用于 Stage**: ST-06A
**Skills**: SK-09-HYPO
**Tools**: `rag-search`

#### Constraints

- maxIterations: 6
- maxTokens: 15_000

#### Input

```typescript
{
  goal: `验证 claims 的证据支持`,
  input: {
    claims: Array<{id, statement, sectionId, sourceEvidenceIds}>,
    evidenceSummary: string,
  },
}
```

#### Output

`HypothesisVerifyResultSchema`

---

### AG-10-FX · FactExtractor

**Tier**: Enhancement
**用于 Stage**: ST-07 前（跨维度事实提取）
**Skills**: SK-11-CROSSFACTS
**Tools**: `TL-04-DIMMEM`

#### Constraints

- maxIterations: 4
- maxTokens: 12_000

#### Input

```typescript
{
  goal: `跨维度提取关键事实`,
  input: {
    dimensionMetas: DimensionMeta[],
    topicType,
  },
}
```

#### Output

`CrossDimensionFactsSchema`

---

## 五、Advanced Tier 6 Agents

### AG-12-SREM · SectionRemediator

**Tier**: Advanced
**用于 Stage**: ST-08（quality gate fail 时）
**Skills**: SK-14-REM
**Tools**: `rag-search`

#### Identity

- role.description: `根据 quality gate 的 violation report 修复 section 内容：补引用 / 调整结构 / 去 fluff / 强化论证 / 补数据。不改变核心观点。`

#### Constraints

- maxIterations: 5
- maxTokens: 15_000

#### Input

```typescript
{
  goal: `修复 section "${id}" 的质量问题`,
  input: {
    originalContent: string,
    violations: ViolationReport[],  // UT-QG-RULES 输出
    availableEvidence: Evidence[],
  },
}
```

#### Output

`RemediationResultSchema`

---

### AG-13-RE · ReportEvaluator

**Tier**: Advanced
**用于 Stage**: ST-09（thorough+）
**Skills**: SK-15-10DIM
**Tools**: 无

#### Constraints

- maxIterations: 3
- maxTokens: 12_000

#### Input

```typescript
{
  goal: `对最终 report 做 10 维评审`,
  input: {
    reportContent: string,
    plan: LeaderPlan,  // 用于 "plan alignment" 维度
    evidenceCount: number,
    wordCountExpected: number,
  },
}
```

#### Output

`ReportEvaluationSchema`

---

### AG-14-LX · LatexRepair

**Tier**: Advanced
**用于 Stage**: ST-12（条件：UT-LTX-VALIDATE 有 issues）
**Skills**: SK-16-LTX
**Tools**: 无

#### Constraints

- maxIterations: 3
- maxTokens: 8_000

#### Input

```typescript
{
  goal: `修复 LaTeX 语法错误`,
  input: {
    reportContent: string,
    issues: Array<{line, issue}>,  // from UT-LTX-VALIDATE
  },
}
```

#### Output

`LatexRepairResultSchema`

---

### AG-15-RED · ReportEditor

**Tier**: Advanced
**用于 endpoint**: 用户编辑段落时的辅助
**Skills**: SK-17-EDIT
**Tools**: 无

#### Input

```typescript
{
  goal: `按用户指令编辑 report 段落`,
  input: {
    sectionContent: string,
    editInstruction: string,
    editContext?: string,  // surrounding content
  },
}
```

#### Output

`ReportEditResultSchema`

---

### AG-16-MA · MissionAdjuster

**Tier**: Advanced
**用于 endpoint**: 用户 `@Leader` 消息调整 mission
**Skills**: SK-18-ADJ
**Tools**: 无

#### Input

```typescript
{
  goal: `处理用户的 mission 调整请求`,
  input: {
    currentPlan: LeaderPlan,
    userMessage: string,
    missionStatus,
  },
}
```

#### Output

`MissionAdjustmentSchema`

---

### AG-17-LDP · LeaderDispatcher

**Tier**: Advanced
**用于 endpoint**: `leader/chat`（Claude CLI 风格）
**Skills**: SK-19-IDEC
**Tools**: `TL-07-MODEL`（for agent assignment 的 modelId 选择）

#### Identity

- role.description: `解码用户输入：DIRECT_ANSWER / CREATE_TODO / CLARIFY / ACKNOWLEDGE。如果是 CREATE_TODO，同一次 LLM 调用内直接给出 agentAssignment（合并 CP-C.18 + C.19）。`

#### Constraints

- maxIterations: 3
- maxTokens: 10_000

#### Input

```typescript
{
  goal: `解码用户消息并决定响应`,
  input: {
    userMessage: string,
    topicContext: { id, name, type },
    availableAgents: Array<{type, role}>,
    availableModels: Array<{id, displayName}>,
    currentMissionStatus?,
  },
}
```

#### Output

`UserIntentSchema`

---

## 六、Agent 共享基类实现（补充 02 设计）

```typescript
// harness-agents/common/base-runner.ts

export abstract class BaseAgentRunner<TContext, TOutput> {
  constructor(
    protected readonly harness: HarnessFacade,
    protected readonly promptCache: PromptCacheCoordinatorService,
    protected readonly logger: Logger,
  ) {}

  async run(
    ctx: TContext & { missionId: string },
    signal?: AbortSignal, // CP-M.7
  ): Promise<AgentRunResult<TOutput>> {
    const startMs = Date.now();

    // CP-C.1: Cache prefix injection
    const cachePrefix = this.promptCache.getPrefix(ctx.missionId);
    const spec = this.buildSpec(ctx);
    if (cachePrefix) spec.promptCachePrefix = cachePrefix;

    const task = this.buildTask(ctx);

    try {
      const result = await this.harness.execute(spec, task, { signal });
      const rawText =
        typeof result.output === "string"
          ? result.output
          : JSON.stringify(result.output);

      const { valid, data, errors } = this.parseAndValidate(rawText, ctx);

      return {
        ok: result.state === "completed" && valid,
        state: result.state,
        iterations: result.iterations,
        latencyMs: Date.now() - startMs,
        output: data ?? null,
        rawOutputText: rawText,
        errorMessage: errors?.join("; "),
        tokensUsed: result.tokensUsed ?? 0,
        costUsd: result.costUsd ?? 0,
        toolCallsCount: result.toolCallsCount ?? 0,
        cacheHitRate: result.cacheHitRate,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      return {
        ok: false,
        state: "failed",
        iterations: 0,
        latencyMs: Date.now() - startMs,
        output: null,
        rawOutputText: "",
        errorMessage: err instanceof Error ? err.message : String(err),
        tokensUsed: 0,
        costUsd: 0,
        toolCallsCount: 0,
      };
    }
  }

  protected abstract buildSpec(ctx: TContext): IAgentSpec;
  protected abstract buildTask(ctx: TContext): IAgentTask;
  protected abstract parseAndValidate(
    rawText: string,
    ctx: TContext,
  ): { valid: boolean; data?: TOutput; errors?: string[] };
}
```
