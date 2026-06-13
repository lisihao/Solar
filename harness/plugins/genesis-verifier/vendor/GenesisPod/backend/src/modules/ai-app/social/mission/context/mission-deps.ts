/**
 * MissionDeps —— social SocialPublishMission stage 函数所需的依赖包
 *
 * Mirror of playground/mission/context/mission-deps.ts。
 * PR-3c 简化版：合并到 CommonDeps（不细分 PlanDeps/TransformDeps/...），PR-4
 * dispatcher 装配时一次性注入所有 role services + 基础设施。
 */

import type { Logger } from "@nestjs/common";
import type {
  AgentRunner,
  EventBus,
  MissionAbortRegistry,
  FailureLearnerService,
  PostmortemClassifierService,
  EmitFn,
} from "@/modules/ai-harness/facade";
import type {
  SocialAgentInvoker,
  LeaderService,
  StewardService,
  PlatformProbeService,
  ContentTransformerAgentService,
  CoverArtistService,
  ComposerService,
  PolishReviewerService,
  PublishExecutorAgentService,
  PublishVerifierService,
} from "../roles";
import type { SocialMissionStore } from "../lifecycle/social-mission-store.service";

import type { LifecycleFn } from "@/modules/ai-harness/facade";
export type { EmitFn, LifecycleFn };

/**
 * CommonDeps —— social mission 所有 stage 都用的依赖（PR-3c 合并版，未来 PR
 * 改窄签名再按 phase 拆 PlanDeps / TransformDeps / ...）。
 */
export interface CommonDeps {
  // 基础设施
  readonly invoker: SocialAgentInvoker;
  readonly abortRegistry: MissionAbortRegistry;
  readonly runner: AgentRunner;
  readonly eventBus: EventBus;
  readonly log: Logger;
  readonly emit: EmitFn;
  readonly lifecycle: LifecycleFn;

  /** stage 软失败上报（不阻断 mission 但 orchestrator + 前端需可见） */
  readonly markStageDegraded: (
    missionId: string,
    userId: string,
    stepId: string,
    reason: string,
  ) => Promise<void>;

  // 9 role services
  readonly leader: LeaderService;
  readonly steward: StewardService;
  readonly platformProbe: PlatformProbeService;
  readonly contentTransformer: ContentTransformerAgentService;
  readonly coverArtist: CoverArtistService;
  readonly composer: ComposerService;
  readonly polishReviewer: PolishReviewerService;
  readonly publishExecutor: PublishExecutorAgentService;
  readonly publishVerifier: PublishVerifierService;

  // Persist / postlude
  readonly failureLearner: FailureLearnerService;
  readonly postmortemClassifier: PostmortemClassifierService;
  readonly store: SocialMissionStore;
}

export type MissionDeps = CommonDeps;
