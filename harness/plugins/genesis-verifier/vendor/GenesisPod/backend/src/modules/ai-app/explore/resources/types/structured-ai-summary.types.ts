/**
 * 结构化AI摘要类型定义（后端版本）
 * 与前端 frontend/types/ai-office.ts 对应
 */

// ============ 基础结构化摘要 ============

export interface StructuredAISummary {
  overview: string; // 200-300 word overview
  category: string;
  subcategories: string[];
  keyPoints: string[]; // 3-5 key points
  keywords: string[];
  difficulty: "beginner" | "intermediate" | "advanced" | "expert";
  readingTime: number;
  visualizations?: Array<{
    type: "timeline" | "flowchart" | "diagram" | "chart" | "matrix";
    description: string;
    dataPoints?: string[];
  }>;
  confidence: number; // 0-1
  generatedAt: Date;
  model: string;
}

// ============ 论文摘要 ============

export interface PaperAISummary extends StructuredAISummary {
  contributions: string[];
  methodology: string;
  results: string;
  limitations: string[];
  futureWork: string[];
  citationContext?: {
    citationCount: number;
    h5Index?: number;
    impactFactor?: number;
  };
  relatedTopics: string[];
  field: string;
  subfield: string;
}

// ============ 新闻摘要 ============

export interface NewsAISummary extends StructuredAISummary {
  headline: string;
  coreNews: string;
  background: string;
  impact: string;
  quotes?: Array<{
    text: string;
    source: string;
  }>;
  newsFactor: "breaking" | "developing" | "analysis" | "feature";
  sentiment: "positive" | "neutral" | "negative";
  urgency: "high" | "medium" | "low";
  relatedEntities: Array<{
    name: string;
    type: "person" | "organization" | "location" | "event";
    relevance: number;
  }>;
}

// ============ 视频摘要 ============

export interface VideoAISummary extends StructuredAISummary {
  speakers: Array<{
    name: string;
    role?: string;
    expertise?: string;
  }>;
  chapters: Array<{
    timestamp: number;
    title: string;
    summary: string;
  }>;
  mainTopic: string;
  subtopics: string[];
  videoType: "lecture" | "tutorial" | "interview" | "demo" | "discussion";
  pace: "slow" | "normal" | "fast";
  audience: "beginner" | "intermediate" | "advanced";
  keyFrames?: Array<{
    timestamp: number;
    description: string;
    importance: number;
  }>;
  estimatedWatchTime: number;
  keyTimestamps: Array<{
    time: number;
    label: string;
  }>;
}

// ============ 项目摘要 ============

export interface ProjectAISummary extends StructuredAISummary {
  projectName: string;
  purpose: string;
  mainFeatures: string[];
  techStack: string[];
  activity: {
    stars: number;
    forks: number;
    openIssues: number;
    activeContributors: number;
    lastUpdate: Date;
    isActive: boolean;
  };
  maturity: "alpha" | "beta" | "stable" | "mature";
  license: string;
  ecosystem: string;
  gettingStarted: string;
  useCases: string[];
  learningCurve: "easy" | "moderate" | "steep";
}

// ============ 联合类型 ============

export type ResourceAISummary =
  | PaperAISummary
  | NewsAISummary
  | VideoAISummary
  | ProjectAISummary
  | StructuredAISummary;

// ============ AI 服务请求/响应类型 ============

/**
 * AI 服务生成结构化摘要的请求
 */
export interface GenerateStructuredSummaryRequest {
  content: string;
  resourceType: "PAPER" | "NEWS" | "YOUTUBE_VIDEO" | "PROJECT" | "OTHER";
  language?: "zh" | "en";
  title?: string;
  abstract?: string;
}

/**
 * AI 服务返回的响应
 */
export interface GenerateStructuredSummaryResponse {
  success: boolean;
  summary: ResourceAISummary;
  model: string;
  tokensUsed?: number;
  generationTime?: number; // ms
}

// ============ 类型守卫函数 ============

/**
 * 检查是否为论文摘要
 */
export function isPaperSummary(
  summary: ResourceAISummary,
): summary is PaperAISummary {
  return "contributions" in summary;
}

/**
 * 检查是否为新闻摘要
 */
export function isNewsSummary(
  summary: ResourceAISummary,
): summary is NewsAISummary {
  return "headline" in summary && "newsFactor" in summary;
}

/**
 * 检查是否为视频摘要
 */
export function isVideoSummary(
  summary: ResourceAISummary,
): summary is VideoAISummary {
  return "chapters" in summary && "speakers" in summary;
}

/**
 * 检查是否为项目摘要
 */
export function isProjectSummary(
  summary: ResourceAISummary,
): summary is ProjectAISummary {
  return "projectName" in summary && "techStack" in summary;
}

/**
 * 检查是否为结构化摘要
 */
export function isStructuredAISummary(
  summary: unknown,
): summary is ResourceAISummary {
  return !!(
    summary &&
    typeof summary === "object" &&
    "overview" in summary &&
    "category" in summary &&
    "keyPoints" in summary &&
    "confidence" in summary &&
    "generatedAt" in summary
  );
}

// ============ 降级函数 ============

/**
 * 将普通文本摘要转换为结构化摘要（降级方案）
 * 当AI服务还没有返回结构化格式时使用
 */
export function convertToStructuredSummary(
  plainSummary: string,
  category: string = "General",
  difficulty:
    | "beginner"
    | "intermediate"
    | "advanced"
    | "expert" = "intermediate",
): StructuredAISummary {
  // 估算阅读时间（中文约100字/分钟，英文约200字/分钟）
  const estimatedReadTime = Math.max(1, Math.ceil(plainSummary.length / 150));

  return {
    overview: plainSummary,
    category,
    subcategories: [],
    keyPoints: [
      plainSummary.substring(0, 100),
      plainSummary.substring(100, 200),
      plainSummary.substring(200, 300),
    ].filter((p) => p.length > 0),
    keywords: [],
    difficulty,
    readingTime: estimatedReadTime,
    confidence: 0.7, // 转换后的摘要置信度较低
    generatedAt: new Date(),
    model: "converted",
  };
}
