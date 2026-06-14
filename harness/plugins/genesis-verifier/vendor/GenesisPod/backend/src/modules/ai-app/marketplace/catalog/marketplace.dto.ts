/**
 * Marketplace catalog response DTOs
 *
 * Read-only projection of platform registries onto 4 shelves:
 * agents / skills / tools / workflows
 */

export interface AgentCatalogItem {
  id: string;
  name: string;
  description: string;
  role: string;
  category: string;
  tags: string[];
  capabilities: string[];
  skillIds: string[];
  toolIds: string[];
  defaultModel: string;
}

export interface SkillCatalogItem {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  activatesFor: string[];
  /** 技能原始指令正文预览（.skill.md body，截断），让市场详情看到"教什么" */
  instructionsPreview: string;
  /** 技能声明可用的工具白名单（frontmatter.allowedTools） */
  allowedTools: string[];
}

export interface ToolCatalogItem {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  source: "builtin" | "mcp" | "openapi";
  /** 真实副作用（ITool.sideEffect）：none=只读 / idempotent=幂等写 / destructive=破坏性 */
  sideEffect: "none" | "idempotent" | "destructive";
}

export interface WorkflowCatalogItem {
  id: string;
  name: string;
  description: string;
  category: string;
  teamSize: number;
  roles: string[];
  stages: string[];
  /**
   * 该工作流跑完用哪个前端 MissionKit 呈现（如 'deep-insight'）。
   * 仅 mission pipeline 携带（声明于其 meta.catalog.missionType）；
   * 团队阵型一般留空。前端 resolveMissionKit(missionType) 解析呈现面。
   */
  missionType?: string;
  /** 阵型 Agent 的 listing id（roles → 沉淀 Agent 解析）。 */
  agentIds?: string[];
  /** 阵型聚合的技能 id（去重并集；供「专家」卡展开看技能详情）。 */
  skillIds?: string[];
  /** 阵型聚合的工具 id（去重并集）。 */
  toolIds?: string[];
}

/**
 * 团队模板（成品货架）—— 一组沉淀 Agent + 一条工作流 + 聚合的技能/工具。
 * "一键成军"用 workflowId 实例化满编团队。
 */
export interface TeamCatalogItem {
  id: string;
  name: string;
  description: string;
  category: string;
  /** 该团队运行的工作流 listing id（一键成军实例化用） */
  workflowId: string;
  /** 名册角色 */
  roles: string[];
  /** 名册对应的沉淀 Agent listing id */
  agentIds: string[];
  /** 名册聚合的技能 id */
  skillIds: string[];
  /** 名册聚合的工具 id */
  toolIds: string[];
  /** 工作流阶段（展示用） */
  stages: string[];
}

export interface MarketplaceCatalog {
  agents: AgentCatalogItem[];
  skills: SkillCatalogItem[];
  tools: ToolCatalogItem[];
  workflows: WorkflowCatalogItem[];
  teams: TeamCatalogItem[];
}
