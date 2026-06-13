/**
 * Plugin Core NestJS module（v5.1 R0.5 PR-11 + R0.5-E W1-a 单轨化）
 *
 * 把 plugins/core 的 plain class（HookBus / Supervisor / Registry / Loader /
 * Bridge）注册成 NestJS provider，让生产应用通过 DI 获取。
 *
 * 设计要点：
 * - @Global() 注册：所有 module 不需 import 即可注入 HookBus / LifecycleHookBridge
 * - 单轨化（2026-05-04 R0.5-E W1-a）：AppModule 调 PluginCoreModule.forRoot({plugins})
 *   传入生产 plugin 列表 + 启用配置；OnApplicationBootstrap 自动 load 全部 plugin
 * - 默认无 plugin（向后兼容老的 `imports: [PluginCoreModule]` 用法 → 行为零变化）
 */
import {
  Global,
  Inject,
  Module,
  Optional,
  OnApplicationBootstrap,
  type DynamicModule,
} from "@nestjs/common";
import { HookBus } from "./hook-bus";
import {
  PluginRegistry,
  PluginResolver,
  type IPluginResolver,
} from "./registry";
import { PluginSupervisor, type ISupervisedPlugin } from "./lifecycle";
import { ManifestValidator, PluginConfigService, PluginLoader } from "./loader";
import type {
  PluginEntryConfig,
  PluginsConfigShape,
} from "./loader/plugin-config.service";
import { LifecycleHookBridge } from "./bridge";
import type { IPlugin } from "./abstractions";

export const PLUGIN_CORE_VERSION = "1.0.0";

/** forRoot 入参：plugin 实例 + 启用条目（可省略 enabled 默认 true）*/
export interface PluginCoreModuleOptions {
  readonly plugins: ReadonlyArray<IPlugin>;
  /** 显式 plugin entries（优先于 plugins 默认 enabled=true 配置） */
  readonly entries?: ReadonlyArray<PluginEntryConfig>;
  readonly globals?: PluginsConfigShape["globals"];
}

const PLUGIN_INSTANCES_TOKEN = "PLUGIN_CORE__INSTANCES";

/**
 * 生产期 PluginConfigService 默认空配置（无 plugin 启用）
 * forRoot() 调用方传入的 entries 会替换此默认
 */
const defaultConfigService = new PluginConfigService(null);

@Global()
@Module({
  providers: [
    PluginSupervisor,
    PluginRegistry,
    {
      provide: HookBus,
      useFactory: (supervisor: PluginSupervisor) => new HookBus(supervisor),
      inject: [PluginSupervisor],
    },
    {
      provide: ManifestValidator,
      useFactory: () => new ManifestValidator(),
    },
    {
      provide: PluginConfigService,
      useValue: defaultConfigService,
    },
    {
      provide: "IPluginResolver",
      useFactory: () => new PluginResolver(),
    },
    {
      provide: PluginLoader,
      useFactory: (
        registry: PluginRegistry,
        resolver: IPluginResolver,
        validator: ManifestValidator,
        configService: PluginConfigService,
        supervisor: PluginSupervisor,
        hookBus: HookBus,
      ) =>
        new PluginLoader({
          registry,
          resolver,
          validator,
          configService,
          supervisor,
          coreVersion: PLUGIN_CORE_VERSION,
          contextFactory: (pluginId) => {
            // PR-11 最小 contextFactory：构造一个能让 plugin init 跑通的 ctx
            // 真实 ServiceProxyRegistry / Capability gate 由 R0.5-E 完整实现
            return {
              manifest: registry.get(pluginId)!.manifest,
              logger: {
                log: () => {},
                warn: () => {},
                error: () => {},
                debug: () => {},
              },
              config: configService.buildView(pluginId),
              hooks: {
                register: (hookId, handler, options) => {
                  hookBus.register(hookId, handler, {
                    pluginId,
                    required: configService.isRequired(
                      pluginId,
                      registry.get(pluginId)!.manifest.required,
                    ),
                    capabilities: registry.get(pluginId)!.manifest.capabilities,
                    priority: options?.priority,
                  });
                },
              },
              metrics: {
                counter: () => {},
                gauge: () => {},
                histogram: () => {},
              },
              events: {
                publish: () => {},
                subscribe: () => () => {},
              },
              getService: () => {
                throw new Error(
                  `getService not yet wired — ServiceProxyRegistry pending in R0.5-E`,
                );
              },
            };
          },
        }),
      inject: [
        PluginRegistry,
        "IPluginResolver",
        ManifestValidator,
        PluginConfigService,
        PluginSupervisor,
        HookBus,
      ],
    },
    {
      provide: LifecycleHookBridge,
      useFactory: (hookBus: HookBus) => {
        const bridge = new LifecycleHookBridge();
        bridge.setHookBus(hookBus);
        return bridge;
      },
      inject: [HookBus],
    },
  ],
  exports: [
    HookBus,
    PluginRegistry,
    PluginSupervisor,
    PluginLoader,
    PluginConfigService,
    ManifestValidator,
    LifecycleHookBridge,
  ],
})
export class PluginCoreModule implements OnApplicationBootstrap {
  constructor(
    private readonly loader: PluginLoader,
    @Optional()
    @Inject(PLUGIN_INSTANCES_TOKEN)
    private readonly pluginInstances?: ReadonlyArray<IPlugin>,
  ) {}

