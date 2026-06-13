/**
 * SharedScratchpadService - Agent 共享便签板服务
 *
 * 基于 AGENTS' ROOM (ICLR 2025) 的共享便签板机制：
 * - 提供 Agent 间的信息共享和协作
 * - 支持异步问答和决策记录
 * - 维护任务执行过程中的关键信息
 *
 * 核心机制：
 * - 便签板条目：NOTE, QUESTION, DECISION, FACT, TODO
 * - 条目优先级和定向发送
 * - 条目状态追踪（未解决/已解决）
 *
 * 参考文献:
 * - AGENTS' ROOM: Narrative Generation through Multi-step Collaboration (ICLR 2025)
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { v4 as uuidv4 } from "uuid";

// ==================== 类型定义 ====================

/**
 * 便签条目类型
 */
export type ScratchpadEntryType =
  | "NOTE" // 笔记/备注
  | "QUESTION" // 问题
  | "ANSWER" // 答案
  | "DECISION" // 决策
  | "FACT" // 事实
  | "TODO" // 待办
  | "WARNING" // 警告
  | "CONTEXT"; // 上下文信息

/**
 * 便签条目优先级
 */
export type ScratchpadPriority = "HIGH" | "MEDIUM" | "LOW";

/**
 * 便签条目状态
 */
export type ScratchpadEntryStatus = "OPEN" | "RESOLVED" | "EXPIRED";

/**
 * 便签条目
 */
export interface ScratchpadEntry {
  /** 条目ID */
  id: string;
  /** 任务ID */
  missionId: string;
  /** 发送者 Agent ID */
  fromAgent: string;
  /** 接收者 Agent ID（可选，空表示广播） */
  toAgents?: string[];
  /** 条目类型 */
  type: ScratchpadEntryType;
  /** 主题/标签 */
  topic?: string;
  /** 内容 */
  content: string;
  /** 优先级 */
  priority: ScratchpadPriority;
  /** 状态 */
  status: ScratchpadEntryStatus;
  /** 关联的条目ID（用于回复链） */
  replyTo?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 创建时间 */
  createdAt: string;
  /** 解决时间 */
  resolvedAt?: string;
  /** 解决者 */
  resolvedBy?: string;
  /** 解决内容（答案/决策结果） */
  resolution?: string;
}

/**
 * 便签板
 */
export interface Scratchpad {
  /** 任务ID */
  missionId: string;
  /** 条目列表 */
  entries: ScratchpadEntry[];
  /** 创建时间 */
  createdAt: string;
  /** 最后更新时间 */
  updatedAt: string;
  /** 版本 */
  version: number;
}

/**
 * 便签查询过滤器
 */
export interface ScratchpadFilter {
  /** Agent ID（获取发给该 Agent 的条目） */
  forAgent?: string;
  /** 条目类型 */
  type?: ScratchpadEntryType | ScratchpadEntryType[];
  /** 状态 */
  status?: ScratchpadEntryStatus;
  /** 优先级 */
  priority?: ScratchpadPriority;
  /** 主题 */
  topic?: string;
  /** 限制数量 */
  limit?: number;
}

/**
 * 添加条目输入
 */
export interface AddEntryInput {
  /** 发送者 Agent ID */
  fromAgent: string;
  /** 接收者 Agent ID */
  toAgents?: string[];
  /** 条目类型 */
  type: ScratchpadEntryType;
  /** 主题 */
  topic?: string;
  /** 内容 */
  content: string;
  /** 优先级 */
  priority?: ScratchpadPriority;
  /** 关联条目ID */
  replyTo?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ==================== 服务实现 ====================

@Injectable()
export class SharedScratchpadService {
  private readonly logger = new Logger(SharedScratchpadService.name);

