/**
 * Slides Engine v3.0 - Checkpoint Types
 *
 * 检查点系统类型定义，支持版本管理和回滚
 */

import { AIModelType } from "@prisma/client";

// ============================================================================
// Checkpoint Core Types
// ============================================================================

/**
 * 检查点类型枚举
 */
export type CheckpointType =
  | "task_decomposition" // 任务分解完成
  | "outline_confirmed" // 大纲确认
  | "page_rendered" // 单页渲染完成
  | "batch_rendered" // 批量渲染完成
  | "user_modified" // 用户手动修改
  | "auto_save"; // 自动保存

/**
 * 检查点接口
 */
export interface Checkpoint {
  id: string;
  sessionId: string;
  name: string;
  type: CheckpointType;
  version: string;
  timestamp: Date;
  state: CheckpointState;
  metadata: CheckpointMetadata;
}

/**
 * 检查点状态 - 包含完整的生成状态
 */
export interface CheckpointState {
  taskDecomposition?: TaskDecomposition;
  outlinePlan?: OutlinePlan;
  pages: PageState[];
  conversation: ConversationMessage[];
  globalStyles?: GlobalStyles;
}

/**
 * 检查点元数据
 */
export interface CheckpointMetadata {
  previousCheckpointId?: string;
  trigger: "auto" | "user";
  description?: string;
  tags?: string[];
  modelUsed?: string;
  tokensUsed?: number;
  durationMs?: number;
}

// ============================================================================
// Task Decomposition Types (Phase 1)
// ============================================================================

/**
 * 任务分解结果
 */
export interface TaskDecomposition {
  totalPages: number;
  chapters: Chapter[];
  todoList: TodoItem[];
  designStrategy: DesignStrategy;
  sourceAnalysis?: SourceAnalysis;
}

/**
 * 章节定义
 */
export interface Chapter {
  id: string;
  title: string;
  pageRange: [number, number];
  keyPoints: string[];
  emphasis?: "high" | "medium" | "low";
}

/**
 * 待办事项
 */
export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  pageNumber?: number;
}

/**
 * 设计策略
 */
export interface DesignStrategy {
  colorScheme: "dark" | "light" | "custom";
  accentColor: string;
  styleReference: string;
  fontFamily?: string;
  targetAudience?: string;
}

/**
 * 源内容分析
 */
export interface SourceAnalysis {
  totalWords: number;
  language: string;
  topics: string[];
  dataPoints: DataPoint[];
  quotes: string[];
  keyInsights: string[];
}

/**
 * 数据点
 */
export interface DataPoint {
  type: "percentage" | "currency" | "number" | "date" | "comparison";
  value: string;
  context: string;
  source?: string;
}

// ============================================================================
// Outline Planning Types (Phase 2)
// ============================================================================

/**
 * 大纲规划结果
 */
export interface OutlinePlan {
  title: string;
  pages: PageOutline[];
  globalStyles: GlobalStyles;
  contentFlow: ContentFlowAnalysis;
}

/**
 * 页面逻辑类型
 *
 * 模板是应对逻辑的，逻辑来源于目标，目标来源于意图理解。
 * 每一页应该有观点（标题），逻辑和数据，数据包括了描述数据的文字，数字和图片，支撑逻辑的。
 */
export type PageLogicType =
  | "parallel" // 并列论证：N个并列的支撑点 → pillars, multiColumn
  | "temporal" // 时序论证：按时间顺序展开 → timeline, evolutionRoadmap
  | "comparison" // 对比论证：通过对比突显差异 → comparison
  | "data" // 数据论证：用数字说明问题 → dashboard
  | "causal" // 因果论证：展示原因和结果 → framework
  | "hierarchical" // 层级论证：展示优先级或层次 → maturityModel
  | "case" // 案例论证：用实例佐证 → caseStudy, splitLayout
  | "narrative"; // 叙事型：封面、目录、结尾等特殊页面

/**
 * 页面大纲
 *
 * 三要素结构：
 * - 观点 (Viewpoint)：title 字段，必须是判断句，表达核心观点
 * - 逻辑 (Logic)：logicType + templateType，决定如何论证观点
 * - 数据 (Data)：keyElements + dataRequirements + imageRequirements，支撑逻辑的具体内容
 */
