/**
 * EventEmitter2 Mock for Slides Tests
 */

import { jest } from "@jest/globals";

/**
 * Create a mock EventEmitter2 service
 */
export function createMockEventEmitter() {
  return {
    emit: jest.fn<() => boolean>(),
    emitAsync: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    on: jest.fn(),
    once: jest.fn(),
    onAny: jest.fn(),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn(),
    listeners: jest.fn<() => unknown[]>().mockReturnValue([]),
    listenerCount: jest.fn<() => number>().mockReturnValue(0),
    hasListeners: jest.fn<() => boolean>().mockReturnValue(false),
  };
}

/**
 * Type for the mock EventEmitter
 */
export type MockEventEmitter = ReturnType<typeof createMockEventEmitter>;
