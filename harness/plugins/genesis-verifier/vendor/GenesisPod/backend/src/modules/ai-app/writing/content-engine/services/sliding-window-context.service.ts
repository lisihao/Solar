/**
 * 滑动窗口上下文服务
 * Sliding Window Context Service
 *
 * 核心职责：
 * 1. 管理工作记忆（有限上下文）
 * 2. 管理长期记忆（数据库存储）
 * 3. 实现窗口滑动机制
 * 4. 提供相关历史检索
 */

import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import {
  WorkingMemoryContext,
  TaskSummary,
  RelevantHistoryChunk,
  TokenUsage,
  SlidingWindowConfig,
  ProjectContextStore,
  SlideResult,
  SummaryGenerationOptions,
  DEFAULT_SLIDING_WINDOW_CONFIG,
} from "../interfaces";
import { AiChatService } from "@/modules/ai-harness/facade";

@Injectable()
export class SlidingWindowContextService {
  private readonly logger = new Logger(SlidingWindowContextService.name);

  /** 项目上下文存储 (projectId -> store) */
  private projectStores = new Map<string, ProjectContextStore>();

  /** 任务完整内容存储 (taskId -> content) - 模拟长期记忆 */
  private taskContentStore = new Map<
    string,
    { content: string; summary: string }
  >();

  constructor(private readonly aiChatService: AiChatService) {}

  /**
   * 初始化项目上下文
   */
  initProject(
    projectId: string,
    projectInfo: {
      title: string;
      description: string;
      totalTasks?: number;
    },
  ): ProjectContextStore {
    const store: ProjectContextStore = {
      projectId,
      globalSummary: this.buildInitialGlobalSummary(projectInfo),
      globalSummaryUpdatedAt: new Date(),
      completedTaskCount: 0,
      recentSummaries: [],
      totalWordCount: 0,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.projectStores.set(projectId, store);
    this.logger.log(`Initialized project context: ${projectId}`);

    return store;
  }

  /**
   * 构建工作记忆上下文
   */
  async buildWorkingMemory(
    projectId: string,
    currentTaskId: string,
    currentTaskContent: string,
    options?: {
      config?: SlidingWindowConfig;
      relevantQuery?: string;
    },
  ): Promise<WorkingMemoryContext> {
    const config = options?.config || DEFAULT_SLIDING_WINDOW_CONFIG;
    const store = this.projectStores.get(projectId);

    if (!store) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // 1. 获取全局摘要
    const globalSummary = this.truncateToTokens(
      store.globalSummary,
      config.maxGlobalSummaryTokens,
    );

    // 2. 获取最近任务摘要
    const recentSummaries = store.recentSummaries.slice(
      -config.recentTaskCount,
    );
    const recentSummaryText = recentSummaries
      .map((s) => `- ${s.title}: ${s.summary}`)
      .join("\n");

    // 3. 截断当前任务内容
    const truncatedCurrentTask = this.truncateToTokens(
      currentTaskContent,
      config.maxCurrentTaskTokens,
    );

    // 4. 检索相关历史
    const relevantHistory = options?.relevantQuery
      ? await this.retrieveRelevantHistory(projectId, options.relevantQuery, {
          maxChunks: config.relevantChunkCount,
        })
      : [];

    // 5. 计算 token 使用
    const tokenUsage = this.calculateTokenUsage(
      globalSummary,
      recentSummaryText,
      truncatedCurrentTask,
      relevantHistory,
      config.maxTotalTokens,
    );

    return {
      projectId,
      currentTaskId,
      globalSummary,
      recentTaskSummaries: recentSummaries,
      currentTaskContent: truncatedCurrentTask,
      relevantHistory,
      tokenUsage,
      builtAt: new Date(),
    };
  }

  /**
   * 滑动窗口 - 任务完成后调用
   */
  async slideWindow(
    projectId: string,
    completedTask: {
      id: string;
      title: string;
      result: string;
      summary?: string;
    },
    config: SlidingWindowConfig = DEFAULT_SLIDING_WINDOW_CONFIG,
  ): Promise<SlideResult> {
    const store = this.projectStores.get(projectId);

    if (!store) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // 1. 存储完整内容到长期记忆
    const summary =
      completedTask.summary ||
      (await this.generateSummary(completedTask.result, completedTask.title));

    this.taskContentStore.set(completedTask.id, {
      content: completedTask.result,
      summary,
    });

    // 2. 创建任务摘要
    const taskSummary: TaskSummary = {
      taskId: completedTask.id,
      title: completedTask.title,
      summary,
      keywords: this.extractKeywords(completedTask.result),
      wordCount: this.countWords(completedTask.result),
      completedAt: new Date(),
    };

    // 3. 添加到最近摘要
    store.recentSummaries.push(taskSummary);

    // 4. 移除最旧的摘要（如果超过限制）
    const evictedSummaries: TaskSummary[] = [];
    while (store.recentSummaries.length > config.recentTaskCount) {
      const evicted = store.recentSummaries.shift();
      if (evicted) evictedSummaries.push(evicted);
    }

    // 5. 更新统计
    store.completedTaskCount++;
    store.totalWordCount += taskSummary.wordCount;
    store.lastActivityAt = new Date();

    // 6. 检查是否需要更新全局摘要
    let newGlobalSummary: string | undefined;
    const globalSummaryAge =
      store.completedTaskCount - this.getTaskCountAtLastGlobalUpdate(store);

    if (globalSummaryAge >= config.globalSummaryUpdateInterval) {
      newGlobalSummary = await this.updateGlobalSummary(projectId, store);
    }

    this.logger.debug(
      `Slide window for project ${projectId}: ` +
        `completed ${store.completedTaskCount}, ` +
        `evicted ${evictedSummaries.length} summaries`,
    );

    return {
      success: true,
      newGlobalSummary,
      evictedSummaries,
      windowState: {
        recentSummaryCount: store.recentSummaries.length,
        totalCompletedTasks: store.completedTaskCount,
        globalSummaryAge,
      },
    };
  }

  /**
   * 检索相关历史
   */
  async retrieveRelevantHistory(
    projectId: string,
    query: string,
    options?: {
      maxChunks?: number;
      threshold?: number;
    },
  ): Promise<RelevantHistoryChunk[]> {
    const store = this.projectStores.get(projectId);
    if (!store) return [];

    const maxChunks = options?.maxChunks || 3;
    const threshold = options?.threshold || 0.5;

    // 简单的关键词匹配（实际应用中应使用向量检索）
    const queryKeywords = this.extractKeywords(query);
    const results: RelevantHistoryChunk[] = [];

    // 遍历所有已存储的任务
    for (const [taskId, stored] of this.taskContentStore.entries()) {
      // 找到对应的摘要
      const taskSummary = store.recentSummaries.find(
        (s) => s.taskId === taskId,
      );

      if (!taskSummary) continue;

      // 计算相关性分数
      const matchedKeywords = queryKeywords.filter((kw) =>
        taskSummary.keywords.includes(kw),
      );
      const relevanceScore =
        matchedKeywords.length / Math.max(queryKeywords.length, 1);

      if (relevanceScore >= threshold) {
        results.push({
          sourceTaskId: taskId,
          sourceTaskTitle: taskSummary.title,
          content: this.extractRelevantChunk(stored.content, query),
          relevanceScore,
          matchedKeywords,
        });
      }
    }

    // 按相关性排序并返回前 N 个
    return results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxChunks);
  }

