/**
 * PluginConfigService — 配置合并 + profile（v5.1 §11.6 / standards/19）
 *
 * 设计：
 * - 项目级：plugins.config.yaml（PluginLoader 在 PR-3 后续读 YAML 注入）
 * - 模块级 override：v5.1 P0-3 已删除（避免 appName 入 hook payload 破坏 §0）
 * - 现仅保留：项目级 yaml + tag-based override（plugin 自己读 manifest.tags）
 *
 * 此 service 持有解析后的 plugin 配置，PluginLoader 在 init plugin 时把对应配置传入。
 */
import type { IPluginConfigView } from "../abstractions/plugin.interface";

export type PluginProfile = "development" | "production" | "test" | string;

/**
 * 单个 plugin 的入口配置（来自 plugins.config.yaml 的一项）
 */
export interface PluginEntryConfig {
  /** plugin id */
  readonly id: string;
  readonly enabled: boolean;
  /** 该 plugin 是否被视为必须（覆盖 manifest.required）*/
  readonly required?: boolean;
  /** 业务配置（plugin 自定义 schema，由 plugin 自己 zod 校验）*/
  readonly config?: unknown;
  /** v5.1 §11.10：plugin 信任模式 strict/permissive */
  readonly trustMode?: "strict" | "permissive";
}

export interface PluginGlobalsConfig {
  readonly hookTraceEnabled?: boolean;
  /** v5.1 §11.8 plugin supervisor failureThreshold */
  readonly failureThreshold?: number;
  /** v5.1 §11.10 默认 trust mode（OSS 推荐 strict）*/
  readonly trustMode?: "strict" | "permissive";
}

export interface PluginsConfigShape {
  readonly version?: number;
  readonly profile?: PluginProfile;
  readonly globals?: PluginGlobalsConfig;
  readonly plugins?: PluginEntryConfig[];
}

export class PluginConfigService {
  private readonly entries: ReadonlyMap<string, PluginEntryConfig>;
  private readonly profile: PluginProfile;
  private readonly globals: PluginGlobalsConfig;

  constructor(raw: PluginsConfigShape | null = null) {
    const profile = raw?.profile ?? process.env.NODE_ENV ?? "development";
    const map = new Map<string, PluginEntryConfig>();
    for (const e of raw?.plugins ?? []) {
      map.set(e.id, e);
    }
    this.entries = map;
    this.profile = profile;
    this.globals = raw?.globals ?? {};
  }

  /** plugin 是否启用（默认 false 防"潜行"加载）*/
  isEnabled(pluginId: string): boolean {
    const e = this.entries.get(pluginId);
    if (!e) return false;
    return e.enabled;
  }

  /** 入口配置 */
  getEntry(pluginId: string): PluginEntryConfig | undefined {
    return this.entries.get(pluginId);
  }

  /** plugin 业务配置（plugin.init 时传入） */
  getConfig<T = unknown>(pluginId: string): T | undefined {
    const e = this.entries.get(pluginId);
    return e?.config as T | undefined;
  }

  /** plugin 是否必须（启动期 fail-fast 策略）*/
  isRequired(pluginId: string, manifestRequired: boolean): boolean {
    const entry = this.entries.get(pluginId);
    if (entry?.required !== undefined) return entry.required;
    return manifestRequired;
  }

  getProfile(): PluginProfile {
    return this.profile;
  }

  getGlobals(): PluginGlobalsConfig {
    return this.globals;
  }

  /** 列出所有 enabled plugin id（PluginLoader 用，按 enabled=true 过滤）*/
  listEnabledIds(): string[] {
    const out: string[] = [];
    for (const [id, e] of this.entries) {
      if (e.enabled) out.push(id);
    }
    return out;
  }

  /** 构造 IPluginConfigView 给 plugin（最小特权：只看自己 namespace + profile）*/
  buildView<T>(pluginId: string): IPluginConfigView<T> {
    const value = this.getConfig<T>(pluginId) ?? ({} as T);
    const profile = this.profile;
    return Object.freeze({
      value,
      profile,
    });
  }
}
