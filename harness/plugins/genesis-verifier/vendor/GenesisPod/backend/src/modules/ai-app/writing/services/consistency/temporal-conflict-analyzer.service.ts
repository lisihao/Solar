/**
 * TemporalConflictAnalyzerService - 时序冲突检测矩阵服务
 *
 * 基于 DOME 论文的 Temporal Conflict Analyzer，实现时序冲突检测矩阵：
 * - 因果冲突：事件因果链断裂或矛盾
 * - 时序冲突：时间线上的事件顺序矛盾
 * - 状态冲突：角色/物品状态的不一致
 * - 位置冲突：角色位置的不合理跳转
 *
 * 核心机制：
 * - 从内容中提取三元组 (subject, predicate, object, time)
 * - 构建时序知识表示
 * - 检测冲突并生成冲突矩阵
 *
 * 参考文献:
 * - DOME: Generating Long-form Story Using Dynamic Hierarchical Outlining
 *   with Memory-Enhancement (NAACL 2025)
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

// ==================== 类型定义 ====================

/**
 * 时序冲突类型
 */
export type TemporalConflictType =
  | "CAUSAL" // 因果冲突：A导致B，但B先于A发生
  | "TEMPORAL" // 时序冲突：时间线矛盾
  | "STATE" // 状态冲突：角色状态不一致
  | "LOCATION" // 位置冲突：位置跳转不合理
  | "EXISTENCE"; // 存在冲突：已死亡/销毁的实体再次出现

/**
 * 时序三元组（基于知识图谱表示）
 */
export interface TemporalTriple {
  /** 主体（角色/物品/事件） */
  subject: string;
  /** 谓语（动作/状态/关系） */
  predicate: string;
  /** 宾语（可选） */
  object?: string;
  /** 故事内时间 */
  storyTime?: string;
  /** 章节编号 */
  chapterNumber: number;
  /** 三元组类型 */
  tripleType: "STATE" | "ACTION" | "RELATION" | "LOCATION";
  /** 时序有效性：开始 */
  validFrom: number; // 章节编号
  /** 时序有效性：结束（null = 持续） */
  validTo?: number;
  /** 原文证据 */
  evidence?: string;
}

/**
 * 时序冲突
 */
export interface TemporalConflict {
  /** 冲突类型 */
  type: TemporalConflictType;
  /** 冲突描述 */
  description: string;
  /** 冲突涉及的章节1 */
  chapter1: number;
  /** 冲突涉及的章节2 */
  chapter2: number;
  /** 涉及的实体 */
  entity: string;
  /** 预期状态/事件 */
  expected: string;
  /** 实际状态/事件 */
  found: string;
  /** 严重程度 */
  severity: "CRITICAL" | "WARNING" | "INFO";
  /** 冲突的三元组 */
  conflictingTriples: [TemporalTriple, TemporalTriple];
  /** 修复建议 */
  suggestion?: string;
}

/**
 * 冲突检测结果
 */
export interface ConflictDetectionResult {
  /** 检测到的冲突列表 */
  conflicts: TemporalConflict[];
  /** 章节间冲突矩阵 (NxN, 值表示冲突数量) */
  conflictMatrix: number[][];
  /** 冲突得分 (0-1, 越高冲突越严重) */
  conflictScore: number;
  /** 分析的章节范围 */
  analyzedChapters: number[];
  /** 提取的三元组数量 */
  tripleCount: number;
  /** 分析时间 */
  analyzedAt: string;
}

/**
 * 实体状态历史
 */
interface EntityStateHistory {
  entityName: string;
  states: {
    chapterNumber: number;
    state: string;
    storyTime?: string;
    evidence?: string;
  }[];
}

// ==================== 服务实现 ====================

@Injectable()
export class TemporalConflictAnalyzerService {
  private readonly logger = new Logger(TemporalConflictAnalyzerService.name);

  // 状态终结标记（这些状态后不应该再有相关动作）
  private readonly TERMINAL_STATES = [
    "死亡",
    "死",
    "殁",
    "亡",
    "驾崩",
    "薨",
    "卒",
    "殉",
    "牺牲",
    "消失",
    "毁灭",
    "销毁",
    "destroyed",
    "dead",
    "died",
  ];

