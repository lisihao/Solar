# 22c: Task Executors & Research Layer - Behavior Contract

**Scope**: Task Executor Interface + 4 Executors + 5 Research Services

**Document Purpose**: Precise specification of public method signatures, control flow pseudocode, database operations, and business invariants for the Topic Insights executors and research layer.

---

## Task Executor Interface

**File**: `task-executor.interface.ts` (lines 1-73)

### TaskExecutionContext (Input)

```typescript
interface TaskExecutionContext {
  task: ResearchTask;
  topic: ResearchTopic & { dimensions: TopicDimension[] };
  missionId: string;
  reportId: string;
  depthConfig?: ResearchDepthConfig;
  assignedModelId?: string;
  assignedSkills: string[];
  assignedTools: string[];
  agentName: string;
  agentRole: string;
}
```

**Fields**:

- `task`: ResearchTask record (taskType, status, result)
- `topic`: ResearchTopic + eager-loaded dimensions
- `missionId`: Foreign key to ResearchMission
- `reportId`: Foreign key to TopicReport
- `depthConfig`: Optional research depth configuration
- `assignedModelId`: Optional LLM model ID
- `assignedSkills/Tools`: Arrays of assigned resources
- `agentName/Role`: Agent display info

### TaskExecutionResult (Output)

Heterogeneous result supporting multiple executor types with fields:

- `summary/content/detailedContent`: Text results
- `keyFindings/analysisResult`: Key discoveries
- `trends/challenges/opportunities`: Analysis results
- `revisionTargets`: Quality review decisions
- `revisionRound`: Current review iteration (1/2)
- `actualModelId`: Model used for execution

### ITaskExecutor Interface

Single method: `execute(context): Promise<TaskExecutionResult>`

**Invariant**: All executors must return result (never throw), emit progress events, handle missing dimensions, respect depthConfig.

---

## 5.1 DimensionResearchExecutor

**File**: `dimension-research.executor.ts` (lines 27-202)

### execute() - Lines 27-140

Orchestrate dimension research using Leader-Agent collaboration.

**Control Flow**:

1. Emit dimension_research_started event
2. Look up dimension (priority: ID → name → DB)
3. If found: call dimensionMissionService.executeDimensionMission()
4. If not found: call executeGenericDimensionResearch()
5. Emit dimension_research_completed event
6. Return result

**Prisma Reads**: topicDimension.findUnique (fallback lookup)
**Prisma Writes**: None
**Events**: dimension_research_started, dimension_research_progress (5%), dimension_research_completed

**Invariants**:

- dimensionId takes precedence over dimensionName
- Query DB if not in cached topic.dimensions
- keyFindings count defaults to 0

### executeGenericDimensionResearch() - Lines 146-202

Create new dimension when predefined doesn't exist.

**Control Flow**:

1. Get dimensionName from task
2. Query max sortOrder from topicDimension
3. Create new TopicDimension (status=PENDING, searchQueries=[name], searchSources=[web])
4. Call dimensionMissionService.executeDimensionMission()
5. Return analysisResult

**Prisma Reads**: topicDimension.findFirst (for max sortOrder)
**Prisma Writes**: topicDimension.create()

**Invariants**:

- sortOrder sequential from 0 onward
- searchQueries always initialized with dimensionName
- status always PENDING
- Fallback: if findFirst returns null, use sortOrder=1

---

## 5.2 ReviewDimensionExecutor

**File**: `review-dimension.executor.ts` (lines 60-730)

Core quality review orchestration with AI or deterministic scoring.

### execute() - Lines 60-730

Full review pipeline with cognitive loops and quality assessment.

**Control Flow**:

1. Emit agent_working (progress=10%)
2. Query completedTasks (dimension_research, COMPLETED)
3. V5 Cognitive Loop (IF enableAiQualityReview && maxCognitiveLoops > 0)
   - Validate claims against evidence
   - Find gaps (disputed/unverified important claims)
   - Generate gap search queries
   - Execute supplementary searches
   - Append new evidence, re-validate
   - Loop 0..maxCognitiveLoops-1 (skip search on last iteration)
4. Review each dimension
   - If AI mode: call reviewerService.reviewDimension()
   - If deterministic: calculate heuristic scores
   - Record review, emit progress
