/**
 * Test Fixtures for Topic Research
 *
 * Provides sample data for testing
 *
 * Note: We use string literals instead of Prisma enum imports
 * because Jest has issues resolving @prisma/client enums at runtime.
 * Type checking is disabled for this file due to Jest mock compatibility issues.
 */

import type {
  ResearchMissionStatus,
  ResearchTaskStatus,
  ResearchTodoStatus,
  ResearchTopicType,
  TopicVisibility,
  ResearchTodoType,
} from "@prisma/client";

// ==================== Topics ====================

export const MOCK_TOPIC = {
  id: "topic-123",
  name: "AI Market Analysis 2024",
  description: "Comprehensive analysis of the AI market",
  type: "MACRO" as ResearchTopicType,
  visibility: "PRIVATE" as TopicVisibility,
  userId: "user-123",
  topicConfig: {
    searchTimeRange: "month",
    knowledgeBaseIds: ["kb-1", "kb-2"],
    enableKnowledgeBase: true,
    maxDimensions: 5,
  },
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-15"),
};

export const MOCK_PUBLIC_TOPIC = {
  ...MOCK_TOPIC,
  id: "topic-456",
  visibility: "PUBLIC" as TopicVisibility,
};

export const MOCK_SHARED_TOPIC = {
  ...MOCK_TOPIC,
  id: "topic-789",
  visibility: "SHARED" as TopicVisibility,
};

// ==================== Dimensions ====================

export const MOCK_DIMENSIONS = [
  {
    id: "dim-1",
    topicId: "topic-123",
    name: "Market Overview",
    description: "Analysis of the current market landscape",
    sortOrder: 1,
    status: "COMPLETED",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-15"),
  },
  {
    id: "dim-2",
    topicId: "topic-123",
    name: "Competitive Analysis",
    description: "Analysis of key competitors",
    sortOrder: 2,
    status: "COMPLETED",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-15"),
  },
  {
    id: "dim-3",
    topicId: "topic-123",
    name: "Technology Trends",
    description: "Emerging technology trends",
    sortOrder: 3,
    status: "PENDING",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-15"),
  },
];

// ==================== Missions ====================

export const MOCK_MISSION_PLANNING = {
  id: "mission-planning",
  topicId: "topic-123",
  status: "PLANNING" as ResearchMissionStatus,
  leaderModelId: "gpt-4o",
  leaderModelName: "GPT-4o",
  leaderPlan: null,
  userPrompt: "Analyze the AI market",
  userContext: {},
  totalTasks: 0,
  completedTasks: 0,
  progressPercent: 0,
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15"),
};

export const MOCK_MISSION_EXECUTING = {
  id: "mission-executing",
  topicId: "topic-123",
  status: "EXECUTING" as ResearchMissionStatus,
  leaderModelId: "gpt-4o",
  leaderModelName: "GPT-4o",
  leaderPlan: {
    dimensions: MOCK_DIMENSIONS.map((d) => ({ id: d.id, name: d.name })),
    agentAssignments: [
      { agentId: "researcher-1", assignedDimensions: ["dim-1"] },
      { agentId: "researcher-2", assignedDimensions: ["dim-2"] },
    ],
  },
  userPrompt: "Analyze the AI market",
  userContext: {},
  totalTasks: 4,
  completedTasks: 2,
  progressPercent: 50,
  startedAt: new Date("2024-01-15T10:00:00"),
  completedAt: null,
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15T11:00:00"),
};

export const MOCK_MISSION_COMPLETED = {
  id: "mission-completed",
  topicId: "topic-123",
  status: "COMPLETED" as ResearchMissionStatus,
  leaderModelId: "gpt-4o",
  leaderModelName: "GPT-4o",
  leaderPlan: {
    dimensions: MOCK_DIMENSIONS.map((d) => ({ id: d.id, name: d.name })),
    agentAssignments: [
      { agentId: "researcher-1", assignedDimensions: ["dim-1"] },
      { agentId: "researcher-2", assignedDimensions: ["dim-2"] },
    ],
  },
  userPrompt: "Analyze the AI market",
  userContext: {},
  totalTasks: 4,
  completedTasks: 4,
  progressPercent: 100,
  startedAt: new Date("2024-01-15T10:00:00"),
  completedAt: new Date("2024-01-15T12:00:00"),
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15T12:00:00"),
};

