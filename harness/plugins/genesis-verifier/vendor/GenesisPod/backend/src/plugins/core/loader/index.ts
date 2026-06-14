/**
 * Plugin loader 实现层桶（v5.1 R0.5 PR-3）
 */
export {
  ManifestValidator,
  ManifestValidationError,
} from "./manifest-validator";
export {
  PluginConfigService,
  type PluginEntryConfig,
  type PluginGlobalsConfig,
  type PluginsConfigShape,
  type PluginProfile,
} from "./plugin-config.service";
export {
  PluginLoader,
  type PluginLoaderDeps,
  type PluginLoadResult,
} from "./plugin-loader.service";