  /**
   * 更新全局摘要
   */
  async updateGlobalSummary(
    projectId: string,
    store?: ProjectContextStore,
  ): Promise<string> {
    const projectStore = store || this.projectStores.get(projectId);
    if (!projectStore) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // 构建摘要更新输入
    const recentSummariesText = projectStore.recentSummaries
      .map((s) => `- ${s.title}: ${s.summary}`)
      .join("\n");

    const prompt = `根据以下项目进展，更新全局摘要：

## 当前全局摘要
${projectStore.globalSummary}

## 最近完成的任务
${recentSummariesText}

## 统计信息
- 已完成任务数：${projectStore.completedTaskCount}
- 总字数：${projectStore.totalWordCount}

请生成一个更新后的全局摘要，包含：
1. 项目整体进展
2. 关键角色/主题/设定
3. 重要事件/结论
4. 当前状态

要求：简洁（不超过300字），突出重点。`;

    try {
      const response = await this.aiChatService.chat({
        messages: [
          { role: "system", content: "你是一个专业的内容摘要助手。" },
          { role: "user", content: prompt },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "low", outputLength: "minimal" },
      });

      const newSummary = response.content || projectStore.globalSummary;
      projectStore.globalSummary = newSummary;
      projectStore.globalSummaryUpdatedAt = new Date();

      this.logger.log(`Updated global summary for project: ${projectId}`);

      return newSummary;
    } catch (error) {
      this.logger.warn(`Failed to update global summary: ${error}`);
      return projectStore.globalSummary;
    }
  }

  /**
   * 获取完整任务内容（从长期记忆）
   */
  getFullTaskContent(taskId: string): string | null {
    return this.taskContentStore.get(taskId)?.content || null;
  }

  /**
   * 获取项目所有完成的任务内容
   */
  getAllCompletedTaskContents(projectId: string): Array<{
    taskId: string;
    title: string;
    content: string;
  }> {
    const store = this.projectStores.get(projectId);
    if (!store) return [];

    const results: Array<{ taskId: string; title: string; content: string }> =
      [];

    for (const summary of store.recentSummaries) {
      const stored = this.taskContentStore.get(summary.taskId);
      if (stored) {
        results.push({
          taskId: summary.taskId,
          title: summary.title,
          content: stored.content,
        });
      }
    }

    return results;
  }

