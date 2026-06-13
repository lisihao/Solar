/**
 * WritingMissionDeps —— stage 函数所需的依赖包（按 phase 拆类型）
 *
 * 由 dispatcher 在 runMission 入口装配一次，然后随 SessionEntry 传给每个 stage 函数。
 *
 * 设计决策（照 playground mission-deps.ts）：
 *   • CommonDeps        ← 所有 stage 都用（框架件：invoker / store / runner / emit /
 *                          lifecycle / eventBus / log + markIntermediateState /
 *                          markStageDegraded）
 *   • WorldDeps         ← s2 用（worldBuildingEnhancer / jsonParser / storyBible /
 *                          character / worldSetting + bibleKeeper role）
 *   • OutlineDeps       ← s3 用（storyArchitect role + jsonParser / textProcessor）
 *   • DraftDeps         ← s4 用（writer role + chapterDependency /
 *                          parallelOrchestrator / writerPool / context /
 *                          expressionMemory / openingHook / narrativeCraft /
 *                          textProcessor）
 *   • ConsistencyDeps   ← s5 用（consistencyChecker role + semanticConsistency /
 *                          factExtractor / consistencyEngine）
 *   • EditDeps          ← s6 用（editor role + qualityGate / chapterQualityEvaluator）
 *   • QualityDeps       ← s7 用（qualityGate / chapterQualityEvaluator /
 *                          narrativeCraft / storyCompletionDetector）
 *   • PersistDeps       ← s8 用（writingPersistence / projector）
 *
 * 注（B0 范围）：
 *   • 领域 service 全部原样保留（从现有 service class import），只是从「Agent/Executor
 *     构造注入」改成「Deps 注入，stage 调用」。
 *   • role service 层（writer / bibleKeeper / storyArchitect / consistency / editor）
 *     + AgentInvoker 由 B2 在 mission/roles/ 建。B0 阶段它们尚不存在，故此处用本地
 *     forward-declare 接口（按 invoke 契约最小声明）占位，B2 落地后替换为真实 class
 *     类型，stage 签名不变。
 *   • projector 由 B4 在 mission/projectors/ 建，B0 同样 forward-declare 占位。
 *   • store 走框架共享 checkpoint（迁移规格决策「中间状态走框架共享 checkpoint，不加
 *     列」）。writing 当前无等价 mission-state 表，故 WritingMissionStore 为本地接口，
 *     声明 markIntermediateState（按 ctx 子集 patch）+ markStageDegraded 两个方法，
 *     实现由后续波次接入。
 */

import type { Logger } from "@nestjs/common";

import type {
  AgentRunner,
  EventBus,
  EmitFn,
  LifecycleFn,
  MissionLifecycleManager,
} from "@/modules/ai-harness/facade";

// 领域 service（原样保留，从现有路径 import）
import type { WorldBuildingEnhancerService } from "../../services/bible/world-building-enhancer.service";
import type { StoryBibleService } from "../../services/bible/story-bible.service";
import type { CharacterService } from "../../services/bible/character.service";
import type { WorldSettingService } from "../../services/bible/world-setting.service";
import type { WritingJsonParserService } from "../../services/mission/writing-json-parser.service";
import type { WritingTextProcessorService } from "../../services/mission/writing-text-processor.service";
import type { WritingContextService } from "../../services/mission/writing-context.service";
import type { WritingPersistence } from "../../services/mission/writing-persistence.service";
import type { ChapterDependencyService } from "../../services/parallel/chapter-dependency.service";
import type { ParallelOrchestratorService } from "../../services/parallel/parallel-orchestrator.service";
import type { WriterPoolService } from "../../services/parallel/writer-pool.service";
import type { ExpressionMemoryService } from "../../services/quality/expression-memory.service";
import type { OpeningHookService } from "../../services/quality/opening-hook.service";
import type { NarrativeCraftService } from "../../services/quality/narrative-craft.service";
import type { WritingQualityGateService } from "../../services/quality/quality-gate.service";
import type { ChapterQualityEvaluatorService } from "../../services/quality/chapter-quality-evaluator.service";
import type { StoryCompletionDetectorService } from "../../services/quality/story-completion-detector.service";
import type { SemanticConsistencyService } from "../../services/quality/semantic-consistency.service";
import type { FactExtractorService } from "../../services/consistency/fact-extractor.service";
import type { ConsistencyEngineService } from "../../services/consistency/consistency-engine.service";

// ─── role service 层（B2 已建，真实 class 类型）──────────────────────────
import type { WriterService } from "../roles/writer.service";
import type { BibleKeeperService } from "../roles/bible-keeper.service";
import type { StoryArchitectService } from "../roles/story-architect.service";
import type { ConsistencyService } from "../roles/consistency.service";
import type { EditorService } from "../roles/editor.service";

// ─── AgentInvoker（B2 已建，真实 class 类型）────────────────────────────
import type { AgentInvoker } from "../roles/agent-invoker.service";

