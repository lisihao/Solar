/**
 * Research Tool Router Types
 * 研究工具路由系统的类型定义
 */

/** 研究主题分类 */
export type ResearchTopicType =
  | "academic" // 学术论文类
  | "policy" // 政策法规类
  | "technical" // 技术类
  | "financial" // 金融财经类
  | "general" // 通用类
  | "mixed"; // 混合类

/** 工具分配 */
export interface ToolAssignment {
  toolId: string;
  maxResults: number;
  priority: number; // lower = higher priority
  required: boolean; // failure halts step?
  queryTransform?: "academic" | "policy" | "technical" | "none";
}

/** 工具解析结果 */
export interface ToolResolution {
  tools: ToolAssignment[];
  mode: "parallel" | "sequential" | "primary-with-fallback";
  maxTotalResults: number;
}

/** 完整工具策略 */
export interface ResearchToolStrategy {
  topicType: ResearchTopicType;
  confidence: number; // 0-1
  defaultResolution: ToolResolution;
  stepOverrides: Partial<Record<string, ToolResolution>>; // stepType -> resolution
}