5. Perform overallReview (IF dimensionReviews.length > 0)
6. Determine revision targets (parse "[revision:N]" from task.description)
7. Return { reviewedTasks, dimensionReviews, overallReview, revisionTargets, revisionRound }

**Prisma Reads**:

- researchTask.findMany (completed dimension research)
- topicEvidence.findMany (fact-check, 50 max)

**Prisma Writes**: None (delegated to agentActivity)

**Events**: agent_working (multiple times), agent_working per dimension, overall review

**Invariants**:

- enableAiQualityReview controls AI vs deterministic path
- Cognitive loop skips search on final iteration
- Evidence budget expands (8000→12000 chars on re-validation)
- revisionRound >= 2: no more revision allowed
- Claims extracted from either keyFindings or analysisResult.keyFindings

**Deterministic Scoring**:

- breadthScore: findings + trends + challenges + opportunities
- depthScore: contentLength + findings + evidence
- evidenceScore: evidence count
- coherenceScore: summary + findings + content + confidence
- currencyScore: 75 (default)
- overallScore: weighted average (0.25, 0.25, 0.25, 0.15, 0.1)

### parseRevisionRound() - Lines 736-739

Extract revision round from task.description.

**Control Flow**:

1. Match /\[revision:(\d+)\]/ in description
2. Return parsed number or 1 (default)

### determineRevisionTargets() - Lines 750-831

Decide which dimensions need re-research.

**Control Flow**:

1. If currentRound >= 2: return empty (hard limit)
2. For each review:
   - Check failure conditions (score thresholds)
   - If fails: find matching task
   - Build feedback with reasons and suggestions
   - Add to targets
3. Return { needsRevision, targets }

**Failure Thresholds**:

- overallScore < 60
- evidence < 40, depth < 35, breadth < 35, coherence < 30

---

## 5.3 SynthesisReportExecutor

**File**: `synthesis-report.executor.ts` (lines 52-194)

Synthesize dimension analyses into final report.

### execute() - Lines 52-194

**Control Flow**:

1. Emit report_synthesis_started event
2. Query dimensionTasks (completed, ordered by createdAt)
3. Build dimensionSortOrders Map
4. For each task:
   - Save dimension analysis (with chapterIndex = sortOrder - 1)
5. Call reportSynthesisService.synthesizeReport()
6. V5 Fact-check (IF factCheckEnabled):
   - Query topicEvidence (50 max)
   - Call reviewerService.factCheckReport()
   - Log accuracy (non-fatal)
7. Emit report_synthesis_completed event
8. Notify AutoDreamScheduler (optional)
9. Return mapped result

**Prisma Reads**:

- researchTask.findMany (dimension research)
- topicDimension.findMany (sortOrder)
- topicEvidence.findMany (fact-check)

**Prisma Writes**: None (delegated)

**Invariants**:

- reportId pre-created
- chapterIndex = sortOrder - 1 (0-indexed)
- factCheckEnabled is conditional

---

## 5.4 GenericTaskExecutor

**File**: `generic-task.executor.ts`

### execute() - Lines 12-21

Fallback for unrecognized task types.

**Control Flow**:

1. Log warning: "Unknown task type: {taskType}"
2. Return { status: 'skipped', message: 'Unknown task type — no executor registered' }

**Invariant**: Never throws, always skipped gracefully

---

## 5.5 ResearchEventEmitterService

**File**: `research-event-emitter.service.ts` (lines 1-1220)

Event hub and persistence layer for research workflow.

### registerEmitHandler() - Lines 218-221

Register WebSocket event callback.

### emitToTopic() - Lines 227-264

Broadcast event to WebSocket and handler.

**Control Flow**:

1. Normalize event data (add timestamp)
2. Try realtimeAdapter.emitToTopic()
3. Try emitHandler()
4. Log if neither available

### emitMissionStarted() - Lines 272-316

Announce mission start, initialize progress tracking.

**Prisma Writes**: researchTeamMessage.create()

**Events**: MISSION_STARTED

### emitMissionCompleted() - Lines 332-373

Mark mission complete, finalize progress.

**Prisma Writes**: researchTeamMessage.create()

**Events**: MISSION_COMPLETED

### emitMissionFailed() - Lines 379-418

Report mission failure.

**Events**: MISSION_FAILED

### emitLeaderThinking() - Lines 426-471

Persist Leader reasoning to DB.

**Prisma Writes**: researchAgentActivity.create()

**Invariants**:

