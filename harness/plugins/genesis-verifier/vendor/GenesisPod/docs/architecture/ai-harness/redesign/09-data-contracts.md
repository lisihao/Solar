# Topic Insights · Data Contracts（Zod Schemas）

> 版本：v1
>
> 目的：为 17 个 Agent 和 14 个 Stage 定义**运行时类型校验**的 Zod schema。**每个 agent runner 的 parseOutput 必须调 schema.parse()**，类型验证失败时 `validateOutput` 返回 `{ valid: false, errors }`，runner 返回 `ok: false`。
>
> 价值：用 Zod 强制结构化，杜绝 agent 自由发挥导致的 fan-out 5 轴评分、编造 evidenceUsed 等旧 bug。

---

## 一、通用 schema building blocks

### 1.1 基础类型

```typescript
// harness-agents/common/schemas/primitives.ts

import { z } from "zod";

export const Score0To100 = z.number().int().min(0).max(100);
export const Score0To10 = z.number().min(0).max(10);
export const UnitInterval = z.number().min(0).max(1);

export const EvidenceRef = z.object({
  evidenceId: z.string().uuid(),
  citationIndex: z.number().int().positive(),
});

export const Significance = z.enum(["high", "medium", "low"]);
export const Severity = z.enum(["critical", "major", "minor"]);
export const QualityLevel = z.enum([
  "excellent",
  "good",
  "acceptable",
  "needs_revision",
  "rejected",
]);
```

### 1.2 Token / Cost 元信息

```typescript
export const AgentRunMetrics = z.object({
  tokensUsed: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  iterations: z.number().int().nonnegative(),
  cacheHitRate: UnitInterval.optional(),
  toolCallsCount: z.number().int().nonnegative(),
});
```

---

## 二、17 个 Agent 输出 Schema

> **v2.1 架构补丁（2026-04-23）**：Leader 的 input 从离散字段（`availableModels: string[]`）
> 收拢为完整 `CapabilitySnapshot`，详见 [11-capability-discovery.md](./11-capability-discovery.md)。
> Business-rule 校验（`validateLeaderPlan`）从接受 `availableModels: string[]` 升级为接受
> `capabilities: CapabilitySnapshot`，校验维度同步扩展（modelId / tool / agent / depth 是否 align）。

### AG-00 · CapabilitySnapshot（前置契约）

```typescript
// ai-engine/runtime/resource/capability-discovery.types.ts

export const CapabilitySnapshotSchema = z.object({
  generatedAt: z.string(),
  userId: z.string().min(1),
  requestedDepth: z.enum(["quick", "standard", "thorough", "deep"]),
  availableModels: z.object({
    CHAT: z.array(
      z.object({
        modelId: z.string().min(1),
        provider: z.string().min(1),
        modelType: z.literal("CHAT"),
        contextWindow: z.number().int().positive(),
        costTier: z.enum(["cheap", "standard", "premium"]),
        healthy: z.boolean(),
        recentErrorRate: z.number().min(0).max(1).optional(),
      }),
    ),
    REASONING: z.array(z.any()), // same shape, modelType=REASONING
    EMBEDDING: z.array(z.any()),
    VISION: z.array(z.any()),
  }),
  userKeys: z.object({
    hasByok: z.boolean(),
    byokProviders: z.array(z.string()),
    sharedKeyAvailable: z.boolean(),
  }),
  availableAgents: z.array(z.string()),
  availableTools: z.array(
    z.object({
      toolId: z.string(),
      healthy: z.boolean(),
      dependencyNote: z.string().optional(),
    }),
  ),
  dbSchema: z.record(z.string(), z.boolean()), // { harnessRunMetrics: true, ... }
  externalDeps: z.record(
    z.string(),
    z.object({
      healthy: z.boolean(),
      checkedAt: z.string(),
      note: z.string().optional(),
    }),
  ),
  recommendedDepth: z.enum(["quick", "standard", "thorough", "deep"]),
  degradations: z.array(
    z.object({
      kind: z.enum([
        "model_missing",
        "tool_unhealthy",
        "schema_missing",
        "byok_exhausted",
        "depth_downgrade",
      ]),
      detail: z.string(),
      severity: z.enum(["info", "warn", "error"]),
    }),
  ),
});

export type CapabilitySnapshot = z.infer<typeof CapabilitySnapshotSchema>;
```

### AG-01-LD · Leader

