/**
 * Context Evolution Types — engine 自有
 *
 * 2026-05-01 (PR-X-M3): 从 ai-harness/runner/executor/interfaces.ts 搬到
 * engine。harness/runner/executor/interfaces.ts re-export 保兼容。
 *
 * 注：EstablishedFact / HardConstraint / CoreEntity 是跨层共享 domain entity，
 * 也搬到 engine（owner = engine 知识抽取层），harness 那边的 mission-context
 * .interface.ts 改为 re-export from engine（消除双定义）。
 */

import { AIModelType } from "@prisma/client";
import type { AiCallerFn } from "@/modules/ai-engine/llm/types/ai-caller.types";

/** 上下文演进配置 */
export interface ContextEvolutionConfig {
  /** 最小输出长度（低于此值跳过提取） */
  minOutputLength: number;
  /** 提取时的最大输出长度（截断） */
  maxOutputForExtraction: number;
  /** 事实总数上限 */
  maxFactsCount: number;
  /** 中等重要性事实显示数量上限 */
  maxMediumFactsDisplay: number;
  /** 最小事实陈述长度 */
  minFactStatementLength: number;
  /** 是否启用异步提取 */
  asyncExtraction: boolean;
  /** 用于事实提取的模型 */
  extractionModel: string;
}

export const DEFAULT_CONTEXT_EVOLUTION_CONFIG: ContextEvolutionConfig = {
  minOutputLength: 200,
  maxOutputForExtraction: 6000,
  maxFactsCount: 100,
  maxMediumFactsDisplay: 10,
  minFactStatementLength: 5,
  asyncExtraction: false,
  extractionModel: AIModelType.CHAT_FAST,
};

/**
 * 已确立的事实 - 在任务执行过程中被确定下来的信息
 *
 * 通用 domain entity，跨层共享（engine 抽取产出 → harness 编排消费 → engine 写作消费）。
 * Owner = ai-engine/knowledge/extraction（提取者层定义）。
 */
export interface EstablishedFact {
  id: string;
  sourceTaskId: string;
  sourceTaskTitle: string;
  establishedAt: string;
  statement: string;
  category:
    | "entity_state"
    | "sequence_point"
    | "decision"
    | "definition"
    | "relationship"
    | "constraint_added";
  relatedEntities?: string[];
  importance: "high" | "medium" | "low";
}

export const FACT_CATEGORIES = [
  "entity_state",
  "sequence_point",
  "decision",
  "definition",
  "relationship",
  "constraint_added",
] as const;

export const FACT_IMPORTANCE_LEVELS = ["high", "medium", "low"] as const;

/** 上下文状态（通用结构，适用于任何任务类型） */
export interface ContextState {
  version: string;
  generatedAt: string;
  generatedBy: string;
  establishedFacts: EstablishedFact[];
}

/** 事实提取请求 */
export interface FactExtractionRequest {
  taskId: string;
  taskTitle: string;
  taskOutput: string;
  existingFacts?: EstablishedFact[];
  existingEntities?: string[];
}

/** 事实提取结果 */
export interface FactExtractionResult {
  facts: EstablishedFact[];
  tokensUsed: number;
}

/** 研究上下文（持久化） */
export interface ResearchContext {
  id: string;
  topic: string;
  accumulatedKnowledge: {
    facts: string[];
    sources: Array<{ url: string; title: string; summary: string }>;
    insights: string[];
  };
  searchHistory: Array<{
    query: string;
    timestamp: Date;
    resultCount: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

/** 上下文演进服务接口 */
export interface IContextEvolutionService {
  extractFacts(
    request: FactExtractionRequest,
    aiCaller: AiCallerFn,
    config?: Partial<ContextEvolutionConfig>,
  ): Promise<FactExtractionResult>;

  mergeFacts(
    existingFacts: EstablishedFact[],
    newFacts: EstablishedFact[],
    config?: Partial<ContextEvolutionConfig>,
  ): EstablishedFact[];

  buildFactsPromptSection(
    facts: EstablishedFact[],
    config?: Partial<ContextEvolutionConfig>,
  ): string;
}
