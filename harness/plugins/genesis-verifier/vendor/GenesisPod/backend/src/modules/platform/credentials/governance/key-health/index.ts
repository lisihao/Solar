export {
  KeyErrorClassifier,
  type ClassifiedError,
  type KeyErrorAction,
  type KeyErrorReason,
} from "./key-error-classifier";
export {
  KeyHealthStore,
  type KeyHealthRecord,
  type KeyHealthState,
  type ParsedKeyId,
  parseKeyId,
  buildPersonalKeyId,
  buildAssignedKeyId,
  buildSystemKeyId,
} from "./key-health.store";
export { KeyHealthModule } from "./key-health.module";
export {
  ProviderProbeService,
  type ProbeErrorCode,
  type ProviderProbeResult,
} from "./provider-probe.service";
// 通用多 key 轮换 + 健康/冷却原语（2026-06-03 从 ai-engine/llm 迁入；非 LLM 专属）
export { MultiKeyManager, type KeyHealthStatus } from "./multi-key.manager";