- Foreign key errors only (topic deleted): debug log
- Phase maps to activityType

### emitLeaderPlanReady() - Lines 492-534

Signal planning done, transition phases.

**Prisma Writes**: researchTeamMessage.create()

### emitAgentWorking() - Lines 606-689

Track agent work (frequent).

**Prisma Writes**:

- researchAgentActivity.create()
- researchTask.updateMany (sync progress)

**Invariants**:

- modelId label appended to agentName
- dimensionName & progress sync task panel
- Status mapped: working→RESEARCHING, completed→COMPLETED, failed→FAILED

### emitDimensionResearchStarted() - Lines 831-865

Announce dimension research start.

**Prisma Writes**: researchTeamMessage.create()

### emitDimensionResearchProgress() - Lines 872-944

Track dimension progress (frequent).

**Prisma Writes**: researchTask.updateMany (sync), researchTeamMessage.create() (only at 25% intervals)

### emitDimensionResearchCompleted() - Lines 950-986

Mark dimension research done.

**Prisma Writes**: researchTeamMessage.create()

### emitReportSynthesisStarted() - Lines 1018-1069

Mark report writing phase start.

**Prisma Writes**: researchTeamMessage.create()

### emitReportSynthesisCompleted() - Lines 1075-1127

Mark report writing complete.

**Prisma Writes**: researchTeamMessage.create()

### getTeamMessages() - Lines 1134-1149

Retrieve team conversation history.

**Prisma Reads**: researchTeamMessage.findMany()

### getAgentActivities() - Lines 1154-1170

Retrieve agent work log.

**Prisma Reads**: researchAgentActivity.findMany()

### getLeaderConversationHistory() - Lines 1182-1206

Fetch multi-turn conversation for AI context.

**Prisma Reads**: researchTeamMessage.findMany()

---

## 5.6 ResearchMemoryService

**File**: `research-memory.service.ts`

Knowledge extraction and retrieval.

### extractAndStoreFindings() - Lines 50-212

Extract key findings from completed research.

**Control Flow**:

1. Load mission with completed tasks
2. Extract task results (limit: 5 keyFindings, 3 trends, 3 challenges)
3. Call chatFacade.chat() to extract findings (JSON)
4. Filter invalid findings (null entity/finding/category)
5. Store via researchMemory.createMany()

**Prisma Reads**: researchMission.findUnique()
**Prisma Writes**: researchMemory.createMany(skipDuplicates: true)

**Invariants**:

- LLM extraction produces variable quality, must filter
- confidence normalized to [0, 1]
- Graceful degradation if table not yet created (P2021)

### getRelevantMemories() - Lines 217-282

Retrieve prior findings related to query.

**Control Flow**:

1. Parse query into keywords
2. Query researchMemory (entity/finding/tags match, insensitive)
3. Order by confidence DESC

**Prisma Reads**: researchMemory.findMany()

### getMemorySummary() - Lines 287-350

Generate markdown summary of prior findings.

**Prisma Reads**: researchMemory.findMany (top 20)

**Control Flow**:

1. Query top 20 memories
2. Group by category
3. Build markdown sections
4. Return formatted string

---

## 5.7 ResearchRealtimeAdapter

**File**: `research-realtime.adapter.ts`

Adapt Research events to AI Engine RealtimeModule.

### startMissionTracking() - Lines 161-184

Initialize mission progress tracker.

**Control Flow**:

1. If not enabled: return
2. Select phases based on isQuickMode
3. Create mission room config
4. Call realtimeProgress.create() and start()

**Invariants**:

- Phase weights sum to 100 (1.0)
- Quick mode skips reviewing (70% researching)

### updatePhaseProgress() - Lines 198-215

Update phase progress.

**Control Flow**:

1. If not enabled: return 0
2. Call realtimeProgress.updatePhaseProgress()
3. Get current progress
4. Return overall progress

### completePhase() - Lines 220-227

Mark phase done.

### completeMissionTracking() - Lines 241-245

Finalize mission tracking.

### emitToTopic() - Lines 282-287

Broadcast event to topic room.

### subscribeToTopic() - Lines 471-515

Subscribe client to topic events (with memory leak prevention).

**Control Flow**:

1. If not enabled: return no-op unsubscribe
2. Generate subscriptionId
3. Create unsubscribers for all ResearchEventType
4. Register in subscriptionRegistry
5. Return unsubscribe function

