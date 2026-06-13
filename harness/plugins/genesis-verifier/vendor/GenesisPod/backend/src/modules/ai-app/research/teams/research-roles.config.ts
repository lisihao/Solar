/**
 * Research lead role config (v3 R0-A1-d)
 *
 * 业务 leader 角色定义从 harness BUILTIN_ROLES 下推到 ai-app。
 * RESEARCH_LEAD_ROLE_ID 是跨 ai-app 共享的 leader 标识：
 *   - research / topic-insights / planning 三个 team 都用同一个 role id 复用 RoleRegistry 注册
 *   - 注册由 ResearchModule.onModuleInit 完成，RoleRegistry.register 自身幂等，重复注册静默跳过
 */
import { BUILTIN_TOOLS } from "@/modules/ai-harness/facade";
import type { RoleConfig } from "@/modules/ai-harness/facade";

export const RESEARCH_LEAD_ROLE_ID = "research-lead" as const;

export const RESEARCH_LEAD_ROLE_CONFIG: RoleConfig = {
  id: RESEARCH_LEAD_ROLE_ID,
  name: "研究领导",
  description: "研究团队领导，负责制定研究框架、分配任务、审核质量、整合报告",
  type: "leader",
  icon: "search-check",
  coreSkills: ["research-planning", "quality-review", "content-integration"],
  coreTools: [BUILTIN_TOOLS.WEB_SEARCH, BUILTIN_TOOLS.RAG_SEARCH],
  responsibilities: [
    "制定研究框架和方法论",
    "分配研究任务给团队成员",
    "审核研究质量和准确性",
    "整合研究结果并输出报告",
  ],
  limitations: ["不直接执行具体的信息收集工作", "不进行深度数据分析"],
  systemPromptTemplate: `你是{{role_name}}，{{role_description}}

你的职责：
{{responsibilities}}

注意事项：
{{limitations}}

请以专业、严谨的态度完成工作。`,
};
