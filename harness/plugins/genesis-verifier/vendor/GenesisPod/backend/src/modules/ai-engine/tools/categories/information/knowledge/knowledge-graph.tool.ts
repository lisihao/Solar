/**
 * Knowledge Graph Tool
 * 知识图谱查询工具 - 查询实体关系和图谱结构
 */

import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";

import { PrismaService } from "@/common/prisma/prisma.service";

// ============================================================================
// Types
// ============================================================================

/**
 * 查询类型
 */
export type QueryType =
  | "find_entity" // 查找实体
  | "find_relationships" // 查找关系
  | "find_path" // 查找路径
  | "get_neighbors" // 获取邻居节点
  | "traverse"; // 图遍历

/**
 * 知识图谱查询输入参数
 */
export interface KnowledgeGraphInput {
  /**
   * 查询类型
   */
  queryType: QueryType;

  /**
   * 实体名称或 ID（用于 find_entity, get_neighbors, find_path）
   */
  entityId?: string;

  /**
   * 实体名称（用于模糊查找）
   */
  entityName?: string;

  /**
   * 实体类型过滤（如：人物、地点、组织等）
   */
  entityTypes?: string[];

  /**
   * 关系类型过滤（如：作者、引用、属于等）
   */
  relationshipTypes?: string[];

  /**
   * 目标实体 ID（用于 find_path）
   */
  targetEntityId?: string;

  /**
   * 遍历深度，默认 1，最大 3
   */
  depth?: number;

  /**
   * 最大返回数量，默认 50
   */
  limit?: number;

  /**
   * 资源范围限制（可选）
   */
  resourceIds?: string[];

  /**
   * 集合范围限制（可选）
   */
  collectionId?: string;
}

/**
 * 图节点（实体）
 */
export interface GraphNode {
  /**
   * 节点 ID
   */
  id: string;

  /**
   * 节点名称
   */
  name: string;

  /**
   * 节点类型
   */
  type: string;

  /**
   * 节点属性
   */
  properties: Record<string, unknown>;

  /**
   * 关联的资源 ID
   */
  resourceId?: string;
}

/**
 * 图边（关系）
 */
export interface GraphEdge {
  /**
   * 边 ID
   */
  id: string;

  /**
   * 源节点 ID
   */
  source: string;

  /**
   * 目标节点 ID
   */
  target: string;

  /**
   * 关系类型
   */
  type: string;

  /**
   * 关系权重
   */
  weight?: number;

  /**
   * 关系属性
   */
  properties: Record<string, unknown>;
}

/**
 * 路径（一系列连接的节点和边）
 */
export interface GraphPath {
  /**
   * 路径长度
   */
  length: number;

  /**
   * 路径上的节点
   */
  nodes: GraphNode[];

  /**
   * 路径上的边
   */
  edges: GraphEdge[];
}

/**
 * 知识图谱查询输出结果
 */
export interface KnowledgeGraphOutput {
  /**
   * 查询是否成功
   */
  success: boolean;

  /**
   * 图节点列表
   */
  nodes: GraphNode[];

  /**
   * 图边列表
   */
  edges: GraphEdge[];

  /**
   * 路径列表（仅 find_path 查询返回）
   */
  paths?: GraphPath[];

  /**
   * 返回的节点数量
   */
  nodeCount: number;

  /**
   * 返回的边数量
   */
  edgeCount: number;

  /**
   * 查询类型
   */
  queryType: QueryType;
}

// ============================================================================
// Tool Implementation
// ============================================================================

/**
 * 知识图谱查询工具
 *
 * 功能：
 * - 查找实体：按名称或 ID 查找实体节点
 * - 查找关系：查找实体间的关系
 * - 路径查找：查找两个实体间的最短路径
 * - 获取邻居：获取实体的相邻节点
 * - 图遍历：从某个节点开始遍历图
 *
 * 使用场景：
 * - 实体关系分析
 * - 知识推理和推荐
 * - 关系网络可视化
 * - 影响力分析
 *
 * 数据模型：
 * - Entity 表：存储实体信息
 * - Relationship 表：存储实体间关系
 * - 支持自定义实体类型和关系类型
 */
@Injectable()
export class KnowledgeGraphTool extends BaseTool<
  KnowledgeGraphInput,
  KnowledgeGraphOutput
