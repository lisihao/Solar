export { MissionAbortRegistry } from "./abort-registry";
export {
  MissionLifecycleManager,
  // ★ C0/G1：唯一终态写入口的契约类型（app 实现 arbiter + 提交 intent）。
  type MissionTerminalIntent,
  type MissionTerminalArbiter,
  type MissionLifecycleStatus,
  type MissionTerminalStatus,
} from "./mission-lifecycle-manager";
export {
  MissionHealthMonitor,
  type HealthCheckConfig,
  type HealthCheckResult,
  type HealthVerdict,
  type MissionHealthMonitorOptions,
  type MissionHealthSnapshot,
} from "./health-monitor";
// ★ 2026-05-05 unified harness liveness guard（替代 4 个 detector 的归并）
//   原 MissionOrphanDetectorService (Redis-based heartbeat) 已删除：
//   - 它的 auto scan 长期 disabled（heartbeat 不可靠）
//   - 它的能力被 MissionLivenessGuard 完整覆盖（多信号 + adapter 注入）
export {
  MissionLivenessGuard,
  type MissionLivenessAdapter,
  type MissionLivenessConfig,
  type MissionLivenessRow,
  type ScanResult as MissionLivenessScanResult,
} from "./mission-liveness-guard.service";
export { MissionOwnershipRegistry } from "./ownership-registry";
export {
  HEARTBEAT_INTERVAL_MS,
  MissionRuntimeStateStore,
  type MissionHeartbeat,
} from "./runtime-state-store";
// ★ 2026-05-04 (PR-3 standardize consumer): RerunLockRegistry 从
//   ai-app/{app} 上提（in-memory mission-level lock primitive，
//   与 abort-registry / ownership-registry 同形态）
export { RerunLockRegistry } from "./rerun-lock.registry";