  // 位置相关谓语
  private readonly LOCATION_PREDICATES = [
    "在",
    "位于",
    "到达",
    "离开",
    "前往",
    "抵达",
    "居于",
    "located",
    "arrived",
    "left",
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 分析新章节的时序冲突
   */
  async analyzeChapter(
    projectId: string,
    chapterNumber: number,
    newContent: string,
  ): Promise<ConflictDetectionResult> {
    this.logger.log(
      `Analyzing temporal conflicts for chapter ${chapterNumber}`,
    );

    // 1. 获取历史章节的三元组
    const historicalTriples = await this.getHistoricalTriples(
      projectId,
      chapterNumber,
    );

    // 2. 从新章节提取三元组
    const newTriples = await this.extractTriples(newContent, chapterNumber);

    // 3. 检测冲突
    const conflicts = await this.detectConflicts(historicalTriples, newTriples);

    // 4. 构建冲突矩阵
    const allChapters = [
      ...new Set([
        ...historicalTriples.map((t) => t.chapterNumber),
        chapterNumber,
      ]),
    ].sort((a, b) => a - b);

    const conflictMatrix = this.buildConflictMatrix(conflicts, allChapters);

    // 5. 计算冲突得分
    const conflictScore = this.calculateConflictScore(conflicts);

    return {
      conflicts,
      conflictMatrix,
      conflictScore,
      analyzedChapters: allChapters,
      tripleCount: historicalTriples.length + newTriples.length,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * 全局分析项目的时序冲突
   */
  async analyzeProject(projectId: string): Promise<ConflictDetectionResult> {
    this.logger.log(`Analyzing temporal conflicts for project ${projectId}`);

    // 获取所有章节
    const chapters = await this.prisma.writingChapter.findMany({
      where: {
        volume: { projectId },
        content: { not: "" },
      },
      orderBy: { chapterNumber: "asc" },
      select: {
        chapterNumber: true,
        content: true,
        metadata: true,
      },
    });

    if (chapters.length === 0) {
      return this.createEmptyResult([]);
    }

    // 提取所有章节的三元组
    const allTriples: TemporalTriple[] = [];
    for (const chapter of chapters) {
      const triples = await this.extractTriples(
        chapter.content || "",
        chapter.chapterNumber,
      );
      allTriples.push(...triples);
    }

    // 使用主体索引优化冲突检测 (从 O(n²) 降至 O(n·m))
    const conflicts: TemporalConflict[] = [];
    const triplesBySubject = new Map<string, TemporalTriple[]>();

    // 按主体分组
    for (const triple of allTriples) {
      const existing = triplesBySubject.get(triple.subject);
      if (existing) {
        existing.push(triple);
      } else {
        triplesBySubject.set(triple.subject, [triple]);
      }
    }

    // 只检测同一主体的三元组（冲突只可能发生在同一实体上）
    for (const triples of triplesBySubject.values()) {
      for (let i = 0; i < triples.length; i++) {
        for (let j = i + 1; j < triples.length; j++) {
          const conflict = this.checkPairConflict(triples[i], triples[j]);
          if (conflict) {
            conflicts.push(conflict);
          }
        }
      }
    }

    // 构建冲突矩阵
    const allChapters = chapters.map((c) => c.chapterNumber);
    const conflictMatrix = this.buildConflictMatrix(conflicts, allChapters);

    return {
      conflicts,
      conflictMatrix,
      conflictScore: this.calculateConflictScore(conflicts),
      analyzedChapters: allChapters,
      tripleCount: allTriples.length,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * 获取历史章节的三元组
   */
  private async getHistoricalTriples(
    projectId: string,
    beforeChapter: number,
  ): Promise<TemporalTriple[]> {
    const chapters = await this.prisma.writingChapter.findMany({
      where: {
        volume: { projectId },
        chapterNumber: { lt: beforeChapter },
        content: { not: "" },
      },
      orderBy: { chapterNumber: "asc" },
      select: {
        chapterNumber: true,
        content: true,
        metadata: true,
      },
    });

    const allTriples: TemporalTriple[] = [];

    for (const chapter of chapters) {
      // 尝试从 metadata 获取缓存的三元组
      const metadata = chapter.metadata as {
        triples?: TemporalTriple[];
      } | null;
      if (metadata?.triples && Array.isArray(metadata.triples)) {
        allTriples.push(...metadata.triples);
      } else {
        // 否则实时提取
        const triples = await this.extractTriples(
          chapter.content || "",
          chapter.chapterNumber,
        );
        allTriples.push(...triples);
      }
    }

    return allTriples;
  }

  /**
   * 从章节内容提取三元组
   */
  async extractTriples(
    content: string,
    chapterNumber: number,
  ): Promise<TemporalTriple[]> {
    if (!content || content.length < 100) {
      return [];
    }

    try {
      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `你是一位知识提取专家。从故事内容中提取时序相关的三元组。

提取规则：
1. 角色状态：角色的生死、健康、情绪等状态变化
2. 角色位置：角色的位置移动
3. 角色关系：角色之间的关系变化
4. 重要事件：关键情节事件

输出 JSON 格式：
{
  "triples": [
    {
      "subject": "主体名称",
      "predicate": "谓语/状态",
      "object": "宾语（可选）",
      "tripleType": "STATE|ACTION|RELATION|LOCATION",
      "storyTime": "故事内时间（如有）",
      "evidence": "原文证据（简短）"
    }
  ]
}

注意：
- 只提取重要的、影响后续剧情的三元组
- 每章最多提取 10 个三元组
- 特别关注：死亡、受伤、位置变化、关系变化`,
          },
          {
            role: "user",
            content: `第${chapterNumber}章内容：
${content.slice(0, 6000)}

请提取关键三元组。`,
          },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "deterministic",
          outputLength: "medium",
        },
      });

      const result = this.parseJsonResponse(response.content || "", {
        triples: [],
      });

      return (result.triples || []).map(
        (t: Partial<TemporalTriple>) =>
          ({
            subject: t.subject || "",
            predicate: t.predicate || "",
            object: t.object,
            storyTime: t.storyTime,
            chapterNumber,
            tripleType: t.tripleType || "STATE",
            validFrom: chapterNumber,
            evidence: t.evidence,
          }) as TemporalTriple,
      );
    } catch (error) {
      this.logger.warn(`Failed to extract triples: ${error}`);
      return [];
    }
  }

  /**
   * 检测冲突
   */
  private async detectConflicts(
    historicalTriples: TemporalTriple[],
    newTriples: TemporalTriple[],
  ): Promise<TemporalConflict[]> {
    const conflicts: TemporalConflict[] = [];

    // 构建实体状态历史
    const entityStates = this.buildEntityStateHistory(historicalTriples);

    for (const newTriple of newTriples) {
      // 1. 检查存在冲突（已终结的实体再次出现）
      const existenceConflict = this.checkExistenceConflict(
        newTriple,
        historicalTriples,
      );
      if (existenceConflict) {
        conflicts.push(existenceConflict);
        continue;
      }

      // 2. 检查状态冲突
      const stateConflict = this.checkStateConflict(newTriple, entityStates);
      if (stateConflict) {
        conflicts.push(stateConflict);
      }

      // 3. 检查位置冲突
      if (newTriple.tripleType === "LOCATION") {
        const locationConflict = this.checkLocationConflict(
          newTriple,
          historicalTriples,
        );
        if (locationConflict) {
          conflicts.push(locationConflict);
        }
      }

      // 4. 检查与每个历史三元组的潜在冲突
      for (const histTriple of historicalTriples) {
        const pairConflict = this.checkPairConflict(histTriple, newTriple);
        if (
          pairConflict &&
          !conflicts.some((c) => this.isSameConflict(c, pairConflict))
        ) {
          conflicts.push(pairConflict);
        }
      }
    }

    return conflicts;
  }

  /**
   * 构建实体状态历史
   */
  private buildEntityStateHistory(
    triples: TemporalTriple[],
  ): Map<string, EntityStateHistory> {
    const history = new Map<string, EntityStateHistory>();

    for (const triple of triples) {
      if (triple.tripleType === "STATE") {
        const existing = history.get(triple.subject);
        if (existing) {
          existing.states.push({
            chapterNumber: triple.chapterNumber,
            state: triple.predicate,
            storyTime: triple.storyTime,
            evidence: triple.evidence,
          });
        } else {
          history.set(triple.subject, {
            entityName: triple.subject,
            states: [
              {
                chapterNumber: triple.chapterNumber,
                state: triple.predicate,
                storyTime: triple.storyTime,
                evidence: triple.evidence,
              },
            ],
          });
        }
      }
    }

    return history;
  }

  /**
   * 检查存在冲突
   */
  private checkExistenceConflict(
    newTriple: TemporalTriple,
    historicalTriples: TemporalTriple[],
  ): TemporalConflict | null {
    // 查找该实体是否已经"终结"
    const terminalTriple = historicalTriples.find(
      (t) =>
        t.subject === newTriple.subject &&
        t.tripleType === "STATE" &&
        this.TERMINAL_STATES.some((ts) => t.predicate.includes(ts)),
    );

    if (terminalTriple) {
      // 新三元组的主体执行了动作（但它应该已经终结了）
      if (
        newTriple.tripleType === "ACTION" ||
        (newTriple.tripleType === "STATE" &&
          !this.TERMINAL_STATES.some((ts) => newTriple.predicate.includes(ts)))
      ) {
        return {
          type: "EXISTENCE",
          description: `"${newTriple.subject}"在第${terminalTriple.chapterNumber}章已${terminalTriple.predicate}，但在第${newTriple.chapterNumber}章再次出现`,
          chapter1: terminalTriple.chapterNumber,
          chapter2: newTriple.chapterNumber,
          entity: newTriple.subject,
          expected: `${newTriple.subject}已${terminalTriple.predicate}`,
          found: `${newTriple.subject}${newTriple.predicate}${newTriple.object || ""}`,
          severity: "CRITICAL",
          conflictingTriples: [terminalTriple, newTriple],
          suggestion: `检查${newTriple.subject}是否真的已${terminalTriple.predicate}，或者是否有复活/误报的情节`,
        };
      }
    }

    return null;
  }

  /**
   * 检查状态冲突
   */
  private checkStateConflict(
    newTriple: TemporalTriple,
    entityStates: Map<string, EntityStateHistory>,
  ): TemporalConflict | null {
    if (newTriple.tripleType !== "STATE") {
      return null;
    }

    const history = entityStates.get(newTriple.subject);
    if (!history || history.states.length === 0) {
      return null;
    }

    const lastState = history.states[history.states.length - 1];

    // 检查状态是否有不合理的变化
    if (this.isConflictingState(lastState.state, newTriple.predicate)) {
      return {
        type: "STATE",
        description: `"${newTriple.subject}"的状态从"${lastState.state}"变为"${newTriple.predicate}"，缺乏过渡`,
        chapter1: lastState.chapterNumber,
        chapter2: newTriple.chapterNumber,
        entity: newTriple.subject,
        expected: lastState.state,
        found: newTriple.predicate,
        severity: "WARNING",
        conflictingTriples: [
          {
            subject: newTriple.subject,
            predicate: lastState.state,
            chapterNumber: lastState.chapterNumber,
            tripleType: "STATE",
            validFrom: lastState.chapterNumber,
            storyTime: lastState.storyTime,
          },
          newTriple,
        ],
        suggestion: `添加状态变化的过渡情节`,
      };
    }

    return null;
  }

  /**
   * 检查位置冲突
   */
  private checkLocationConflict(
    newTriple: TemporalTriple,
    historicalTriples: TemporalTriple[],
  ): TemporalConflict | null {
    // 查找该实体最近的位置
    const locationTriples = historicalTriples
      .filter(
        (t) => t.subject === newTriple.subject && t.tripleType === "LOCATION",
      )
      .sort((a, b) => b.chapterNumber - a.chapterNumber);

    if (locationTriples.length === 0) {
      return null;
    }

    const lastLocation = locationTriples[0];
    const newLocation = newTriple.object || newTriple.predicate;
    const oldLocation = lastLocation.object || lastLocation.predicate;

    // 如果位置不同且章节差距小于2，可能是不合理的跳转
    if (
      newLocation !== oldLocation &&
      newTriple.chapterNumber - lastLocation.chapterNumber <= 1
    ) {
      // 检查是否有明确的移动动作
      const hasMoveAction = historicalTriples.some(
        (t) =>
          t.subject === newTriple.subject &&
          t.tripleType === "ACTION" &&
          t.chapterNumber > lastLocation.chapterNumber &&
          t.chapterNumber <= newTriple.chapterNumber &&
          this.LOCATION_PREDICATES.some((p) => t.predicate.includes(p)),
      );

      if (!hasMoveAction) {
        return {
          type: "LOCATION",
          description: `"${newTriple.subject}"从"${oldLocation}"瞬移到"${newLocation}"，缺乏移动描写`,
          chapter1: lastLocation.chapterNumber,
          chapter2: newTriple.chapterNumber,
          entity: newTriple.subject,
          expected: `${newTriple.subject}在${oldLocation}`,
          found: `${newTriple.subject}在${newLocation}`,
          severity: "WARNING",
          conflictingTriples: [lastLocation, newTriple],
          suggestion: `添加${newTriple.subject}从${oldLocation}到${newLocation}的移动描写`,
        };
      }
    }

    return null;
  }

  /**
   * 检查两个三元组是否冲突
   */
  private checkPairConflict(
    triple1: TemporalTriple,
    triple2: TemporalTriple,
  ): TemporalConflict | null {
    // 只检查同一主体的三元组
    if (triple1.subject !== triple2.subject) {
      return null;
    }

    // 确保顺序：triple1 在前，triple2 在后
    const [earlier, later] =
      triple1.chapterNumber <= triple2.chapterNumber
        ? [triple1, triple2]
        : [triple2, triple1];

    // 检查状态冲突
    if (earlier.tripleType === "STATE" && later.tripleType === "STATE") {
      if (this.isDirectContradiction(earlier.predicate, later.predicate)) {
        return {
          type: "STATE",
          description: `"${earlier.subject}"的状态矛盾：第${earlier.chapterNumber}章"${earlier.predicate}" vs 第${later.chapterNumber}章"${later.predicate}"`,
          chapter1: earlier.chapterNumber,
          chapter2: later.chapterNumber,
          entity: earlier.subject,
          expected: earlier.predicate,
          found: later.predicate,
          severity: "CRITICAL",
          conflictingTriples: [earlier, later],
        };
      }
    }

    return null;
  }

  /**
   * 判断两个状态是否冲突
   */
  private isConflictingState(state1: string, state2: string): boolean {
    // 极端状态变化检测
    const extremeChanges = [
      ["健康", "重伤"],
      ["快乐", "绝望"],
      ["信任", "仇恨"],
      ["友好", "敌对"],
    ];

    for (const [a, b] of extremeChanges) {
      if (
        (state1.includes(a) && state2.includes(b)) ||
        (state1.includes(b) && state2.includes(a))
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * 判断是否直接矛盾
   */
  private isDirectContradiction(pred1: string, pred2: string): boolean {
    const contradictions = [
      ["活", "死"],
      ["存在", "消失"],
      ["完好", "毁灭"],
      ["健在", "死亡"],
    ];

    for (const [a, b] of contradictions) {
      if (
        (pred1.includes(a) && pred2.includes(b)) ||
        (pred1.includes(b) && pred2.includes(a))
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * 判断是否为相同冲突
   */
  private isSameConflict(c1: TemporalConflict, c2: TemporalConflict): boolean {
    return (
      c1.type === c2.type &&
      c1.entity === c2.entity &&
      c1.chapter1 === c2.chapter1 &&
      c1.chapter2 === c2.chapter2
    );
  }

  /**
   * 构建冲突矩阵
   */
  private buildConflictMatrix(
    conflicts: TemporalConflict[],
    chapters: number[],
  ): number[][] {
    const n = chapters.length;
    const matrix: number[][] = Array(n)
      .fill(null)
      .map(() => Array(n).fill(0));

    const chapterIndex = new Map(chapters.map((c, i) => [c, i]));

    for (const conflict of conflicts) {
      const i = chapterIndex.get(conflict.chapter1);
      const j = chapterIndex.get(conflict.chapter2);
      if (i !== undefined && j !== undefined) {
        matrix[i][j]++;
        matrix[j][i]++;
      }
    }

    return matrix;
  }

  /**
   * 计算冲突得分
   */
  private calculateConflictScore(conflicts: TemporalConflict[]): number {
    if (conflicts.length === 0) {
      return 0;
    }

    const severityWeights = {
      CRITICAL: 1.0,
      WARNING: 0.5,
      INFO: 0.1,
    };

    let totalWeight = 0;
    for (const conflict of conflicts) {
      totalWeight += severityWeights[conflict.severity];
    }

    // 归一化到 0-1
    return Math.min(totalWeight / 10, 1);
  }

  /**
   * 创建空结果
   */
  private createEmptyResult(chapters: number[]): ConflictDetectionResult {
    return {
      conflicts: [],
      conflictMatrix: [],
      conflictScore: 0,
      analyzedChapters: chapters,
      tripleCount: 0,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * 解析 JSON 响应
   */
  private parseJsonResponse<T>(content: string, defaultValue: T): T {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      this.logger.warn("Failed to parse JSON response");
    }
    return defaultValue;
  }

  /**
   * 保存三元组到章节元数据（用于缓存）
   */
  async saveTriplesToChapter(
    chapterId: string,
    triples: TemporalTriple[],
  ): Promise<void> {
    try {
      const chapter = await this.prisma.writingChapter.findUnique({
        where: { id: chapterId },
        select: { metadata: true },
      });

      const existingMetadata =
        (chapter?.metadata as Record<string, unknown>) || {};

      await this.prisma.writingChapter.update({
        where: { id: chapterId },
        data: {
          metadata: JSON.parse(
            JSON.stringify({
              ...existingMetadata,
              triples,
              triplesUpdatedAt: new Date().toISOString(),
            }),
          ),
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to save triples to chapter: ${error}`);
    }
  }
}