  /**
   * 启动期注册 plugin（forRoot 传入的实例）
   * 默认空数组 → 兼容老用法（仅 import PluginCoreModule，无 plugin 加载）
   */
  async onApplicationBootstrap(): Promise<void> {
    const list = this.pluginInstances ?? [];
    if (list.length === 0) return;
    await this.loader.load(list);
  }

  /**
   * 配置 + 加载 plugin（v5.1 R0.5-E W1-a 单轨化入口）
   *
   * 用法：
   *   AppModule { imports: [PluginCoreModule.forRoot({ plugins: [new ...Plugin(), ...] })] }
   *
   * 默认 entries：每个 plugin 都 enabled=true，从 manifest.required 取 required。
   * 显式传 entries 时按 entries 走（覆盖默认）。
   */
  static forRoot(options: PluginCoreModuleOptions): DynamicModule {
    const entries: PluginEntryConfig[] =
      options.entries && options.entries.length > 0
        ? [...options.entries]
        : options.plugins.map((p) => ({
            id: p.manifest.id,
            enabled: true,
            required: p.manifest.required,
          }));
    const configShape: PluginsConfigShape = {
      version: 1,
      profile: process.env.NODE_ENV ?? "development",
      globals: options.globals,
      plugins: entries,
    };
    const configService = new PluginConfigService(configShape);

    return {
      module: PluginCoreModule,
      global: true,
      providers: [
        PluginSupervisor,
        PluginRegistry,
        {
          provide: HookBus,
          useFactory: (supervisor: PluginSupervisor) => new HookBus(supervisor),
          inject: [PluginSupervisor],
        },
        {
          provide: ManifestValidator,
          useFactory: () => new ManifestValidator(),
        },
        { provide: PluginConfigService, useValue: configService },
        { provide: "IPluginResolver", useFactory: () => new PluginResolver() },
        {
          provide: PluginLoader,
          useFactory: (
            registry: PluginRegistry,
            resolver: IPluginResolver,
            validator: ManifestValidator,
            cfg: PluginConfigService,
            supervisor: PluginSupervisor,
            hookBus: HookBus,
          ) =>
            new PluginLoader({
              registry,
              resolver,
              validator,
              configService: cfg,
              supervisor,
              coreVersion: PLUGIN_CORE_VERSION,
              contextFactory: (pluginId) => ({
                manifest: registry.get(pluginId)!.manifest,
                // 启动期 logger（不依赖 NestJS Logger，避免循环：plugin-core 早于 LoggerModule）
                /* eslint-disable no-console */
                logger: {
                  log: (msg, ...m) => console.log(`[${pluginId}]`, msg, ...m),
                  warn: (msg, ...m) => console.warn(`[${pluginId}]`, msg, ...m),
                  error: (msg, ...m) =>
                    console.error(`[${pluginId}]`, msg, ...m),
                  debug: () => {},
                },
                /* eslint-enable no-console */
                config: cfg.buildView(pluginId),
                hooks: {
                  register: (hookId, handler, options) => {
                    hookBus.register(hookId, handler, {
                      pluginId,
                      required: cfg.isRequired(
                        pluginId,
                        registry.get(pluginId)!.manifest.required,
                      ),
                      capabilities:
                        registry.get(pluginId)!.manifest.capabilities,
                      priority: options?.priority,
                    });
                  },
                },
                metrics: {
                  counter: () => {},
                  gauge: () => {},
                  histogram: () => {},
                },
                events: {
                  publish: () => {},
                  subscribe: () => () => {},
                },
                getService: () => {
                  throw new Error(
                    `getService not yet wired — ServiceProxyRegistry pending`,
                  );
                },
              }),
            }),
          inject: [
            PluginRegistry,
            "IPluginResolver",
            ManifestValidator,
            PluginConfigService,
            PluginSupervisor,
            HookBus,
          ],
        },
        {
          provide: LifecycleHookBridge,
          useFactory: (hookBus: HookBus) => {
            const bridge = new LifecycleHookBridge();
            bridge.setHookBus(hookBus);
            return bridge;
          },
          inject: [HookBus],
        },
        {
          provide: PLUGIN_INSTANCES_TOKEN,
          useValue: options.plugins,
        },
      ],
      exports: [
        HookBus,
        PluginRegistry,
        PluginSupervisor,
        PluginLoader,
        PluginConfigService,
        ManifestValidator,
        LifecycleHookBridge,
      ],
    };
  }
}

/** 类型 re-export，避免 ai-app 直接 import plugin-core 内部 */
export type { ISupervisedPlugin };
