/**
 * Image ai-app 业务常量（v3 R0-A1-a：从 harness BUILTIN_AGENTS 下推）
 */
import type { AgentConfig } from "@/modules/ai-harness/facade";

export const IMAGE_DESIGNER_AGENT_ID = "image-designer" as const;

export const IMAGE_DESIGNER_AGENT_META: AgentConfig = {
  id: IMAGE_DESIGNER_AGENT_ID,
  name: "AI Image Designer",
  description: "智能图像设计师，生成高质量图像和信息图表",
  icon: "🖼️",
  color: "#06B6D4",
  capabilities: ["信息图表生成", "Prompt 优化", "多风格生成", "图像编辑"],
  templates: [],
};
