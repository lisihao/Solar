/**
 * AI 提示词配置
 * 定义为不同资源类型生成结构化摘要的提示词
 */

export interface AIPromptTemplate {
  name: string;
  description: string;
  system: string; // 系统提示词
  user: (resourceData: Record<string, unknown>) => string; // 用户提示词生成函数
}

/**
 * 论文摘要生成提示词
 */
export const PaperSummaryPrompt: AIPromptTemplate = {
  name: "paper_summary",
  description: "Generate structured summary for academic papers",
  system: `You are an expert academic paper analyzer. Your task is to generate a structured summary of research papers in JSON format.

Please analyze the paper and extract:
1. Key contributions and findings
2. Research methodology
3. Main results
4. Limitations and future directions
5. Related topics and fields
6. Academic difficulty level

Return ONLY valid JSON without markdown formatting or code blocks.`,

  user: (paper) => `
Analyze this academic paper and generate a structured summary:

Title: ${paper.title}
Abstract: ${paper.abstract}
Content: ${paper.content}

Return JSON with this exact structure:
{
  "overview": "200-300 word comprehensive overview of the paper",
  "category": "Academic",
  "subcategories": ["subfield1", "subfield2"],
  "keyPoints": ["point1", "point2", "point3"],
  "keywords": ["keyword1", "keyword2"],
  "difficulty": "intermediate",
  "readingTime": 15,
  "confidence": 0.9,
  "generatedAt": "2024-01-01T00:00:00Z",
  "model": "<actual-model-id>",
  "contributions": ["contribution1", "contribution2"],
  "methodology": "description of research methodology",
  "results": "main findings and results",
  "limitations": ["limitation1", "limitation2"],
  "futureWork": ["future direction1"],
  "citationContext": {
    "citationCount": 150,
    "h5Index": 25,
    "impactFactor": 5.2
  },
  "relatedTopics": ["related1", "related2"],
  "field": "Computer Science",
  "subfield": "Machine Learning"
}`,
};

/**
 * 新闻文章摘要生成提示词
 */
export const NewsSummaryPrompt: AIPromptTemplate = {
  name: "news_summary",
  description: "Generate structured summary for news articles",
  system: `You are an expert news analyst. Your task is to generate a structured summary of news articles in JSON format.

Please analyze the article and extract:
1. Core news facts
2. Background context
3. Impact and implications
4. Key quotes
5. Related entities (people, organizations, locations)
6. Sentiment and urgency assessment

Return ONLY valid JSON without markdown formatting or code blocks.`,

  user: (news) => `
Analyze this news article and generate a structured summary:

Title: ${news.title}
Content: ${news.content}

Return JSON with this exact structure:
{
  "overview": "200-300 word comprehensive overview",
  "category": "News",
  "subcategories": ["topic1", "topic2"],
  "keyPoints": ["point1", "point2", "point3"],
  "keywords": ["keyword1", "keyword2"],
  "difficulty": "beginner",
  "readingTime": 5,
  "confidence": 0.95,
  "generatedAt": "2024-01-01T00:00:00Z",
  "model": "<actual-model-id>",
  "headline": "Catchy headline summary",
  "coreNews": "Core facts of the news story",
  "background": "Historical context and background information",
  "impact": "Potential impact and implications",
  "quotes": [
    {
      "text": "Direct quote from article",
      "source": "Quote source/attribution"
    }
  ],
  "newsFactor": "breaking",
  "sentiment": "neutral",
  "urgency": "high",
  "relatedEntities": [
    {
      "name": "Entity name",
      "type": "person",
      "relevance": 0.95
    }
  ]
}`,
};

/**
 * 视频摘要生成提示词
 */
export const VideoSummaryPrompt: AIPromptTemplate = {
  name: "video_summary",
  description: "Generate structured summary for video content",
  system: `You are an expert video content analyzer. Your task is to generate a structured summary of video transcripts in JSON format.

Please analyze the video and extract:
1. Main topics and subtopics
2. Key speakers and their expertise
3. Chapter/section breakdown with timestamps
4. Key takeaways and learning points
5. Target audience level
6. Viewing pace and estimated watch time

Return ONLY valid JSON without markdown formatting or code blocks.`,

  user: (video) => `
Analyze this video transcript and generate a structured summary:

Title: ${video.title}
Transcript excerpt: ${video.content}

Return JSON with this exact structure:
{
  "overview": "200-300 word overview of video content",
  "category": "Video",
  "subcategories": ["topic1", "topic2"],
  "keyPoints": ["learning1", "learning2", "learning3"],
  "keywords": ["keyword1", "keyword2"],
  "difficulty": "intermediate",
  "readingTime": 30,
  "confidence": 0.9,
  "generatedAt": "2024-01-01T00:00:00Z",
  "model": "<actual-model-id>",
  "mainTopic": "Main topic of the video",
  "speakers": [
    {
      "name": "Speaker name",
      "role": "Speaker role",
      "expertise": "Area of expertise"
    }
  ],
  "chapters": [
    {
      "timestamp": 0,
      "title": "Introduction",
      "summary": "Chapter summary"
    }
  ],
  "subtopics": ["subtopic1", "subtopic2"],
  "videoType": "lecture",
  "pace": "normal",
  "audience": "intermediate",
  "estimatedWatchTime": 45,
  "keyFrames": [
    {
      "timestamp": 120,
      "description": "Important moment description",
      "importance": 0.9
    }
  ],
  "keyTimestamps": [
    {
      "time": 180,
      "label": "Key concept introduction"
    }
  ]
}`,
};

/**
 * 开源项目摘要生成提示词
 */
