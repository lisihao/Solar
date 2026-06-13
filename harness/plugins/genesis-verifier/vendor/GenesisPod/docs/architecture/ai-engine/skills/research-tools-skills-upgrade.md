# AI Research Module - Tools & Skills Upgrade Design

## Document Info

- Version: 1.0
- Author: Architect Agent
- Date: 2026-03-11
- Status: Draft

## 1. Problem Statement

### Current State

The AI Research (Deep Research) module has significant capability gaps compared to the mature Topic Insights module:

| Area              | Research (Current)                                                   | Topic Insights (Target)                                                     |
| ----------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Search tools      | Hardcoded `web-search` only                                          | 9 search adapters with intelligent routing                                  |
| Skills            | 7 string declarations, 0 `.skill.md` files                           | 35 `.skill.md` files, runtime injection via `chatWithSkills()`              |
| Quality control   | Single `estimateReportQuality()` heuristic function (capped at 0.65) | 3-layer: code validation + skill verification + leader review               |
| Tool routing      | No routing; all steps go through `web-search`                        | `DataSourceRouterService` + `SearchExecutorService` with parallel execution |
| Evidence handling | Raw snippets injected into prompts                                   | Summarized evidence with deduplication                                      |

### Root Cause Analysis

The Research module was built as a discussion-driven agent system (7 agents: director, 3 researchers, analyst, writer, reviewer) with a focus on the iterative loop, but its **data acquisition layer** was never upgraded beyond basic web search.

### Files Read for This Analysis

```
backend/src/modules/ai-app/research/discussion/iterative-search.service.ts
backend/src/modules/ai-app/research/discussion/discussion-orchestrator.service.ts
backend/src/modules/ai-app/research/discussion/discussion-agent.service.ts
backend/src/modules/ai-app/research/discussion/report-synthesizer.service.ts
backend/src/modules/ai-app/research/discussion/types.ts
backend/src/modules/ai-app/research/teams/research-team.config.ts
backend/src/modules/ai-app/research/iteration/iterative-research.service.ts
backend/src/modules/ai-app/research/evaluation/exit-decision.service.ts
backend/src/modules/ai-app/research/research.module.ts
backend/src/modules/ai-app/insight/services/data/data-source-router.service.ts
backend/src/modules/ai-app/insight/services/search/search-executor.service.ts
backend/src/modules/ai-app/insight/services/quality/report-quality-gate.service.ts
backend/src/modules/ai-app/insight/services/verification/claim-verification.service.ts
backend/src/modules/ai-app/insight/services/verification/self-consistency.service.ts
backend/src/modules/ai-app/insight/services/core/research-leader.service.ts
backend/src/modules/ai-app/insight/config/data-source-mapping.config.ts
backend/src/modules/ai-app/insight/topic-insights.module.ts
backend/src/modules/ai-app/insight/skills/fact-check.skill.md
backend/src/modules/ai-engine/skills/runtime/prompt-skill-bridge.service.ts
```

---

## 2. Architecture Overview

### Current Research Flow

```
User Query
    |
    v
DiscussionOrchestratorService
    |
    +-- Phase 1: IDEATION
    |     +-- director agent (plan directions)
    |     +-- researcher A/B/C agents (perspectives)
    |
    +-- Phase 2: EXECUTION
    |     +-- IterativeSearchService.executeStep()
    |           +-- toolRegistry.tryGet("web-search")  <-- ONLY web-search
    |           +-- enhanceQuery() (keyword appending)
    |
    +-- [Replanning] ResearchReplannerService
    |
    +-- Phase 3: FINDINGS
    |     +-- analyst agent (analysis)
    |     +-- reviewer agent (review)
    |
    +-- Phase 4: SYNTHESIS
    |     +-- ReportSynthesizerService
    |           +-- chatFacade.chat() (no skills)
    |
    v
DeepResearchReport
```

### Target Research Flow (After Upgrade)

```
User Query
    |
    v
DiscussionOrchestratorService
    |
    +-- Phase 1: IDEATION (enhanced)
    |     +-- director agent with chatWithSkills({ additionalSkills: ["research-planning"] })
    |     +-- TopicClassifierService -> ResearchToolRouter (determines tool strategy)
    |     +-- researcher A/B/C agents with domain-specific skills
    |
    +-- Phase 2: EXECUTION (major upgrade)
    |     +-- ResearchToolRouter.resolveToolsForStep(step, topicType)
    |     |     +-- Returns: { primary: ["arxiv-search", "semantic-scholar"], fallback: ["web-search"] }
    |     +-- IterativeSearchService.executeStep() (enhanced)
    |           +-- Parallel execution across multiple tools
    |           +-- Result merging and deduplication
    |           +-- Evidence summarization (chatWithSkills + "synthesis")
    |
    +-- [Replanning] ResearchReplannerService (skill-enhanced)
    |
    +-- Phase 3: FINDINGS (skill-enhanced)
    |     +-- analyst with chatWithSkills({ additionalSkills: ["data-interpretation", "critical-thinking"] })
    |     +-- reviewer with chatWithSkills({ additionalSkills: ["fact-check", "consistency-check"] })
    |
    +-- Phase 4: SYNTHESIS (quality-gated)
    |     +-- ReportSynthesizerService with chatWithSkills({ additionalSkills: ["report-synthesis"] })
    |     +-- ResearchQualityGateService (code-level validation)
    |     +-- Fact-check skill pass (citation verification)
    |
    v
DeepResearchReport (quality-assured)
```

