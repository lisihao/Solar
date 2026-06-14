/**
 * PluginRegistry — 已实例化 plugin 的注册表 + 元信息查询（v5.1 §11.8）
 *
 * 职责（不和 Loader 重叠）：
 *   - 持有已成功 init 的 plugin 实例
 *   - 提供按 id / category / replaces / hook 查询
 *   - 不做加载、init、拓扑排序（那是 Loader 的事）
 *   - 不做扫描磁盘（那是 Loader 的事）
 */
import type {
  IPlugin,
  IPluginManifest,
  PluginCategory,
} from "../abstractions/plugin.interface";

export class PluginRegistry {
  private readonly plugins = new Map<string, IPlugin>();

  register(plugin: IPlugin): void {
    if (this.plugins.has(plugin.manifest.id)) {
      throw new Error(
        `[PluginRegistry] duplicate plugin id: ${plugin.manifest.id}`,
      );
    }
    this.plugins.set(plugin.manifest.id, plugin);
  }

  unregister(pluginId: string): boolean {
    return this.plugins.delete(pluginId);
  }

  get(pluginId: string): IPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  getAll(): IPlugin[] {
    return Array.from(this.plugins.values());
  }

  getAllManifests(): IPluginManifest[] {
    return this.getAll().map((p) => p.manifest);
  }

  size(): number {
    return this.plugins.size;
  }

  /** 按 category 过滤（如 listByCategory("observability") 返回所有遥测 plugin）*/
  listByCategory(category: PluginCategory): IPlugin[] {
    return this.getAll().filter((p) => p.manifest.category === category);
  }

  /**
   * 按 replaces 字段过滤（同一 replaces 值最多 1 个 enabled）
   * 例：listByReplaces("sandbox") → 返回正在生效的那个 sandbox 实现
   */
  listByReplaces(replaces: string): IPlugin[] {
    return this.getAll().filter((p) => p.manifest.replaces === replaces);
  }

  /** 监听某 hook 的所有 plugin（仅查 manifest，不查 HookBus 实际注册）*/
  listByHook(hookId: string): IPlugin[] {
    return this.getAll().filter((p) => p.manifest.hooks.includes(hookId));
  }

  /** 测试用 */
  clearForTest(): void {
    this.plugins.clear();
  }
}