// ==================== Tasks ====================

export const MOCK_TASK_PENDING = {
  id: "task-pending",
  missionId: "mission-executing",
  taskType: "dimension_research",
  title: "Research Technology Trends",
  description: "Research emerging technology trends",
  dimensionId: "dim-3",
  dimensionName: "Technology Trends",
  assignedAgent: "researcher-3",
  assignedAgentType: "dimension_researcher",
  priority: 1,
  status: "PENDING" as ResearchTaskStatus,
  dependencies: [],
  result: null,
  resultSummary: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15"),
};

export const MOCK_TASK_EXECUTING = {
  id: "task-executing",
  missionId: "mission-executing",
  taskType: "dimension_research",
  title: "Research Competitive Analysis",
  description: "Research key competitors",
  dimensionId: "dim-2",
  dimensionName: "Competitive Analysis",
  assignedAgent: "researcher-2",
  assignedAgentType: "dimension_researcher",
  priority: 2,
  status: "EXECUTING" as ResearchTaskStatus,
  dependencies: [],
  result: null,
  resultSummary: null,
  startedAt: new Date("2024-01-15T10:30:00"),
  completedAt: null,
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15T10:30:00"),
};

export const MOCK_TASK_COMPLETED = {
  id: "task-completed",
  missionId: "mission-executing",
  taskType: "dimension_research",
  title: "Research Market Overview",
  description: "Research market landscape",
  dimensionId: "dim-1",
  dimensionName: "Market Overview",
  assignedAgent: "researcher-1",
  assignedAgentType: "dimension_researcher",
  priority: 1,
  status: "COMPLETED" as ResearchTaskStatus,
  dependencies: [],
  result: {
    analysis: "Market analysis completed",
    sources: 5,
    keyFindings: ["Finding 1", "Finding 2"],
  },
  resultSummary: "Completed analysis of market landscape",
  startedAt: new Date("2024-01-15T10:00:00"),
  completedAt: new Date("2024-01-15T10:30:00"),
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15T10:30:00"),
};

// ==================== TODOs ====================

export const MOCK_TODO_PENDING = {
  id: "todo-pending",
  topicId: "topic-123",
  missionId: "mission-executing",
  type: "DIMENSION_RESEARCH" as ResearchTodoType,
  title: "Research Technology Trends dimension",
  description: "Research the technology trends dimension",
  dimensionId: "dim-3",
  dimensionName: "Technology Trends",
  agentId: "researcher-3",
  agentName: "Tech Analyst",
  agentRole: "researcher",
  modelId: "gpt-4o-mini",
  status: "PENDING" as ResearchTodoStatus,
  progress: 0,
  statusMessage: null,
  priority: 1,
  dependsOn: [],
  startedAt: null,
  completedAt: null,
  estimatedMs: 60000,
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15"),
};

export const MOCK_TODO_IN_PROGRESS = {
  id: "todo-in-progress",
  topicId: "topic-123",
  missionId: "mission-executing",
  type: "DIMENSION_RESEARCH" as ResearchTodoType,
  title: "Research Competitive Analysis dimension",
  description: "Research the competitive analysis dimension",
  dimensionId: "dim-2",
  dimensionName: "Competitive Analysis",
  agentId: "researcher-2",
  agentName: "Competitive Analyst",
  agentRole: "researcher",
  modelId: "gpt-4o-mini",
  status: "IN_PROGRESS" as ResearchTodoStatus,
  progress: 50,
  statusMessage: "Analyzing competitor data...",
  priority: 2,
  dependsOn: [],
  startedAt: new Date("2024-01-15T10:30:00"),
  completedAt: null,
  estimatedMs: 60000,
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15T10:45:00"),
};