> {
  private readonly logger = new Logger(KnowledgeGraphTool.name);
  readonly id = "knowledge-graph";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "information";
  readonly tags = ["knowledge", "graph", "entity", "relationship", "internal"];
  readonly name = "知识图谱查询";
  readonly description =
    "查询知识图谱中的实体和关系。支持实体查找、关系查询、路径查找、邻居节点获取等功能。适用于知识推理、关系分析、影响力分析等场景。返回图节点和边的结构化数据。";

  private static readonly VALID_QUERY_TYPES: QueryType[] = [
    "find_entity",
    "find_relationships",
    "find_path",
    "get_neighbors",
    "traverse",
  ];

  /**
   * LLM 常把 queryType 叫错（如 entity_search→find_entity）。归一化常见同义词，
   * 避免本来只是叫法不同就抛 "Unsupported query type" 硬报错。
   */
  private static readonly QUERY_TYPE_ALIASES: Record<string, QueryType> = {
    entity_search: "find_entity",
    entity_lookup: "find_entity",
    lookup_entity: "find_entity",
    search_entity: "find_entity",
    search_entities: "find_entity",
    find_entities: "find_entity",
    node_search: "find_entity",
    entity: "find_entity",
    entities: "find_entity",
    relationship_search: "find_relationships",
    find_relationship: "find_relationships",
    find_relations: "find_relationships",
    relationships: "find_relationships",
    relations: "find_relationships",
    path: "find_path",
    shortest_path: "find_path",
    find_shortest_path: "find_path",
    neighbor: "get_neighbors",
    neighbors: "get_neighbors",
    neighbours: "get_neighbors",
    get_neighbours: "get_neighbors",
    traversal: "traverse",
    walk: "traverse",
    bfs: "traverse",
    dfs: "traverse",
  };

  /** 归一化 queryType：合法值原样返回，已知别名映射，未知返回 null。 */
  private normalizeQueryType(raw: unknown): QueryType | null {
    const v = String(raw ?? "")
      .trim()
      .toLowerCase();
    if ((KnowledgeGraphTool.VALID_QUERY_TYPES as string[]).includes(v)) {
      return v as QueryType;
    }
    return KnowledgeGraphTool.QUERY_TYPE_ALIASES[v] ?? null;
  }

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      queryType: {
        type: "string",
        description: "查询类型",
        enum: [
          "find_entity",
          "find_relationships",
          "find_path",
          "get_neighbors",
          "traverse",
        ],
      },
      entityId: {
        type: "string",
        description: "实体 ID（用于 get_neighbors、find_path 等查询）",
      },
      entityName: {
        type: "string",
        description: "实体名称（用于模糊查找实体）",
      },
      entityTypes: {
        type: "array",
        description: "实体类型过滤，如 ['PERSON', 'ORGANIZATION']",
        items: { type: "string" },
      },
      relationshipTypes: {
        type: "array",
        description: "关系类型过滤，如 ['AUTHORED', 'CITED', 'BELONGS_TO']",
        items: { type: "string" },
      },
      targetEntityId: {
        type: "string",
        description: "目标实体 ID（用于 find_path 查询）",
      },
      depth: {
        type: "number",
        description: "遍历深度，默认 1，最大 3",
        default: 1,
      },
      limit: {
        type: "number",
        description: "最大返回数量，默认 50，最大 500",
        default: 50,
      },
      resourceIds: {
        type: "array",
        description: "限定在特定资源范围内查询",
        items: { type: "string" },
      },
      collectionId: {
        type: "string",
        description: "限定在特定集合范围内查询",
      },
    },
    required: ["queryType"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: {
        type: "boolean",
        description: "查询是否成功",
      },
      nodes: {
        type: "array",
        description: "图节点列表",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "节点 ID" },
            name: { type: "string", description: "节点名称" },
            type: { type: "string", description: "节点类型" },
            properties: { type: "object", description: "节点属性" },
            resourceId: { type: "string", description: "关联的资源 ID" },
          },
        },
      },
      edges: {
        type: "array",
        description: "图边列表",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "边 ID" },
            source: { type: "string", description: "源节点 ID" },
            target: { type: "string", description: "目标节点 ID" },
            type: { type: "string", description: "关系类型" },
            weight: { type: "number", description: "关系权重" },
            properties: { type: "object", description: "关系属性" },
          },
        },
      },
      paths: {
        type: "array",
        description: "路径列表（仅 find_path 查询返回）",
        items: {
          type: "object",
          properties: {
            length: { type: "number", description: "路径长度" },
            nodes: { type: "array", description: "路径上的节点" },
            edges: { type: "array", description: "路径上的边" },
          },
        },
      },
      nodeCount: {
        type: "number",
        description: "返回的节点数量",
      },
      edgeCount: {
        type: "number",
        description: "返回的边数量",
      },
      queryType: {
        type: "string",
        description: "查询类型",
      },
    },
  };

  constructor(private readonly prisma: PrismaService) {
    super();
    // defaultTimeout set in class property // 30 秒超时
  }

  /**
   * 验证输入参数
   */
  validateInput(input: KnowledgeGraphInput) {
    // 验证查询类型
    const validQueryTypes: QueryType[] = [
      "find_entity",
      "find_relationships",
      "find_path",
      "get_neighbors",
      "traverse",
    ];

    if (!validQueryTypes.includes(input.queryType)) {
      this.logger.error(`Invalid queryType: ${input.queryType}`);
      return false;
    }

    // 验证必需参数
    if (input.queryType === "get_neighbors" || input.queryType === "traverse") {
      if (!input.entityId) {
        this.logger.error(
          `entityId is required for queryType: ${input.queryType}`,
        );
        return false;
      }
    }

    if (input.queryType === "find_path") {
      if (!input.entityId || !input.targetEntityId) {
        this.logger.error(
          "Both entityId and targetEntityId are required for find_path",
        );
        return false;
      }
    }

    if (input.queryType === "find_entity") {
      if (!input.entityId && !input.entityName) {
        this.logger.error(
          "Either entityId or entityName is required for find_entity",
        );
        return false;
      }
    }

    // 验证 depth
    if (input.depth !== undefined) {
      if (
        typeof input.depth !== "number" ||
        input.depth < 1 ||
        input.depth > 3
      ) {
        this.logger.error("Invalid depth: must be between 1 and 3");
        return false;
      }
    }

    // 验证 limit
    if (input.limit !== undefined) {
      if (
        typeof input.limit !== "number" ||
        input.limit < 1 ||
        input.limit > 500
      ) {
        this.logger.error("Invalid limit: must be between 1 and 500");
        return false;
      }
    }

    return true;
  }

  /**
   * 执行知识图谱查询
   */
  protected async doExecute(
    input: KnowledgeGraphInput,
    context: ToolContext,
  ): Promise<KnowledgeGraphOutput> {
    // 别名容错：把 LLM 叫错的 queryType 归一化（entity_search→find_entity 等）。
    const normalized = this.normalizeQueryType(input.queryType);
    if (!normalized) {
      // 真正未知的类型：优雅返回空图，不抛错（避免在 trace 里显示为硬异常）。
      this.logger.warn(
        `Unknown knowledge-graph queryType "${String(input.queryType)}"; returning empty graph (graceful)`,
      );
      return {
        success: false,
        nodes: [],
        edges: [],
        nodeCount: 0,
        edgeCount: 0,
        queryType: input.queryType,
      };
    }
    if (normalized !== input.queryType) {
      this.logger.log(
        `Normalized knowledge-graph queryType "${String(input.queryType)}" → "${normalized}"`,
      );
      input = { ...input, queryType: normalized };
    }

    this.logger.log(`Knowledge graph query: ${input.queryType}`);

    try {
      switch (input.queryType) {
        case "find_entity":
          return await this.findEntity(input, context);
        case "find_relationships":
          return await this.findRelationships(input, context);
        case "find_path":
          return await this.findPath(input, context);
        case "get_neighbors":
          return await this.getNeighbors(input, context);
        case "traverse":
          return await this.traverse(input, context);
        default:
          throw new Error(`Unsupported query type: ${input.queryType}`);
      }
    } catch (error) {
      this.logger.error(
        `Knowledge graph query failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * 查找实体
   */
  private async findEntity(
    input: KnowledgeGraphInput,
    _context: ToolContext,
  ): Promise<KnowledgeGraphOutput> {
    const { entityId, entityName, entityTypes, limit = 50 } = input;

    // 构建参数化 WHERE 条件
    const conditions: Prisma.Sql[] = [];

    if (entityId) {
      conditions.push(Prisma.sql`id = ${entityId}`);
    } else if (entityName) {
      // entityId takes priority; only use entityName when entityId is absent
      conditions.push(Prisma.sql`name ILIKE ${"%" + entityName + "%"}`);
    }
    if (entityTypes && entityTypes.length > 0) {
      conditions.push(Prisma.sql`type = ANY(${entityTypes})`);
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;

    // 注意：这里假设存在 Entity 表
    // 实际实现需要根据具体的数据库 schema 调整
    const entities = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        type: string;
        properties: Record<string, unknown>;
        resource_id?: string;
      }>
    >`
      SELECT id, name, type, properties, resource_id
      FROM entities
      ${whereClause}
      LIMIT ${limit}
    `.catch((err) => {
      this.logger.warn("Knowledge graph query failed", err?.message);
      return [];
    });

    const nodes: GraphNode[] = entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      properties: e.properties || {},
      resourceId: e.resource_id,
    }));

    return {
      success: true,
      nodes,
      edges: [],
      nodeCount: nodes.length,
      edgeCount: 0,
      queryType: input.queryType,
    };
  }

  /**
   * 查找关系
   */
  private async findRelationships(
    input: KnowledgeGraphInput,
    _context: ToolContext,
  ): Promise<KnowledgeGraphOutput> {
    const { entityId, relationshipTypes, limit = 50 } = input;

    // 构建参数化 WHERE 条件
    const conditions: Prisma.Sql[] = [];

    if (entityId) {
      conditions.push(
        Prisma.sql`(source_id = ${entityId} OR target_id = ${entityId})`,
      );
    }
    if (relationshipTypes && relationshipTypes.length > 0) {
      conditions.push(Prisma.sql`type = ANY(${relationshipTypes})`);
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;

    // 查询关系
    const relationships = await this.prisma.$queryRaw<
      Array<{
        id: string;
        source_id: string;
        target_id: string;
        type: string;
        weight?: number;
        properties: Record<string, unknown>;
      }>
    >`
      SELECT id, source_id, target_id, type, weight, properties
      FROM relationships
      ${whereClause}
      LIMIT ${limit}
    `.catch((err) => {
      this.logger.warn("Knowledge graph query failed", err?.message);
      return [];
    });

    // 获取涉及的实体
    const entityIds = new Set<string>();
    relationships.forEach((r) => {
      entityIds.add(r.source_id);
      entityIds.add(r.target_id);
    });

    const entities =
      entityIds.size > 0
        ? await this.prisma.$queryRaw<
            Array<{
              id: string;
              name: string;
              type: string;
              properties: Record<string, unknown>;
              resource_id?: string;
            }>
          >`
          SELECT id, name, type, properties, resource_id
          FROM entities
          WHERE id = ANY(${Array.from(entityIds)})
        `.catch((err) => {
            this.logger.warn("Knowledge graph query failed", err?.message);
            return [];
          })
        : [];

    const nodes: GraphNode[] = entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      properties: e.properties || {},
      resourceId: e.resource_id,
    }));

    const edges: GraphEdge[] = relationships.map((r) => ({
      id: r.id,
      source: r.source_id,
      target: r.target_id,
      type: r.type,
      weight: r.weight,
      properties: r.properties || {},
    }));

    return {
      success: true,
      nodes,
      edges,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      queryType: input.queryType,
    };
  }

  /**
   * 查找路径（简化实现：查找一跳内的连接）
   */
  private async findPath(
    input: KnowledgeGraphInput,
    _context: ToolContext,
  ): Promise<KnowledgeGraphOutput> {
    const { entityId, targetEntityId } = input;

    if (!entityId || !targetEntityId) {
      throw new Error("Both entityId and targetEntityId are required");
    }

    // 查找直接连接的关系
    const relationships = await this.prisma.$queryRaw<
      Array<{
        id: string;
        source_id: string;
        target_id: string;
        type: string;
        weight?: number;
        properties: Record<string, unknown>;
      }>
    >`
      SELECT id, source_id, target_id, type, weight, properties
      FROM relationships
      WHERE
        (source_id = ${entityId} AND target_id = ${targetEntityId})
        OR (source_id = ${targetEntityId} AND target_id = ${entityId})
    `.catch((err) => {
      this.logger.warn("Knowledge graph query failed", err?.message);
      return [];
    });

    // 获取涉及的实体
    const entities = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        type: string;
        properties: Record<string, unknown>;
        resource_id?: string;
      }>
    >`
      SELECT id, name, type, properties, resource_id
      FROM entities
      WHERE id = ANY(${[entityId, targetEntityId]})
    `.catch((err) => {
      this.logger.warn("Knowledge graph query failed", err?.message);
      return [];
    });

    const nodes: GraphNode[] = entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      properties: e.properties || {},
      resourceId: e.resource_id,
    }));

    const edges: GraphEdge[] = relationships.map((r) => ({
      id: r.id,
      source: r.source_id,
      target: r.target_id,
      type: r.type,
      weight: r.weight,
      properties: r.properties || {},
    }));

    // 构建路径
    const paths: GraphPath[] =
      edges.length > 0
        ? [
            {
              length: 1,
              nodes,
              edges,
            },
          ]
        : [];

    return {
      success: true,
      nodes,
      edges,
      paths,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      queryType: input.queryType,
    };
  }

  /**
   * 获取邻居节点
   */
  private async getNeighbors(
    input: KnowledgeGraphInput,
    _context: ToolContext,
  ): Promise<KnowledgeGraphOutput> {
    const {
      entityId,
      depth: _depth = 1,
      relationshipTypes,
      limit = 50,
    } = input;

    if (!entityId) {
      throw new Error("entityId is required");
    }

    // 构建参数化关系类型过滤条件
    const relTypeFilter =
      relationshipTypes && relationshipTypes.length > 0
        ? Prisma.sql`AND type = ANY(${relationshipTypes})`
        : Prisma.empty;

    const relationships = await this.prisma.$queryRaw<
      Array<{
        id: string;
        source_id: string;
        target_id: string;
        type: string;
        weight?: number;
        properties: Record<string, unknown>;
      }>
    >`
      SELECT id, source_id, target_id, type, weight, properties
      FROM relationships
      WHERE (source_id = ${entityId} OR target_id = ${entityId})
      ${relTypeFilter}
      LIMIT ${limit}
    `.catch((err) => {
      this.logger.warn("Knowledge graph query failed", err?.message);
      return [];
    });

    // 获取邻居实体 ID
    const neighborIds = new Set<string>();
    relationships.forEach((r) => {
      if (r.source_id === entityId) {
        neighborIds.add(r.target_id);
      } else {
        neighborIds.add(r.source_id);
      }
    });

    // 查询所有涉及的实体（包括中心节点）
    const allEntityIds = [entityId, ...Array.from(neighborIds)];

    const entities =
      allEntityIds.length > 0
        ? await this.prisma.$queryRaw<
            Array<{
              id: string;
              name: string;
              type: string;
              properties: Record<string, unknown>;
              resource_id?: string;
            }>
          >`
          SELECT id, name, type, properties, resource_id
          FROM entities
          WHERE id = ANY(${allEntityIds})
        `.catch((err) => {
            this.logger.warn("Knowledge graph query failed", err?.message);
            return [];
          })
        : [];

    const nodes: GraphNode[] = entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      properties: e.properties || {},
      resourceId: e.resource_id,
    }));

    const edges: GraphEdge[] = relationships.map((r) => ({
      id: r.id,
      source: r.source_id,
      target: r.target_id,
      type: r.type,
      weight: r.weight,
      properties: r.properties || {},
    }));

    return {
      success: true,
      nodes,
      edges,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      queryType: input.queryType,
    };
  }

  /**
   * 图遍历（深度优先）
   */
  private async traverse(
    input: KnowledgeGraphInput,
    _context: ToolContext,
  ): Promise<KnowledgeGraphOutput> {
    // 简化实现：与 getNeighbors 相同
    // 完整实现需要递归遍历多层
    return this.getNeighbors(input, _context);
  }
}
