/**
 * AI Chat Service Mock for Topic Research Tests
 *
 * Provides mock implementations for AI-related services
 */

import { jest } from "@jest/globals";

/**
 * Sample Leader plan response for testing
 */
export const MOCK_LEADER_PLAN = {
  dimensions: [
    {
      id: "dim-1",
      name: "Market Overview",
      description: "Analysis of the current market landscape",
      searchQueries: ["market analysis 2024", "industry trends"],
    },
    {
      id: "dim-2",
      name: "Competitive Analysis",
      description: "Analysis of key competitors",
      searchQueries: ["competitor analysis", "market share"],
    },
    {
      id: "dim-3",
      name: "Technology Trends",
      description: "Emerging technology trends",
      searchQueries: ["technology trends 2024", "innovation"],
    },
  ],
  agentAssignments: [
    {
      agentId: "researcher-1",
      agentName: "Market Analyst",
      agentType: "dimension_researcher",
      assignedDimensions: ["dim-1"],
      modelId: "gpt-4o-mini",
    },
    {
      agentId: "researcher-2",
      agentName: "Competitive Analyst",
      agentType: "dimension_researcher",
      assignedDimensions: ["dim-2"],
      modelId: "gpt-4o-mini",
    },
    {
      agentId: "researcher-3",
      agentName: "Tech Analyst",
      agentType: "dimension_researcher",
      assignedDimensions: ["dim-3"],
      modelId: "gpt-4o-mini",
    },
  ],
  researchStrategy: "parallel",
  estimatedDuration: 600,
};

/**
 * Sample dimension research result
 */
export const MOCK_DIMENSION_RESEARCH_RESULT = {
  dimensionName: "Market Overview",
  analysis: "The market is growing at 15% annually...",
  keyFindings: [
    "Market size reached $10B in 2024",
    "Top 3 players control 60% of market share",
    "Asia-Pacific region shows fastest growth",
  ],
  sources: [
    {
      title: "Market Report 2024",
      url: "https://example.com/report",
      snippet: "Market analysis shows...",
      publishedAt: "2024-01-15",
    },
  ],
  confidence: 0.85,
};

/**
 * Sample report synthesis result
 */
export const MOCK_REPORT_SYNTHESIS = {
  title: "Comprehensive Market Analysis",
  executiveSummary: "This report provides a comprehensive analysis...",
  sections: [
    {
      title: "Market Overview",
      content: "The market has shown significant growth...",
      citations: [1, 2],
    },
    {
      title: "Competitive Landscape",
      content: "Key competitors include...",
      citations: [3, 4],
    },
  ],
  conclusions: ["Market is growing", "Competition is intensifying"],
  recommendations: ["Focus on innovation", "Expand to Asia-Pacific"],
};

type MockChatResponse = {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  isError?: boolean;
};

type MockModelInfo = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
};

type MockDefaultModel = {
  modelId: string;
  modelName: string;
};

type MockAvailableModel = {
  id: string;
  name?: string;
  provider: string;
  isAvailable?: boolean;
  isReasoning?: boolean;
};

type MockReasoningModel = {
  id: string;
  name: string;
  provider: string;
  isReasoning?: boolean;
};

/**
 * Create a mock AI Chat service
 */
export function createMockAiChat() {
  return {
    chat: jest.fn<() => Promise<MockChatResponse>>().mockResolvedValue({
      content: JSON.stringify(MOCK_LEADER_PLAN),
      usage: {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      },
    }),

    streamChat: jest.fn().mockImplementation(async function* () {
      yield { content: "Analyzing ", done: false };
      yield { content: "the research ", done: false };
      yield { content: "topic...", done: true };
    }),
  };
}

/**
 * Create a mock AI Engine Facade
 */
export function createMockAiEngineFacade() {
  return {
    chat: jest.fn<() => Promise<MockChatResponse>>().mockResolvedValue({
      content: JSON.stringify(MOCK_LEADER_PLAN),
      usage: {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      },
    }),

    chatStructured: jest
      .fn<() => Promise<{ data: unknown; rawContent: string }>>()
      .mockResolvedValue({
        data: MOCK_LEADER_PLAN,
        rawContent: JSON.stringify(MOCK_LEADER_PLAN),
      }),

    chatWithSkills: jest
      .fn<() => Promise<MockChatResponse>>()
      .mockResolvedValue({
        content: JSON.stringify(MOCK_LEADER_PLAN),
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        },
      }),

    streamingChat: jest.fn().mockImplementation(async function* () {
      yield { content: "Analyzing ", done: false };
      yield { content: "the research ", done: false };
      yield { content: "topic...", done: true };
    }),

    getModelInfo: jest.fn<() => MockModelInfo | undefined>().mockReturnValue({
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      provider: "openai",
      contextWindow: 128000,
    }),

    getDefaultModelByType: jest
      .fn<() => Promise<MockDefaultModel>>()
      .mockResolvedValue({
        modelId: "gpt-4o-mini",
        modelName: "GPT-4o Mini",
      }),

    getAvailableModels: jest
      .fn<() => Promise<MockAvailableModel[]>>()
      .mockResolvedValue([
        {
          id: "gpt-4o-mini",
          name: "GPT-4o Mini",
          provider: "openai",
          isAvailable: true,
        },
      ]),

    getAvailableModelsExtended: jest
      .fn<() => Promise<MockAvailableModel[]>>()
      .mockResolvedValue([
        {
          id: "gpt-4o-mini",
          name: "GPT-4o Mini",
          provider: "openai",
          isAvailable: true,
        },
      ]),

    getReasoningModel: jest
      .fn<() => Promise<MockReasoningModel | null>>()
      .mockResolvedValue({
        id: "deepseek-r1",
        name: "DeepSeek R1",
        provider: "deepseek",
        isReasoning: true,
      }),

    selectModel: jest
      .fn<() => Promise<MockReasoningModel | null>>()
      .mockResolvedValue({
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        provider: "openai",
        isReasoning: false,
      }),

    intentDetector: {
      detectIntent: jest.fn().mockReturnValue({
        intent: "GENERAL_CHAT",
        confidence: 0.5,
      }),
    },

    getAvailableTools: jest.fn().mockReturnValue([]),
  };
}

/**
 * Create a mock Research Leader Service response
 */
export function createMockLeaderPlanResponse() {
  return {
    ...MOCK_LEADER_PLAN,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Create mock for dimension research
 */
export function createMockDimensionResearchResponse(dimensionName: string) {
  return {
    ...MOCK_DIMENSION_RESEARCH_RESULT,
    dimensionName,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Types for mock services
 */
export type MockAiChatService = ReturnType<typeof createMockAiChat>;
export type MockAiEngineFacade = ReturnType<typeof createMockAiEngineFacade>;
