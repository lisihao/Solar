/**
 * deep-insight pipeline bindings 桶。
 * 14 阶段执行内核（StageBindings 实现）+ per-run crossStageState 绑定 helper。
 */
export {
  DeepInsightStageBindings,
  attachState,
  detachState,
} from "./deep-insight-stage-bindings";
export { invokeAgent, type AgentRunProjection } from "./agent-invoke.helper";
// S8 逐章流式 + S8B 三重时间护栏（审计 #4/#34/#35/#36）。bindings 调用，独立可单测。
export {
  withTimeout,
  emitChapterStream,
  startWritingHeartbeat,
  runGuardedSectionRemediation,
  type ChapterStreamArgs,
  type WriterSectionLite,
  type GuardedRemediationArgs,
  type GuardedRemediationDeps,
  type GuardedRemediationResult,
  type RemediableSection,
  type SelfEvalLite,
  type RemediateLite,
} from "./chapter-stream.helper";
