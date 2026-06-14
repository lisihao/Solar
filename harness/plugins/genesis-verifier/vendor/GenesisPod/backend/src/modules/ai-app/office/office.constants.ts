/**
 * Office ai-app 业务常量（v3 R0-A1-a：从 harness BUILTIN_AGENTS 下推）
 *
 * Office 含 3 个 sub-agent: SLIDES / DOCS / DESIGNER
 */
import type { AgentConfig } from "@/modules/ai-harness/facade";

export const SLIDES_AGENT_ID = "slides" as const;
export const DOCS_AGENT_ID = "docs" as const;
export const DESIGNER_AGENT_ID = "designer" as const;

// Team ids（v3 R0-A1-c：从 harness BUILTIN_TEAMS 下推）
export const SLIDES_TEAM_ID = "slides" as const;
export const REPORT_TEAM_ID = "report" as const;
export const DESIGN_TEAM_ID = "design" as const;

export const SLIDES_AGENT_META: AgentConfig = {
  id: SLIDES_AGENT_ID,
  name: "AI Slides",
  description: "智能 PPT 生成器，快速创建专业演示文稿",
  icon: "📊",
  color: "#3B82F6",
  capabilities: ["自动生成大纲", "智能配图", "多种主题风格", "导出 PPTX"],
  templates: [],
};

export const DOCS_AGENT_META: AgentConfig = {
  id: DOCS_AGENT_ID,
  name: "AI Docs",
  description: "智能文档助手，撰写专业文档报告",
  icon: "📄",
  color: "#10B981",
  capabilities: ["自动调研资料", "生成大纲", "撰写内容", "导出 Word/PDF"],
  templates: [],
};

export const DESIGNER_AGENT_META: AgentConfig = {
  id: DESIGNER_AGENT_ID,
  name: "AI Designer",
  description: "智能设计工具，生成创意设计图",
  icon: "🎨",
  color: "#F59E0B",
  capabilities: ["海报设计", "Logo 设计", "Banner 生成", "多风格变体"],
  templates: [],
};