export interface PageOutline {
  pageNumber: number;
  /** 观点性标题：必须是判断句，表达明确观点，不是描述性标题 */
  title: string;
  subtitle?: string;
  /** 逻辑类型：决定使用什么论证结构 */
  logicType?: PageLogicType;
  /** 模板类型：由逻辑类型决定 */
  templateType: PageTemplateType;
  /** 内容简述：描述如何用数据支撑逻辑 */
  contentBrief: string;
  /** 关键元素：支撑观点的数据内容（文字描述） */
  keyElements: string[];
  layoutHints: LayoutHint[];
  /** 数据需求：需要的数字数据 */
  dataRequirements?: DataRequirement[];
  /** 图像需求：需要的视觉素材 */
  imageRequirements?: ImageRequirement[];
  sourceRef?: string;
}

/**
 * 17种页面模板类型
 */
export type PageTemplateType =
  | "cover"
  | "toc"
  | "chapterTitle" // v3.5: 章节分隔页
  | "questions"
  | "pillars"
  | "framework"
  | "timeline"
  | "evolutionRoadmap"
  | "dashboard"
  | "comparison"
  | "splitLayout"
  | "caseStudy"
  | "multiColumn"
  | "recommendations"
  | "maturityModel"
  | "riskOpportunity"
  | "closing"; // 结尾/感谢页

/**
 * 布局提示
 */
export interface LayoutHint {
  type: "alignment" | "spacing" | "emphasis" | "ratio";
  value: string;
  description?: string;
}

/**
 * 数据需求
 */
export interface DataRequirement {
  type: "chart" | "table" | "metric" | "list";
  description: string;
  mustInclude: boolean;
  sourceRef?: string;
}

/**
 * 图像需求
 */
export interface ImageRequirement {
  position: "background" | "inline" | "card" | "icon";
  semanticContext: string;
  style?: string;
  optional: boolean;
}

/**
 * 全局样式
 */
export interface GlobalStyles {
  backgroundColor: string;
  cardBackground: string;
  borderColor: string;
  accentColor: string;
  secondaryAccent: string;
  textPrimary: string;
  textSecondary: string;
  fontFamily: string;
  canvasWidth: number;
  canvasHeight: number;
  pagePadding: string;
  bottomSafeZone: number;
}

/**
 * 内容流分析
 */
export interface ContentFlowAnalysis {
  narrativeArc: "problem-solution" | "chronological" | "topical" | "comparison";
  keyTransitions: string[];
  climaxPage?: number;
  conclusionStyle: "summary" | "cta" | "recommendations";
}

// ============================================================================
// Page Rendering Types (Phase 3)
// ============================================================================

/**
 * 页面状态
 */
export interface PageState {
  pageNumber: number;
  outline: PageOutline;
  content?: PageContent;
  design?: PageDesign;
  html?: string;
  images?: GeneratedImage[];
  status: "pending" | "in_progress" | "completed" | "error";
  error?: string;
  /** v4.0: 内容分析结果（用于调试和反馈循环） */
  contentAnalysis?: {
    recommendedLayout: string;
    totalSections: number;
    totalCharacters: number;
    wasCompressed?: boolean;
    wasSplit?: boolean;
  };
}

/**
 * 页面内容 (Writer 输出)
 */
export interface PageContent {
  title: string;
  subtitle?: string;
  sections: ContentSection[];
  footer?: string;
  citations?: string[];
}

/**
 * 内容区块
 */
export interface ContentSection {
  type: "text" | "list" | "quote" | "stat" | "chart" | "image";
  position: "left" | "right" | "center" | "full";
  content: string | string[] | StatContent | ChartContent;
}

/**
 * 统计内容
 */
export interface StatContent {
  value: string;
  label: string;
  trend?: "up" | "down" | "neutral";
  change?: string;
}

/**
 * 图表内容
 */
export interface ChartContent {
  type: "bar" | "line" | "pie" | "radar";
  data: Record<string, number | string>[];
  title?: string;
}

/**
 * 页面设计 (Renderer 四步设计输出)
 */
export interface PageDesign {
  step1_drafting: {
    style: string;
    coreElements: string[];
    mood: string;
  };
  step2_refiningLayout: {
    alignment: string;
    graphicsPosition: string;
    spacing: string;
    ratio?: string;
  };
  step3_planningVisuals: {
    backgroundColor: string;
    accentColors: string[];
    decorations: string[];
    shadows?: string;
  };
  step4_formulatingHTML: {
    html: string;
    css?: string;
    externalDependencies: string[];
  };
  /** AI 调用的系统提示词 */
  systemPrompt?: string;
  /** AI 调用的用户提示词（完整的输入上下文） */
  userPrompt?: string;
  /** AI 的原始响应（完整的思考过程） */
  rawResponse?: string;
}

