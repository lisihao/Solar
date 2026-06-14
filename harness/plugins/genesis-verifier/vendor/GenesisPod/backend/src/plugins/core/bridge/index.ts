/**
 * Plugin bridge 实现层桶（v5.1 R0.5 PR-6）
 *
 * Bridge 是给 ai-harness/ai-app 主动调用的高层 API，
 * 将 fire HookBus 的细节封装起来，避免 caller 直接 import HookBus + payload type。
 */
export {
  LifecycleHookBridge,
  type FireMissionStartArgs,
  type FireMissionEndArgs,
  type FireMemoryWriteArgs,
  type FireMemoryReadArgs,
} from "./lifecycle-hook-bridge";
