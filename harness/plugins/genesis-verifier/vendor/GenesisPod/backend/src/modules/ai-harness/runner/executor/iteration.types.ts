/**
 * Iteration Manager Types
 *
 * 2026-05-01 (PR-X-O): 从 interfaces.ts 拆出。
 */

/** 结构化输出部分 */
export interface OutputSection {
  id: string;
  title: string;
  content: string;
  level: number;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

/** 结构化输出 */
export interface StructuredOutput {
  id: string;
  version: number;
  title: string;
  summary?: string;
  sections: OutputSection[];
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

/** 迭代请求类型 */
export type IterationRequestType =
  | "partial_update"
  | "section_expand"
  | "section_rewrite"
  | "add_section"
  | "refresh"
  | "full_update";

/** 迭代请求 */
export interface IterationRequest {
  type: IterationRequestType;
  outputId: string;
  sectionIds?: string[];
  userInstruction?: string;
  searchKeywords?: string[];
  newSection?: {
    title: string;
    afterSectionId?: string;
    description?: string;
  };
}

/** 迭代结果 */
export interface IterationResult {
  success: boolean;
  output: StructuredOutput;
  changedSectionIds: string[];
  changeSummary: string;
  tokensUsed: number;
  error?: string;
}

/** 研究上下文（持久化） — 注：与 ai-engine/knowledge/extraction 同名 type 是 alias */
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

/** 迭代管理服务接口 */
export interface IIterationManagerService {
  executeIteration(
    request: IterationRequest,
    context: ResearchContext,
  ): Promise<IterationResult>;

  getVersionHistory(outputId: string): Promise<StructuredOutput[]>;

  compareVersions(
    outputId: string,
    version1: number,
    version2: number,
  ): Promise<{
    added: OutputSection[];
    removed: OutputSection[];
    modified: Array<{
      sectionId: string;
      before: string;
      after: string;
    }>;
  }>;

  getOrCreateResearchContext(topic: string): Promise<ResearchContext>;

  updateResearchContext(
    contextId: string,
    updates: Partial<ResearchContext>,
  ): Promise<ResearchContext>;
}
