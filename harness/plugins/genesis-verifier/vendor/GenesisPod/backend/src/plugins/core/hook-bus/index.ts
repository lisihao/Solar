/**
 * HookBus 实现层桶（v5.1 R0.5 PR-2）
 *
 * 仅暴露 HookBus 类 + IPluginSupervisor 接口；
 * IHookContext / HookHandler / HookAbortError 等类型在 abstractions/ 桶。
 */
export { HookBus } from "./hook-bus.service";
export type { IPluginSupervisor, HookBusConfig } from "./hook-bus.service";