```typescript
// harness-agents/leader/schemas.ts

export const LeaderPlanSchema = z.object({
  taskUnderstanding: z.object({
    topic: z.string().min(1),
    scope: z.string().min(1),
    objectives: z.array(z.string()).min(1).max(8),
    constraints: z.array(z.string()).optional(),
  }),
  dimensions: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(50),
        description: z.string().min(10),
        searchQueries: z.array(z.string()).min(1).max(10),
        dataSources: z
          .array(
            z.enum([
              "web",
              "rag",
              "academic",
              "github",
              "hackernews",
              "social",
              "policy",
              "finance",
              "weather",
            ]),
          )
          .min(1),
        priority: z.number().int().min(1).max(10),
        reasoning: z.string().min(20).describe("why this dimension matters"),
      }),
    )
    .min(2)
    .max(10),
  agentAssignments: z
    .array(
      z.object({
        agentId: z.string().min(1),
        agentName: z.string().min(1),
        agentType: z.enum([
          "dimension_researcher",
          "quality_reviewer",
          "report_writer",
        ]),
        assignedDimensions: z.array(z.string()),
        role: z.string().min(1),
        modelId: z.string().min(1).describe("must be from availableModels"),
        skills: z.array(z.string()).optional(),
        tools: z.array(z.string()).optional(),
        reasoning: z.string().describe("why this model for this agent"),
      }),
    )
    .min(1),
  executionStrategy: z.object({
    parallelism: z.number().int().min(1).max(10),
    priorityOrder: z.array(z.string()),
    estimatedDurationMin: z.number().int().positive(),
  }),
});

export type LeaderPlan = z.infer<typeof LeaderPlanSchema>;

// v2.1（2026-04-23）：校验 plan 与 capabilities 对齐
export function validateLeaderPlan(
  plan: LeaderPlan,
  capabilities: CapabilitySnapshot,
): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];
  const validModelIds = new Set<string>([
    "", // 空串 = 由下游 TaskProfile 自动解析，允许
    ...capabilities.availableModels.CHAT.map((m) => m.modelId),
    ...capabilities.availableModels.REASONING.map((m) => m.modelId),
  ]);
  const validToolIds = new Set(
    capabilities.availableTools.filter((t) => t.healthy).map((t) => t.toolId),
  );

  for (const a of plan.agentAssignments) {
    if (!validModelIds.has(a.modelId)) {
      errors.push(
        `agentAssignments[${a.agentId}].modelId "${a.modelId}" not in availableModels. ` +
          `Valid: [${[...validModelIds].join(", ")}]`,
      );
    }
  }
  // dimensions referenced in assignedDimensions must exist
  const dimIds = new Set(plan.dimensions.map((d) => d.id));
  for (const a of plan.agentAssignments) {
    for (const dimId of a.assignedDimensions) {
      if (!dimIds.has(dimId)) {
        errors.push(
          `agentAssignments[${a.agentId}].assignedDimensions contains unknown id: ${dimId}`,
        );
      }
    }
    // tool 校验：agent 指定的 tools 必须在可用池里（tools 字段可选，为空跳过）
    for (const t of a.tools ?? []) {
      if (!validToolIds.has(t)) {
        errors.push(
          `agentAssignments[${a.agentId}].tools contains unavailable tool: ${t}`,
        );
      }
    }
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
```

### AG-02-DP · DimensionPlanner

```typescript
export const SectionPlanSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(100),
  description: z.string().min(20),
  targetWords: z.number().int().min(300).max(5000),
  keyPoints: z.array(z.string()).min(2).max(8),
  dependsOn: z
    .array(z.string())
    .optional()
    .describe("section ids this depends on"),
  suggestedFigures: z.number().int().min(0).max(5),
});

export const DimensionOutlineSchema = z.object({
  dimensionId: z.string(),
  sections: z.array(SectionPlanSchema).min(3).max(8),
  crossReferences: z
    .array(
      z.object({
        fromSection: z.string(),
        toDimension: z.string(),
        reason: z.string(),
      }),
    )
    .optional(),
});

export type DimensionOutline = z.infer<typeof DimensionOutlineSchema>;
```

### AG-03-SW · SectionWriter