export const MOCK_TODO_COMPLETED = {
  id: "todo-completed",
  topicId: "topic-123",
  missionId: "mission-executing",
  type: "DIMENSION_RESEARCH" as ResearchTodoType,
  title: "Research Market Overview dimension",
  description: "Research the market overview dimension",
  dimensionId: "dim-1",
  dimensionName: "Market Overview",
  agentId: "researcher-1",
  agentName: "Market Analyst",
  agentRole: "researcher",
  modelId: "gpt-4o-mini",
  status: "COMPLETED" as ResearchTodoStatus,
  progress: 100,
  statusMessage: "Completed",
  priority: 1,
  dependsOn: [],
  startedAt: new Date("2024-01-15T10:00:00"),
  completedAt: new Date("2024-01-15T10:30:00"),
  estimatedMs: 60000,
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15T10:30:00"),
};

// ==================== Reports ====================

export const MOCK_REPORT = {
  id: "report-123",
  topicId: "topic-123",
  title: "AI Market Analysis Report",
  executiveSummary: "This report provides comprehensive analysis...",
  fullReport: "<h1>AI Market Analysis</h1><p>Content here...</p>",
  version: 1,
  status: "DRAFT",
  generatedAt: new Date("2024-01-15T12:00:00"),
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15T12:00:00"),
};

// ==================== Evidence ====================

export const MOCK_EVIDENCES = [
  {
    id: "evidence-1",
    reportId: "report-123",
    title: "AI Market Report 2024",
    url: "https://example.com/report",
    domain: "example.com",
    snippet: "The AI market is expected to grow...",
    sourceType: "web",
    publishedAt: new Date("2024-01-10"),
    credibilityScore: 0.85,
    citationIndex: 1,
    analysisId: null,
    createdAt: new Date("2024-01-15"),
    updatedAt: new Date("2024-01-15"),
  },
  {
    id: "evidence-2",
    reportId: "report-123",
    title: "Industry Analysis",
    url: "https://example.com/industry",
    domain: "example.com",
    snippet: "Key industry trends show...",
    sourceType: "web",
    publishedAt: new Date("2024-01-12"),
    credibilityScore: 0.9,
    citationIndex: 2,
    analysisId: null,
    createdAt: new Date("2024-01-15"),
    updatedAt: new Date("2024-01-15"),
  },
];

// ==================== Users ====================

export const MOCK_USER = {
  id: "user-123",
  email: "test@example.com",
  name: "Test User",
};

export const MOCK_COLLABORATOR = {
  id: "collaborator-1",
  topicId: "topic-123",
  userId: "user-456",
  role: "EDITOR",
  isActive: true,
  invitedBy: "user-123",
  createdAt: new Date("2024-01-05"),
  updatedAt: new Date("2024-01-05"),
};

// ==================== Helper Functions ====================

/**
 * Create a topic with custom overrides
 */
export function createMockTopic(overrides: Partial<typeof MOCK_TOPIC> = {}) {
  return { ...MOCK_TOPIC, ...overrides };
}

/**
 * Create a mission with custom overrides
 */
export function createMockMission(
  overrides: Partial<typeof MOCK_MISSION_EXECUTING> = {},
) {
  return { ...MOCK_MISSION_EXECUTING, ...overrides };
}

/**
 * Create a task with custom overrides
 */
export function createMockTask(
  overrides: Partial<typeof MOCK_TASK_EXECUTING> = {},
) {
  return { ...MOCK_TASK_EXECUTING, ...overrides };
}

/**
 * Create a todo with custom overrides
 */
export function createMockTodo(
  overrides: Partial<typeof MOCK_TODO_IN_PROGRESS> = {},
) {
  return { ...MOCK_TODO_IN_PROGRESS, ...overrides };
}

/**
 * Create a mission with tasks for testing
 * Overrides completedTasks/totalTasks to match the actual tasks array
 */
export function createMockMissionWithTasks() {
  return {
    ...MOCK_MISSION_EXECUTING,
    totalTasks: 3,
    completedTasks: 1, // Only MOCK_TASK_COMPLETED is completed
    progressPercent: 33,
    tasks: [MOCK_TASK_COMPLETED, MOCK_TASK_EXECUTING, MOCK_TASK_PENDING],
    topic: MOCK_TOPIC,
  };
}
