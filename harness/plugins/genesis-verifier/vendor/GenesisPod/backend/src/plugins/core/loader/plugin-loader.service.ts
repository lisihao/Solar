/**
 * PluginLoader — 启动期协调器（v5.1 §11.8 / standards/19）
 *
 * 职责（与 Registry / Resolver / Validator / Supervisor 协作）：
 *   1. 拿一组 plugin 实例（外部传入；PR-3 不做磁盘扫描，PR-3-后续/PR-7 起再实现 yaml 加载）
 *   2. 校验 manifest（ManifestValidator）+ coreVersionRange
 *   3. 过滤 enabled（PluginConfigService）
 *   4. 拓扑排序（PluginResolver，含 replaces 互斥 + 循环检测）
 *   5. 按顺序 init plugin，注册到 Registry + Supervisor
 *   6. init 失败：required=true 致命 fail-fast；required=false logger.warn + skip
 *
 * 实例化依赖（PR-3 范围）：
 *   - plugin 实例由调用方提供（PluginCoreModule 在 PR-3 后续从磁盘扫描或注入；
 *     此处保持纯协调器逻辑，便于 spec 不依赖磁盘）
 */
import type { IPlugin, IPluginContext } from "../abstractions/plugin.interface";
import { PluginBootError } from "../abstractions/hook-context.interface";
import { ManifestValidator } from "./manifest-validator";
import { PluginConfigService } from "./plugin-config.service";
import { PluginRegistry } from "../registry/plugin-registry.service";
import { type IPluginResolver } from "../registry/plugin-resolver";
import { PluginSupervisor } from "../lifecycle/plugin-supervisor.service";

export interface PluginLoaderDeps {
  readonly registry: PluginRegistry;
  readonly resolver: IPluginResolver;
  readonly validator: ManifestValidator;
  readonly configService: PluginConfigService;
  readonly supervisor: PluginSupervisor;
  readonly coreVersion: string;
  /** plugin init 时传入的 context 工厂（DS1 实现注入）*/
  readonly contextFactory: (pluginId: string) => IPluginContext;
  readonly logger?: {
    log: (msg: string, ...meta: unknown[]) => void;
    warn: (msg: string, ...meta: unknown[]) => void;
    error: (msg: string, ...meta: unknown[]) => void;
  };
}

export interface PluginLoadResult {
  readonly loaded: string[];
  readonly skipped: Array<{ pluginId: string; reason: string }>;
  readonly failed: Array<{ pluginId: string; error: unknown }>;
}

export class PluginLoader {
  private readonly deps: PluginLoaderDeps;
  private readonly logger: NonNullable<PluginLoaderDeps["logger"]>;

  constructor(deps: PluginLoaderDeps) {
    this.deps = deps;
    this.logger = deps.logger ?? {
      // eslint-disable-next-line no-console
      log: (msg, ...meta) => console.log(msg, ...meta),
      // eslint-disable-next-line no-console
      warn: (msg, ...meta) => console.warn(msg, ...meta),
      // eslint-disable-next-line no-console
      error: (msg, ...meta) => console.error(msg, ...meta),
    };
  }

  /**
   * 加载一组 plugin（外部传入实例）
   *
   * @returns 加载结果：成功 / 跳过 / 失败列表
   * @throws 当 required plugin 失败 → PluginBootError 致命
   */
  async load(plugins: ReadonlyArray<IPlugin>): Promise<PluginLoadResult> {
    const result: PluginLoadResult = {
      loaded: [],
      skipped: [],
      failed: [],
    };
    const mut = result as {
      loaded: string[];
      skipped: Array<{ pluginId: string; reason: string }>;
      failed: Array<{ pluginId: string; error: unknown }>;
    };

    // ① 校验 manifest（含 coreVersionRange fail-fast）
    const validated: IPlugin[] = [];
    for (const p of plugins) {
      try {
        this.deps.validator.validate(p.manifest, this.deps.coreVersion);
        validated.push(p);
      } catch (err) {
        this.logger.error(
          `[PluginLoader] manifest validation failed: ${p.manifest.id}`,
          err,
        );
        mut.failed.push({ pluginId: p.manifest.id, error: err });
        if (
          this.deps.configService.isRequired(p.manifest.id, p.manifest.required)
        ) {
          throw new PluginBootError(p.manifest.id, err);
        }
      }
    }

    // ② 按 enabled 过滤
    const enabled: IPlugin[] = [];
    for (const p of validated) {
      const entry = this.deps.configService.getEntry(p.manifest.id);
      // 配置未列出 → 默认 disabled（不潜行加载）
      if (!entry || !entry.enabled) {
        mut.skipped.push({
          pluginId: p.manifest.id,
          reason: "not enabled in plugins.config.yaml",
        });
        continue;
      }
      enabled.push(p);
    }

    // ③ 拓扑排序（含 replaces 互斥 + 循环 + 缺依赖检查）
    const sortedManifests = this.deps.resolver.resolve(
      enabled.map((p) => p.manifest),
    );
    const idToPlugin = new Map(enabled.map((p) => [p.manifest.id, p]));
    const sorted = sortedManifests.map((m) => idToPlugin.get(m.id)!);

    // ④ 按顺序 init
    for (const p of sorted) {
      const id = p.manifest.id;
      try {
        const ctx = this.deps.contextFactory(id);
        const config = this.deps.configService.getConfig(id);
        await p.init(ctx, config);
        this.deps.registry.register(p);
        // Adapt IPlugin → ISupervisedPlugin (id from manifest.id; pass through healthCheck)
        this.deps.supervisor.register({
          id,
          healthCheck: p.healthCheck?.bind(p),
        });
        mut.loaded.push(id);
        this.logger.log(`[PluginLoader] loaded plugin ${id}`);
      } catch (err) {
        this.logger.error(`[PluginLoader] init failed: ${id}`, err);
        mut.failed.push({ pluginId: id, error: err });
        if (this.deps.configService.isRequired(id, p.manifest.required)) {
          throw new PluginBootError(id, err);
        }
      }
    }

    return result;
  }
}