```typescript
export const KeyFindingSchema = z.object({
  finding: z.string().min(20).max(500),
  significance: Significance,
  evidenceIds: z.array(z.string().uuid()).min(1).max(10),
  implication: z.string().optional(),
});

export const SectionResultSchema = z.object({
  sectionId: z.string(),
  title: z.string(),
  content: z.string().min(300), // markdown
  wordCount: z.number().int().min(200),
  keyFindings: z.array(KeyFindingSchema).min(1).max(10),
  citationCount: z.number().int().nonnegative(),
  figureReferences: z
    .array(
      z.object({
        evidenceId: z.string().uuid(),
        figureIndex: z.number().int().nonnegative(),
        position: z.string().regex(/^after_paragraph_\d+$/),
      }),
    )
    .optional(),
  selfEvalScore: Score0To100.optional().describe("self-rated 0-100"),
  selfEvalIssues: z.array(z.string()).optional(),
});

export type SectionResult = z.infer<typeof SectionResultSchema>;
```

### AG-04-SR · SectionReviewer

```typescript
export const ReviewIssueSchema = z.object({
  type: z.enum([
    "missing_coverage",
    "weak_evidence",
    "outdated_info",
    "logical_gap",
    "shallow_analysis",
    "missing_perspective",
    "iron_wall_violation",
  ]),
  severity: Severity,
  description: z.string().min(10),
  suggestedFix: z.string().optional(),
  lineNumbers: z.array(z.number().int().positive()).optional(),
});

export const SectionReviewSchema = z.object({
  sectionId: z.string(),
  overallScore: Score0To100,
  // Strict 5-axis — NOT derived from overallScore (CP-2.14 fix)
  axisScores: z.object({
    breadth: Score0To100,
    depth: Score0To100,
    evidence: Score0To100,
    coherence: Score0To100,
    currency: Score0To100,
  }),
  issues: z.array(ReviewIssueSchema),
  suggestions: z.array(z.string()).max(10),
  needsRevision: z.boolean(),
  revisionInstructions: z.string().optional(),
  // V5 claims extraction (CP-2.11) — piggyback on review call
  claims: z
    .array(
      z.object({
        id: z.string(),
        statement: z.string().min(20),
        evidenceIds: z.array(z.string().uuid()),
        importance: Significance,
      }),
    )
    .optional(),
});

export type SectionReview = z.infer<typeof SectionReviewSchema>;

// Custom validation: axisScores must not all equal overallScore (detect fan-out)
export function validateSectionReview(review: SectionReview): {
  valid: boolean;
  errors?: string[];
} {
  const { overallScore, axisScores } = review;
  const axes = Object.values(axisScores);
  // If all 5 axes are identical to overallScore, reject as fan-out
  if (axes.every((a) => a === overallScore)) {
    return {
      valid: false,
      errors: [
        "axisScores appears to be fan-out from overallScore (all 5 axes identical). Reviewer must score each axis independently.",
      ],
    };
  }
  // If stddev of axes < 2 (very low variance), warn
  const mean = axes.reduce((a, b) => a + b, 0) / axes.length;
  const stddev = Math.sqrt(
    axes.reduce((s, a) => s + (a - mean) ** 2, 0) / axes.length,
  );
  if (stddev < 2) {
    return {
      valid: false,
      errors: [
        `axisScores variance too low (stddev=${stddev.toFixed(2)}). Likely fan-out pattern.`,
      ],
    };
  }
  return { valid: true };
}
```

### AG-05-ME · DimensionMetaExtractor

```typescript
export const DimensionMetaSchema = z.object({
  dimensionId: z.string(),
  summary: z.string().min(100).max(1500),
  keyFindings: z.array(KeyFindingSchema).min(3).max(10),
  trends: z
    .array(
      z.object({
        trend: z.string(),
        direction: z.enum(["up", "down", "stable"]),
        timeframe: z.string().optional(),
        drivers: z.string().optional(),
        evidenceIds: z.array(z.string().uuid()),
      }),
    )
    .max(10),
  challenges: z
    .array(
      z.object({
        challenge: z.string(),
        impact: z.string(),
        evidenceIds: z.array(z.string().uuid()),
      }),
    )
    .max(10),
  opportunities: z
    .array(
      z.object({
        opportunity: z.string(),
        potential: z.string(),
        evidenceIds: z.array(z.string().uuid()),
      }),
    )
    .max(10),
  confidenceLevel: z.enum(["high", "medium", "low"]),
});

export type DimensionMeta = z.infer<typeof DimensionMetaSchema>;
```

### AG-06-QR · QualityReviewer（2 种 scope）