  /**
   * 清理项目上下文
   */
  clearProject(projectId: string): void {
    const store = this.projectStores.get(projectId);
    if (store) {
      // 清理关联的任务内容
      for (const summary of store.recentSummaries) {
        this.taskContentStore.delete(summary.taskId);
      }
    }
    this.projectStores.delete(projectId);
    this.logger.log(`Cleared project context: ${projectId}`);
  }

  // ============ 私有方法 ============

  /**
   * 构建初始全局摘要
   */
  private buildInitialGlobalSummary(projectInfo: {
    title: string;
    description: string;
    totalTasks?: number;
  }): string {
    return `## 项目：${projectInfo.title}

### 描述
${projectInfo.description}

### 状态
- 计划任务数：${projectInfo.totalTasks || "待定"}
- 已完成任务：0
- 总字数：0

### 关键信息
（待更新）`;
  }

  /**
   * 生成任务摘要
   */
  private async generateSummary(
    content: string,
    title: string,
    options?: SummaryGenerationOptions,
  ): Promise<string> {
    const maxLength = options?.maxLength || 200;

    // 如果内容较短，直接使用
    if (content.length <= maxLength) {
      return content;
    }

    try {
      const response = await this.aiChatService.chat({
        messages: [
          {
            role: "system",
            content: "你是一个专业的内容摘要助手。请用简洁的语言概括主要内容。",
          },
          {
            role: "user",
            content: `请为以下内容（标题：${title}）生成不超过${maxLength}字的摘要：\n\n${content.slice(0, 2000)}`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "low", outputLength: "minimal" },
      });

      return response.content || content.slice(0, maxLength) + "...";
    } catch (error) {
      this.logger.warn(`Failed to generate summary: ${error}`);
      return content.slice(0, maxLength) + "...";
    }
  }

  /**
   * 提取关键词
   */
  private extractKeywords(content: string): string[] {
    // 简单实现：提取高频词
    const words = content
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    const wordCount = new Map<string, number>();
    for (const word of words) {
      wordCount.set(word, (wordCount.get(word) || 0) + 1);
    }

    // 返回频率最高的 10 个词
    return Array.from(wordCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * 提取相关片段
   */
  private extractRelevantChunk(content: string, query: string): string {
    const queryKeywords = this.extractKeywords(query);
    const sentences = content.split(/[。！？.!?]/);

    // 找到包含关键词最多的句子
    let bestSentence = "";
    let maxMatches = 0;

    for (const sentence of sentences) {
      const matches = queryKeywords.filter((kw) =>
        sentence.includes(kw),
      ).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        bestSentence = sentence;
      }
    }

    return bestSentence.slice(0, 500) || content.slice(0, 500);
  }

  /**
   * 截断到指定 token 数
   */
  private truncateToTokens(text: string, maxTokens: number): string {
    // 简单估算：1 token ≈ 2 中文字符 或 4 英文字符
    const estimatedChars = maxTokens * 2;
    if (text.length <= estimatedChars) {
      return text;
    }
    return text.slice(0, estimatedChars) + "...";
  }

  /**
   * 计算 token 使用
   */
  private calculateTokenUsage(
    globalSummary: string,
    recentSummaries: string,
    currentTask: string,
    relevantHistory: RelevantHistoryChunk[],
    maxTokens: number,
  ): TokenUsage {
    const estimate = (text: string) => Math.ceil(text.length / 2);

    const globalSummaryTokens = estimate(globalSummary);
    const recentSummariesTokens = estimate(recentSummaries);
    const currentTaskTokens = estimate(currentTask);
    const relevantHistoryTokens = estimate(
      relevantHistory.map((h) => h.content).join("\n"),
    );

    const total =
      globalSummaryTokens +
      recentSummariesTokens +
      currentTaskTokens +
      relevantHistoryTokens;

    return {
      globalSummary: globalSummaryTokens,
      recentSummaries: recentSummariesTokens,
      currentTask: currentTaskTokens,
      relevantHistory: relevantHistoryTokens,
      total,
      limit: maxTokens,
      utilizationRate: total / maxTokens,
    };
  }

  /**
   * 统计字数
   */
  private countWords(text: string): number {
    return text.replace(/\s/g, "").length;
  }

  /**
   * 获取上次全局摘要更新时的任务数
   */
  private getTaskCountAtLastGlobalUpdate(store: ProjectContextStore): number {
    // 简化实现：假设每次更新后重置计数器
    // 实际应用中应该记录更新时的任务数
    const timeSinceUpdate = Date.now() - store.globalSummaryUpdatedAt.getTime();
    const estimatedTasksPerHour = 10;
    return Math.max(
      0,
      store.completedTaskCount -
        Math.floor((timeSinceUpdate / 3600000) * estimatedTasksPerHour),
    );
  }
}