  // 内存缓存（用于快速访问，同时持久化到数据库）
  private scratchpads = new Map<string, Scratchpad>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取或创建便签板
   */
  async getOrCreate(missionId: string): Promise<Scratchpad> {
    // 先检查缓存
    if (this.scratchpads.has(missionId)) {
      return this.scratchpads.get(missionId)!;
    }

    // 从数据库加载
    const loaded = await this.loadFromDatabase(missionId);
    if (loaded) {
      this.scratchpads.set(missionId, loaded);
      return loaded;
    }

    // 创建新的
    const scratchpad: Scratchpad = {
      missionId,
      entries: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    this.scratchpads.set(missionId, scratchpad);
    await this.saveToDatabase(scratchpad);

    return scratchpad;
  }

  /**
   * 添加条目
   */
  async addEntry(
    missionId: string,
    input: AddEntryInput,
  ): Promise<ScratchpadEntry> {
    const scratchpad = await this.getOrCreate(missionId);

    const entry: ScratchpadEntry = {
      id: uuidv4(),
      missionId,
      fromAgent: input.fromAgent,
      toAgents: input.toAgents,
      type: input.type,
      topic: input.topic,
      content: input.content,
      priority: input.priority || "MEDIUM",
      status: "OPEN",
      replyTo: input.replyTo,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    };

    scratchpad.entries.push(entry);
    scratchpad.updatedAt = new Date().toISOString();
    scratchpad.version++;

    await this.saveToDatabase(scratchpad);

    this.logger.debug(
      `Added ${entry.type} entry from ${entry.fromAgent}: ${entry.content.slice(0, 50)}...`,
    );

    return entry;
  }

  /**
   * 快捷方法：添加问题
   */
  async askQuestion(
    missionId: string,
    fromAgent: string,
    question: string,
    toAgents?: string[],
    priority: ScratchpadPriority = "MEDIUM",
  ): Promise<ScratchpadEntry> {
    return this.addEntry(missionId, {
      fromAgent,
      toAgents,
      type: "QUESTION",
      content: question,
      priority,
    });
  }

  /**
   * 快捷方法：回答问题
   */
  async answerQuestion(
    missionId: string,
    questionId: string,
    fromAgent: string,
    answer: string,
  ): Promise<ScratchpadEntry> {
    // 标记问题为已解决
    await this.resolveEntry(missionId, questionId, fromAgent, answer);

    // 添加答案条目
    return this.addEntry(missionId, {
      fromAgent,
      type: "ANSWER",
      content: answer,
      replyTo: questionId,
    });
  }

  /**
   * 快捷方法：记录事实
   */
  async recordFact(
    missionId: string,
    fromAgent: string,
    fact: string,
    topic?: string,
  ): Promise<ScratchpadEntry> {
    return this.addEntry(missionId, {
      fromAgent,
      type: "FACT",
      content: fact,
      topic,
      priority: "HIGH",
    });
  }

  /**
   * 快捷方法：记录决策
   */
  async recordDecision(
    missionId: string,
    fromAgent: string,
    decision: string,
    context?: string,
  ): Promise<ScratchpadEntry> {
    return this.addEntry(missionId, {
      fromAgent,
      type: "DECISION",
      content: decision,
      metadata: { context },
      priority: "HIGH",
    });
  }

  /**
   * 快捷方法：添加警告
   */
  async addWarning(
    missionId: string,
    fromAgent: string,
    warning: string,
    toAgents?: string[],
  ): Promise<ScratchpadEntry> {
    return this.addEntry(missionId, {
      fromAgent,
      toAgents,
      type: "WARNING",
      content: warning,
      priority: "HIGH",
    });
  }

  /**
   * 快捷方法：添加上下文
   */
  async addContext(
    missionId: string,
    fromAgent: string,
    context: string,
    topic?: string,
  ): Promise<ScratchpadEntry> {
    return this.addEntry(missionId, {
      fromAgent,
      type: "CONTEXT",
      content: context,
      topic,
    });
  }

  /**
   * 解决条目
   */
  async resolveEntry(
    missionId: string,
    entryId: string,
    resolvedBy: string,
    resolution?: string,
  ): Promise<void> {
    const scratchpad = await this.getOrCreate(missionId);
    const entry = scratchpad.entries.find((e) => e.id === entryId);

    if (entry) {
      entry.status = "RESOLVED";
      entry.resolvedAt = new Date().toISOString();
      entry.resolvedBy = resolvedBy;
      entry.resolution = resolution;

      scratchpad.updatedAt = new Date().toISOString();
      scratchpad.version++;

      await this.saveToDatabase(scratchpad);

      this.logger.debug(`Resolved entry ${entryId} by ${resolvedBy}`);
    }
  }

  /**
   * 获取条目列表
   */
  async getEntries(
    missionId: string,
    filter?: ScratchpadFilter,
  ): Promise<ScratchpadEntry[]> {
    const scratchpad = await this.getOrCreate(missionId);
    let entries = [...scratchpad.entries];

    if (filter) {
      // 按接收者过滤
      if (filter.forAgent) {
        entries = entries.filter(
          (e) =>
            !e.toAgents ||
            e.toAgents.length === 0 ||
            e.toAgents.includes(filter.forAgent!),
        );
      }

      // 按类型过滤
      if (filter.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        entries = entries.filter((e) => types.includes(e.type));
      }

      // 按状态过滤
      if (filter.status) {
        entries = entries.filter((e) => e.status === filter.status);
      }

      // 按优先级过滤
      if (filter.priority) {
        entries = entries.filter((e) => e.priority === filter.priority);
      }

      // 按主题过滤
      if (filter.topic) {
        entries = entries.filter((e) => e.topic === filter.topic);
      }

      // 限制数量
      if (filter.limit) {
        entries = entries.slice(-filter.limit);
      }
    }

    return entries;
  }

  /**
   * 获取未解决的问题
   */
  async getUnresolvedQuestions(
    missionId: string,
    forAgent?: string,
  ): Promise<ScratchpadEntry[]> {
    return this.getEntries(missionId, {
      forAgent,
      type: "QUESTION",
      status: "OPEN",
    });
  }

  /**
   * 获取高优先级条目
   */
  async getHighPriorityEntries(
    missionId: string,
    forAgent?: string,
  ): Promise<ScratchpadEntry[]> {
    return this.getEntries(missionId, {
      forAgent,
      priority: "HIGH",
      status: "OPEN",
    });
  }

  /**
   * 获取某主题的所有事实
   */
  async getFactsByTopic(
    missionId: string,
    topic: string,
  ): Promise<ScratchpadEntry[]> {
    return this.getEntries(missionId, {
      type: "FACT",
      topic,
    });
  }

  /**
   * 获取所有决策
   */
  async getDecisions(missionId: string): Promise<ScratchpadEntry[]> {
    return this.getEntries(missionId, {
      type: "DECISION",
    });
  }

  /**
   * 构建便签板摘要（用于注入到 Agent 上下文）
   */
  async buildSummaryForAgent(
    missionId: string,
    agentId: string,
  ): Promise<string> {
    const [unresolvedQuestions, highPriority, recentFacts, decisions] =
      await Promise.all([
        this.getUnresolvedQuestions(missionId, agentId),
        this.getHighPriorityEntries(missionId, agentId),
        this.getEntries(missionId, { type: "FACT", limit: 10 }),
        this.getDecisions(missionId),
      ]);

    const parts: string[] = [];

    // 未解决的问题
    if (unresolvedQuestions.length > 0) {
      parts.push(
        `【待回答问题】\n${unresolvedQuestions.map((q) => `- [${q.fromAgent}] ${q.content}`).join("\n")}`,
      );
    }

    // 高优先级条目
    if (highPriority.length > 0) {
      const filtered = highPriority.filter((e) => e.type !== "QUESTION");
      if (filtered.length > 0) {
        parts.push(
          `【重要信息】\n${filtered.map((e) => `- [${e.type}] ${e.content}`).join("\n")}`,
        );
      }
    }

    // 已确立的事实
    if (recentFacts.length > 0) {
      parts.push(
        `【已确立事实】\n${recentFacts.map((f) => `- ${f.content}`).join("\n")}`,
      );
    }

    // 关键决策
    if (decisions.length > 0) {
      parts.push(
        `【已做决策】\n${decisions.map((d) => `- ${d.content}`).join("\n")}`,
      );
    }

    return parts.length > 0 ? parts.join("\n\n") : "";
  }

  /**
   * 清理过期条目
   */
  async cleanupExpired(
    missionId: string,
    maxAgeHours: number = 24,
  ): Promise<number> {
    const scratchpad = await this.getOrCreate(missionId);
    const cutoff = new Date(
      Date.now() - maxAgeHours * 60 * 60 * 1000,
    ).toISOString();

    const originalCount = scratchpad.entries.length;

    // 只清理已解决的低优先级条目
    scratchpad.entries = scratchpad.entries.filter(
      (e) =>
        e.status !== "RESOLVED" ||
        e.priority === "HIGH" ||
        e.createdAt > cutoff,
    );

    const removedCount = originalCount - scratchpad.entries.length;

    if (removedCount > 0) {
      scratchpad.updatedAt = new Date().toISOString();
      scratchpad.version++;
      await this.saveToDatabase(scratchpad);

      this.logger.log(
        `Cleaned up ${removedCount} expired entries from mission ${missionId}`,
      );
    }

    return removedCount;
  }

  /**
   * 删除便签板
   */
  async delete(missionId: string): Promise<void> {
    this.scratchpads.delete(missionId);
    await this.deleteFromDatabase(missionId);
    this.logger.log(`Deleted scratchpad for mission ${missionId}`);
  }

  /**
   * 从数据库加载
   */
  private async loadFromDatabase(
    missionId: string,
  ): Promise<Scratchpad | null> {
    try {
      const mission = await this.prisma.writingMission.findUnique({
        where: { id: missionId },
        select: { result: true },
      });

      if (!mission?.result) {
        return null;
      }

      const result = mission.result as { scratchpad?: Scratchpad };
      return result.scratchpad || null;
    } catch (error) {
      this.logger.warn(`Failed to load scratchpad from database: ${error}`);
      return null;
    }
  }

  /**
   * 保存到数据库
   */
  private async saveToDatabase(scratchpad: Scratchpad): Promise<void> {
    try {
      const mission = await this.prisma.writingMission.findUnique({
        where: { id: scratchpad.missionId },
        select: { result: true },
      });

      const existingResult = (mission?.result as Record<string, unknown>) || {};

      await this.prisma.writingMission.update({
        where: { id: scratchpad.missionId },
        data: {
          result: JSON.parse(
            JSON.stringify({
              ...existingResult,
              scratchpad,
            }),
          ),
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to save scratchpad to database: ${error}`);
    }
  }

  /**
   * 从数据库删除
   */
  private async deleteFromDatabase(missionId: string): Promise<void> {
    try {
      const mission = await this.prisma.writingMission.findUnique({
        where: { id: missionId },
        select: { result: true },
      });

      if (mission?.result) {
        const result = { ...(mission.result as Record<string, unknown>) };
        delete result.scratchpad;

        await this.prisma.writingMission.update({
          where: { id: missionId },
          data: { result: JSON.parse(JSON.stringify(result)) },
        });
      }
    } catch (error) {
      this.logger.warn(`Failed to delete scratchpad from database: ${error}`);
    }
  }
}