```typescript
// Dimension-level scope (CP-2.14)
export const DimensionQualityReviewSchema = z.object({
  scope: z.literal("dimension"),
  dimensionId: z.string(),
  qualityLevel: QualityLevel,
  overallScore: Score0To100,
  axisScores: z.object({
    breadth: Score0To100,
    depth: Score0To100,
    evidence: Score0To100,
    coherence: Score0To100,
    currency: Score0To100,
  }),
  issues: z.array(ReviewIssueSchema),
  suggestions: z.array(z.string()).max(5),
  needsReresearch: z.boolean(),
  reresearchFocus: z.array(z.string()).optional(),
});

// Overall-level scope (CP-3.2)
export const OverallQualityReviewSchema = z.object({
  scope: z.literal("overall"),
  qualityLevel: QualityLevel,
  overallScore: Score0To100,
  dimensionsReviewed: z.number().int().positive(),
  crossDimensionIssues: z.array(
    z.object({
      type: z.enum(["contradiction", "redundancy", "coverage_gap"]),
      dimensions: z.array(z.string()).min(2),
      description: z.string(),
    }),
  ),
  coverageAnalysis: z.object({
    coveredAspects: z.array(z.string()),
    missingAspects: z.array(z.string()),
    coverageScore: Score0To100,
  }),
  recommendations: z.array(z.string()).min(1).max(10),
  needsReresearch: z.boolean(),
  dimensionsToReresearch: z.array(z.string()),
});

export const QualityReviewSchema = z.discriminatedUnion("scope", [
  DimensionQualityReviewSchema,
  OverallQualityReviewSchema,
]);
```

### AG-07-FC · FactChecker

```typescript
export const FactCheckResultSchema = z.object({
  accuracyScore: Score0To100,
  totalClaimsChecked: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  disputed: z.number().int().nonnegative(),
  unverified: z.number().int().nonnegative(),
  issues: z.array(
    z.object({
      claimStatement: z.string(),
      claimLocation: z.string().describe("section id or paragraph index"),
      status: z.enum(["disputed", "unverified", "contradicted"]),
      reason: z.string(),
      conflictingEvidence: z.array(z.string().uuid()).optional(),
    }),
  ),
  recommendations: z.array(z.string()),
});
```

### AG-08-GS · GapSearcher

```typescript
export const GapSearchQuerySchema = z.object({
  query: z.string().min(5).max(200),
  searchType: z.enum(["academic", "web", "policy", "finance"]),
  priority: z.number().int().min(1).max(5),
  gapAddressed: z.string().describe("which unverified claim or gap"),
});

export const GapSearchResultSchema = z.object({
  queries: z.array(GapSearchQuerySchema).min(1).max(10),
  reasoning: z.string(),
});
```

### AG-09-HV · HypothesisVerifier

```typescript
export const HypothesisVerificationSchema = z.object({
  claimId: z.string(),
  claimStatement: z.string(),
  status: z.enum(["verified", "disputed", "unverified"]),
  evidenceIds: z.array(z.string().uuid()),
  confidence: UnitInterval,
  reasoning: z.string(),
});

export const HypothesisVerifyResultSchema = z.object({
  verifications: z.array(HypothesisVerificationSchema),
  stats: z.object({
    verified: z.number().int().nonnegative(),
    disputed: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
  }),
});
```

### AG-10-FX · FactExtractor

```typescript
export const ExtractedFactSchema = z.object({
  statement: z.string().min(10).max(500),
  sourceDimensions: z.array(z.string()).min(1),
  supportingEvidenceIds: z.array(z.string().uuid()).min(1),
  importance: Significance,
  category: z.enum([
    "trend",
    "data_point",
    "insight",
    "warning",
    "opportunity",
  ]),
});

export const CrossDimensionFactsSchema = z.object({
  facts: z.array(ExtractedFactSchema).max(30),
  contradictions: z
    .array(
      z.object({
        factsInvolved: z.array(z.number()).min(2),
        description: z.string(),
      }),
    )
    .optional(),
});
```

### AG-11-SY · Synthesizer