/**
 * 生成的图像
 */
export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  semanticContext: string;
  position: "background" | "inline" | "card" | "icon";
  width?: number;
  height?: number;
  generatedAt: Date;
}

// ============================================================================
// Conversation Types
// ============================================================================

/**
 * 对话消息
 */
export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  metadata?: Record<string, unknown>;
}

/**
 * 工具调用
 */
export interface ToolCall {
  id: string;
  type: ToolType;
  name: string;
  status: "pending" | "running" | "completed" | "error";
  input?: unknown;
  output?: unknown;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * 工具类型
 */
export type ToolType = "think" | "search" | "docview" | "write" | "render";

// ============================================================================
// Session Types
// ============================================================================

/**
 * Slides 会话
 */
export interface SlidesSession {
  id: string;
  userId: string;
  title: string;
  status: "active" | "completed" | "archived";
  currentCheckpointId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Model Role Types
// ============================================================================

/**
 * 角色类型
 */
export type SlidesRole =
  | "architect"
  | "writer"
  | "renderer"
  | "image"
  | "reviewer";

/**
 * 角色配置
 */
export interface RoleConfig {
  role: SlidesRole;
  modelType: AIModelType;
  strategy: "DEFAULT" | "COST_OPTIMIZED" | "QUALITY_FIRST" | "SPEED_FIRST";
  description: string;
}

/**
 * 角色配置映射
 */
export const ROLE_CONFIGS: Record<SlidesRole, RoleConfig> = {
  architect: {
    role: "architect",
    modelType: "CHAT" as AIModelType,
    strategy: "QUALITY_FIRST",
    description: "任务分解、大纲规划、质量审核",
  },
  writer: {
    role: "writer",
    modelType: "CHAT" as AIModelType,
    strategy: "QUALITY_FIRST",
    description: "内容填充、文案润色（使用高质量模型确保内容丰富）",
  },
  renderer: {
    role: "renderer",
    modelType: "CHAT" as AIModelType,
    strategy: "QUALITY_FIRST",
    description: "四步设计、HTML生成",
  },
  image: {
    role: "image",
    modelType: "IMAGE_GENERATION" as AIModelType,
    strategy: "DEFAULT",
    description: "图像生成",
  },
  reviewer: {
    role: "reviewer",
    modelType: "CHAT" as AIModelType,
    strategy: "QUALITY_FIRST",
    description: "质量检查、一致性验证",
  },
};

// ============================================================================
// Stream Event Types
// ============================================================================

/**
 * 流事件类型
 * 使用 colon 分隔符以匹配前端的 SlidesTeamEventType
 */
export type StreamEventType =
  // 执行生命周期
  | "execution:started"
  | "execution:completed"
  | "execution:failed"
  // 阶段变化
  | "phase:started"
  | "phase:progress"
  | "phase:completed"
  | "phase:retry"
  // Agent 活动
  | "agent:thinking"
  | "agent:working"
  | "agent:completed"
  | "agent:handoff"
  | "agent:switched"
  // 内容生成
  | "slide:generating"
  | "slide:generated"
  // 质量检查
  | "review:issue_found"
  | "review:auto_fixed"
  | "review:scoring"
  | "review:rejected"
  | "review:max_retries_reached"
  | "review:diagnostics"
  // 心跳
  | "heartbeat";

/**
 * 流事件
 * 匹配前端的 SlidesTeamEvent 接口
 */
export interface StreamEvent {
  type: StreamEventType;
  timestamp: string; // ISO string 格式
  executionId: string;
  data: unknown;
}

// ============================================================================
// Quality Report Types
// ============================================================================

/**
 * 质量报告
 */
export interface QualityReport {
  overall: "pass" | "warning" | "fail";
  score: number;
  issues: QualityIssue[];
  suggestions: string[];
  checkedAt: Date;
}

/**
 * 质量问题
 */
export interface QualityIssue {
  type: "layout" | "content" | "image" | "consistency";
  severity: "error" | "warning" | "info";
  pageNumber?: number;
  description: string;
  suggestion?: string;
  autoFixed?: boolean; // v3.2: 是否已自动修复
}

// ============================================================================
// Genspark Design System Constants
// ============================================================================

/**
 * Genspark 设计系统常量
 */
export const GENSPARK_DESIGN_SYSTEM: GlobalStyles = {
  backgroundColor: "#0F172A",
  cardBackground: "#1E293B",
  borderColor: "#334155",
  accentColor: "#D4AF37",
  secondaryAccent: "#3B82F6",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  fontFamily: "'Noto Sans SC', sans-serif",
  canvasWidth: 1280,
  canvasHeight: 720,
  pagePadding: "50px 80px 80px 80px",
  bottomSafeZone: 80,
};

/**
 * CDN 资源
 */
export const CDN_RESOURCES = {
  tailwind:
    "https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css",
  fontAwesome:
    "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css",
  echarts: "https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js",
  notoSansSC:
    "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap",
};

// ============================================================================
// Intent Analysis Types (Layer 1 - 意图理解层)
// ============================================================================

/**
 * 演示目的类型
 */
export type PresentationPurpose =
  | "inform" // 信息传达
  | "persuade" // 说服影响
  | "instruct" // 教学指导
  | "inspire" // 激励鼓舞
  | "report"; // 汇报总结

/**
 * 演示语调类型
 */
export type PresentationTone =
  | "formal" // 正式
  | "professional" // 专业
  | "casual" // 休闲
  | "inspiring" // 激励
  | "analytical"; // 分析性

/**
 * 受众信息
 */
export interface AudienceInfo {
  /** 受众类型 (investor/customer/internal/public/executive/technical) */
  type: string;
  /** 专业程度 (expert/general/novice) */
  expertise: "expert" | "general" | "novice";
  /** 期望和关注点 */
  expectations: string[];
}

/**
 * 演示约束条件
 */
export interface PresentationConstraints {
  /** 时间限制 (分钟) */
  timeLimit?: number;
  /** 页数限制 */
  pageLimit?: number;
  /** 品牌指南 */
  brandGuidelines?: string;
}

/**
 * 意图分析结果 (Layer 1 输出)
 */
export interface IntentAnalysis {
  /** 演示目的 */
  purpose: PresentationPurpose;
  /** 目标受众 */
  audience: AudienceInfo;
  /** 演示语调 */
  tone: PresentationTone;
  /** 核心信息 (一句话总结) */
  keyMessage: string;
  /** 预期成果 */
  expectedOutcome: string;
  /** 约束条件 */
  constraints: PresentationConstraints;
  /** 置信度 (0-1) */
  confidence: number;
  /** 分析时间戳 */
  analyzedAt: Date;
}

// ============================================================================
// Narrative Planning Types (Layer 2 - 叙事规划层)
// ============================================================================

/**
 * 叙事模式
 */
export type NarrativePattern =
  | "problem-solution" // 问题 -> 方案 -> 证据 -> 行动
  | "journey" // 过去 -> 现在 -> 未来
  | "pyramid" // 结论 -> 支撑1/2/3 -> 总结
  | "comparison" // A vs B -> 分析 -> 建议
  | "teaching"; // 概念 -> 原理 -> 示例 -> 练习

/**
 * 故事情节结构
 */
export interface Storyline {
  /** 开场钩子 - 抓住注意力 */
  hook: string[];
  /** 背景铺垫 - 设置场景 */
  context: string[];
  /** 问题/挑战 - 制造紧张感 */
  tension: string[];
  /** 解决方案 - 核心内容 */
  resolution: string[];
  /** 证据/数据 - 支撑论点 */
  proof: string[];
  /** 行动号召 - 促进行动 */
  callToAction: string[];
}

/**
 * 情感节点
 */
export interface EmotionalNode {
  /** 页码 */
  page: number;
  /** 情感类型 */
  emotion: "curiosity" | "concern" | "hope" | "confidence" | "urgency";
}

/**
 * 信息密度等级
 */
export type DensityLevel = "high" | "medium" | "low";

/**
 * 叙事规划结果 (Layer 2 输出)
 */
export interface NarrativePlan {
  /** 故事情节结构 */
  storyline: Storyline;
  /** 信息密度节奏 (每页的密度) */
  rhythmPattern: DensityLevel[];
  /** 情感曲线 */
  emotionalArc: EmotionalNode[];
  /** 叙事模式 */
  narrativePattern: NarrativePattern;
  /** 高潮页码 (信息最密集的页) */
  climaxPage?: number;
  /** 页面分配 (章节 -> 页码范围) */
  pageAllocation: {
    section: string;
    pageRange: [number, number];
    purpose: string;
  }[];
}
