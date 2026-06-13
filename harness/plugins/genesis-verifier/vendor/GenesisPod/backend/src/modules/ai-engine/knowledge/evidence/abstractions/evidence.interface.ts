/**
 * Evidence Interface
 * 证据管理抽象接口
 */

import { EvidenceType as PrismaEvidenceType } from "@prisma/client";

/**
 * 证据类型 - 使用 Prisma 生成的枚举
 * 值：CITATION, REFERENCE, INSPIRATION, FACT, QUOTE
 */
export type EvidenceType = PrismaEvidenceType;

/**
 * 引用格式
 */
export type CitationStyle = "apa" | "mla" | "chicago" | "harvard" | "ieee";

/**
 * 证据记录
 */
export interface Evidence {
  id: string;
  type: EvidenceType;

  // 来源信息
  source: {
    url?: string;
    title: string;
    author?: string;
    publishedAt?: Date;
    domain?: string;
    publisher?: string;
  };

  // 内容信息
  content: {
    original: string; // 原始内容
    snippet?: string; // 摘要片段
    usedPortion?: string; // 使用的部分
  };

  // 关联信息
  associations: {
    entityType: string; // 关联实体类型 (report, chapter, dimension)
    entityId: string; // 关联实体 ID
    location?: string; // 在实体中的位置
    context?: string; // 使用上下文
  };

  // 元数据
  metadata: {
    relevanceScore: number; // 相关性评分 (0-1)
    credibilityScore?: number; // 可信度评分 (0-1)
    citationCount: number; // 被引用次数
    createdAt: Date;
    updatedAt: Date;
    createdBy?: string;
  };
}

/**
 * 证据存储请求
 */
export interface SaveEvidenceRequest {
  type: EvidenceType;
  source: Evidence["source"];
  content: Evidence["content"];
  associations: Evidence["associations"];
  relevanceScore?: number;
  credibilityScore?: number;
  createdBy?: string;
}

/**
 * 证据检索请求
 */
export interface RetrieveEvidenceRequest {
  entityType?: string;
  entityId?: string;
  types?: EvidenceType[];
  minRelevanceScore?: number;
  minCredibilityScore?: number;
  limit?: number;
  offset?: number;
  sortBy?: "relevance" | "credibility" | "createdAt";
  sortOrder?: "asc" | "desc";
}

/**
 * 证据统计
 */
export interface EvidenceStats {
  totalCount: number;
  byType: Record<EvidenceType, number>;
  avgRelevanceScore: number;
  avgCredibilityScore: number;
}

/**
 * 证据管理器接口
 */
export interface IEvidenceManager {
  /**
   * 保存证据
   */
  save(request: SaveEvidenceRequest): Promise<Evidence>;

  /**
   * 批量保存
   */
  saveBatch(requests: SaveEvidenceRequest[]): Promise<Evidence[]>;

  /**
   * 检索证据
   */
  retrieve(request: RetrieveEvidenceRequest): Promise<Evidence[]>;

  /**
   * 获取单条证据
   */
  getById(id: string): Promise<Evidence | null>;

  /**
   * 更新证据
   */
  update(id: string, updates: Partial<Evidence>): Promise<Evidence>;

  /**
   * 删除证据
   */
  delete(id: string): Promise<void>;

  /**
   * 增加引用计数
   */
  incrementCitationCount(id: string): Promise<void>;

  /**
   * 获取实体的证据统计
   */
  getStats(entityType: string, entityId: string): Promise<EvidenceStats>;

  /**
   * 生成引用格式
   */
  formatCitation(evidence: Evidence, style: CitationStyle): string;

  /**
   * 批量生成引用
   */
  generateBibliography(
    entityType: string,
    entityId: string,
    style: CitationStyle,
  ): Promise<string>;
}