---

## 3. Tool Routing Upgrade

### 3.1 ResearchToolRouter Service

**New file**: `backend/src/modules/ai-app/research/search/research-tool-router.service.ts`

This service determines which search tools to use based on topic classification and step type.

```typescript
/**
 * Research Tool Router Service
 *
 * Routes research steps to appropriate search tools based on:
 * 1. Topic classification (academic, policy, technical, general, financial)
 * 2. Step type (initial_search, deep_dive, academic, comparison, verification)
 * 3. Available tools in ToolRegistry
 */
@Injectable()
export class ResearchToolRouterService {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly topicClassifier: TopicClassifierService,
  ) {}

  /**
   * Resolve which tools to use for a given research step
   */
  resolveToolsForStep(
    step: ResearchPlanStep,
    topicType: ResearchTopicType,
    options?: { preferredTools?: string[] },
  ): ToolResolution {
    // ...
  }

  /**
   * Classify topic and return full tool strategy for the research
   */
  async buildToolStrategy(
    query: string,
    language?: string,
  ): Promise<ResearchToolStrategy> {
    // ...
  }
}
```

#### ResearchTopicType Enum

```typescript
export type ResearchTopicType =
  | "academic" // arXiv, Semantic Scholar, PubMed, OpenAlex
  | "policy" // Federal Register, Congress.gov, WhiteHouse News
  | "technical" // GitHub, HackerNews, web-search
  | "financial" // Finance API, web-search
  | "general" // web-search (primary), others as needed
  | "mixed"; // multiple categories
```

#### Tool Resolution Strategy

| Topic Type | Primary Tools                                | Secondary Tools                 | Fallback     |
| ---------- | -------------------------------------------- | ------------------------------- | ------------ |
| academic   | `arxiv-search`, `semantic-scholar`, `pubmed` | `openalex-search`, `web-search` | `web-search` |
| policy     | `federal-register`, `congress-gov`           | `whitehouse-news`, `web-search` | `web-search` |
| technical  | `github-search`, `hackernews-search`         | `web-search`                    | `web-search` |
| financial  | `finance-api`, `web-search`                  | -                               | `web-search` |
| general    | `web-search`                                 | -                               | `web-search` |
| mixed      | (determined by step type)                    | -                               | `web-search` |

#### Step Type Override Matrix

Regardless of topic type, certain step types force specific tool inclusion:

| Step Type        | Force-include Tools                           |
| ---------------- | --------------------------------------------- |
| `academic`       | `arxiv-search` or `semantic-scholar`          |
| `verification`   | `web-search` (always, for cross-verification) |
| `initial_search` | `web-search` (breadth-first)                  |
| `deep_dive`      | Primary tools for topic type                  |
| `comparison`     | `web-search` + topic-specific tools           |

#### Interface Definitions

```typescript
export interface ToolResolution {
  /** Ordered list of tools to execute (first = highest priority) */
  tools: ToolAssignment[];
  /** Execution mode */
  mode: "parallel" | "sequential" | "primary-with-fallback";
  /** Max total results across all tools */
  maxTotalResults: number;
}

export interface ToolAssignment {
  toolId: string;
  /** Max results for this specific tool */
  maxResults: number;
  /** Query modification for this tool (e.g., arxiv needs structured queries) */
  queryTransform?: (query: string) => string;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Whether failure of this tool should halt the step */
  required: boolean;
}

export interface ResearchToolStrategy {
  topicType: ResearchTopicType;
  /** Per-step-type tool resolutions */
  stepStrategies: Map<ResearchStepType, ToolResolution>;
  /** Overall confidence in classification (0-1) */
  classificationConfidence: number;
}
```

### 3.2 Enhanced IterativeSearchService

**Modified file**: `backend/src/modules/ai-app/research/discussion/iterative-search.service.ts`

Current implementation hardcodes `web-search`. The upgrade adds multi-tool parallel execution.

#### Key Changes

