/**
 * Event Emitter Mock for Topic Research Tests
 *
 * Provides mock implementations for event-related services
 */

import { jest } from "@jest/globals";

/**
 * Create a mock NestJS EventEmitter2
 */
export function createMockEventEmitter2() {
  return {
    emit: jest.fn<() => boolean>(),
    emitAsync: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    on: jest.fn(),
    once: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn(),
  };
}

/**
 * Create a mock ResearchEventEmitterService
 */
export function createMockResearchEventEmitter() {
  const voidFn = () =>
    jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  return {
    // Mission events
    emitMissionStarted: voidFn(),
    emitMissionProgress: voidFn(),
    emitMissionCompleted: voidFn(),
    emitMissionFailed: voidFn(),

    // Leader events
    emitLeaderThinking: voidFn(),
    emitLeaderPlanning: voidFn(),
    emitLeaderPlanReady: voidFn(),
    emitLeaderResponse: voidFn(),

    // Agent events
    emitAgentWorking: voidFn(),
    emitAgentCompleted: voidFn(),
    emitAgentFailed: voidFn(),

    // Task events
    emitTaskStarted: voidFn(),
    emitTaskProgress: voidFn(),
    emitTaskCompleted: voidFn(),
    emitTaskFailed: voidFn(),

    // Dimension events
    emitDimensionResearchStarted: voidFn(),
    emitDimensionResearchProgress: voidFn(),
    emitDimensionResearchCompleted: voidFn(),

    // Report events
    emitReportSynthesisStarted: voidFn(),
    emitReportSynthesisProgress: voidFn(),
    emitReportSynthesisCompleted: voidFn(),

    // TODO events
    emitTodoCreated: voidFn(),
    emitTodoStatusChanged: voidFn(),
    emitTodoProgress: voidFn(),
    emitTodoCompleted: voidFn(),
    emitTodoFailed: voidFn(),
    emitTodoCancelled: voidFn(),
    emitTodoReviewing: voidFn(),
    emitTodoReviewed: voidFn(),

    // Generic emit
    emitToTopic: voidFn(),

    // Handler registration
    registerEmitHandler: jest.fn(),

    // Message persistence
    saveUserMessage: voidFn(),
    getTeamMessages: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    getAgentActivities: jest
      .fn<() => Promise<unknown[]>>()
      .mockResolvedValue([]),
  };
}

/**
 * Create a mock AgentActivityService
 */
export function createMockAgentActivityService() {
  return {
    recordActivity: jest
      .fn<() => Promise<{ id: string; createdAt: Date }>>()
      .mockResolvedValue({
        id: "activity-123",
        createdAt: new Date(),
      }),
    getActivitiesForMission: jest
      .fn<() => Promise<unknown[]>>()
      .mockResolvedValue([]),
    getActivitiesForTopic: jest
      .fn<() => Promise<unknown[]>>()
      .mockResolvedValue([]),
    getLatestActivityForAgent: jest
      .fn<() => Promise<null>>()
      .mockResolvedValue(null),
    recordDimensionReview: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
    recordOverallReview: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
  };
}

/**
 * Types for mock services
 */
export type MockEventEmitter2 = ReturnType<typeof createMockEventEmitter2>;
export type MockResearchEventEmitter = ReturnType<
  typeof createMockResearchEventEmitter
>;
export type MockAgentActivityService = ReturnType<
  typeof createMockAgentActivityService
>;