```typescript
export const HighlightSchema = z.object({
  title: z.string().min(5).max(100),
  description: z.string().min(20).max(500),
  relatedDimensions: z.array(z.string()),
  evidenceIds: z.array(z.string().uuid()),
});

export const RiskMatrixEntrySchema = z.object({
  risk: z.string(),
  likelihood: z.enum(["high", "medium", "low"]),
  impact: z.enum(["high", "medium", "low"]),
  mitigation: z.string().optional(),
});

export const SynthesisResultSchema = z.object({
  executiveSummary: z.string().min(300).max(2000),
  preface: z.string().min(100).max(800).optional(),
  fullMarkdown: z
    .string()
    .min(2000)
    .describe("complete report body, with [n] citations"),
  highlights: z.array(HighlightSchema).min(3).max(8),
  crossDimensionAnalysis: z.string().min(200).optional(),
  riskMatrix: z.array(RiskMatrixEntrySchema).max(15).optional(),
  recommendations: z.array(z.string()).min(3).max(10),
  totalSources: z.number().int().nonnegative(),
  totalWords: z.number().int().positive(),
});

export type SynthesisResult = z.infer<typeof SynthesisResultSchema>;
```

### AG-12-SREM · SectionRemediator

```typescript
export const RemediationResultSchema = z.object({
  sectionId: z.string(),
  originalIssues: z.array(z.string()),
  fixedContent: z.string().min(300),
  changes: z.array(
    z.object({
      type: z.enum([
        "add_citation",
        "fix_structure",
        "remove_fluff",
        "strengthen_argument",
        "add_data",
      ]),
      description: z.string(),
    }),
  ),
  confidence: UnitInterval,
});
```

### AG-13-RE · ReportEvaluator

```typescript
export const ReportEvaluationSchema = z.object({
  overallScore: Score0To100,
  dimensions: z.object({
    content_completeness: Score0To10,
    analytical_depth: Score0To10,
    evidence_usage: Score0To10,
    logical_coherence: Score0To10,
    word_count_compliance: Score0To10,
    plan_alignment: Score0To10,
    writing_quality: Score0To10,
    figure_usage: Score0To10,
    section_transitions: Score0To10,
    independent_analysis: Score0To10,
  }),
  strengths: z.array(z.string()).max(5),
  weaknesses: z.array(z.string()).max(5),
  recommendation: z.enum(["publish", "minor_revise", "major_revise", "reject"]),
});
```

### AG-14-LX · LatexRepair

```typescript
export const LatexRepairResultSchema = z.object({
  repairedContent: z.string(),
  fixesApplied: z.array(
    z.object({
      line: z.number().int().positive(),
      issue: z.string(),
      fix: z.string(),
    }),
  ),
  remainingIssues: z.array(z.string()).optional(),
});
```

### AG-15-RED · ReportEditor

```typescript
export const ReportEditResultSchema = z.object({
  editedContent: z.string(),
  changeDescription: z.string(),
  affectedSections: z.array(z.string()).optional(),
});
```

### AG-16-MA · MissionAdjuster

```typescript
export const MissionAdjustmentSchema = z.object({
  adjustmentType: z.enum([
    "add_dimension",
    "remove_dimension",
    "modify_focus",
    "change_depth",
  ]),
  changes: z.record(z.unknown()),
  reasoning: z.string(),
  requiresReplan: z.boolean(),
});
```

### AG-17-LDP · LeaderDispatcher

```typescript
export const UserIntentSchema = z.object({
  decisionType: z.enum([
    "DIRECT_ANSWER",
    "CREATE_TODO",
    "CLARIFY",
    "ACKNOWLEDGE",
  ]),
  understanding: z.string().min(10),
  response: z.string().min(10),
  todo: z
    .object({
      title: z.string(),
      description: z.string(),
      dimensionId: z.string().optional(),
      priority: z.number().int().min(1).max(10),
    })
    .optional(),
  agentAssignment: z
    .object({
      agentId: z.string(),
      agentName: z.string(),
      agentType: z.string(),
      role: z.string(),
      modelId: z.string(),
      skills: z.array(z.string()).optional(),
      tools: z.array(z.string()).optional(),
    })
    .optional(),
  clarifyQuestion: z.string().optional(),
  clarifyOptions: z.array(z.string()).optional(),
});
```

---

## 三、14 个 Stage 输入输出 Schema