1. **Constructor**: Inject `ResearchToolRouterService` alongside `ToolRegistry`
2. **`executeStep()`**: Accept `ToolResolution` parameter, execute tools in parallel
3. **New `executeMultiToolStep()`**: Parallel tool execution with result merging
4. **New `summarizeEvidence()`**: Condense raw snippets before prompt injection

```typescript
@Injectable()
export class IterativeSearchService {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly toolRouter: ResearchToolRouterService,
    private readonly chatFacade: ChatFacade, // NEW: for evidence summarization
  ) {}

  /**
   * Execute step using router-determined tools (parallel, with fallback)
   */
  async executeStep(
    step: ResearchPlanStep,
    round: number,
    toolResolution?: ToolResolution,
  ): Promise<SearchRound> {
    // If no resolution provided, fall back to web-search only (backward compat)
    if (!toolResolution) {
      return this.executeWebSearchStep(step, round);
    }
    return this.executeMultiToolStep(step, round, toolResolution);
  }

  /**
   * Execute across multiple tools in parallel with result merging
   */
  private async executeMultiToolStep(
    step: ResearchPlanStep,
    round: number,
    resolution: ToolResolution,
  ): Promise<SearchRound> {
    // ...parallel execution via Promise.allSettled
    // ...result merging and deduplication
    // ...fallback on failure
  }

  /**
   * Summarize raw search results into condensed evidence
   * Prevents prompt bloat (Topic Insights lesson: base64 injection bug)
   */
  async summarizeEvidence(
    sources: SearchSource[],
    query: string,
    maxChars?: number,
  ): Promise<string> {
    // ...uses chatFacade.chat() with "synthesis" skill
  }
}
```

#### Result Merging Strategy

```typescript
/**
 * Merge results from multiple tools:
 * 1. URL-based deduplication (normalize URLs)
 * 2. Title similarity deduplication (fuzzy match)
 * 3. Priority-weighted ordering (primary tool results first)
 * 4. Domain diversity enforcement (max 3 results from same domain)
 */
mergeMultiToolResults(
  toolResults: Map<string, SearchSource[]>,
  resolution: ToolResolution,
): SearchSource[] {
  // ...
}
```

### 3.3 Integration into Orchestrator

**Modified file**: `backend/src/modules/ai-app/research/discussion/discussion-orchestrator.service.ts`

Changes in `executeDiscussion()`:

```typescript
// Phase 1: IDEATION (add topic classification)
const toolStrategy = await this.toolRouter.buildToolStrategy(
  dto.query,
  language,
);
// Store strategy for use in execution phase

// Phase 2: EXECUTION (use tool strategy)
for (const step of plan.steps) {
  const resolution =
    toolStrategy.stepStrategies.get(step.type) ??
    toolStrategy.stepStrategies.get("initial_search"); // fallback
  const round = await this.searchService.executeStep(
    step,
    roundNum,
    resolution,
  );
  // ...
}
```

### 3.4 Shared Search Infrastructure Decision

**Decision**: Do NOT extract Topic Insights search adapters into a shared module at this stage.

**Rationale**:

