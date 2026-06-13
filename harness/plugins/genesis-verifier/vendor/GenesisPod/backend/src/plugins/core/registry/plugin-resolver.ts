/**
 * PluginResolver — 启动期依赖图解析（v5.1 §11.8 / standards/19）
 *
 * 职责：
 * - 拓扑排序 plugins 按 manifest.dependencies
 * - 检测循环依赖（fail-fast）
 * - 检测缺失依赖（required dep 不在 list 中）
 * - 检测 replaces 互斥（同 replaces 值最多 1 个 enabled）
 *
 * 输出：按依赖顺序排列的 manifest 数组（依赖在前，被依赖在后）
 */
import type { IPluginManifest } from "../abstractions/plugin.interface";

export class PluginCircularDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(
      `[PluginResolver] circular dependency detected: ${cycle.join(" → ")}`,
    );
    this.name = "PluginCircularDependencyError";
  }
}

export class PluginMissingDependencyError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly missingDep: string,
  ) {
    super(
      `[PluginResolver] plugin ${pluginId} depends on ${missingDep}, but it is not enabled`,
    );
    this.name = "PluginMissingDependencyError";
  }
}

export class PluginReplacesConflictError extends Error {
  constructor(
    public readonly replacesValue: string,
    public readonly conflictingIds: string[],
  ) {
    super(
      `[PluginResolver] multiple plugins replace "${replacesValue}": ${conflictingIds.join(", ")}; only one allowed enabled`,
    );
    this.name = "PluginReplacesConflictError";
  }
}

export interface IPluginResolver {
  /** 拓扑排序，含循环 / 缺失 / replaces 互斥校验 */
  resolve(manifests: ReadonlyArray<IPluginManifest>): IPluginManifest[];
}

export class PluginResolver implements IPluginResolver {
  resolve(manifests: ReadonlyArray<IPluginManifest>): IPluginManifest[] {
    this.checkReplacesConflict(manifests);
    this.checkMissingDependencies(manifests);
    return this.topologicalSort(manifests);
  }

  /** 同 replaces 值最多 1 个 enabled（v5.1 §11.3 manifest.replaces 语义）*/
  private checkReplacesConflict(
    manifests: ReadonlyArray<IPluginManifest>,
  ): void {
    const groups = new Map<string, string[]>();
    for (const m of manifests) {
      if (!m.replaces) continue;
      const arr = groups.get(m.replaces) ?? [];
      arr.push(m.id);
      groups.set(m.replaces, arr);
    }
    for (const [replaces, ids] of groups) {
      if (ids.length > 1) {
        throw new PluginReplacesConflictError(replaces, ids);
      }
    }
  }

  /** 检查 dependencies 中的 plugin id 是否存在 */
  private checkMissingDependencies(
    manifests: ReadonlyArray<IPluginManifest>,
  ): void {
    const ids = new Set(manifests.map((m) => m.id));
    for (const m of manifests) {
      if (!m.dependencies) continue;
      for (const dep of m.dependencies) {
        if (!ids.has(dep)) {
          throw new PluginMissingDependencyError(m.id, dep);
        }
      }
    }
  }

  /** 标准 Kahn 算法拓扑排序，遇环抛 PluginCircularDependencyError */
  private topologicalSort(
    manifests: ReadonlyArray<IPluginManifest>,
  ): IPluginManifest[] {
    const idToManifest = new Map<string, IPluginManifest>();
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const m of manifests) {
      idToManifest.set(m.id, m);
      inDegree.set(m.id, 0);
      adj.set(m.id, []);
    }
    for (const m of manifests) {
      for (const dep of m.dependencies ?? []) {
        // dep → m（dep 必须先 init）
        adj.get(dep)!.push(m.id);
        inDegree.set(m.id, (inDegree.get(m.id) ?? 0) + 1);
      }
    }

    // 拿入度为 0 的节点开始
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    // 稳定输出（按 id 字典序）
    queue.sort();

    const sorted: IPluginManifest[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      sorted.push(idToManifest.get(id)!);
      const neighbors = (adj.get(id) ?? []).slice().sort();
      for (const neighbor of neighbors) {
        const next = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, next);
        if (next === 0) queue.push(neighbor);
      }
    }

    if (sorted.length !== manifests.length) {
      // 找出环（从未被排序的节点出发 DFS 找回边）
      const cycle = this.findCycle(manifests);
      throw new PluginCircularDependencyError(cycle);
    }
    return sorted;
  }

  private findCycle(manifests: ReadonlyArray<IPluginManifest>): string[] {
    const adj = new Map<string, string[]>();
    for (const m of manifests) {
      adj.set(m.id, m.dependencies ?? []);
    }
    const visited = new Set<string>();
    const stack: string[] = [];
    const stackSet = new Set<string>();

    const dfs = (id: string): string[] | null => {
      if (stackSet.has(id)) {
        // 找到环：返回从环起点到 id 的路径
        const idx = stack.indexOf(id);
        return [...stack.slice(idx), id];
      }
      if (visited.has(id)) return null;
      visited.add(id);
      stack.push(id);
      stackSet.add(id);
      for (const dep of adj.get(id) ?? []) {
        const cycle = dfs(dep);
        if (cycle) return cycle;
      }
      stack.pop();
      stackSet.delete(id);
      return null;
    };

    for (const m of manifests) {
      if (visited.has(m.id)) continue;
      const cycle = dfs(m.id);
      if (cycle) return cycle;
    }
    return [];
  }
}
