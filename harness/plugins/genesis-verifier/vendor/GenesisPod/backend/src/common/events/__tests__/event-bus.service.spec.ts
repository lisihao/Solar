/**
 * EventBusService Unit Tests
 *
 * Tests for unified event bus service that handles cross-module communication.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Logger } from "@nestjs/common";
import { EventBusService, EventPayload } from "../event-bus.service";

describe("EventBusService", () => {
  let service: EventBusService;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockEventEmitter = {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventBusService,
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<EventBusService>(EventBusService);
    eventEmitter = module.get(EventEmitter2);

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("publish", () => {
    it("should publish event with enriched payload", () => {
      // Arrange
      const event = "mission:completed";
      const payload: EventPayload = {
        missionId: "test-123",
        result: "success",
      };

      // Act
      service.publish(event, payload);

      // Assert
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        event,
        expect.objectContaining({
          missionId: "test-123",
          result: "success",
          timestamp: expect.any(Number),
        }),
      );
    });

    it("should add timestamp if not provided", () => {
      // Arrange
      const event = "task:started";
      const payload: EventPayload = { taskId: "task-1" };
      const beforeTime = Date.now();

      // Act
      service.publish(event, payload);

      // Assert
      const emittedPayload = eventEmitter.emit.mock.calls[0][1];
      expect(emittedPayload.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(emittedPayload.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it("should preserve existing timestamp", () => {
      // Arrange
      const event = "task:completed";
      const customTimestamp = 1234567890;
      const payload: EventPayload = {
        taskId: "task-1",
        timestamp: customTimestamp,
      };

      // Act
      service.publish(event, payload);

      // Assert
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        event,
        expect.objectContaining({
          timestamp: customTimestamp,
        }),
      );
    });

    it("should notify local subscribers", () => {
      // Arrange
      const event = "mission:completed";
      const handler = jest.fn();
      service.subscribe(event, handler);
      const payload: EventPayload = { missionId: "test-123" };

      // Act
      service.publish(event, payload);

      // Assert
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          missionId: "test-123",
          timestamp: expect.any(Number),
        }),
      );
    });

    it("should handle multiple subscribers for same event", () => {
      // Arrange
      const event = "task:started";
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();
      service.subscribe(event, handler1);
      service.subscribe(event, handler2);
      service.subscribe(event, handler3);
      const payload: EventPayload = { taskId: "task-1" };

      // Act
      service.publish(event, payload);

      // Assert
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler3).toHaveBeenCalledTimes(1);
      expect(handler1).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1" }),
      );
    });

    it("should continue publishing if one handler throws error", () => {
      // Arrange
      const event = "task:failed";
      const handler1 = jest.fn();
      const handler2 = jest.fn(() => {
        throw new Error("Handler error");
      });
      const handler3 = jest.fn();
      service.subscribe(event, handler1);
      service.subscribe(event, handler2);
      service.subscribe(event, handler3);

      // Act
      service.publish(event, { taskId: "task-1" });

      // Assert
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();
    });

    it("should handle async handler errors gracefully", async () => {
      // Arrange
      const event = "task:started";
      const asyncHandler = jest.fn(async () => {
        throw new Error("Async error");
      });
      service.subscribe(event, asyncHandler);

      // Act
      service.publish(event, { taskId: "task-1" });

      // Wait for async handler to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Assert
      expect(asyncHandler).toHaveBeenCalled();
      // Should not throw - error should be caught and logged
    });

    it("should not throw if no subscribers exist", () => {
      // Arrange
      const event = "nonexistent:event";
      const payload: EventPayload = { data: "test" };

      // Act & Assert
      expect(() => service.publish(event, payload)).not.toThrow();
    });
  });

  describe("subscribe", () => {
    it("should subscribe to event and return subscription handle", () => {
      // Arrange
      const event = "mission:started";
      const handler = jest.fn();

      // Act
      const subscription = service.subscribe(event, handler);

      // Assert
      expect(subscription).toHaveProperty("unsubscribe");
      expect(typeof subscription.unsubscribe).toBe("function");
      expect(eventEmitter.on).toHaveBeenCalledWith(event, handler);
    });

    it("should increment handler count when subscribing", () => {
      // Arrange
      const event = "task:completed";
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      // Act
      expect(service.getHandlerCount(event)).toBe(0);
      service.subscribe(event, handler1);
      expect(service.getHandlerCount(event)).toBe(1);
      service.subscribe(event, handler2);
      expect(service.getHandlerCount(event)).toBe(2);
    });

    it("should not duplicate same handler in Set", () => {
      // Arrange
      const event = "task:started";
      const handler = jest.fn();

      // Act
      service.subscribe(event, handler);
      service.subscribe(event, handler);

      // Assert
      // Set prevents duplicates, so count should be 1
      expect(service.getHandlerCount(event)).toBe(1);
    });

    it("should register with both local subscriptions and EventEmitter2", () => {
      // Arrange
      const event = "mission:completed";
      const handler = jest.fn();

      // Act
      service.subscribe(event, handler);

      // Assert
      expect(service.hasSubscribers(event)).toBe(true);
      expect(eventEmitter.on).toHaveBeenCalledWith(event, handler);
    });
  });

  describe("unsubscribe", () => {
    it("should remove handler when unsubscribe is called", () => {
      // Arrange
      const event = "task:completed";
      const handler = jest.fn();
      const subscription = service.subscribe(event, handler);

      // Act
      subscription.unsubscribe();

      // Assert
      expect(service.getHandlerCount(event)).toBe(0);
      expect(eventEmitter.off).toHaveBeenCalledWith(event, handler);
    });

    it("should not call unsubscribed handler", () => {
      // Arrange
      const event = "task:started";
      const handler = jest.fn();
      const subscription = service.subscribe(event, handler);

      // Act
      subscription.unsubscribe();
      service.publish(event, { taskId: "task-1" });

      // Assert
      expect(handler).not.toHaveBeenCalled();
    });

    it("should only remove specific handler when multiple exist", () => {
      // Arrange
      const event = "task:completed";
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();
      service.subscribe(event, handler1);
      const subscription2 = service.subscribe(event, handler2);
      service.subscribe(event, handler3);

      // Act
      subscription2.unsubscribe();
      service.publish(event, { taskId: "task-1" });

      // Assert
      expect(handler1).toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();
      expect(service.getHandlerCount(event)).toBe(2);
    });

    it("should be safe to call unsubscribe multiple times", () => {
      // Arrange
      const event = "task:started";
      const handler = jest.fn();
      const subscription = service.subscribe(event, handler);

      // Act & Assert
      expect(() => {
        subscription.unsubscribe();
        subscription.unsubscribe();
        subscription.unsubscribe();
      }).not.toThrow();
    });
  });

  describe("once", () => {
    it("should call handler only once", () => {
      // Arrange
      const event = "task:completed";
      const handler = jest.fn();
      service.once(event, handler);

      // Act
      service.publish(event, { taskId: "task-1" });
      service.publish(event, { taskId: "task-2" });
      service.publish(event, { taskId: "task-3" });

      // Assert
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-1" }),
      );
    });

    it("should automatically unsubscribe after first call", () => {
      // Arrange
      const event = "mission:started";
      const handler = jest.fn();
      service.once(event, handler);
      const initialCount = service.getHandlerCount(event);

      // Act
      service.publish(event, { missionId: "mission-1" });

      // Assert
      expect(service.getHandlerCount(event)).toBe(initialCount - 1);
    });

    it("should return subscription handle that can be manually unsubscribed", () => {
      // Arrange
      const event = "task:started";
      const handler = jest.fn();
      const subscription = service.once(event, handler);

      // Act
      subscription.unsubscribe();
      service.publish(event, { taskId: "task-1" });

      // Assert
      expect(handler).not.toHaveBeenCalled();
    });

    it("should work with async handlers", async () => {
      // Arrange
      const event = "task:completed";
      let callCount = 0;
      const asyncHandler = jest.fn(async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      service.once(event, asyncHandler);

      // Act
      service.publish(event, { taskId: "task-1" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      service.publish(event, { taskId: "task-2" });
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Assert
      expect(asyncHandler).toHaveBeenCalledTimes(1);
      expect(callCount).toBe(1);
    });
  });

  describe("getHandlerCount", () => {
    it("should return 0 for event with no subscribers", () => {
      expect(service.getHandlerCount("nonexistent:event")).toBe(0);
    });

    it("should return correct count for subscribed event", () => {
      const event = "task:started";
      service.subscribe(event, jest.fn());
      service.subscribe(event, jest.fn());
      service.subscribe(event, jest.fn());

      expect(service.getHandlerCount(event)).toBe(3);
    });

    it("should update count after unsubscribe", () => {
      const event = "task:completed";
      const sub1 = service.subscribe(event, jest.fn());
      const sub2 = service.subscribe(event, jest.fn());

      expect(service.getHandlerCount(event)).toBe(2);
      sub1.unsubscribe();
      expect(service.getHandlerCount(event)).toBe(1);
      sub2.unsubscribe();
      expect(service.getHandlerCount(event)).toBe(0);
    });
  });

  describe("hasSubscribers", () => {
    it("should return false for event with no subscribers", () => {
      expect(service.hasSubscribers("nonexistent:event")).toBe(false);
    });

    it("should return true for event with subscribers", () => {
      const event = "task:started";
      service.subscribe(event, jest.fn());

      expect(service.hasSubscribers(event)).toBe(true);
    });

    it("should return false after all subscribers unsubscribe", () => {
      const event = "task:completed";
      const sub1 = service.subscribe(event, jest.fn());
      const sub2 = service.subscribe(event, jest.fn());

      expect(service.hasSubscribers(event)).toBe(true);
      sub1.unsubscribe();
      expect(service.hasSubscribers(event)).toBe(true);
      sub2.unsubscribe();
      expect(service.hasSubscribers(event)).toBe(false);
    });
  });

  describe("onModuleDestroy", () => {
    it("should clear all subscriptions on module destroy", () => {
      // Arrange
      service.subscribe("event1", jest.fn());
      service.subscribe("event2", jest.fn());
      service.subscribe("event2", jest.fn());

      // Act
      service.onModuleDestroy();

      // Assert
      expect(service.getHandlerCount("event1")).toBe(0);
      expect(service.getHandlerCount("event2")).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should log error when handler throws synchronously", () => {
      // Arrange
      const event = "task:failed";
      const error = new Error("Handler error");
      const handler = jest.fn(() => {
        throw error;
      });
      service.subscribe(event, handler);
      const errorSpy = jest.spyOn(Logger.prototype, "error");

      // Act
      service.publish(event, { taskId: "task-1" });

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Handler error for ${event}`),
        error,
      );
    });

    it("should log error when async handler rejects", async () => {
      // Arrange
      const event = "task:failed";
      const error = new Error("Async handler error");
      const asyncHandler = jest.fn(async () => {
        throw error;
      });
      service.subscribe(event, asyncHandler);
      const errorSpy = jest.spyOn(Logger.prototype, "error");

      // Act
      service.publish(event, { taskId: "task-1" });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Handler error for ${event}`),
        error,
      );
    });
  });

  describe("integration scenarios", () => {
    it("should support multiple events with different handlers", () => {
      // Arrange
      const event1 = "mission:started";
      const event2 = "task:completed";
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      service.subscribe(event1, handler1);
      service.subscribe(event2, handler2);

      // Act
      service.publish(event1, { missionId: "m1" });
      service.publish(event2, { taskId: "t1" });

      // Assert
      expect(handler1).toHaveBeenCalledWith(
        expect.objectContaining({ missionId: "m1" }),
      );
      expect(handler2).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "t1" }),
      );
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should support event naming convention patterns", () => {
      // Arrange
      const handlers: Record<string, jest.Mock> = {
        "mission:created": jest.fn(),
        "mission:started": jest.fn(),
        "mission:completed": jest.fn(),
        "task:created": jest.fn(),
        "task:failed": jest.fn(),
        "agent:updated": jest.fn(),
      };

      Object.entries(handlers).forEach(([event, handler]) => {
        service.subscribe(event, handler);
      });

      // Act
      service.publish("mission:completed", { missionId: "m1" });
      service.publish("task:failed", { taskId: "t1", error: "error" });

      // Assert
      expect(handlers["mission:completed"]).toHaveBeenCalled();
      expect(handlers["task:failed"]).toHaveBeenCalled();
      expect(handlers["mission:created"]).not.toHaveBeenCalled();
    });
  });
});
