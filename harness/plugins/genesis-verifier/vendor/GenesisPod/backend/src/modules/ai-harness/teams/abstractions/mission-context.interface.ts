/**
 * AI Engine - Mission Context Package
 *
 * 任务上下文包 - Leader 理解任务后产生的结构化上下文
 * 领域无关的通用机制，适用于所有场景：
 * - AI Teams（研究、办公、模拟）
 * - AI Writing（长篇小说创作）
 * - 其他需要结构化上下文的 AI 应用
 */

// ==================== 基础类型定义 ====================

// 2026-05-01 (PR-X-O): HardConstraint / CoreEntity / EstablishedFact 从此处搬到
// ai-engine/knowledge/{world-building,extraction}/...types（owner = engine 提取/构建层），
// 消除双定义。harness mission-context 通过 import + re-export 保持原 import 路径稳定。
// CoreEntity.relations 字段已升级到 engine canonical 版本。
import type {
  HardConstraint,
  CoreEntity,
} from "@/modules/ai-engine/knowledge/world-building/world-building.types";
import type { EstablishedFact } from "@/modules/ai-engine/knowledge/extraction/context-evolution.types";
export type { HardConstraint, CoreEntity, EstablishedFact };

/**
 * 禁止事项
 */
export interface Prohibition {
  /** 禁止什么 */
  description: string;
  /** 为什么禁止 */
  reason?: string;
}

/**
 * 质量标准
 */
export interface QualityStandard {
  /** 维度：准确性/完整性/一致性/... */
  dimension: string;
  /** 要求 */
  requirement: string;
  /** 可量化的指标 */
  metric?: string;
}

// EstablishedFact 已 re-export 自 ai-engine（见上方 import）— 消除双定义

/**
 * 任务理解
 */
export interface TaskUnderstanding {
  /** 一句话总结 */
  summary: string;
  /** 任务范围 */
  scope: string;
  /** 预期产出物 */
  expectedOutput: string;
}

// ==================== 核心接口 ====================

/**
 * Mission Context Package - 完整的任务上下文包
 *
 * 设计原则：领域无关，通用适配
 * - 初始化：Leader 在规划阶段填充 entities, hardConstraints 等
 * - 演进：任务完成后，系统提取 establishedFacts 追加到上下文
 * - 校验：后续任务执行和审核时，参照 establishedFacts 确保一致性
 */
export interface MissionContextPackage {
  /** 版本号 */
  version: "1.0";

  /** 生成时间 */
  generatedAt: string;

  /** 生成者（Leader ID） */
  generatedBy: string;

  /** 任务理解 */
  understanding: TaskUnderstanding;

  /** 硬性约束（必须遵循，违反=失败） */
  hardConstraints: HardConstraint[];

  /** 核心实体定义 */
  entities: CoreEntity[];

  /** 禁止事项 */
  prohibitions: Prohibition[];

  /** 质量标准 */
  qualityStandards: QualityStandard[];

  /** 术语表（确保一致性） */
  glossary?: Record<string, string>;

  /** 场景特定扩展（灵活字段） */
  extensions?: Record<string, unknown>;

  /**
   * 已确立的事实（任务执行过程中演进）
   *
   * 这是跨任务一致性的核心机制：
   * - 每个任务完成后，AI 提取关键事实追加到此列表
   * - 后续任务执行时，这些事实作为上下文注入
   * - Leader 审核时，校验新内容与已确立事实的一致性
   */
  establishedFacts?: EstablishedFact[];
}

// ==================== 工厂函数 ====================

/**
 * 创建空的 Context Package
 */
export function createEmptyContextPackage(
  generatedBy: string,
): MissionContextPackage {
  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    generatedBy,
    understanding: {
      summary: "",
      scope: "",
      expectedOutput: "",
    },
    hardConstraints: [],
    entities: [],
    prohibitions: [],
    qualityStandards: [],
    glossary: {},
    extensions: {},
    establishedFacts: [],
  };
}

/**
 * 校验 Context Package 的基本结构
 */
