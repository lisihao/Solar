/**
 * Plugin registry 实现层桶（v5.1 R0.5 PR-3）
 */
export { PluginRegistry } from "./plugin-registry.service";
export {
  PluginResolver,
  PluginCircularDependencyError,
  PluginMissingDependencyError,
  PluginReplacesConflictError,
  type IPluginResolver,
} from "./plugin-resolver";
