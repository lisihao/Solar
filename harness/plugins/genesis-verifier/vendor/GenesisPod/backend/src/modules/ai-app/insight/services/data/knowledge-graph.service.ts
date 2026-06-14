/**
 * Knowledge Graph Service
 *
 * P0: 持久化知识图谱
 * 跨项目研究记忆，自动提取实体和关系，支持知识积累和复用
 *
 * 核心功能：
 * 1. 从研究内容中自动提取实体和关系
 * 2. 持久化存储（通过 Prisma/JSON 存储）
 * 3. 跨项目知识查询和复用
 * 4. 实体去重和合并
 * 5. 知识图谱统计和可视化数据
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import {
  EntityType,
  RelationType,
  KnowledgeEntity,
  KnowledgeRelation,
  KnowledgeGraphQueryOptions,
  KnowledgeSubgraph,
  EntityExtractionRequest,
  EntityExtractionResult,
  KnowledgeGraphStats,
} from "../../types/knowledge-graph.types";

@Injectable()
export class TopicInsightsKnowledgeGraphService {
  private readonly logger = new Logger(TopicInsightsKnowledgeGraphService.name);

  /** 内存缓存（可后续迁移至图数据库） */
  private readonly entities = new Map<string, KnowledgeEntity>();
  private readonly relations: KnowledgeRelation[] = [];

  /** 实体名称索引（用于快速去重） */
  private readonly entityNameIndex = new Map<string, string>();

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 从文本中提取实体和关系
   */
  async extractEntities(
    request: EntityExtractionRequest,
  ): Promise<EntityExtractionResult> {
    this.logger.log(
      `[extractEntities] Extracting from content (${request.content.length} chars) for topic ${request.topicId}`,
    );

    try {
      const response = await this.chatFacade.chatWithSkills({
        messages: [
          {
            role: "system",
            content:
              "You are a knowledge graph extraction specialist. Extract entities and relationships from research content. Return valid JSON only.",
          },
          {
            role: "user",
            content: `Extract entities and relationships from the following research content:\n\n${request.content.slice(0, 4000)}${request.contextHint ? `\n\nContext: ${request.contextHint}` : ""}`,
          },
        ],
        operationName: "知识图谱",
        additionalSkills: ["entity-extraction"],
        modelType: AIModelType.CHAT,
        skipGuardrails: true, // 内部系统调用，知识图谱提取
        cachePolicy: "auto",
        taskProfile: { creativity: "deterministic", outputLength: "medium" },
        responseFormat: "json",
      });

      const result = this.parseExtractionResult(response.content || "");

      // 持久化提取的实体和关系
      await this.persistExtraction(result, request.topicId, request.evidenceId);

      return result;
    } catch (error) {
      this.logger.error(`[extractEntities] Failed: ${error}`);
      return { entities: [], relations: [] };
    }
  }

  /**
   * 添加或更新实体
   */
  addEntity(entity: KnowledgeEntity): string {
    // 检查是否有同名实体（去重）
    const normalizedName = entity.name.toLowerCase().trim();
    const existingId = this.entityNameIndex.get(normalizedName);

    if (existingId) {
      const existing = this.entities.get(existingId);
      if (existing) {
        // 合并实体信息
        this.mergeEntity(existing, entity);
        return existingId;
      }
    }

    // 检查别名是否匹配已有实体
    for (const alias of entity.aliases) {
      const aliasNorm = alias.toLowerCase().trim();
      const aliasId = this.entityNameIndex.get(aliasNorm);
      if (aliasId) {
        const existing = this.entities.get(aliasId);
        if (existing) {
          this.mergeEntity(existing, entity);
          return aliasId;
        }
      }
    }

    // 创建新实体
    this.entities.set(entity.id, entity);
    this.entityNameIndex.set(normalizedName, entity.id);
    for (const alias of entity.aliases) {
      this.entityNameIndex.set(alias.toLowerCase().trim(), entity.id);
    }

    return entity.id;
  }

  /**
   * 添加关系
   */
  addRelation(relation: KnowledgeRelation): void {
    // 检查是否已存在相同关系
    const exists = this.relations.some(
      (r) =>
        r.sourceEntityId === relation.sourceEntityId &&
        r.targetEntityId === relation.targetEntityId &&
        r.type === relation.type,
    );

    if (!exists) {
      this.relations.push(relation);
    }
  }

  /**
   * 查询知识图谱
   */
  query(options: KnowledgeGraphQueryOptions): KnowledgeSubgraph {
    const start = Date.now();

    let filteredEntities = Array.from(this.entities.values());

    // 按实体类型过滤
    if (options.entityTypes?.length) {
      filteredEntities = filteredEntities.filter((e) =>
        options.entityTypes!.includes(e.type),
      );
    }

    // 按置信度过滤
    if (options.minConfidence) {
      filteredEntities = filteredEntities.filter(
        (e) => e.confidence >= options.minConfidence!,
      );
    }

    // 按研究范围过滤
    if (options.topicIds?.length) {
      filteredEntities = filteredEntities.filter((e) =>
        e.sourceTopicIds.some((id) => options.topicIds!.includes(id)),
      );
    }

    // 限制结果数
    if (options.limit) {
      filteredEntities = filteredEntities.slice(0, options.limit);
    }

    // 获取相关关系
    const entityIds = new Set(filteredEntities.map((e) => e.id));
    let filteredRelations = this.relations.filter(
      (r) => entityIds.has(r.sourceEntityId) || entityIds.has(r.targetEntityId),
    );

    // 按关系类型过滤
    if (options.relationTypes?.length) {
      filteredRelations = filteredRelations.filter((r) =>
        options.relationTypes!.includes(r.type),
      );
    }

    return {
      entities: filteredEntities,
      relations: filteredRelations,
      metadata: {
        queryTime: Date.now() - start,
        totalEntities: filteredEntities.length,
        totalRelations: filteredRelations.length,
      },
    };
  }

  /**
   * 查找与查询相关的已有知识
   */
  findRelatedKnowledge(query: string, topicId?: string): KnowledgeSubgraph {
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/);

    // 模糊匹配实体名称
    const matchedEntities = Array.from(this.entities.values()).filter(
      (entity) => {
        const nameLower = entity.name.toLowerCase();
        return (
          queryTerms.some((term) => nameLower.includes(term)) ||
          entity.aliases.some((alias) =>
            queryTerms.some((term) => alias.toLowerCase().includes(term)),
          )
        );
      },
    );

    // 排除当前研究的实体（避免重复）
    const crossProjectEntities = topicId
      ? matchedEntities.filter(
          (e) =>
            e.sourceTopicIds.length > 1 || !e.sourceTopicIds.includes(topicId),
        )
      : matchedEntities;

    const entityIds = new Set(crossProjectEntities.map((e) => e.id));
    const relatedRelations = this.relations.filter(
      (r) => entityIds.has(r.sourceEntityId) || entityIds.has(r.targetEntityId),
    );

    return {
      entities: crossProjectEntities.slice(0, 20),
      relations: relatedRelations,
      metadata: {
        queryTime: 0,
        totalEntities: crossProjectEntities.length,
        totalRelations: relatedRelations.length,
      },
    };
  }

  /**
   * 获取统计信息
   */
  getStats(): KnowledgeGraphStats {
    const entities = Array.from(this.entities.values());

    // 实体类型分布
    const entityTypeDistribution = {} as Record<EntityType, number>;
    for (const entity of entities) {
      entityTypeDistribution[entity.type] =
        (entityTypeDistribution[entity.type] || 0) + 1;
    }

    // 关系类型分布
    const relationTypeDistribution = {} as Record<RelationType, number>;
    for (const relation of this.relations) {
      relationTypeDistribution[relation.type] =
        (relationTypeDistribution[relation.type] || 0) + 1;
    }

    // 连接数最多的实体
    const connectionCount = new Map<string, number>();
    for (const relation of this.relations) {
      connectionCount.set(
        relation.sourceEntityId,
        (connectionCount.get(relation.sourceEntityId) || 0) + 1,
      );
      connectionCount.set(
        relation.targetEntityId,
        (connectionCount.get(relation.targetEntityId) || 0) + 1,
      );
    }

    const topConnected = Array.from(connectionCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([entityId, count]) => ({
        entity: this.entities.get(entityId)!,
        connectionCount: count,
      }))
      .filter((item) => item.entity);

    return {
      totalEntities: entities.length,
      totalRelations: this.relations.length,
      entityTypeDistribution,
      relationTypeDistribution,
      topConnectedEntities: topConnected,
      recentUpdates: entities.filter(
        (e) => Date.now() - e.lastUpdated.getTime() < 24 * 60 * 60 * 1000,
      ).length,
    };
  }

  /**
   * 清除知识图谱
   */
  clear(): void {
    this.entities.clear();
    this.relations.length = 0;
    this.entityNameIndex.clear();
  }

  // =========================================================================
  // 内部方法
  // =========================================================================

  private mergeEntity(
    existing: KnowledgeEntity,
    incoming: KnowledgeEntity,
  ): void {
    // 合并来源研究
    for (const topicId of incoming.sourceTopicIds) {
      if (!existing.sourceTopicIds.includes(topicId)) {
        existing.sourceTopicIds.push(topicId);
      }
    }

    // 合并证据
    for (const evidenceId of incoming.evidenceIds) {
      if (!existing.evidenceIds.includes(evidenceId)) {
        existing.evidenceIds.push(evidenceId);
      }
    }

    // 合并别名
    for (const alias of incoming.aliases) {
      if (!existing.aliases.includes(alias)) {
        existing.aliases.push(alias);
        this.entityNameIndex.set(alias.toLowerCase().trim(), existing.id);
      }
    }

    // 合并属性
    Object.assign(existing.properties, incoming.properties);

    // 更新置信度（取更高值）
    existing.confidence = Math.max(existing.confidence, incoming.confidence);

    // 更新引用计数
    existing.referenceCount++;

    // 更新时间
    existing.lastUpdated = new Date();
  }

  private async persistExtraction(
    result: EntityExtractionResult,
    topicId: string,
    evidenceId?: string,
  ): Promise<void> {
    const now = new Date();

    for (const rawEntity of result.entities) {
      const id = this.generateId();
      const entity: KnowledgeEntity = {
        id,
        name: rawEntity.name,
        type: rawEntity.type,
        description: rawEntity.description,
        aliases: rawEntity.aliases,
        properties: rawEntity.properties,
        sourceTopicIds: [topicId],
        evidenceIds: evidenceId ? [evidenceId] : [],
        confidence: rawEntity.confidence,
        firstSeen: now,
        lastUpdated: now,
        referenceCount: 1,
      };

      this.addEntity(entity);
    }

    // 解析关系中的实体名称到 ID
    for (const rawRelation of result.relations) {
      const sourceId = this.entityNameIndex.get(
        rawRelation.sourceName.toLowerCase().trim(),
      );
      const targetId = this.entityNameIndex.get(
        rawRelation.targetName.toLowerCase().trim(),
      );

      if (sourceId && targetId) {
        this.addRelation({
          id: this.generateId(),
          sourceEntityId: sourceId,
          targetEntityId: targetId,
          type: rawRelation.type,
          description: rawRelation.description,
          strength: rawRelation.strength,
          sourceTopicId: topicId,
          evidenceIds: evidenceId ? [evidenceId] : [],
          confidence: rawRelation.confidence,
          createdAt: now,
        });
      }
    }
  }

  private parseExtractionResult(content: string): EntityExtractionResult {
    try {
      // 提取 JSON 块
      const jsonMatch =
        content.match(/```json\s*([\s\S]*?)```/) ||
        content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { entities: [], relations: [] };
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      return {
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      };
    } catch {
      this.logger.warn("[parseExtractionResult] Failed to parse AI response");
      return { entities: [], relations: [] };
    }
  }

  private generateId(): string {
    return `kg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
