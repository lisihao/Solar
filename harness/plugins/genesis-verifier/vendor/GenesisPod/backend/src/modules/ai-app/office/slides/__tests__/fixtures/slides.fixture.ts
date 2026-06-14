/**
 * Slides Test Fixtures
 *
 * Provides test data for slides module unit tests.
 */

import {
  SlidesMissionStatus,
  SlidesTaskStatus,
  SlidesSessionStatus,
  SlidesCheckpointType,
} from "@prisma/client";

// ==================== Session Fixtures ====================

export const mockUserId = "user-123";

export const mockSession = {
  id: "session-1",
  userId: mockUserId,
  title: "Test Presentation",
  status: SlidesSessionStatus.ACTIVE,
  currentStateId: "checkpoint-1",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

export const mockSessions = [
  mockSession,
  {
    id: "session-2",
    userId: mockUserId,
    title: "Another Presentation",
    status: SlidesSessionStatus.COMPLETED,
    currentStateId: "checkpoint-2",
    createdAt: new Date("2024-01-02T00:00:00Z"),
    updatedAt: new Date("2024-01-02T00:00:00Z"),
  },
];

// ==================== Mission Fixtures ====================

export const mockMission = {
  id: "mission-1",
  sessionId: "session-1",
  userId: mockUserId,
  status: SlidesMissionStatus.EXECUTING,
  totalTasks: 10,
  completedTasks: 5,
  startedAt: new Date("2024-01-01T00:00:00Z"),
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:30:00Z"),
  completedAt: null,
  errorMessage: null,
  metadata: {},
  pages: [
    { index: 0, title: "Title Slide", html: "<div>Title</div>" },
    { index: 1, title: "Content Slide", html: "<div>Content</div>" },
  ],
};

export const mockStuckMission = {
  ...mockMission,
  id: "mission-stuck",
  // Updated 40 minutes ago (past stuck threshold)
  updatedAt: new Date(Date.now() - 40 * 60 * 1000),
  tasks: [],
};

export const mockMissionWithExecutingTasks = {
  ...mockMission,
  id: "mission-with-tasks",
  // Updated 40 minutes ago but has executing tasks
  updatedAt: new Date(Date.now() - 40 * 60 * 1000),
  tasks: [
    {
      id: "task-1",
      status: SlidesTaskStatus.IN_PROGRESS,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
    },
  ],
};

export const mockCompletedMission = {
  ...mockMission,
  id: "mission-completed",
  status: SlidesMissionStatus.COMPLETED,
  progressPercent: 100,
  completedAt: new Date("2024-01-01T01:00:00Z"),
};

// ==================== Task Fixtures ====================

export const mockTask = {
  id: "task-1",
  missionId: "mission-1",
  type: "render_page",
  status: SlidesTaskStatus.PENDING,
  input: { pageIndex: 0 },
  output: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
};

export const mockTasks = [
  mockTask,
  {
    id: "task-2",
    missionId: "mission-1",
    type: "render_page",
    status: SlidesTaskStatus.COMPLETED,
    input: { pageIndex: 1 },
    output: { html: "<div>Rendered</div>" },
    startedAt: new Date("2024-01-01T00:10:00Z"),
    completedAt: new Date("2024-01-01T00:15:00Z"),
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:15:00Z"),
  },
];

// ==================== Checkpoint Fixtures ====================

export const mockCheckpoint = {
  id: "checkpoint-1",
  sessionId: "session-1",
  name: "Task Decomposition",
  type: SlidesCheckpointType.TASK_DECOMPOSITION,
  version: "1.0.0",
  stateJson: {
    taskDecomposition: { totalPages: 5 },
    outlinePlan: null,
    pages: [],
    globalStyles: {},
  },
  metadata: { trigger: "auto" },
  createdAt: new Date("2024-01-01T00:00:00Z"),
};

export const mockCheckpoints = [
  mockCheckpoint,
  {
    id: "checkpoint-2",
    sessionId: "session-1",
    name: "Page Rendered (2/5)",
    type: SlidesCheckpointType.PAGE_RENDERED,
    version: "1.0.1",
    stateJson: {
      taskDecomposition: { totalPages: 5 },
      outlinePlan: { pages: [] },
      pages: [{ pageNumber: 0, status: "completed" }],
      globalStyles: {},
    },
    metadata: { trigger: "auto", previousCheckpointId: "checkpoint-1" },
    createdAt: new Date("2024-01-01T00:10:00Z"),
  },
];

// ==================== Generate DTO Fixtures ====================

export const mockGenerateDto = {
  title: "AI in Healthcare",
  sourceText: "Artificial intelligence is transforming healthcare...",
  userRequirement: "Focus on diagnostic applications",
  targetPages: 10,
  stylePreference: "dark" as const,
  targetAudience: "Medical professionals",
  themeId: "modern-dark",
};

export const mockMinimalGenerateDto = {
  title: "Simple Presentation",
  sourceText: "Basic content for the presentation.",
};

// ==================== Import Source Fixtures ====================

export const mockResearchTopic = {
  id: "research-topic-1",
  userId: mockUserId,
  name: "AI Market Analysis",
  description: "Deep dive into AI market trends",
  language: "zh",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  reports: [
    {
      id: "report-1",
      fullReport: "This is the full research report...",
      charts: [],
      highlights: ["Key finding 1", "Key finding 2"],
      dimensionAnalyses: [],
    },
  ],
  dimensions: [
    {
      name: "Market Size",
      description: "Analysis of market size",
      sortOrder: 0,
    },
  ],
};

export const mockWritingProject = {
  id: "writing-project-1",
  ownerId: mockUserId,
  name: "Tech Book",
  genre: "Non-fiction",
  writingStyle: "Technical",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  volumes: [
    {
      id: "volume-1",
      title: "Introduction",
      volumeNumber: 1,
      chapters: [
        {
          id: "chapter-1",
          title: "Chapter 1",
          content: "Content...",
          chapterNumber: 1,
        },
      ],
    },
  ],
  storyBible: null,
};

export const mockTeamsTopic = {
  id: "teams-topic-1",
  name: "Product Strategy Discussion",
  description: "Discussing Q1 product roadmap",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  messages: [
    {
      id: "msg-1",
      content: "We should focus on user retention.",
      senderId: null,
      aiMemberId: "ai-member-1",
      sender: null,
      aiMember: {
        id: "ai-member-1",
        displayName: "Strategy Expert",
        roleDescription: "Strategic planning",
      },
      createdAt: new Date("2024-01-01T00:10:00Z"),
    },
  ],
  aiMembers: [{ id: "ai-member-1", displayName: "Strategy Expert" }],
};

// ==================== Request Fixtures ====================

export const mockAuthenticatedRequest = {
  user: {
    id: mockUserId,
    email: "test@example.com",
    name: "Test User",
  },
};