1. Research module's search model is different: step-based sequential with replanning, not dimension-based parallel
2. Research uses `ToolRegistry.tryGet()` directly; Topic Insights has a full adapter layer with `ISearchAdapter` interface
3. Premature extraction would create coupling without clear benefit
4. The `data-source-mapping.config.ts` can be shared (it's pure data mapping)

**What to reuse**:

- Import `dataSourceToToolId` / `toolIdToDataSource` from Topic Insights config (or extract to `ai-app/shared/`)
- Same tool IDs (both modules call ToolRegistry with identical string IDs)
- Same deduplication logic patterns (URL normalization, domain extraction)

**P2 consideration**: If both modules stabilize, extract `SearchAdapterBase` + common adapters to `ai-app/shared/search/`.

---

## 4. Skill System

### 4.1 Skills to Create for Research Module

#### Reuse from Topic Insights (14 skills, copy directly)

These skills are generic enough for direct reuse. They will be copied to `backend/src/modules/ai-app/research/skills/` so the Research module can register its own domain independently.

| Skill File                     | Use in Research                             | Phase               |
| ------------------------------ | ------------------------------------------- | ------------------- |
| `fact-check.skill.md`          | Citation verification in findings/synthesis | Findings, Synthesis |
| `consistency-check.skill.md`   | Cross-section consistency                   | Findings            |
| `critical-thinking.skill.md`   | Analyst agent reasoning                     | Findings            |
| `data-interpretation.skill.md` | Analyst data analysis                       | Findings            |
| `synthesis.skill.md`           | Report synthesis                            | Synthesis           |
| `comparison.skill.md`          | Comparison analysis steps                   | Execution, Findings |
| `cause-effect.skill.md`        | Causal reasoning                            | Findings            |
| `trend-analysis.skill.md`      | Trend identification                        | Findings            |
| `deep-dive.skill.md`           | Deep dive research steps                    | Execution           |
| `research-planning.skill.md`   | Director planning phase                     | Ideation            |
| `claim-extraction.skill.md`    | Extract verifiable claims                   | Quality gate        |
| `fact-verification.skill.md`   | Verify extracted claims                     | Quality gate        |
| `report-synthesis.skill.md`    | Report writing guidance                     | Synthesis           |
| `content-critique.skill.md`    | Writer self-review                          | Synthesis           |

#### New Skills for Research Module (8 new skills)

| Skill File                             | Purpose                                                  | Phase                  |
| -------------------------------------- | -------------------------------------------------------- | ---------------------- |
| `research-direction-planning.skill.md` | Director: plan research directions with tool assignments | Ideation               |
| `evidence-summarization.skill.md`      | Condense search results into structured evidence summary | Execution              |
| `source-credibility.skill.md`          | Evaluate source authority and reliability                | Execution, Findings    |
| `gap-analysis.skill.md`                | Identify information gaps after each search round        | Execution (replanning) |
| `cross-reference-validation.skill.md`  | Validate claims across multiple sources                  | Findings               |
| `section-depth-evaluation.skill.md`    | Evaluate section depth and suggest improvements          | Synthesis              |
| `executive-summary-writing.skill.md`   | Write executive summaries                                | Synthesis              |
| `research-conclusion.skill.md`         | Write research conclusions and recommendations           | Synthesis              |

**Total**: 22 `.skill.md` files in `backend/src/modules/ai-app/research/skills/`

### 4.2 Skill Registration Flow

**Modified file**: `backend/src/modules/ai-app/research/research.module.ts`

```typescript
@Module({ ... })
export class ResearchModule implements OnModuleInit {
  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly teamRegistry: TeamRegistry,
    private readonly researcherAgent: ResearcherAgent,
    private readonly promptSkillBridge: PromptSkillBridge,  // NEW
  ) {}

  async onModuleInit() {
    this.agentRegistry.register(this.researcherAgent);
    this.teamRegistry.registerConfig(RESEARCH_TEAM_CONFIG);

    // NEW: Bridge prompt skills from .skill.md -> SkillRegistry
    const bridgeResult = await this.promptSkillBridge.registerDomain("deep-research");
    this.logger.log(
      `Prompt skills bridged: registered=${bridgeResult.registered.length}, ` +
        `skipped=${bridgeResult.skipped.length}, errors=${bridgeResult.errors.length}`,
    );
  }
}
```

**Key design decision**: The Research module registers skills under domain `"deep-research"` (not `"research"`, which is already used by Topic Insights). The `SkillLoaderService` scans the `skills/` directory relative to the calling module's path.

### 4.3 VALID_SKILLS Whitelist

**New file**: `backend/src/modules/ai-app/research/config/valid-skills.config.ts`

```typescript
/**
 * Whitelist of valid skill names for Research module.
 * Used to filter out non-existent skill names generated by the LLM.
 * Must match file names in research/skills/*.skill.md (without extension).
 */
export const RESEARCH_VALID_SKILLS = new Set([
  // Reused from Topic Insights
  "fact-check",
  "consistency-check",
  "critical-thinking",
  "data-interpretation",
  "synthesis",
  "comparison",
  "cause-effect",
  "trend-analysis",
  "deep-dive",
  "research-planning",
  "claim-extraction",
  "fact-verification",
  "report-synthesis",
  "content-critique",
  // New for Research
  "research-direction-planning",
  "evidence-summarization",
  "source-credibility",
  "gap-analysis",
  "cross-reference-validation",
  "section-depth-evaluation",
  "executive-summary-writing",
  "research-conclusion",
]);
```

### 4.4 Skill Injection Points

Each agent in `DiscussionAgentService` will be enhanced with appropriate skills:

| Agent              | Skills Injected                                                                   | Method                                |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------- |
| `director`         | `research-direction-planning`, `research-planning`                                | `chatWithSkills()` in ideation phase  |
| `researcher-a/b/c` | `deep-dive`, `evidence-summarization`                                             | `chatWithSkills()` in findings phase  |
| `analyst`          | `data-interpretation`, `critical-thinking`, `trend-analysis`, `cause-effect`      | `chatWithSkills()` in findings phase  |
| `writer`           | `report-synthesis`, `executive-summary-writing`, `research-conclusion`            | `chatWithSkills()` in synthesis phase |
| `reviewer`         | `fact-check`, `consistency-check`, `content-critique`, `section-depth-evaluation` | `chatWithSkills()` in findings phase  |

#### DiscussionAgentService Change

The `speak()` method needs an `additionalSkills` parameter:

```typescript
async speak(
  agentState: AgentState,
  context: string,
  options?: {
    creativity?: "deterministic" | "low" | "medium" | "high";
    outputLength?: "minimal" | "short" | "medium" | "long";
    modelType?: AIModelType;
    additionalSkills?: string[];  // NEW
  },
): Promise<string> {
  // ...existing code...

  if (options?.additionalSkills?.length) {
    // Use chatWithSkills for skill-enhanced calls
    const result = await this.chatFacade.chatWithSkills({
      messages: agentState.conversationHistory.map(/* ... */),
      modelType: options?.modelType || AIModelType.CHAT,
      taskProfile: { /* ... */ },
      additionalSkills: options.additionalSkills,
      skipGuardrails: true,
    });
    // ...
  } else {
    // Original path (no skills)
    const result = await this.chatFacade.chat({ /* ... */ });
    // ...
  }
}
```

### 4.5 ReportSynthesizerService Enhancement

The report synthesizer should use skills for each generation step:

```typescript
// Step 3: Generate executive summary (with skill)
const executiveSummary = await this.chatFacade.chatWithSkills({
  messages: [{ role: "user", content: rp.executiveSummaryPrompt(...) }],
  modelType: AIModelType.CHAT,
  taskProfile: { creativity: "medium", outputLength: "long" },
  additionalSkills: ["executive-summary-writing", "synthesis"],
  skipGuardrails: true,
});

// Step 4: Generate sections (with skill)
const sectionResults = await Promise.allSettled(
  sectionTopics.map((topic) =>
    this.chatFacade.chatWithSkills({
      messages: [{ role: "user", content: rp.sectionPrompt(...) }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "medium", outputLength: "long" },
      additionalSkills: ["report-synthesis", "deep-dive"],
      skipGuardrails: true,
    }),
  ),
);
```

---

## 5. Quality Control Upgrade

### 5.1 Current State

The `estimateReportQuality()` function (line 1322 of `iterative-research.service.ts`) is a single heuristic scorer:

- Weighted sum of: section count, ref count, content depth, idea count, structure
- Capped at 0.65 (only demo evaluation can exceed)
- Generates gap lists based on missing elements
- No content-level validation (formatting, citations, language consistency)

### 5.2 Target: 3-Layer Quality Control

```
Layer 1: Code Validation (ResearchQualityGateService)
    |  - Formatting rules (headings, bold density, blockquotes)
    |  - Content length minimums
    |  - Citation coverage checks
    |  - Language consistency
    |  - Auto-fix what can be auto-fixed
    v
Layer 2: Skill Verification (fact-check + consistency-check)
    |  - Citation accuracy (fact-check skill)
    |  - Cross-section consistency (consistency-check skill)
    |  - Source credibility assessment
    v
Layer 3: Structural Quality (enhanced estimateReportQuality)
    |  - Section depth scoring
    |  - Reference diversity
    |  - Evidence coverage
    |  - Gap identification for iteration loop
    v
Quality Decision
    |
    +-- Pass (score >= threshold) -> emit report
    +-- Fail with rewrite guidance -> targeted section rewrite
    +-- Fail structurally -> next iteration
```

### 5.3 ResearchQualityGateService

**New file**: `backend/src/modules/ai-app/research/quality/research-quality-gate.service.ts`

This service adapts the Topic Insights `ReportQualityGateService` pattern for Research reports.

```typescript
@Injectable()
export class ResearchQualityGateService {
  /**
   * Validate a complete research report.
   * Returns violations, auto-fixed content, and rewrite guidance.
   */
  validateReport(
    report: DeepResearchReport,
    targetLanguage: string,
  ): ReportQualityResult {
    // ...
  }

  /**
   * Validate a single report section.
   */
  validateSection(
    section: ReportSection,
    targetLanguage: string,
  ): SectionQualityResult {
    // ...
  }
}
```

#### Validation Rules (adapted from Topic Insights)

**Auto-fixable (warning level)**:

1. Heading hierarchy (sanitize to ### and ####)
2. Horizontal rules (remove)
3. Bold density (limit per section)
4. Blockquote density (limit per report)
5. LLM meta-notes (strip word counts, role names, edit instructions)
6. Inline images (remove AI-hallucinated URLs)
7. Duplicate headings (deduplicate)

**Requires rewrite (error level)**:

1. Minimum content length per section (800 chars)
2. Empty sections (heading with < 50 chars body)
3. Citation coverage (minimum 2 unique citations per section)
4. Foreign language blocks exceeding 5%

**Advisory (warning, no action)**:

1. Subjective expression density
2. Citation concentration
3. Source diversity
4. Single-source claims

### 5.4 Skill-Based Verification

**New file**: `backend/src/modules/ai-app/research/quality/research-fact-checker.service.ts`

```typescript
@Injectable()
export class ResearchFactCheckerService {
  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * Run fact-check skill on report sections.
   * Checks each [n] citation against the source evidence.
   */
  async checkCitations(
    sections: ReportSection[],
    references: ReportReference[],
    sources: SearchSource[],
  ): Promise<FactCheckResult> {
    // Uses chatWithSkills({ additionalSkills: ["fact-check"] })
    // Returns per-citation verdict and overall accuracy score
  }

  /**
   * Run consistency-check skill across sections.
   * Detects contradictions between sections.
   */
  async checkConsistency(
    sections: ReportSection[],
  ): Promise<ConsistencyCheckResult> {
    // Uses chatWithSkills({ additionalSkills: ["consistency-check"] })
  }
}
```

### 5.5 Enhanced estimateReportQuality

The existing function remains as Layer 3 but gains additional signals:

```typescript
function estimateReportQuality(
  report: DeepResearchReport,
  insightCount: number,
  creativeIdeaCount: number,
  previousReport?: DeepResearchReport,
  qualityGateResult?: ReportQualityResult, // NEW: Layer 1 result
  factCheckResult?: FactCheckResult, // NEW: Layer 2 result
): { score: number; gaps: { dataGaps: string[]; ideaGaps: string[] } } {
  // ...existing heuristic scoring...

  // NEW: Quality gate penalties
  if (qualityGateResult && !qualityGateResult.passed) {
    const errorCount = qualityGateResult.violations.filter(
      (v) => v.severity === "error",
    ).length;
    rawScore -= errorCount * 0.05; // Each error-level violation reduces score
  }

  // NEW: Fact-check bonus/penalty
  if (factCheckResult) {
    if (factCheckResult.accuracyScore >= 90) rawScore += 0.05;
    if (factCheckResult.accuracyScore < 50) rawScore -= 0.1;
  }

  // ...rest of scoring...
}
```

### 5.6 Quality-Gated Synthesis Integration

In `DiscussionOrchestratorService.runSynthesisPhase()`:

```typescript
// After report generation, run quality gate
const qualityResult = this.qualityGate.validateReport(report, language);

// Auto-fix what can be fixed
if (qualityResult.wasAutoFixed) {
  report = this.applyAutoFixes(report, qualityResult);
}

// If rewrite guidance exists, ask writer to revise (max 2 attempts)
if (qualityResult.rewriteGuidance.length > 0) {
  report = await this.requestRewrite(
    report,
    qualityResult.rewriteGuidance,
    team,
    language,
  );
}

// Run fact-check (optional, for thorough depth only)
if (depth === "thorough" && this.factChecker) {
  const factResult = await this.factChecker.checkCitations(
    report.sections,
    report.references,
    allSources,
  );
  // Attach to report metadata
}
```

---

## 6. File Inventory

### New Files

```
backend/src/modules/ai-app/research/
  search/
    research-tool-router.service.ts          # Tool routing logic
    research-tool-router.types.ts            # Type definitions
  quality/
    research-quality-gate.service.ts         # Code-level quality validation
    research-fact-checker.service.ts         # Skill-based fact checking
    quality.types.ts                         # Quality result types
  config/
    valid-skills.config.ts                   # VALID_SKILLS whitelist
    tool-strategy.config.ts                  # Default tool strategies per topic type
  skills/                                    # 22 .skill.md files
    fact-check.skill.md                      # (reuse from Topic Insights)
    consistency-check.skill.md               # (reuse)
    critical-thinking.skill.md               # (reuse)
    data-interpretation.skill.md             # (reuse)
    synthesis.skill.md                       # (reuse)
    comparison.skill.md                      # (reuse)
    cause-effect.skill.md                    # (reuse)
    trend-analysis.skill.md                  # (reuse)
    deep-dive.skill.md                       # (reuse)
    research-planning.skill.md              # (reuse)
    claim-extraction.skill.md               # (reuse)
    fact-verification.skill.md              # (reuse)
    report-synthesis.skill.md               # (reuse)
    content-critique.skill.md               # (reuse)
    research-direction-planning.skill.md    # NEW
    evidence-summarization.skill.md         # NEW
    source-credibility.skill.md             # NEW
    gap-analysis.skill.md                   # NEW
    cross-reference-validation.skill.md     # NEW
    section-depth-evaluation.skill.md       # NEW
    executive-summary-writing.skill.md      # NEW
    research-conclusion.skill.md            # NEW
```

### Modified Files

```
backend/src/modules/ai-app/research/
  discussion/
    iterative-search.service.ts              # Multi-tool execution, evidence summarization
    discussion-agent.service.ts              # chatWithSkills() support in speak()
    discussion-orchestrator.service.ts       # Tool strategy integration, quality gate
    report-synthesizer.service.ts            # chatWithSkills() for report generation
  iteration/
    iterative-research.service.ts            # Enhanced estimateReportQuality()
  research.module.ts                         # PromptSkillBridge registration, new providers
  teams/
    research-team.config.ts                  # Updated availableTools list
```

### Shared Extraction (P2)

```
backend/src/modules/ai-app/shared/
  config/
    data-source-mapping.config.ts            # Move from topic-insights (both modules use)
```

---

## 7. Implementation Roadmap

### P0: Tool Routing + Basic Skills (Week 1-2)

**Goal**: Multi-tool search capability; Research module uses more than just `web-search`.

1. Create `ResearchToolRouterService` with topic classification and tool resolution
2. Enhance `IterativeSearchService` to accept and execute multi-tool resolutions
3. Wire into `DiscussionOrchestratorService` (Phase 2: Execution)
4. Copy 14 reusable `.skill.md` files from Topic Insights
5. Create `research.module.ts` skill registration via `PromptSkillBridge`
6. Add `chatWithSkills()` path to `DiscussionAgentService.speak()`
7. Update `RESEARCH_TEAM_CONFIG.availableTools` to include all search tools

**Files changed**: 5 modified, 4 new
**Risk**: Low. Tool routing is additive; existing `web-search` path preserved as fallback.
**Verification**: Existing tests pass; new unit tests for `ResearchToolRouterService`.

### P1: Quality Gate + Fact-Check (Week 3-4)

**Goal**: Multi-layer quality control; reports are validated before emission.

1. Create `ResearchQualityGateService` (adapt from Topic Insights)
2. Create `ResearchFactCheckerService` (skill-based citation verification)
3. Wire quality gate into synthesis phase
4. Create 8 new `.skill.md` files specific to Research
5. Enhance `estimateReportQuality()` with quality gate and fact-check signals
6. Add rewrite loop (max 2 attempts) for quality-failing sections

**Files changed**: 3 modified, 4 new, 8 new skill files
**Risk**: Medium. Quality gate may reject existing reports that were previously accepted. Need calibration of thresholds.
**Verification**: Run existing iterative research tests; add quality gate unit tests; test with real research queries to calibrate thresholds.

### P2: Advanced Patterns + Shared Infrastructure (Week 5-6)

**Goal**: Full skill utilization; shared search infrastructure.

1. Inject skills into all agent phases (director, researcher, analyst, writer, reviewer)
2. Add evidence summarization in execution phase (prevent prompt bloat)
3. Add skill-enhanced replanning (gap-analysis skill)
4. Extract `data-source-mapping.config.ts` to `ai-app/shared/`
5. Add per-tool query transformation (e.g., arxiv structured queries)
6. Add domain diversity enforcement in result merging
7. Performance optimization: parallel search with global throttle

**Files changed**: 6 modified, 2 extracted
**Risk**: Low-Medium. Skill injection is additive. Shared extraction requires updating import paths.

---

## 8. Key Design Decisions

### ADR-R01: Separate Skill Domain Registration

**Decision**: Research registers skills under domain `"deep-research"`, not `"research"`.

**Context**: Topic Insights already uses `"research"` domain for its 35 skills via `PromptSkillBridge.registerDomain("research")`. If Research uses the same domain, skill IDs could collide (both have `research-planning.skill.md` with potentially different content).

**Consequence**: Some skill files are duplicated across modules. This is acceptable because:

- Skills may evolve independently per module
- No cross-module dependency
- Each module controls its own skill lifecycle

### ADR-R02: Tool Router at AI App Layer

**Decision**: `ResearchToolRouterService` lives in `ai-app/research/`, not in `ai-engine/`.

**Context**: Tool routing is business logic (which tools for which research topic). The `ToolRegistry` itself is in AI Engine, but the routing strategy is application-specific.

**Consequence**: If other AI Apps need similar routing, each implements its own strategy (Topic Insights already has `DataSourceRouterService`).

### ADR-R03: Quality Gate Threshold Calibration

**Decision**: Research quality gate uses less strict thresholds than Topic Insights.

**Context**: Research reports are broader and shorter per section than Topic Insights dimension reports. A 800-char minimum per section (from Topic Insights) may be too strict for Research sections.

**Calibration approach**:

- Minimum section length: 500 chars (vs Topic Insights 800)
- Citation coverage: minimum 1 unique citation per section (vs 2)
- Bold density: same as Topic Insights (12 per section max)
- Language consistency: same (5% foreign threshold)

### ADR-R04: Backward Compatibility

**Decision**: All changes are backward-compatible. The existing `web-search`-only path is preserved.

**Implementation**:

- `executeStep()` accepts optional `ToolResolution` parameter; without it, uses legacy `web-search`
- `speak()` accepts optional `additionalSkills`; without it, uses `chat()` not `chatWithSkills()`
- `estimateReportQuality()` accepts optional quality gate and fact-check results; without them, uses existing heuristic only

---

## 9. Testing Strategy

### Unit Tests

```
backend/src/modules/ai-app/research/
  search/__tests__/
    research-tool-router.service.spec.ts     # Topic classification, tool resolution
  quality/__tests__/
    research-quality-gate.service.spec.ts    # Validation rules, auto-fix
    research-fact-checker.service.spec.ts    # Mocked chatFacade, citation checks
```

### Integration Tests

```
- Iterative search with multi-tool resolution (mock ToolRegistry)
- Quality gate in synthesis phase (mock chatFacade)
- Full iterative loop with quality feedback (existing test harness)
```

### Calibration Tests

```
- Run quality gate on 10 existing research reports to check false-positive rate
- Run fact-check on 5 reports with known citation errors
- Measure token usage delta (skill prompts add overhead)
```

---

## 10. Risks and Mitigations

| Risk                                  | Likelihood | Impact | Mitigation                                                                |
| ------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------- |
| Multi-tool search increases latency   | High       | Medium | Parallel execution; timeout per tool (10s); early stopping                |
| Skill prompts increase token usage    | Medium     | Medium | Monitor via AIUsageLog; skill prompts are typically 500-1000 tokens       |
| Quality gate rejects too many reports | Medium     | High   | Conservative thresholds in P1; calibration with existing reports          |
| Topic classification is wrong         | Medium     | Low    | `web-search` always included as fallback; classification confidence score |
| Specialist tool APIs unavailable      | Medium     | Low    | Fallback to `web-search`; circuit breaker pattern (existing)              |
| Skill file maintenance burden         | Low        | Low    | 14/22 skills are shared with Topic Insights; content is stable            |

---

## 11. Token Budget Impact

| Phase     | Before (tokens)              | After (tokens)                         | Delta          |
| --------- | ---------------------------- | -------------------------------------- | -------------- |
| Ideation  | ~4K (director + researchers) | ~5K (+research-planning skill)         | +1K            |
| Execution | ~2K (search queries only)    | ~6K (+evidence summarization)          | +4K            |
| Findings  | ~6K (analyst + reviewer)     | ~8K (+fact-check, critical-thinking)   | +2K            |
| Synthesis | ~12K (multi-step report)     | ~14K (+report-synthesis, quality gate) | +2K            |
| **Total** | **~24K**                     | **~33K**                               | **+9K (~37%)** |

This increase is acceptable because:

1. Current reports are often shallow due to limited search results
2. Quality improvement justifies the cost
3. `thorough` depth already has high credit allocation (1500 credits)
4. Skills add context that reduces LLM "thinking" tokens (net efficiency gain)

---

## Appendix A: Skill File Template

```markdown
---
name: { skill-id }
description: |
  {One-line description of what this skill does.}
  {When to use it.}
tags: [{ tag1 }, { tag2 }, { tag3 }]
---

# {Skill Name}

## Role

{What role does the LLM assume when this skill is active?}

## Objective

{What is the specific goal?}

## Method

{Step-by-step approach}

## Output Format

{Expected output structure}

## Constraints

{Rules and limitations}

{{#if context}}

## Context

{{{context}}}
{{/if}}
```

## Appendix B: Data Source Mapping Reference

Source: `backend/src/modules/ai-app/insight/config/data-source-mapping.config.ts`

| DataSourceType   | Tool ID             | API/Provider                  |
| ---------------- | ------------------- | ----------------------------- |
| WEB              | `web-search`        | Tavily / SearXNG              |
| ACADEMIC         | `arxiv-search`      | arXiv API                     |
| SEMANTIC_SCHOLAR | `semantic-scholar`  | Semantic Scholar API          |
| PUBMED           | `pubmed`            | PubMed E-utilities            |
| OPENALEX         | `openalex-search`   | OpenAlex API                  |
| GITHUB           | `github-search`     | GitHub REST API               |
| HACKERNEWS       | `hackernews-search` | HN Algolia API                |
| FEDERAL_REGISTER | `federal-register`  | Federal Register API          |
| CONGRESS         | `congress-gov`      | Congress.gov API              |
| WHITEHOUSE       | `whitehouse-news`   | White House News scraper      |
| SOCIAL_X         | `social-x`          | Grok Live Search              |
| FINANCE_API      | `finance-api`       | Alpha Vantage / Yahoo Finance |
| WEATHER_API      | `weather-api`       | OpenWeatherMap                |