export const ProjectSummaryPrompt: AIPromptTemplate = {
  name: "project_summary",
  description: "Generate structured summary for open source projects",
  system: `You are an expert open source project analyst. Your task is to generate a structured summary of GitHub projects in JSON format.

Please analyze the project and extract:
1. Project purpose and main features
2. Technology stack
3. Project maturity and activity status
4. Use cases and learning curve
5. Getting started guide
6. Project metrics (stars, contributors, etc.)

Return ONLY valid JSON without markdown formatting or code blocks.`,

  user: (project) => `
Analyze this open source project and generate a structured summary:

Project Name: ${project.title}
README: ${project.content}

Return JSON with this exact structure:
{
  "overview": "200-300 word comprehensive project overview",
  "category": "Technology",
  "subcategories": ["category1", "category2"],
  "keyPoints": ["feature1", "feature2", "feature3"],
  "keywords": ["keyword1", "keyword2"],
  "difficulty": "intermediate",
  "readingTime": 10,
  "confidence": 0.88,
  "generatedAt": "2024-01-01T00:00:00Z",
  "model": "<actual-model-id>",
  "projectName": "Project full name",
  "purpose": "What the project does and solves",
  "mainFeatures": ["feature1", "feature2", "feature3"],
  "techStack": ["tech1", "tech2", "tech3"],
  "activity": {
    "stars": 5000,
    "forks": 1200,
    "openIssues": 45,
    "activeContributors": 28,
    "lastUpdate": "2024-01-15T00:00:00Z",
    "isActive": true
  },
  "maturity": "stable",
  "license": "MIT",
  "ecosystem": "Node.js/JavaScript",
  "gettingStarted": "Quick start guide/installation instructions",
  "useCases": ["use case1", "use case2"],
  "learningCurve": "moderate"
}`,
};

/**
 * 获取指定类型的提示词模板
 */
export function getPromptTemplate(resourceType: string): AIPromptTemplate {
  const templates: Record<string, AIPromptTemplate> = {
    PAPER: PaperSummaryPrompt,
    NEWS: NewsSummaryPrompt,
    YOUTUBE_VIDEO: VideoSummaryPrompt,
    PROJECT: ProjectSummaryPrompt,
  };

  return (
    templates[resourceType] || {
      name: "generic_summary",
      description: "Generic summary for unknown resource type",
      system: `You are a content analyzer. Generate a structured summary in JSON format.`,
      user: (resource) => `
Analyze this content:
Title: ${resource.title}
Content: ${resource.content}

Return valid JSON with: overview, category, subcategories, keyPoints, keywords, difficulty, readingTime, confidence, generatedAt, model`,
    }
  );
}

/**
 * 提示词使用示例和最佳实践
 */
export const PromptBestPractices = {
  /**
   * 调用 AI 服务时使用 TaskProfile（必须通过 AiChatService + taskProfile 传递，禁止硬编码参数）
   *
   * 推荐配置: { creativity: "medium", outputLength: "short" }
   * - creativity: "medium" → 平衡创意和准确性
   * - outputLength: "short" → 足以容纳结构化 JSON 输出
   */
  requestDefaults: {
    taskProfile: { creativity: "medium", outputLength: "short" } as const,
  },

  /**
   * 验证 AI 响应的检查清单
   */
  validationChecklist: [
    "✓ 响应是有效的 JSON",
    "✓ 包含所有必需字段",
    "✓ overview 字段 200-300 字",
    "✓ keyPoints 数组有 3-5 个项目",
    "✓ confidence 值在 0-1 之间",
    "✓ generatedAt 是有效的 ISO 8601 日期",
    "✓ difficulty 值是允许的之一",
    "✓ 没有 markdown 格式化",
  ],

  /**
   * 降级策略
   */
  fallbackStrategies: [
    "1. 尝试重新请求 AI 服务",
    "2. 使用 convertToStructuredSummary() 从普通摘要转换",
    "3. 返回最小化的结构化数据（只有必需字段）",
    "4. 记录错误并返回 null",
  ],

  /**
   * 性能优化建议
   */
  performanceOptimizations: [
    "- 缓存 AI 响应以避免重复生成",
    "- 对大内容进行分块处理",
    "- 使用流式处理长文本",
    "- 并行处理多个资源",
    "- 实现响应缓存策略（24小时）",
  ],
};

/**
 * 验证 JSON 响应是否符合结构化摘要格式
 */
export function validateStructuredResponse(
  response: Record<string, unknown>,
  resourceType: string = "PAPER",
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 检查基础字段
  if (!response.overview || typeof response.overview !== "string") {
    errors.push("Missing or invalid overview");
  }
  if (!response.category || typeof response.category !== "string") {
    errors.push("Missing or invalid category");
  }
  if (!Array.isArray(response.keyPoints) || response.keyPoints.length === 0) {
    errors.push("Missing or invalid keyPoints");
  }
  if (
    typeof response.confidence !== "number" ||
    response.confidence < 0 ||
    response.confidence > 1
  ) {
    errors.push("Invalid confidence value");
  }

  // 检查类型特定字段
  if (resourceType === "PAPER") {
    if (!Array.isArray(response.contributions)) {
      errors.push("PAPER: Missing or invalid contributions");
    }
  } else if (resourceType === "NEWS") {
    if (!response.headline || typeof response.headline !== "string") {
      errors.push("NEWS: Missing or invalid headline");
    }
  } else if (resourceType === "YOUTUBE_VIDEO") {
    if (!Array.isArray(response.speakers)) {
      errors.push("VIDEO: Missing or invalid speakers");
    }
  } else if (resourceType === "PROJECT") {
    if (!response.projectName || typeof response.projectName !== "string") {
      errors.push("PROJECT: Missing or invalid projectName");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
