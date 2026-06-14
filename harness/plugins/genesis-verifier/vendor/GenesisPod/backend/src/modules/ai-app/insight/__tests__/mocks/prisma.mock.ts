/**
 * Prisma Mock for Topic Research Tests
 *
 * Provides a mock implementation of PrismaService for unit testing
 */

import { jest } from "@jest/globals";

/** Helper: create a mock function that accepts any resolved value */
const fn = () => jest.fn<() => Promise<unknown>>();

/**
 * Create a mock Prisma service with all commonly used methods
 */
export function createMockPrisma() {
  return {
    // ResearchTopic
    researchTopic: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      count: fn(),
    },

    // ResearchMission
    researchMission: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      updateMany: fn(),
      delete: fn(),
      count: fn(),
    },

    // ResearchTask
    researchTask: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      createMany: fn(),
      update: fn(),
      updateMany: fn(),
      delete: fn(),
      count: fn(),
    },

    // ResearchTodo
    researchTodo: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      createMany: fn(),
      update: fn(),
      updateMany: fn(),
      delete: fn(),
      count: fn(),
    },

    // TopicReport
    topicReport: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      deleteMany: fn(),
    },

    // TopicEvidence
    topicEvidence: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      createMany: fn(),
      update: fn(),
      updateMany: fn(),
      delete: fn(),
      deleteMany: fn(),
      aggregate: fn(),
    },

    // TopicDimension
    topicDimension: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      createMany: fn(),
      update: fn(),
      upsert: fn(),
      delete: fn(),
    },

    // LeaderDecision
    leaderDecision: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
    },

    // TopicCollaborator
    topicCollaborator: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
    },

    // AgentActivity
    agentActivity: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
    },

    // KnowledgeBase
    knowledgeBase: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
    },

    // DefaultModel
    defaultModel: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
    },

    // User model for JWT authentication
    user: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
    },

    // Transaction support
    $transaction: jest.fn().mockImplementation((callback: unknown) => {
      if (typeof callback === "function") {
        return (callback as (arg: unknown) => unknown)({});
      }
      return Promise.resolve([]);
    }),

    // Raw query (should not be used after Phase 1 security fixes)
    $queryRaw: fn(),
  };
}

/**
 * Type for the mock Prisma service
 */
export type MockPrismaService = ReturnType<typeof createMockPrisma>;
