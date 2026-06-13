/**
 * Per-role services barrel export
 *
 * 8 个角色 × 1 个 invoker。orchestrator / leader-chat / 其它服务统一通过本 barrel
 * 引入，不再单文件 import 一堆 agent class。
 *
 * 角色与文件一一对应（与 agents/<role>/ 目录同名）：
 *
 *   agent-invoker.service.ts  ← 兼容门面（对外 API 保持稳定）
 *   agent-execution-support.ts ← 通用执行支撑（run / 并发 / DAG）
 *   playground-event-relay.ts ← Playground 事件语义与 cost relay
 *   agent-invocation-policy.ts ← Playground 调用策略（loop / failure learning）
 *   leader.service.ts         ← M0/M1/M6/M7 跨 milestone 容器（SupervisedMission）
 *   researcher.service.ts     ← 单 dim 数据采集
 *   reconciler.service.ts     ← 跨 dim 对账
 *   analyst.service.ts        ← 跨 dim 综合分析
 *   writer.service.ts         ← 6 种写作模式（single-shot / outline / chapter / ...）
 *   reviewer.service.ts       ← 主观质量评审 / L4 critic / dim quality judge
 *   verifier.service.ts       ← 客观事实核验（4 mode）
 *   steward.service.ts        ← 资源 / 合规 / 边界守门（4 scope）
 */

export { AgentInvoker, type InvocationContext } from "./agent-invoker.service";
export {
  LeaderService,
  SupervisedMission,
  type LeaderRunFn,
  type LeaderTask,
  type LeaderResearcherOutcome,
  type LeaderStageOutcomes,
  type LeaderFinalQuality,
  type LeaderPlanOutput,
} from "./leader.service";
export { ResearcherService } from "./researcher.service";
export { ReconcilerService } from "./reconciler.service";
export { AnalystService } from "./analyst.service";
export { WriterService } from "./writer.service";
export { ReviewerService } from "./reviewer.service";
export { VerifierService } from "./verifier.service";
export { StewardService } from "./steward.service";
