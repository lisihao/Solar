/**
 * AI App - Office Teams
 * Office 团队配置导出
 */

export {
  REPORT_WORKFLOW,
  REPORT_TEAM_CONFIG,
  createReportTeamConfig,
} from "./report-team.config";

export {
  SLIDES_WORKFLOW,
  SLIDES_TEAM_CONFIG,
  createSlidesTeamConfig,
} from "./slides-team.config";

export {
  VISUAL_DESIGN_WORKFLOW,
  VISUAL_DESIGN_TEAM_CONFIG,
  createVisualDesignTeamConfig,
  // Agent Prompts for Imagen 4
  CONTENT_AGENT_PROMPT,
  LAYOUT_AGENT_PROMPT,
  VISUAL_AGENT_PROMPT,
  STYLE_AGENT_PROMPT,
} from "./visual-design-team.config";

export {
  CONTENT_LEAD_ROLE_ID,
  CONTENT_LEAD_ROLE_CONFIG,
  SLIDES_LEAD_ROLE_ID,
  SLIDES_LEAD_ROLE_CONFIG,
  OFFICE_LEAD_ROLE_CONFIGS,
} from "./office-roles.config";
