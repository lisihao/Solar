import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import {
  CONTENT_SOURCE_METADATA,
  CONTENT_SOURCE_TOKEN,
} from "./content-source.token";
import type {
  ContentSource,
  ContentSourceDescriptor,
} from "./content-source.contract";

/**
 * ContentSourceRegistry
 *
 * 2026-05-24 P17a: 从 ai-app/social/registry/social-data-source.registry.ts 上提
 * 到 ai-engine/content/sources（去掉 'social' 命名，通用化）。
 *
 * 历史修复保留（来自 prod 事故，详见原 registry 内注释）:
 *   - onApplicationBootstrap (跨模块 provider 就绪时机)
 *   - Reflect.getMetadata 取代 DiscoveryService metadataKey filter
 *     （SetMetadata 自定义 key 不被 metadataKey 过滤命中）
 *   - listDescriptors() 显式 pick 6 字段（防 PrismaService 等注入字段被
 *     JSON.stringify 撞循环引用）
 *
 * Engine 内部：纯结构化扫描，零业务语义；consumer (ai-app/social /
 * 未来其他 app) 用 DI 注入读取。
 */
@Injectable()
export class ContentSourceRegistry implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContentSourceRegistry.name);
  private readonly sources = new Map<string, ContentSource>();

  constructor(
    @Optional()
    @Inject(CONTENT_SOURCE_TOKEN)
    injected?: ContentSource[],
    @Optional()
    private readonly discoveryService?: DiscoveryService,
  ) {
    if (injected) {
      for (const src of injected) {
        this.register(src);
      }
    }
  }

  onApplicationBootstrap(): void {
    if (!this.discoveryService) {
      this.logger.debug(
        "DiscoveryService not available — only explicit/constructor-injected sources active",
      );
      return;
    }
    const providers = this.discoveryService.getProviders();
    let discovered = 0;
    let skipped = 0;
    for (const wrapper of providers) {
      const instance: unknown = wrapper.instance;
      const metatype = wrapper.metatype;
      if (!instance || typeof instance !== "object" || !metatype) {
        skipped++;
        continue;
      }
      const hasFlag = Reflect.getMetadata(
        CONTENT_SOURCE_METADATA,
        metatype,
      ) as unknown;
      if (!hasFlag) continue; // 静默跳过非 content-source provider
      const candidate = instance as ContentSource;
      if (!candidate.id || typeof candidate.listItems !== "function") {
        skipped++;
        continue;
      }
      if (this.sources.has(candidate.id)) continue;
      this.register(candidate);
      discovered++;
    }
    this.logger.log(
      `Auto-discovered ${discovered} content source(s) (${skipped} skipped); total registered: ${this.sources.size}`,
    );
    if (discovered === 0 && this.sources.size === 0) {
      const names = providers
        .map((w) => w.metatype?.name ?? "(anonymous)")
        .filter((n) => n !== "(anonymous)")
        .slice(0, 200);
      this.logger.error(
        `[diagnostic] 0 content-source providers discovered. Scanned ${providers.length} wrappers. Metatypes: ${names.join(", ")}`,
      );
    }
  }

  register(source: ContentSource): void {
    if (this.sources.has(source.id)) {
      throw new Error(`Duplicate content source id: ${source.id}`);
    }
    this.sources.set(source.id, source);
    this.logger.log(`Registered content source: ${source.id}`);
  }

  get(id: string): ContentSource | undefined {
    return this.sources.get(id);
  }

  list(): ContentSource[] {
    return Array.from(this.sources.values());
  }

  /**
   * 只显式 pick ContentSourceDescriptor 的 6 个字段（防注入字段被 JSON.stringify
   * 撞循环引用——历史 prod 事故："Converting circular structure to JSON"）。
   */
  listDescriptors(): ContentSourceDescriptor[] {
    return this.list().map((src) => ({
      id: src.id,
      displayName: src.displayName,
      icon: src.icon,
      description: src.description,
      contentKinds: src.contentKinds,
      maxItemsPerTask: src.maxItemsPerTask,
    }));
  }
}
