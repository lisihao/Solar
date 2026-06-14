/**
 * Plugin 核心接口（v5.1 §11.3 / standards/19 §五 规则 8 标 @stable）
 *
 * SDK 发布对外承诺面：IPlugin / IPluginManifest / IPluginContext 是 @stable，
 * 破坏性变更必须 major bump。
 */
import type { HookId } from "./hooks";
import type { PluginCapability } from "./plugin-capability.types";
import type { ServiceToken } from "./service-tokens";

/**
 * Plugin 域分类（v5.1 §11.1 锁定 8 大域，含 core）
 *
 * core 是特殊"域"——内核而非实现，标 category 为 plugin-core 仅用于 SDK 元信息。
 * 7 个实现域 + experimental（试验性）共 9 个值。
 */
export const PLUGIN_CATEGORIES = [
  "plugin-core",
  "observability",
  "resilience",
  "security",
  "storage",
  "rag-backend",
  "llm-augment",
  "tool-augment",
  "experimental",
] as const;

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

/**
 * Plugin 稳定性等级（v5.1 §11.10 SDK 发布对外承诺面）
 */
export type PluginStability = "stable" | "experimental" | "internal";

/**
 * Plugin manifest 自描述（v5.1 §11.3 / standards/19 §五）
 */
export interface IPluginManifest {
  /** 全局唯一 plugin id（含域前缀，例：observability/telemetry-otel）*/
  id: string;

  /** plugin 自身 semver */
  version: string;

  /**
   * 兼容的 plugin-core 版本范围（semver range）
   * 启动期校验：当前 plugin-core 版本不满足此 range → fail-fast（无视 required）
   * v5.1 MED-2：不兼容一律 fail-fast，避免 SDK 升级后旧 plugin 静默 skip
   */
  coreVersionRange: string;

  /** 单行描述 */
  description: string;

  /** 域分类 */
  category: PluginCategory;

  /** 稳定性等级（SDK 对外承诺面）*/
  stability: PluginStability;

  /**
   * 替代关系：同一 replaces 值最多 1 个 enabled
   * 例：sandbox-isolated-vm 与 sandbox-vm2 都声明 replaces="sandbox"，互斥
   */
  replaces?: string;

  /** 依赖的其他 plugin id（启动期拓扑排序）*/
  dependencies?: string[];

  /** 监听的 hook（启动期与 capabilities 一致性校验）*/
  hooks: HookId[];

  /**
   * 能处理的 hook payload 版本矩阵（v5.1 §11.4）
   * 例：{ "engine.llm.request": [1, 2] } 表示能处理 v1/v2
   * HookBus 在 fire 时若 payload version 不在此列表 → logger.warn + skip
   */
  payloadVersions?: Record<HookId, number[]>;

  /** 所需 capability（plugin 安全模型，三层校验）*/
  capabilities: PluginCapability[];

  /**
   * 配置 zod schema 引用（启动期校验配置文件）
   * 在 manifest 中放 schema 引用而非具体类型，避免循环依赖
   */
  configSchemaRef?: string;

  /** 加载阶段 */
  phase: "bootstrap" | "runtime";

  /**
   * 是否必须（false=optional）
   * - true: init 失败 → fail-fast（系统拒启动）
   * - false: init 失败 → logger.warn + skip
   */
  required: boolean;

  /** 标签（业务无关，例：production-only / experimental-feature）*/
  tags?: string[];

  /**
   * 来源签名（v5.1 CRIT-2 / standards/19 §七 规则 12）
   * 外部 plugin（@genesis/plugins-* npm 包）OSS 必须签名
   * 公钥固化在 src/plugins/core/security/trusted-keys.json
   */
  signature?: {
    issuer: string;
    sig: string;
    algorithm: "ed25519" | "rsa-sha256";
  };

  /** 是否允许 ai-app 层 override（v5.1 LOW-2：security/* 类应设 false）*/
  overridable?: boolean;

  // ── SDK 发布元信息 ──
  homepage?: string;
  repository?: string;
}

/**
 * Plugin 健康状态（PluginSupervisor 周期检查）
 */
export interface PluginHealth {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  metrics?: Record<string, number>;
}

/**
 * Plugin 运行时契约（v5.1 §11.3 @stable）
 */