```typescript
// pipeline/types/stage-io.ts

// ST-00-INIT
export const St00Output = z.object({
  leaderModelId: z.string(),
  availableModels: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      displayName: z.string(),
    }),
  ),
  topicMeta: z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(["MACRO", "TECHNOLOGY", "COMPANY", "EVENT", "OTHER"]),
    description: z.string().optional(),
    language: z.string(),
    anchorArticleContent: z.string().optional(),
  }),
  existingDimensions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
    }),
  ),
  draftReportId: z.string(),
  cachePrefix: z.string(),
  budget: z.object({
    // PipelineBudget snapshot
    maxTotalTokens: z.number().int().positive(),
    maxTotalCostUsd: z.number().positive(),
    maxToolCalls: z.number().int().positive(),
    maxWallTimeMs: z.number().int().positive(),
  }),
});

// ST-01-PLAN → output = LeaderPlanSchema

// ST-02-RESEARCH (per-dimension)
export const DimensionResearchResultSchema = z.object({
  dimensionId: z.string(),
  status: z.enum(["completed", "failed", "skipped"]),
  evidenceSavedCount: z.number().int().nonnegative(),
  figuresSavedCount: z.number().int().nonnegative(),
  literatureBaselineFound: z.number().int().nonnegative().optional(),
  searchStats: z.object({
    totalQueries: z.number().int().nonnegative(),
    totalResults: z.number().int().nonnegative(),
    adapterBreakdown: z.record(z.number().int().nonnegative()),
  }),
  errorMessage: z.string().optional(),
});
export const St02Output = z.array(DimensionResearchResultSchema);

// ST-03-WRITE (per-section flattened)
export const St03Output = z.object({
  dimensionSections: z.record(
    z.string(), // dimensionId
    z.array(SectionResultSchema),
  ),
});

// ST-04-REVIEW
export const St04Output = z.object({
  dimensionReviews: z.record(z.string(), z.array(SectionReviewSchema)),
  revisionsApplied: z.number().int().nonnegative(),
  earlyStoppedDimensions: z.array(z.string()),
});

// ST-05-INTEGRATE
export const St05Output = z.record(z.string(), DimensionMetaSchema);

// ST-06-COGLOOP
export const St06Output = z.object({
  loopsRun: z.number().int().nonnegative(),
  claimsValidated: z.number().int().nonnegative(),
  gapsFound: z.number().int().nonnegative(),
  supplementaryEvidenceAdded: z.number().int().nonnegative(),
  finalValidationStats: z.object({
    verified: z.number().int().nonnegative(),
    disputed: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
  }),
});

// ST-07-SYNTH → output = SynthesisResultSchema
// ST-08-QGATE
export const QualityGateReportSchema = z.object({
  passed: z.boolean(),
  rulesChecked: z.array(
    z.object({
      ruleId: z.enum([
        "heading_hierarchy",
        "citation_coverage",
        "min_content_length",
        "figure_placement",
        "cross_references",
        "iron_wall_compliance",
      ]),
      passed: z.boolean(),
      details: z.string().optional(),
      violations: z
        .array(
          z.object({
            line: z.number().int().positive().optional(),
            description: z.string(),
          }),
        )
        .optional(),
    }),
  ),
  remediationsApplied: z.number().int().nonnegative(),
  finalScore: Score0To100,
});
export const St08Output = QualityGateReportSchema;

// ST-09-EVAL → output = ReportEvaluationSchema
// ST-10-FACT → output = FactCheckResultSchema

// ST-11-ASM
export const St11Output = z.object({
  assembledMarkdown: z.string().min(2000),
  tocMarkdown: z.string(),
  figureCount: z.number().int().nonnegative(),
  citationCount: z.number().int().nonnegative(),
  wordCount: z.number().int().positive(),
});

// ST-12-LATEX → output = LatexRepairResultSchema (optional)

// ST-13-PERSIST
export const St13Output = z.object({
  reportId: z.string(),
  finalWordCount: z.number().int().positive(),
  totalSources: z.number().int().nonnegative(),
  generationTimeMs: z.number().int().positive(),
  qualityTrace: z.record(z.unknown()),
});

// ST-14-CLEANUP
export const St14Output = z.object({
  cachePrefixReleased: z.boolean(),
  autoDreamNotified: z.boolean(),
  finalBudgetUsage: z.object({
    tokensUsed: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    toolCallsCount: z.number().int().nonnegative(),
    wallTimeMs: z.number().int().nonnegative(),
  }),
});
```

---

## 四、Runner 通用 validateOutput 实现

