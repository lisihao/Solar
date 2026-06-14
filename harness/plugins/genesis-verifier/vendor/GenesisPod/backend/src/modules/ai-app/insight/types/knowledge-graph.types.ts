/**
 * Knowledge Graph Types
 *
 * P0: 持久化知识图谱
 * 跨项目研究记忆，实体-关系图谱，支持知识积累和复用
 */

/**
 * 知识实体类型
 */
export enum EntityType {
  PERSON = "person",
  ORGANIZATION = "organization",
  TECHNOLOGY = "technology",
  CONCEPT = "concept",
  EVENT = "event",
  PRODUCT = "product",
  LOCATION = "location",
  REGULATION = "regulation",
  METRIC = "metric",
  TREND = "trend",
}

/**
 * 关系类型
 */
export enum RelationType {
  /** 属于 */
  BELONGS_TO = "belongs_to",
  /** 竞争 */
  COMPETES_WITH = "competes_with",
  /** 合作 */
  COLLABORATES_WITH = "collaborates_with",
  /** 影响 */
  INFLUENCES = "influences",
  /** 依赖 */
  DEPENDS_ON = "depends_on",
  /** 产生 */
  PRODUCES = "produces",
  /** 使用 */
  USES = "uses",
  /** 相关 */
  RELATED_TO = "related_to",
  /** 对立 */
  OPPOSES = "opposes",
  /** 驱动 */
  DRIVES = "drives",
  /** 源自 */
  DERIVED_FROM = "derived_from",
  /** 替代 */
  REPLACES = "replaces",
}

/**
 * 知识实体
 */
export interface KnowledgeEntity {
  id: string;
  /** 实体名称 */
  name: string;
  /** 实体类型 */
  type: EntityType;
  /** 实体描述 */
  description?: string;
  /** 别名列表 */
  aliases: string[];
  /** 属性键值对 */
  properties: Record<string, string | number | boolean>;
  /** 来源研究 ID 列表 */
  sourceTopicIds: string[];
  /** 证据 ID 列表 */
  evidenceIds: string[];
  /** 置信度 (0-1) */
  confidence: number;
  /** 首次发现时间 */
  firstSeen: Date;
  /** 最近更新时间 */
  lastUpdated: Date;
  /** 被引用次数（跨研究） */
  referenceCount: number;
}

/**
 * 知识关系
 */
export interface KnowledgeRelation {
  id: string;
  /** 源实体 ID */
  sourceEntityId: string;
  /** 目标实体 ID */
  targetEntityId: string;
  /** 关系类型 */
  type: RelationType;
  /** 关系描述 */
  description?: string;
  /** 关系强度 (0-1) */
  strength: number;
  /** 来源研究 ID */
  sourceTopicId: string;
  /** 证据 ID 列表 */
  evidenceIds: string[];
  /** 置信度 (0-1) */
  confidence: number;
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 知识图谱查询选项
 */
export interface KnowledgeGraphQueryOptions {
  /** 实体类型过滤 */
  entityTypes?: EntityType[];
  /** 关系类型过滤 */
  relationTypes?: RelationType[];
  /** 最小置信度 */
  minConfidence?: number;
  /** 限定研究范围 */
  topicIds?: string[];
  /** 用户 ID */
  userId?: string;
  /** 最大深度（跳数） */
  maxDepth?: number;
  /** 最大结果数 */
  limit?: number;
}

/**
 * 知识图谱子图（查询结果）
 */
export interface KnowledgeSubgraph {
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
  metadata: {
    queryTime: number;
    totalEntities: number;
    totalRelations: number;
  };
}

/**
 * 实体提取请求
 */
export interface EntityExtractionRequest {
  /** 文本内容 */
  content: string;
  /** 来源研究 ID */
  topicId: string;
  /** 证据 ID */
  evidenceId?: string;
  /** 上下文提示 */
  contextHint?: string;
}

/**
 * 实体提取结果
 */
export interface EntityExtractionResult {
  entities: Array<{
    name: string;
    type: EntityType;
    description: string;
    confidence: number;
    aliases: string[];
    properties: Record<string, string | number | boolean>;
  }>;
  relations: Array<{
    sourceName: string;
    targetName: string;
    type: RelationType;
    description: string;
    strength: number;
    confidence: number;
  }>;
}

/**
 * 知识图谱统计
 */
export interface KnowledgeGraphStats {
  totalEntities: number;
  totalRelations: number;
  entityTypeDistribution: Record<EntityType, number>;
  relationTypeDistribution: Record<RelationType, number>;
  topConnectedEntities: Array<{
    entity: KnowledgeEntity;
    connectionCount: number;
  }>;
  recentUpdates: number;
}
