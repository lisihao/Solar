/**
 * Prisma Mock for Slides Tests
 *
 * Provides a mock implementation of PrismaService for unit testing slides module.
 */

import { jest } from "@jest/globals";

/** Helper: create a mock function that accepts any resolved value */
const fn = () => jest.fn<() => Promise<unknown>>();

/**
 * Create a mock Prisma service with all slides-related methods
 */
export function createMockPrisma() {
  return {
    // SlidesSession
    slidesSession: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      count: fn(),
    },

    // SlidesMission
    slidesMission: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      deleteMany: fn(),
      count: fn(),
    },

    // SlidesTask
    slidesTask: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      createMany: fn(),
      update: fn(),
      updateMany: fn(),
      delete: fn(),
      deleteMany: fn(),
      count: fn(),
    },

    // SlidesCheckpoint
    slidesCheckpoint: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      update: fn(),
      delete: fn(),
      deleteMany: fn(),
      count: fn(),
    },

    // SlidesMissionEvent
    slidesMissionEvent: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
      create: fn(),
      createMany: fn(),
      delete: fn(),
      deleteMany: fn(),
    },

    // ResearchTopic (for import)
    researchTopic: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
    },

    // WritingProject (for import)
    writingProject: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
    },

    // Topic (AI Teams - for import)
    topic: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
    },

    // Resource (Library - for import)
    resource: {
      findUnique: fn(),
      findFirst: fn(),
      findMany: fn(),
    },

    // User
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

    // Raw query
    $queryRaw: fn(),
  };
}

/**
 * Type for the mock Prisma service
 */
export type MockPrismaService = ReturnType<typeof createMockPrisma>;