```typescript
// harness-agents/common/validate-output.ts

export function validateWithSchema<T>(
  schema: z.ZodType<T>,
  data: unknown,
  customValidations?: Array<
    (output: T) => { valid: boolean; errors?: string[] }
  >,
): { valid: boolean; errors?: string[]; data?: T } {
  const result = schema.safeParse(data);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    };
  }

  const customErrors: string[] = [];
  for (const customValidate of customValidations ?? []) {
    const r = customValidate(result.data);
    if (!r.valid && r.errors) customErrors.push(...r.errors);
  }

  return customErrors.length === 0
    ? { valid: true, data: result.data }
    : { valid: false, errors: customErrors };
}
```

---

## 五、output.parser 使用模板

```typescript
// 例：harness-agents/section-reviewer/output.parser.ts

import { tryJson } from "../common";
import { SectionReviewSchema, validateSectionReview } from "./schemas";
import { validateWithSchema } from "../common/validate-output";

export function parseSectionReview(rawText: string): {
  valid: boolean;
  data?: SectionReview;
  errors?: string[];
} {
  const raw = tryJson<unknown>(rawText, "");
  if (!raw) return { valid: false, errors: ["not valid JSON"] };

  return validateWithSchema(
    SectionReviewSchema,
    raw,
    [validateSectionReview], // custom: detect fan-out
  );
}
```

---

## 六、Skill-level output contract

每个 skill markdown **必须**在底部附 output JSON schema：

```markdown
## Output Format (MANDATORY)

Your output MUST be a valid JSON matching this schema (will be strictly validated):

\`\`\`json
{
"sectionId": "string",
"overallScore": "number (0-100)",
"axisScores": {
"breadth": "number (0-100, MUST be independent from overallScore)",
"depth": "number (0-100, MUST be independent)",
...
},
...
}
\`\`\`

**IMPORTANT**:

- Do NOT copy overallScore to all 5 axes. Score each independently.
- Do NOT invent evidenceIds. Only reference actual evidenceIds from input.
- Return ONLY the JSON, no prose outside.
```

Runtime：`SkillLint`（新 utility，Gate 2 产出）扫描所有 skill.md 检查输出契约段存在。

---

## 七、版本控制

- **Schema 版本号**：每个 schema 附 `version: "1.0"` 字段
- **向后兼容**：schema 变更时，parser 支持旧版本读取 + 警告
- **破坏性变更**：走 RFC 流程，必须更新 golden 样本

---

## 八、覆盖清单

| Agent        | Schema 定义                     | 自定义 validate          | Golden test |
| ------------ | ------------------------------- | ------------------------ | ----------- |
| AG-01 Leader | ✅ LeaderPlanSchema             | ✅ validateLeaderPlan    | Gate 3      |
| AG-02 DP     | ✅ DimensionOutlineSchema       | —                        | Gate 3      |
| AG-03 SW     | ✅ SectionResultSchema          | —                        | Gate 3      |
| AG-04 SR     | ✅ SectionReviewSchema          | ✅ validateSectionReview | Gate 3      |
| AG-05 ME     | ✅ DimensionMetaSchema          | —                        | Gate 3      |
| AG-06 QR     | ✅ QualityReviewSchema (union)  | —                        | Gate 3      |
| AG-07 FC     | ✅ FactCheckResultSchema        | —                        | Gate 3      |
| AG-08 GS     | ✅ GapSearchResultSchema        | —                        | Gate 3      |
| AG-09 HV     | ✅ HypothesisVerifyResultSchema | —                        | Gate 3      |
| AG-10 FX     | ✅ CrossDimensionFactsSchema    | —                        | Gate 3      |
| AG-11 SY     | ✅ SynthesisResultSchema        | —                        | Gate 3      |
| AG-12 SREM   | ✅ RemediationResultSchema      | —                        | Gate 3      |
| AG-13 RE     | ✅ ReportEvaluationSchema       | —                        | Gate 3      |
| AG-14 LX     | ✅ LatexRepairResultSchema      | —                        | Gate 3      |
| AG-15 RED    | ✅ ReportEditResultSchema       | —                        | Gate 3      |
| AG-16 MA     | ✅ MissionAdjustmentSchema      | —                        | Gate 3      |
| AG-17 LDP    | ✅ UserIntentSchema             | —                        | Gate 3      |
| Stages       | ✅ 14 stages' I/O               | —                        | Gate 3      |

---

## 九、下一步

本文档（09）作为 Gate 2 的前置交付。接下来：

- `03-harness-agents-design.md` 消费这些 schema 定义每个 agent 的 spec
- `04-pipeline-orchestrator.md` 消费 stage I/O schema 定义 DAG