// ─── projector（B4 已建，真实 class 类型）───────────────────────────────
import type { WritingArtifactProjector } from "../projectors/writing-artifact.projector";

import type { WritingMissionContext } from "./mission-context";

export type { EmitFn, LifecycleFn };

// ─── Re-export real types for consumers (stage files etc.) ───────────────
export type {
  WriterService,
  BibleKeeperService,
  StoryArchitectService,
  ConsistencyService,
  EditorService,
};
export type { AgentInvoker };
export type { WritingArtifactProjector };

// ─── store（框架共享 checkpoint，本地接口，不加 Prisma 列）─────────────────
export interface WritingMissionStore {
  /**
   * 写中间产物到框架共享 checkpoint（按 ctx 子集 patch，append/覆盖语义由调用方决定）。
   * 用法：deps.store.markIntermediateState(missionId, { chapterDrafts: [...] }, userId)。
   */
  markIntermediateState(
    missionId: string,
    patch: Partial<WritingMissionContext>,
    userId?: string,
  ): Promise<void>;

  /**
   * stage 软失败上报（不阻断 mission，让 orchestrator + 前端可见）。
   * 禁止 log.warn 后静默 swallow（软失败盲区）。
   */
  markStageDegraded(
    missionId: string,
    userId: string,
    stepId: string,
    reason: string,
  ): Promise<void>;
}

// ─── Phase 0: CommonDeps（每个 stage 都注入）─────────────────────────────
export interface CommonDeps {
  readonly invoker: AgentInvoker;
  readonly store: WritingMissionStore;
  readonly runner: AgentRunner;
  readonly lifecycleManager: MissionLifecycleManager;
  readonly eventBus: EventBus;
  readonly log: Logger;
  readonly emit: EmitFn;
  readonly lifecycle: LifecycleFn;
}

// ─── Phase 2: World（s2-world-build）────────────────────────────────────
export interface WorldDeps extends CommonDeps {
  readonly bibleKeeper: BibleKeeperService;
  readonly worldBuildingEnhancer: WorldBuildingEnhancerService;
  readonly jsonParser: WritingJsonParserService;
  readonly storyBible: StoryBibleService;
  readonly character: CharacterService;
  readonly worldSetting: WorldSettingService;
}

// ─── Phase 3: Outline（s3-outline-plan）─────────────────────────────────
export interface OutlineDeps extends CommonDeps {
  readonly storyArchitect: StoryArchitectService;
  readonly jsonParser: WritingJsonParserService;
  readonly textProcessor: WritingTextProcessorService;
  /** Persistence service for writingVolume/writingChapter upsert (injected by dispatcher). */
  readonly writingPersistence: WritingPersistence;
}

// ─── Phase 4: Draft（s4-chapter-fanout）─────────────────────────────────
export interface DraftDeps extends CommonDeps {
  readonly writer: WriterService;
  readonly chapterDependency: ChapterDependencyService;
  readonly parallelOrchestrator: ParallelOrchestratorService;
  readonly writerPool: WriterPoolService;
  readonly context: WritingContextService;
  readonly expressionMemory: ExpressionMemoryService;
  readonly openingHook: OpeningHookService;
  readonly narrativeCraft: NarrativeCraftService;
  readonly textProcessor: WritingTextProcessorService;
}

// ─── Phase 5: Consistency（s5-consistency-check）────────────────────────
export interface ConsistencyDeps extends CommonDeps {
  readonly consistencyChecker: ConsistencyService;
  readonly semanticConsistency: SemanticConsistencyService;
  readonly factExtractor: FactExtractorService;
  readonly consistencyEngine: ConsistencyEngineService;
}

// ─── Phase 6: Edit（s6-edit-polish）─────────────────────────────────────
export interface EditDeps extends CommonDeps {
  readonly editor: EditorService;
  readonly qualityGate: WritingQualityGateService;
  readonly chapterQualityEvaluator: ChapterQualityEvaluatorService;
}

// ─── Phase 7: Quality（s7-quality-evaluate）─────────────────────────────
export interface QualityDeps extends CommonDeps {
  readonly qualityGate: WritingQualityGateService;
  readonly chapterQualityEvaluator: ChapterQualityEvaluatorService;
  readonly narrativeCraft: NarrativeCraftService;
  readonly storyCompletionDetector: StoryCompletionDetectorService;
}

// ─── Phase 8: Persist（s8-mission-persist）──────────────────────────────
export interface PersistDeps extends CommonDeps {
  readonly writingPersistence: WritingPersistence;
  readonly projector: WritingArtifactProjector;
}

/**
 * WritingMissionDeps —— 完整合成类型（dispatcher 装配 + 所有 stage 函数当前签名都用这个）。
 */
export interface WritingMissionDeps
  extends
    CommonDeps,
    WorldDeps,
    OutlineDeps,
    DraftDeps,
    ConsistencyDeps,
    EditDeps,
    QualityDeps,
    PersistDeps {}