**Invariants**:

- subscriptionRegistry prevents memory leaks
- TTL = 1 hour
- Cleanup every 10 minutes

### startCleanupTask() - Lines 87-94

Periodic stale subscription cleanup.

### cleanupStaleSubscriptions() - Lines 99-116

Remove subscriptions older than 1 hour.

---

## 5.8 ResearchStrategyService

**File**: `research-strategy.service.ts`

Analyze research freshness and recommend strategy.

### analyzeAndRecommend() - Lines 55-140

Full freshness analysis.

**Control Flow**:

1. Merge config with defaults (fresh: 24h, recent: 7d, stale: 30d)
2. Load topic with dimensions
3. Analyze topic status
4. Analyze each dimension freshness
5. Calculate stats
6. Determine strategy
7. Estimate scope
8. Return ResearchStrategyRecommendation

**Prisma Reads**: researchTopic.findUnique()

### quickCheck() - Lines 145-183

Fast check if research needed.

**Control Flow**:

1. Call analyzeAndRecommend()
2. Calculate needsResearch, isNewResearch
3. Map strategy to button text
4. Return quick result

### getSmartRefreshOptions() - Lines 190-257

Auto-select refresh strategy.

**Control Flow**:

1. Call analyzeAndRecommend()
2. Switch strategy:
   - NEW: forceRefresh=true
   - INCREMENTAL: forceRefresh=false, list dimensions
   - FULL_REFRESH: forceRefresh=true
   - OPTIONAL: forceRefresh=false, optional list
   - UP_TO_DATE: no refresh

### analyzeDimensionFreshness() - Lines 262-327

Calculate freshness for one dimension.

**Control Flow**:

1. If never researched: NEVER_RESEARCHED, priority=high
2. Calculate hours/days since research
3. Determine level:
   - <= 24h: FRESH, no update
   - <= 7d: RECENT, low priority
   - else: STALE, medium/high priority
4. Override: if status!=COMPLETED, priority=high

### determineStrategy() - Lines 332-400

Map stats to strategy.

**Control Flow**:

1. If no existing research: NEW
2. If all dimensions fresh: UP_TO_DATE
3. If >70% need update OR any never-researched: FULL_REFRESH
4. If some need update: INCREMENTAL
5. Else: OPTIONAL (requires confirmation)

---

## 5.9 ResearchTemplateService

**File**: `research-template.service.ts`

Built-in + custom research templates.

### getTemplates() - Lines 547-558

Retrieve all templates, optionally filtered.

**Control Flow**:

1. Combine built-in + custom
2. Filter by category if provided
3. Return array

### getTemplate() - Lines 563-568

Sync lookup (built-in or custom).

### getTemplateAsync() - Lines 573-589

DB-first lookup with in-memory fallback.

**Prisma Reads**: researchTemplate.findUnique()

### applyTemplate() - Lines 594-638

Instantiate template with parameters.

**Control Flow**:

1. Load template
2. Validate required params
3. Replace placeholders in dimensions
4. Generate topicName
5. Return TemplateApplicationResult

**Invariants**:

- Parameter replacement: simple string.replace(\{key\})
- Required params enforced
- searchQueries expanded from templates

### recommendTemplate() - Lines 643-690

Use AI to suggest templates.

**Control Flow**:

1. Build template summaries
2. Call chatFacade.chat() (low creativity, short output)
3. Parse JSON response
4. Filter where template exists
5. Return recommendations

### getCategories() - Lines 704-714

Get template count per category.

### syncBuiltInTemplates() - Lines 724-752

Persist built-in templates to DB (idempotent).

**Prisma Writes**: researchTemplate.create() (if not exists)

**Invariants**:

- Idempotent (skips existing)
- All built-in have isBuiltIn=true

---

## Summary

**Total Methods**: 40+ across 6 services

**Method Count by Service**:

- ResearchEventEmitterService: 16
- ReviewDimensionExecutor: 4
- DimensionResearchExecutor: 2
- SynthesisReportExecutor: 1
- GenericTaskExecutor: 1
- ResearchMemoryService: 3
- ResearchRealtimeAdapter: 8
- ResearchStrategyService: 5
- ResearchTemplateService: 7

**Prisma Operations**: ~30 read/write across all services

**Events Emitted**: 20+ WebSocket types + database persistence

**Business Invariants**: 50+ critical rules