export function validateContextPackage(
  data: unknown,
): MissionContextPackage | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const obj = data as Record<string, unknown>;

  // 构建有效的 package，缺失字段使用默认值
  const result: MissionContextPackage = {
    version: "1.0",
    generatedAt:
      typeof obj.generatedAt === "string"
        ? obj.generatedAt
        : new Date().toISOString(),
    generatedBy:
      typeof obj.generatedBy === "string" ? obj.generatedBy : "unknown",
    understanding: {
      summary: "",
      scope: "",
      expectedOutput: "",
    },
    hardConstraints: [],
    entities: [],
    prohibitions: [],
    qualityStandards: [],
    glossary: {},
    extensions: {},
  };

  // 解析 understanding
  if (obj.understanding && typeof obj.understanding === "object") {
    const u = obj.understanding as Record<string, unknown>;
    result.understanding = {
      summary: typeof u.summary === "string" ? u.summary : "",
      scope: typeof u.scope === "string" ? u.scope : "",
      expectedOutput:
        typeof u.expectedOutput === "string" ? u.expectedOutput : "",
    };
  }

  // 解析 hardConstraints
  if (Array.isArray(obj.hardConstraints)) {
    result.hardConstraints = obj.hardConstraints
      .filter(
        (c): c is Record<string, unknown> =>
          c !== null && typeof c === "object",
      )
      .map((c) => ({
        id:
          typeof c.id === "string"
            ? c.id
            : `HC-${Math.random().toString(36).slice(2, 8)}`,
        rule: typeof c.rule === "string" ? c.rule : "",
        reason: typeof c.reason === "string" ? c.reason : undefined,
        severity: (c.severity === "SHOULD" ? "SHOULD" : "MUST") as
          | "MUST"
          | "SHOULD",
      }))
      .filter((c) => c.rule.length > 0);
  }

  // 解析 entities
  if (Array.isArray(obj.entities)) {
    result.entities = obj.entities
      .filter(
        (e): e is Record<string, unknown> =>
          e !== null && typeof e === "object",
      )
      .map((e) => ({
        name: typeof e.name === "string" ? e.name : "",
        type: typeof e.type === "string" ? e.type : "未知",
        definition: typeof e.definition === "string" ? e.definition : "",
        attributes:
          e.attributes && typeof e.attributes === "object"
            ? (e.attributes as Record<string, string>)
            : undefined,
        relations: Array.isArray(e.relations)
          ? e.relations
              .filter(
                (r): r is Record<string, unknown> =>
                  r !== null && typeof r === "object",
              )
              .map((r) => ({
                target: typeof r.target === "string" ? r.target : "",
                relation: typeof r.relation === "string" ? r.relation : "",
              }))
          : undefined,
      }))
      .filter((e) => e.name.length > 0);
  }

  // 解析 prohibitions
  if (Array.isArray(obj.prohibitions)) {
    result.prohibitions = obj.prohibitions
      .filter(
        (p): p is Record<string, unknown> =>
          p !== null && typeof p === "object",
      )
      .map((p) => ({
        description: typeof p.description === "string" ? p.description : "",
        reason: typeof p.reason === "string" ? p.reason : undefined,
      }))
      .filter((p) => p.description.length > 0);
  }

  // 解析 qualityStandards
  if (Array.isArray(obj.qualityStandards)) {
    result.qualityStandards = obj.qualityStandards
      .filter(
        (q): q is Record<string, unknown> =>
          q !== null && typeof q === "object",
      )
      .map((q) => ({
        dimension: typeof q.dimension === "string" ? q.dimension : "",
        requirement: typeof q.requirement === "string" ? q.requirement : "",
        metric: typeof q.metric === "string" ? q.metric : undefined,
      }))
      .filter((q) => q.dimension.length > 0 && q.requirement.length > 0);
  }

  // 解析 glossary
  if (obj.glossary && typeof obj.glossary === "object") {
    result.glossary = obj.glossary as Record<string, string>;
  }

  // 解析 extensions
  if (obj.extensions && typeof obj.extensions === "object") {
    result.extensions = obj.extensions as Record<string, unknown>;
  }

  // 解析 establishedFacts
  result.establishedFacts = [];
  if (Array.isArray(obj.establishedFacts)) {
    const validCategories = [
      "entity_state",
      "sequence_point",
      "decision",
      "definition",
      "relationship",
      "constraint_added",
    ];
    const validImportance = ["high", "medium", "low"];

    result.establishedFacts = obj.establishedFacts
      .filter(
        (f): f is Record<string, unknown> =>
          f !== null && typeof f === "object",
      )
      .map((f) => ({
        id:
          typeof f.id === "string"
            ? f.id
            : `EF-${Math.random().toString(36).slice(2, 8)}`,
        sourceTaskId: typeof f.sourceTaskId === "string" ? f.sourceTaskId : "",
        sourceTaskTitle:
          typeof f.sourceTaskTitle === "string" ? f.sourceTaskTitle : "",
        establishedAt:
          typeof f.establishedAt === "string"
            ? f.establishedAt
            : new Date().toISOString(),
        statement: typeof f.statement === "string" ? f.statement : "",
        category: (validCategories.includes(f.category as string)
          ? f.category
          : "definition") as EstablishedFact["category"],
        relatedEntities: Array.isArray(f.relatedEntities)
          ? f.relatedEntities.filter((e): e is string => typeof e === "string")
          : undefined,
        importance: (validImportance.includes(f.importance as string)
          ? f.importance
          : "medium") as EstablishedFact["importance"],
      }))
      .filter((f) => f.statement.length > 0);
  }

  return result;
}

/**
 * 合并两个 Context Package
 * 用于将多个任务的上下文合并
 */
export function mergeContextPackages(
  base: MissionContextPackage,
  ...others: MissionContextPackage[]
): MissionContextPackage {
  const result = { ...base };

  for (const other of others) {
    // 合并实体（去重）
    const existingNames = new Set(result.entities.map((e) => e.name));
    for (const entity of other.entities) {
      if (!existingNames.has(entity.name)) {
        result.entities.push(entity);
        existingNames.add(entity.name);
      }
    }

    // 合并约束（去重）
    const existingRules = new Set(result.hardConstraints.map((c) => c.rule));
    for (const constraint of other.hardConstraints) {
      if (!existingRules.has(constraint.rule)) {
        result.hardConstraints.push(constraint);
        existingRules.add(constraint.rule);
      }
    }

    // 合并禁止事项
    const existingProhibitions = new Set(
      result.prohibitions.map((p) => p.description),
    );
    for (const prohibition of other.prohibitions) {
      if (!existingProhibitions.has(prohibition.description)) {
        result.prohibitions.push(prohibition);
        existingProhibitions.add(prohibition.description);
      }
    }

    // 合并术语表
    result.glossary = { ...result.glossary, ...other.glossary };

    // 合并已确立事实
    result.establishedFacts = [
      ...(result.establishedFacts || []),
      ...(other.establishedFacts || []),
    ];
  }

  return result;
}
