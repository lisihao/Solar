/**
 * 智能体市场（/marketplace）领域类型 —— M0 原型 mock 层。
 *
 * 四个独立货架共享 BaseListing；各货架有自己的扩展字段。
 * 真接后端时，这些类型对应 ai-harness/agents、ai-engine/tools、skill-runtime、
 * teams 的目录投影（见 docs/features/one-person-company-os/design.md §6）。
 */

export type ListingKind = 'team' | 'agent' | 'skill' | 'tool' | 'workflow';

export interface BaseListing {
  id: string;
  kind: ListingKind;
  name: string;
  /** 一句话卖点 */
  tagline: string;
  description: string;
  /** 分类（用于货架筛选 chips） */
  category: string;
  tags: string[];
  /** 发布方（M0 全部「官方」） */
  publisher: string;
  /** 采用次数（人气排序） */
  installs: number;
  /** 评分 0–5（一位小数） */
  rating: number;
}

export type Seniority = 'junior' | 'mid' | 'senior' | 'lead';

export const SENIORITY_LABEL: Record<Seniority, string> = {
  junior: '初级',
  mid: '中级',
  senior: '高级',
  lead: '专家',
};

export interface AgentListing extends BaseListing {
  kind: 'agent';
  /** 职位（招聘语义） */
  role: string;
  seniority: Seniority;
  /** 头像渐变（Tailwind from-x to-y 字面量） */
  avatarGradient: string;
  /** 自带技能（指向 SkillListing.id） */
  skillIds: string[];
  /** 自带工具（指向 ToolListing.id） */
  toolIds: string[];
  /** 默认模型（展示名；真实走 TaskProfile，不硬编码） */
  defaultModel: string;
  /** 每次任务大致算力消耗（credits） */
  costPerRun: number;
}

export type ToolSource = 'builtin' | 'mcp' | 'openapi';

export const TOOL_SOURCE_LABEL: Record<ToolSource, string> = {
  builtin: '内置',
  mcp: 'MCP',
  openapi: 'OpenAPI',
};

export type ToolSideEffect = 'none' | 'idempotent' | 'destructive';

export interface ToolListing extends BaseListing {
  kind: 'tool';
  source: ToolSource;
  sideEffect: ToolSideEffect;
}

export interface SkillListing extends BaseListing {
  kind: 'skill';
  /** 适用角色（激活语义） */
  activatesFor: string[];
  /** 技能原始指令正文预览（.skill.md body） */
  instructionsPreview?: string;
  /** 技能声明可用的工具白名单 */
  allowedTools?: string[];
}

export interface WorkflowListing extends BaseListing {
  kind: 'workflow';
  /** 推荐团队规模 */
  teamSize: number;
  /** 需要的角色 */
  roles: string[];
  /** 阶段名（pipeline 概览） */
  stages: string[];
  /**
   * 跑完用哪个前端 MissionKit 呈现（如 'deep-insight'）。
   * 后续详情/采用处可 resolveMissionKit(missionType)?.DetailComponent 渲染配套界面。
   */
  missionType?: string;
  /** 阵型 Agent 的 listing id（roles → 沉淀 Agent）。 */
  agentIds?: string[];
  /** 阵型聚合的技能 id（去重并集；供「专家」卡展开看技能/工具详情）。 */
  skillIds?: string[];
  /** 阵型聚合的工具 id（去重并集）。 */
  toolIds?: string[];
}

export interface TeamListing extends BaseListing {
  kind: 'team';
  /** 该团队运行的工作流 listing id（一键成军实例化用） */
  workflowId: string;
  /** 名册角色 */
  roles: string[];
  /** 名册对应的 Agent listing id */
  agentIds: string[];
  /** 名册聚合的技能 id */
  skillIds: string[];
  /** 名册聚合的工具 id */
  toolIds: string[];
  /** 工作流阶段 */
  stages: string[];
}

export type AnyListing =
  | TeamListing
  | AgentListing
  | ToolListing
  | SkillListing
  | WorkflowListing;
