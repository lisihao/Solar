import { Injectable, Logger } from "@nestjs/common";

/**
 * ChapterNode - 章节节点
 */
export interface ChapterNode {
  id: string;
  title: string;
  orderIndex: number;
  dependencies: string[]; // 依赖的章节ID列表
  estimatedTime: number; // 预估写作时间（秒）
}

/**
 * CircularDependency - 循环依赖
 */
export interface CircularDependency {
  path: string[]; // 循环路径
  type: "CIRCULAR" | "SELF_REFERENCE";
}

/**
 * ExecutionRound - 执行轮次
 */
export interface ExecutionRound {
  roundNumber: number;
  chapters: string[]; // 本轮可并行执行的章节ID
  estimatedTime: number; // 本轮预估时间
}

/**
 * ExecutionPlan - 执行计划
 */
export interface ExecutionPlan {
  rounds: ExecutionRound[];
  totalRounds: number;
  criticalPath: string[]; // 关键路径上的章节
  parallelizationRate: number; // 并行化率 = 章节数 / 轮次数
  estimatedTotalTime: number;
}

/**
 * DependencyValidationResult - 依赖验证结果
 */
export interface DependencyValidationResult {
  isValid: boolean;
  circularDependencies: CircularDependency[];
  invalidReferences: string[]; // 引用不存在的章节ID
  warnings: string[];
}

/**
 * EnhancedDependencyService - 增强依赖分析服务
 *
 * 核心职责：
 * - 检测章节间的循环依赖
 * - 生成最优执行计划
 * - 分析关键路径
 */
@Injectable()
export class EnhancedDependencyService {
  private readonly logger = new Logger(EnhancedDependencyService.name);

  /**
   * 检测循环依赖
   * 使用 DFS 算法检测图中的环
   */
  detectCircularDependencies(chapters: ChapterNode[]): CircularDependency[] {
    const circularDeps: CircularDependency[] = [];
    const chapterMap = new Map(chapters.map((c) => [c.id, c]));

    // 1. 检测自引用
    for (const chapter of chapters) {
      if (chapter.dependencies.includes(chapter.id)) {
        circularDeps.push({
          path: [chapter.id, chapter.id],
          type: "SELF_REFERENCE",
        });
      }
    }

    // 2. 使用 DFS 检测循环依赖
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const pathStack: string[] = [];

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      pathStack.push(nodeId);

      const node = chapterMap.get(nodeId);
      if (!node) return false;

      for (const depId of node.dependencies) {
        // 忽略自引用（已经检测过）
        if (depId === nodeId) continue;

        // 如果依赖不存在，跳过
        if (!chapterMap.has(depId)) continue;

        if (!visited.has(depId)) {
          if (dfs(depId)) return true;
        } else if (recursionStack.has(depId)) {
          // 找到循环，构建循环路径
          const cycleStartIndex = pathStack.indexOf(depId);
          const cyclePath = [...pathStack.slice(cycleStartIndex), depId];
          circularDeps.push({
            path: cyclePath,
            type: "CIRCULAR",
          });
          return true;
        }
      }

      recursionStack.delete(nodeId);
      pathStack.pop();
      return false;
    };

    // 对每个未访问的节点执行 DFS
    for (const chapter of chapters) {
      if (!visited.has(chapter.id)) {
        dfs(chapter.id);
      }
    }