export interface IPlugin<TConfig = unknown> {
  /** 静态 manifest（plugin 自描述）*/
  readonly manifest: IPluginManifest;

  /**
   * 启动期初始化
   *
   * @param ctx plugin 与平台的唯一接口（最小特权）
   * @param config plugin 配置（来自 plugins.config.yaml + module override）
   * @throws 抛错时由 PluginLoader 处理：required=true 致命 fail-fast，
   *         required=false logger.warn + 跳过该 plugin
   */
  init(ctx: IPluginContext, config: TConfig): Promise<void>;

  /**
   * 健康检查（可选，PluginSupervisor 周期调用）
   * 返回 unhealthy 累计达阈值后该 plugin 被熔断
   */
  healthCheck?(): Promise<PluginHealth>;

  /**
   * 关停清理（进程退出 / hot-reload）
   * 必须幂等：可能被 supervisor 在熔断时调用
   */
  dispose?(): Promise<void>;
}

/**
 * 隔离 logger（v5.1 HIGH-1 内置 PII scrubber）
 */
export interface IPluginLogger {
  log(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
}

/**
 * plugin 配置只读视图（仅自己 namespace）
 */
export interface IPluginConfigView<T = unknown> {
  /** 完整配置 */
  readonly value: T;
  /** profile（development / production / test）*/
  readonly profile: string;
}

/**
 * Hook 注册器（plugin 在 init 调用，注册自己监听的 hook）
 */
export interface IHookRegistrar {
  /**
   * 注册 hook handler
   *
   * @param hookId 见 CORE_HOOKS / EXTENDED_HOOKS
   * @param handler 处理函数
   * @param options.priority 高 priority 在外（先 before、后 after）
   * @throws 注册了未在 manifest.hooks 声明的 hook 时
   */
  register<P>(
    hookId: HookId,
    handler: (
      ctx: import("./hook-context.interface").IHookContext<P>,
    ) => Promise<unknown>,
    options?: { priority?: number },
  ): void;
}

/**
 * 轻量遥测（plugin 自身指标，不经 HookBus 避免 telemetry 自指悖论）
 */
export interface IMetricsEmitter {
  counter(name: string, value?: number, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
}

/**
 * 受限事件总线（v5.1 HIGH-2 强制 namespace）
 *
 * 实现侧自动加 ${pluginId}: 前缀；plugin 只能 publish/subscribe 自己 namespace。
 * 跨 namespace 订阅需声明 events:cross-subscribe:{targetPluginId} capability。
 */
export interface IPluginEventBus {
  publish(topic: string, payload: unknown): void;
  subscribe(topic: string, handler: (payload: unknown) => void): () => void;
}

/**
 * Plugin 与平台的唯一接口（v5.1 §11.3 最小特权 @stable）
 *
 * 安全设计：
 * - plugin 拿不到 NestJS ModuleRef / Injector / 其他 plugin 实例
 * - 唯一获取服务的途径：getService(token) 受 capability 三层校验（DS1）
 * - logger 自动加固定前缀 + PII scrubber
 * - events 自动加 namespace
 * - 不可越权
 */
export interface IPluginContext {
  /** 当前 plugin 自描述（plugin 自省）*/
  readonly manifest: IPluginManifest;

  /** 隔离 logger（含 PII scrubber，v5.1 HIGH-1）*/
  readonly logger: IPluginLogger;

  /** 配置只读视图（仅自己 namespace）*/
  readonly config: IPluginConfigView;

  /** Hook 注册器（核心接入点）*/
  readonly hooks: IHookRegistrar;

  /** 轻量遥测（不经 HookBus 避免循环）*/
  readonly metrics: IMetricsEmitter;

  /** 受限事件总线（强制 namespace prefix，v5.1 HIGH-2）*/
  readonly events: IPluginEventBus;

  /**
   * 受限服务获取（v5.1 DS1 / standards/19 §六）
   *
   * 仅当 manifest.capabilities 含对应 capability 才能拿到服务代理
   * 返回的不是原始服务，而是受限代理（如 NamespacedRedisClient）
   *
   * @throws PluginCapabilityError 未声明 capability 时
   */
  getService<T>(token: ServiceToken<T>): T;
}
