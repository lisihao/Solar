/**
 * MarketplaceCatalogService
 *
 * Projects the platform registries (ToolRegistry / TeamRegistry /
 * BuiltinSkillCatalog + SkillRegistry) into the 4-shelf marketplace catalog
 * consumed by the "一人公司 OS" agent-marketplace frontend.
 *
 * This service is read-only: it never mutates registry state.
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  ToolRegistry,
  TeamRegistry,
  BuiltinSkillCatalog,
  MissionPipelineRegistry,
  readDefineAgentMeta,
} from "@/modules/ai-harness/facade";
import { SkillRegistry } from "@/modules/ai-engine/facade";
import { readPipelineCatalogMeta } from "@/modules/ai-app/contracts/pipeline-catalog.contract";
import { SEDIMENTED_AGENT_SPECS } from "@/modules/ai-app/contracts/agent-spec-catalog";
import type {
  AgentCatalogItem,
  SkillCatalogItem,
  ToolCatalogItem,
  WorkflowCatalogItem,
  TeamCatalogItem,
  MarketplaceCatalog,
} from "./marketplace.dto";

/** 截断长文本（技能指令正文），保留可读预览。 */
function truncate(text: string | undefined, max: number): string {
  if (!text) return "";
  const t = text.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/**
 * 基础设施型 domain：这些是某个 AI App 的内部生产管线（如 slides 渲染流水线），
 * 不是「一人公司」用户可装配的通用方法论技能，不应出现在市场货架。
 * 可调整：若要把某领域重新放回市场，从这里移除即可。
 */
const INFRA_SKILL_DOMAINS = new Set<string>(["office"]);

/**
 * engine SkillRegistry 里的 prompt 型技能适配器（PromptSkillAdapter）鸭子类型。
 * 只有 prompt 技能才有可注入 Agent 系统提示的方法论正文；code-backed 执行单元
 * （slides page-pipeline / content-compression 等 NestJS Provider）没有正文，
 * 不能被装配，故不进市场。用鸭子类型避免跨 facade 导入 engine 内部类。
 */
interface PromptSkillLike {
  isPromptSkillAdapter?: boolean;
  getPromptContent?: () => string;
  getDefinitionMetadata?: () => { allowedTools?: string[] };
}

/** "researcher" → "Researcher"（角色 id 无展示名时的兜底标题化）。 */
function titleCaseRole(role: string): string {
  if (!role) return role;
  return role.charAt(0).toUpperCase() + role.slice(1);
}

@Injectable()
export class MarketplaceCatalogService {
  private readonly logger = new Logger(MarketplaceCatalogService.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly teamRegistry: TeamRegistry,
    private readonly builtinSkillCatalog: BuiltinSkillCatalog,
    private readonly skillRegistry: SkillRegistry,
    // ★ @Global mission pipeline registry —— 投影 ai-app 各 mission 工作流 + 其角色
    private readonly pipelineRegistry: MissionPipelineRegistry,
  ) {}

  getCatalog(): MarketplaceCatalog {
    return {
      agents: this.getAgents(),
      skills: this.getSkills(),
      tools: this.getTools(),
      workflows: this.getWorkflows(),
      teams: this.getTeams(),
    };
  }

  /**
   * 团队模板货架（成品）：把"角色名册能解析到沉淀 Agent"的工作流，投影成可一键成军的团队。
   * 名册 = 工作流 roles ∩ 沉淀 Agent（按 role）。聚合各 Agent 自带的技能/工具。
   */
  getTeams(): TeamCatalogItem[] {
    const sedimented = this.getAgents().filter(
      (a) => a.category === "深度研究团队",
    );
    const byRole = new Map(sedimented.map((a) => [a.role, a]));

    const teams: TeamCatalogItem[] = [];
    for (const wf of this.getWorkflows()) {
      const roster: AgentCatalogItem[] = [];
      const seen = new Set<string>();
      for (const role of wf.roles) {
        const ag = byRole.get(role);
        if (ag && !seen.has(ag.id)) {
          roster.push(ag);
          seen.add(ag.id);
        }
      }
      if (roster.length === 0) continue; // 无沉淀名册的工作流不成"团队"

      const baseName = wf.name.replace(/工作流$/, "").trim();
      teams.push({
        id: `team.${wf.id}`,
        name: `${baseName}团队`,
        description: wf.description,
        category: wf.category,
        workflowId: wf.id,
        roles: roster.map((a) => a.role),
        agentIds: roster.map((a) => a.id),
        skillIds: Array.from(new Set(roster.flatMap((a) => a.skillIds))),
        toolIds: Array.from(new Set(roster.flatMap((a) => a.toolIds))),
        stages: wf.stages,
      });
    }
    return teams;
  }

  getAgents(): AgentCatalogItem[] {
    // Agent 货架 = 11 个原子 Agent（单一源 = SEDIMENTED_AGENT_SPECS，readDefineAgentMeta 派生）。
    // 旧的 8 个 app-level persona（PLATFORM_AGENT_METAS）已弃用：它们是空壳（无 skills/tools/
    // workflow 关联）。待 phase-2 各 app 按沉淀范本重新成形后再回归；保留在 agent-catalog.ts 作 legacy。
    return this.getSedimentedAgents();
  }

  private getSedimentedAgents(): AgentCatalogItem[] {
    const items: AgentCatalogItem[] = [];
    for (const [id, SpecClass] of Object.entries(SEDIMENTED_AGENT_SPECS)) {
      try {
        const meta = readDefineAgentMeta(SpecClass);
        if (!meta) continue;

        const identity = meta.identity;
        const roleRef = identity.role;
        const role =
          typeof roleRef === "string" ? roleRef : (roleRef?.id ?? id);
        const description =
          "description" in identity && typeof identity.description === "string"
            ? identity.description
            : "";
        const skillIds = meta.skills ? [...meta.skills] : [];
        const toolIds = meta.tools ? [...meta.tools] : [];

        items.push({
          id: meta.id,
          name: titleCaseRole(role),
          description,
          role,
          category: "深度研究团队",
          tags: skillIds,
          capabilities: skillIds,
          skillIds,
          toolIds,
          defaultModel: "",
        } satisfies AgentCatalogItem);
      } catch (err) {
        this.logger.warn(
          `Sedimented agent projection failed for "${id}": ${String(err)}`,
        );
      }
    }
    return items;
  }

  getSkills(): SkillCatalogItem[] {
    const items: SkillCatalogItem[] = [];

    // Source 1: harness BuiltinSkillCatalog (SKILL.md files)
    try {
      for (const skill of this.builtinSkillCatalog.all()) {
        const fm = skill.frontmatter;
        items.push({
          id: fm.name,
          name: fm.name,
          description: fm.description,
          category: "general",
          tags: fm.tags ? [...fm.tags] : [],
          activatesFor: fm.activateFor ? [...fm.activateFor] : [],
          // 取技能真正"教什么"的指令正文（截断，避免目录响应过大）
          instructionsPreview: truncate(skill.instructions, 1200),
          allowedTools: fm.allowedTools ? [...fm.allowedTools] : [],
        });
      }
    } catch (err) {
      this.logger.warn(
        `BuiltinSkillCatalog enumeration failed: ${String(err)}`,
      );
    }

    // Source 2: engine SkillRegistry
    // 仅投影 prompt 型方法论技能（有可注入 Agent 的指令正文）；跳过 code-backed
    // 执行单元（slides 渲染管线、playground 执行体等基础设施，无方法论正文）。
    try {
      for (const skill of this.skillRegistry.getAll()) {
        const prompt = skill as unknown as PromptSkillLike;
        const isPromptSkill =
          prompt.isPromptSkillAdapter === true &&
          typeof prompt.getPromptContent === "function";
        if (!isPromptSkill) continue;

        // 跳过某个 App 的内部生产管线领域（如 office/slides）
        if (INFRA_SKILL_DOMAINS.has(skill.domain)) continue;

        const body = prompt.getPromptContent?.() ?? "";
        const meta = prompt.getDefinitionMetadata?.() ?? {};

        items.push({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          category: skill.domain ?? "general",
          tags: skill.tags ? [...skill.tags] : [],
          activatesFor: [],
          // 取技能真正"教什么"的指令正文（截断，避免目录响应过大）
          instructionsPreview: truncate(body, 1200),
          allowedTools: meta.allowedTools ? [...meta.allowedTools] : [],
        });
      }
    } catch (err) {
      this.logger.warn(`SkillRegistry enumeration failed: ${String(err)}`);
    }

    if (items.length === 0) {
      this.logger.warn(
        "No skills found in either BuiltinSkillCatalog or SkillRegistry",
      );
    }

    return items;
  }

  getTools(): ToolCatalogItem[] {
    try {
      return this.toolRegistry.getEnabled().map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: String(tool.category),
        tags: tool.tags ? [...tool.tags] : [],
        source: "builtin" as const,
        sideEffect: tool.sideEffect ?? "none",
      }));
    } catch (err) {
      this.logger.warn(`ToolRegistry enumeration failed: ${String(err)}`);
      return [];
    }
  }

  getWorkflows(): WorkflowCatalogItem[] {
    // Two canonical sources, both projected read-only (标准 28：不建台账):
    //   1. TeamRegistry —— TeamConfig 阵型（research/debate/slides…）
    //   2. MissionPipelineRegistry —— mission pipeline（playground 14 阶段 + radar/social/writing）
    const base = [...this.getTeamWorkflows(), ...this.getMissionWorkflows()];

    // 为每个工作流（= 市场「专家」）聚合其阵型 Agent 的技能/工具：
    //   roles → 沉淀 Agent（按 role 解析）→ 技能/工具去重并集。
    // 与 getTeams 同源同逻辑，让「专家」卡能展开查看其技能/工具详情。
    const byRole = new Map(this.getSedimentedAgents().map((a) => [a.role, a]));
    return base.map((w) => {
      const seen = new Set<string>();
      const roster: AgentCatalogItem[] = [];
      for (const role of w.roles) {
        const ag = byRole.get(role);
        if (ag && !seen.has(ag.id)) {
          roster.push(ag);
          seen.add(ag.id);
        }
      }
      return {
        ...w,
        agentIds: roster.map((a) => a.id),
        skillIds: Array.from(new Set(roster.flatMap((a) => a.skillIds))),
        toolIds: Array.from(new Set(roster.flatMap((a) => a.toolIds))),
      };
    });
  }

  private getTeamWorkflows(): WorkflowCatalogItem[] {
    try {
      return this.teamRegistry.getAllConfigs().map((config) => {
        const memberTeamSize = config.memberRoles.reduce(
          (sum, r) => sum + r.minCount,
          0,
        );
        // +1 for the leader
        const teamSize = memberTeamSize + 1;

        const roles = [
          config.leaderRoleId,
          ...config.memberRoles.map((r) => r.roleId),
        ];

        const stages = config.workflow.steps.map((s) => s.name);

        return {
          id: config.id,
          name: config.name,
          description: config.description,
          category: "平台",
          teamSize,
          roles,
          stages,
        } satisfies WorkflowCatalogItem;
      });
    } catch (err) {
      this.logger.warn(`TeamRegistry enumeration failed: ${String(err)}`);
      return [];
    }
  }

  private getMissionWorkflows(): WorkflowCatalogItem[] {
    const items: WorkflowCatalogItem[] = [];
    try {
      for (const pipelineId of this.pipelineRegistry.listIds()) {
        const config = this.pipelineRegistry.get(pipelineId);
        const catalog = readPipelineCatalogMeta(config.meta);

        // meta.catalog 提供展示信息时用之（如 playground）；缺省时优雅回退到
        // 原始 pipeline 字段（其他 app 尚未补 catalog 元数据时仍可见，待后续按
        // playground 模板各自归位）。
        const fallbackDesc =
          typeof config.meta?.description === "string"
            ? config.meta.description
            : "";

        items.push({
          id: config.id,
          name: catalog?.name ?? config.id,
          description: catalog?.description ?? fallbackDesc,
          category: catalog?.category ?? "Mission",
          teamSize: config.roles.length,
          roles: config.roles.map((r) => r.id),
          stages: catalog?.stages ?? config.steps.map((s) => s.id),
          // 呈现面绑定：声明则透传（如 playground → 'deep-insight'），缺省留空。
          missionType: catalog?.missionType,
        } satisfies WorkflowCatalogItem);
      }
    } catch (err) {
      this.logger.warn(
        `MissionPipelineRegistry enumeration failed: ${String(err)}`,
      );
    }
    return items;
  }
}