    return circularDeps;
  }

  /**
   * 拓扑排序（Kahn's algorithm）
   * 返回排序后的章节ID列表，如果存在循环则返回 null
   */
  topologicalSort(chapters: ChapterNode[]): string[] | null {
    const chapterMap = new Map(chapters.map((c) => [c.id, c]));
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    // 初始化入度和邻接表
    for (const chapter of chapters) {
      inDegree.set(chapter.id, 0);
      adjList.set(chapter.id, []);
    }

    // 构建图
    for (const chapter of chapters) {
      for (const depId of chapter.dependencies) {
        if (!chapterMap.has(depId)) continue; // 忽略无效依赖
        if (depId === chapter.id) continue; // 忽略自引用

        const deps = adjList.get(depId) || [];
        deps.push(chapter.id);
        adjList.set(depId, deps);
        inDegree.set(chapter.id, (inDegree.get(chapter.id) || 0) + 1);
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    const result: string[] = [];

    // 将所有入度为0的节点加入队列
    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      result.push(nodeId);

      // 减少邻居节点的入度
      const neighbors = adjList.get(nodeId) || [];
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // 如果排序结果包含所有节点，则无环
    return result.length === chapters.length ? result : null;
  }

  /**
   * 找出关键路径（最长路径）
   * 使用动态规划计算最长路径
   */
  findCriticalPath(chapters: ChapterNode[]): string[] {
    const chapterMap = new Map(chapters.map((c) => [c.id, c]));

    // 拓扑排序
    const sortedIds = this.topologicalSort(chapters);
    if (!sortedIds) {
      this.logger.warn("Cannot find critical path: circular dependency exists");
      return [];
    }

    // DP: maxTime[id] = 到达该节点的最长时间
    const maxTime = new Map<string, number>();
    const predecessor = new Map<string, string | null>();

    // 初始化
    for (const id of sortedIds) {
      maxTime.set(id, 0);
      predecessor.set(id, null);
    }

    // 按拓扑顺序计算最长路径
    for (const id of sortedIds) {
      const chapter = chapterMap.get(id)!;
      const currentMaxTime = maxTime.get(id) || 0;
      const newTime = currentMaxTime + chapter.estimatedTime;

      // 更新所有依赖此章节的节点
      for (const otherChapter of chapters) {
        if (otherChapter.dependencies.includes(id)) {
          const otherId = otherChapter.id;
          const otherMaxTime = maxTime.get(otherId) || 0;
          if (newTime > otherMaxTime) {
            maxTime.set(otherId, newTime);
            predecessor.set(otherId, id);
          }
        }
      }
    }

    // 找到最长路径的终点
    let maxTimeValue = 0;
    let endNode: string | null = null;
    for (const [id, time] of maxTime.entries()) {
      const chapter = chapterMap.get(id)!;
      const totalTime = time + chapter.estimatedTime;
      if (totalTime > maxTimeValue) {
        maxTimeValue = totalTime;
        endNode = id;
      }
    }

    if (!endNode) return [];

    // 回溯构建关键路径
    const criticalPath: string[] = [];
    let currentNode: string | null = endNode;
    while (currentNode) {
      criticalPath.unshift(currentNode);
      currentNode = predecessor.get(currentNode) || null;
    }

    return criticalPath;
  }

  /**
   * 生成最优执行计划
   * 按依赖关系分轮次，每轮内的章节可以并行执行
   */
  generateOptimalPlan(
    chapters: ChapterNode[],
    maxParallel = Infinity,
  ): ExecutionPlan {
    const chapterMap = new Map(chapters.map((c) => [c.id, c]));

    // 拓扑排序
    const sortedIds = this.topologicalSort(chapters);
    if (!sortedIds) {
      throw new Error(
        "Cannot generate execution plan: circular dependency detected",
      );
    }

    // 计算每个章节的最早开始轮次
    const earliestRound = new Map<string, number>();
    for (const id of sortedIds) {
      const chapter = chapterMap.get(id)!;
      let maxDepRound = 0;

      for (const depId of chapter.dependencies) {
        if (!chapterMap.has(depId)) continue;
        const depRound = earliestRound.get(depId) || 0;
        maxDepRound = Math.max(maxDepRound, depRound + 1);
      }

      earliestRound.set(id, maxDepRound);
    }

    // 按轮次分组
    const roundGroups = new Map<number, string[]>();
    for (const [id, round] of earliestRound.entries()) {
      const group = roundGroups.get(round) || [];
      group.push(id);
      roundGroups.set(round, group);
    }

    // 构建执行轮次（考虑并行度限制）
    const rounds: ExecutionRound[] = [];
    const sortedRounds = Array.from(roundGroups.keys()).sort((a, b) => a - b);

    for (const roundNum of sortedRounds) {
      const chapterIds = roundGroups.get(roundNum) || [];

      // 如果超过最大并行度，需要拆分成多个轮次
      if (chapterIds.length <= maxParallel) {
        const estimatedTime = Math.max(
          ...chapterIds.map((id) => chapterMap.get(id)!.estimatedTime),
        );
        rounds.push({
          roundNumber: rounds.length + 1,
          chapters: chapterIds,
          estimatedTime,
        });
      } else {
        // 按预估时间排序，优先执行耗时长的
        const sortedByTime = [...chapterIds].sort(
          (a, b) =>
            chapterMap.get(b)!.estimatedTime - chapterMap.get(a)!.estimatedTime,
        );

        for (let i = 0; i < sortedByTime.length; i += maxParallel) {
          const batch = sortedByTime.slice(i, i + maxParallel);
          const estimatedTime = Math.max(
            ...batch.map((id) => chapterMap.get(id)!.estimatedTime),
          );
          rounds.push({
            roundNumber: rounds.length + 1,
            chapters: batch,
            estimatedTime,
          });
        }
      }
    }

    // 计算关键路径
    const criticalPath = this.findCriticalPath(chapters);

    // 计算总时间
    const estimatedTotalTime = rounds.reduce(
      (sum, round) => sum + round.estimatedTime,
      0,
    );

    // 计算并行化率
    const parallelizationRate = chapters.length / rounds.length;

    return {
      rounds,
      totalRounds: rounds.length,
      criticalPath,
      parallelizationRate,
      estimatedTotalTime,
    };
  }

  /**
   * 验证依赖关系有效性
   */
  validateDependencies(chapters: ChapterNode[]): DependencyValidationResult {
    const chapterIds = new Set(chapters.map((c) => c.id));
    const invalidReferences: string[] = [];
    const warnings: string[] = [];

    // 检查无效引用
    for (const chapter of chapters) {
      for (const depId of chapter.dependencies) {
        if (!chapterIds.has(depId)) {
          invalidReferences.push(
            `Chapter "${chapter.title}" (${chapter.id}) references non-existent chapter ${depId}`,
          );
        }
      }
    }

    // 检测循环依赖
    const circularDependencies = this.detectCircularDependencies(chapters);

    // 检查孤立章节（既不依赖也不被依赖）
    const dependedChapters = new Set<string>();
    for (const chapter of chapters) {
      for (const depId of chapter.dependencies) {
        dependedChapters.add(depId);
      }
    }

    for (const chapter of chapters) {
      if (
        chapter.dependencies.length === 0 &&
        !dependedChapters.has(chapter.id)
      ) {
        warnings.push(
          `Chapter "${chapter.title}" (${chapter.id}) is isolated (no dependencies and not depended upon)`,
        );
      }
    }

    const isValid =
      circularDependencies.length === 0 && invalidReferences.length === 0;

    return {
      isValid,
      circularDependencies,
      invalidReferences,
      warnings,
    };
  }

  /**
   * 自动推断章节依赖
   * 基于章节顺序和启发式规则
   */
  inferDependencies(
    chapters: ChapterNode[],
    options: {
      sequentialDependency?: boolean; // 是否每章依赖前一章
      skipIntroduction?: boolean; // 是否跳过第一章（前言）
      groupSize?: number; // 分组大小（每组第一章依赖上一组最后一章）
    } = {},
  ): Map<string, string[]> {
    const {
      sequentialDependency = true,
      skipIntroduction = true,
      groupSize = 0,
    } = options;

    const sortedChapters = [...chapters].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
    const dependencies = new Map<string, string[]>();

    for (let i = 0; i < sortedChapters.length; i++) {
      const chapter = sortedChapters[i];
      const deps: string[] = [];

      // 跳过第一章
      if (i === 0 && skipIntroduction) {
        dependencies.set(chapter.id, deps);
        continue;
      }

      // 顺序依赖：每章依赖前一章
      if (sequentialDependency && i > 0) {
        deps.push(sortedChapters[i - 1].id);
      }

      // 分组依赖：每组第一章依赖上一组最后一章
      if (groupSize > 0 && i % groupSize === 0 && i > 0) {
        deps.push(sortedChapters[i - 1].id);
      }

      dependencies.set(chapter.id, deps);
    }

    return dependencies;
  }

  /**
   * 导出依赖关系为 Mermaid 图表格式
   */
  exportToMermaid(chapters: ChapterNode[]): string {
    const lines: string[] = ["graph TD"];

    const chapterMap = new Map(chapters.map((c) => [c.id, c]));

    // 添加节点
    for (const chapter of chapters) {
      const label = `${chapter.title} (${chapter.estimatedTime}s)`;
      lines.push(`  ${chapter.id}["${label}"]`);
    }

    // 添加边
    for (const chapter of chapters) {
      for (const depId of chapter.dependencies) {
        if (chapterMap.has(depId)) {
          lines.push(`  ${depId} --> ${chapter.id}`);
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * 计算章节的深度（从根节点开始的最长路径）
   */
  calculateDepth(chapters: ChapterNode[]): Map<string, number> {
    const chapterMap = new Map(chapters.map((c) => [c.id, c]));
    const depth = new Map<string, number>();

    const sortedIds = this.topologicalSort(chapters);
    if (!sortedIds) {
      this.logger.warn("Cannot calculate depth: circular dependency exists");
      return depth;
    }

    // 按拓扑顺序计算深度
    for (const id of sortedIds) {
      const chapter = chapterMap.get(id)!;
      let maxDepth = 0;

      for (const depId of chapter.dependencies) {
        if (!chapterMap.has(depId)) continue;
        const depDepth = depth.get(depId) || 0;
        maxDepth = Math.max(maxDepth, depDepth + 1);
      }

      depth.set(id, maxDepth);
    }

    return depth;
  }

  /**
   * 获取可以立即执行的章节（所有依赖已完成）
   */
  getReadyChapters(
    chapters: ChapterNode[],
    completedIds: Set<string>,
  ): string[] {
    return chapters
      .filter((chapter) => {
        // 该章节未完成
        if (completedIds.has(chapter.id)) return false;

        // 所有依赖都已完成
        return chapter.dependencies.every((depId) => completedIds.has(depId));
      })
      .map((c) => c.id);
  }
}
