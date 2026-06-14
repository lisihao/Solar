/**
 * Role services barrel for ai-app/social.
 *
 * 9 role services（LeaderService / StewardService / PlatformProbeService /
 * ContentTransformerAgentService / CoverArtistService / ComposerService /
 * PolishReviewerService / PublishExecutorAgentService / PublishVerifierService）
 * + SocialAgentInvoker（thin AgentRunner wrapper with "social" event namespace）.
 *
 * Naming convention: roles 下与同名 services/ 共存的 agent 版本带 `-agent` 后缀
 * （content-transformer-agent.service / publish-executor-agent.service），类名
 * 同步加 `Agent` 后缀，与 services/ 同步工作流的类区分。
 */
export {
  SocialAgentInvoker,
  extractTokenSpend,
  type SocialInvocationContext,
} from "./social-agent-invoker.service";
export { SocialEventRelay } from "./social-event-relay";
export {
  normalizeRunnerState,
  type NormalizedRunnerState,
} from "@/modules/ai-harness/facade";

export { LeaderService } from "./leader.service";
export { StewardService } from "./steward.service";
export { PlatformProbeService } from "./platform-probe.service";
export { ContentTransformerAgentService } from "./content-transformer-agent.service";
export { CoverArtistService } from "./cover-artist.service";
export { ComposerService } from "./composer.service";
export { PolishReviewerService } from "./polish-reviewer.service";
export { PublishExecutorAgentService } from "./publish-executor-agent.service";
export { PublishVerifierService } from "./publish-verifier.service";

export type { LeaderInvocationResult } from "./leader.service";
export type { StewardInvocationResult } from "./steward.service";
export type { PlatformProbeInvocationResult } from "./platform-probe.service";
export type { ContentTransformerInvocationResult } from "./content-transformer-agent.service";
export type { CoverArtistInvocationResult } from "./cover-artist.service";
export type { ComposerInvocationResult } from "./composer.service";
export type { PolishReviewerInvocationResult } from "./polish-reviewer.service";
export type { PublishExecutorInvocationResult } from "./publish-executor-agent.service";
export type { PublishVerifierInvocationResult } from "./publish-verifier.service";
