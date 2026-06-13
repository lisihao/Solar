/**
 * plugins/core 顶层 barrel（v5.1 R0.5 PR-11）
 *
 * 对外暴露：
 * - PluginCoreModule（NestJS @Global module，AppModule 一次 import 即可）
 * - HookBus / PluginRegistry / PluginSupervisor / PluginLoader / LifecycleHookBridge
 *   类型（用于 DI inject 标注，运行时由 PluginCoreModule provider 解析）
 * - 抽象类型 IPlugin / IPluginManifest / IPluginContext / CORE_HOOKS / 等
 *
 * 不对外暴露：
 * - 内部实现 (manifest-validator / plugin-resolver 等具体类) ——
 *   ai-app 仅通过 NestJS DI 拿 instance，不应直接 new
 */
export {
  PluginCoreModule,
  PLUGIN_CORE_VERSION,
  type ISupervisedPlugin,
} from "./plugin-core.module";

// 抽象类型（@stable SDK 承诺面）
export * from "./abstractions";

// DI tokens（让 ai-app 用于 @Inject 注解）
export { HookBus } from "./hook-bus";
export {
  PluginRegistry,
  PluginResolver,
  PluginCircularDependencyError,
  PluginMissingDependencyError,
  PluginReplacesConflictError,
} from "./registry";
export { PluginSupervisor } from "./lifecycle";
export {
  PluginLoader,
  PluginConfigService,
  ManifestValidator,
  ManifestValidationError,
} from "./loader";
export { LifecycleHookBridge } from "./bridge";
