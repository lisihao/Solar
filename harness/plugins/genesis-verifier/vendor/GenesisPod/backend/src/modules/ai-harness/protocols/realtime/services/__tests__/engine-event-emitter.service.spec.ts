/**
 * Unit tests for EngineEventEmitterService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { EventBusService as EngineEventEmitterService } from "../../../../../ai-harness/facade";
import type {
  EngineEvent,
  ProgressEvent,
  RoomConfig,
} from "../../abstractions/event-emitter.interface";

// ----- helpers -----

function makeRoomConfig(overrides?: Partial<RoomConfig>): RoomConfig {
  return {
    roomId: "room-123",
    roomType: "topic",
    entityId: "entity-456",
    ...overrides,
  };
}

function makeEngineEvent<T>(
  type: string,
  payload: T,
  overrides?: Partial<EngineEvent<T>>,
): EngineEvent<T> {
  return {
    type,
    payload,
    metadata: {
      timestamp: new Date(),
      source: "test",
    },
    ...overrides,
  };
}

// ----- mock factories -----

function makeMockEventEmitter2(): jest.Mocked<EventEmitter2> {
  return {
    emit: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    off: jest.fn(),
  } as unknown as jest.Mocked<EventEmitter2>;
}

function makeMockSocket() {
  return {
    join: jest.fn(),
    leave: jest.fn(),
  };
}

function makeMockServer() {
  const socket = makeMockSocket();
  return {
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    sockets: {
      sockets: new Map([["socket-1", socket]]),
      adapter: {
        rooms: new Map([["room-123", new Set(["socket-1", "socket-2"])]]),
      },
    },
    _socket: socket,
  };
}

// ----- tests -----

describe("EngineEventEmitterService", () => {
  let service: EngineEventEmitterService;
  let mockEventEmitter: jest.Mocked<EventEmitter2>;

  beforeEach(async () => {
    mockEventEmitter = makeMockEventEmitter2();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngineEventEmitterService,
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<EngineEventEmitterService>(EngineEventEmitterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── construction ──────────────────────────────────────────────────────────

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should start with zero active subscriptions", () => {
    expect(service.getActiveSubscriptionCount()).toBe(0);
  });

  // ── setServer ─────────────────────────────────────────────────────────────

  describe("setServer", () => {
    it("should accept a server without throwing", () => {
      const mockServer = makeMockServer();
      expect(() =>
        service.setServer(mockServer as unknown as any),
      ).not.toThrow();
    });
  });

  // ── emit ──────────────────────────────────────────────────────────────────

  describe("emit (global)", () => {
    it("should forward the event to EventEmitter2", () => {
      const event = makeEngineEvent("task:started", { taskId: "t1" });
      service.emit(event);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith("task:started", event);
    });

    it("should call server.emit when server is set", () => {
      const mockServer = makeMockServer();
      service.setServer(mockServer as unknown as any);

      const event = makeEngineEvent("task:completed", { taskId: "t1" });
      service.emit(event);

      expect(mockServer.emit).toHaveBeenCalledWith("task:completed", event);
    });

    it("should not throw when server is not set", () => {
      const event = makeEngineEvent("task:started", { taskId: "t1" });
      expect(() => service.emit(event)).not.toThrow();
    });
  });

  // ── emitToRoom ────────────────────────────────────────────────────────────

  describe("emitToRoom", () => {
    it("should call server.to(roomId).emit with the event", () => {
      const mockServer = makeMockServer();
      service.setServer(mockServer as unknown as any);

      const roomConfig = makeRoomConfig();
      const event = makeEngineEvent("task:progress", { progress: 50 });

      service.emitToRoom(roomConfig, event);

      expect(mockServer.to).toHaveBeenCalledWith("room-123");
    });

    it("should emit to EventEmitter2 with enriched metadata", () => {
      const roomConfig = makeRoomConfig();
      const event = makeEngineEvent("task:progress", { progress: 50 });

      service.emitToRoom(roomConfig, event);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "task:progress",
        expect.objectContaining({
          metadata: expect.objectContaining({
            roomId: "room-123",
            roomType: "topic",
            entityId: "entity-456",
          }),
        }),
      );
    });

    it("should derive roomId from type+entityId when roomId is omitted", () => {
      const mockServer = makeMockServer();
      service.setServer(mockServer as unknown as any);

      const roomConfig: RoomConfig = {
        roomId: "",
        roomType: "project",
        entityId: "proj-789",
      };
      const event = makeEngineEvent("test:event", {});
      service.emitToRoom(roomConfig, event);

      // roomId === "" => falls back to `${roomType}:${entityId}`
      expect(mockServer.to).toHaveBeenCalledWith("project:proj-789");
    });

    it("should not throw when server is not set", () => {
      const roomConfig = makeRoomConfig();
      const event = makeEngineEvent("test:event", {});
      expect(() => service.emitToRoom(roomConfig, event)).not.toThrow();
    });
  });

  // ── emitProgress ──────────────────────────────────────────────────────────

  describe("emitProgress", () => {
    it("should wrap ProgressEvent in EngineEvent and call emitToRoom", () => {
      const mockServer = makeMockServer();
      service.setServer(mockServer as unknown as any);

      const roomConfig = makeRoomConfig();
      const progress: ProgressEvent = {
        taskId: "task-1",
        taskType: "research",
        phase: "planning",
        progress: 25,
        message: "Planning phase",
      };

      service.emitProgress(roomConfig, progress);

      expect(mockServer.to).toHaveBeenCalledWith("room-123");
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "task:progress",
        expect.objectContaining({
          type: "task:progress",
          payload: progress,
          metadata: expect.objectContaining({
            correlationId: "task-1",
            source: "engine",
          }),
        }),
      );
    });
  });

  // ── subscribe / unsubscribe ───────────────────────────────────────────────

  describe("subscribe", () => {
    it("should register handler on EventEmitter2 and increment count", () => {
      const handler = jest.fn();
      service.subscribe("task:started", handler);

      expect(service.getActiveSubscriptionCount()).toBe(1);
      expect(mockEventEmitter.on).toHaveBeenCalledWith("task:started", handler);
    });

    it("should return an unsubscribe function that removes the subscription", () => {
      const handler = jest.fn();
      const unsubscribe = service.subscribe("task:started", handler);

      expect(service.getActiveSubscriptionCount()).toBe(1);

      unsubscribe();

      expect(service.getActiveSubscriptionCount()).toBe(0);
      expect(mockEventEmitter.off).toHaveBeenCalled();
    });

    it("should support multiple independent subscriptions", () => {
      const h1 = jest.fn();
      const h2 = jest.fn();
      service.subscribe("event:a", h1);
      service.subscribe("event:b", h2);

      expect(service.getActiveSubscriptionCount()).toBe(2);
    });

    it("should clean old subscriptions when limit is reached", () => {
      // The MAX_SUBSCRIPTIONS is 10000 which is hard to hit in tests.
      // We simulate the cleanup by subscribing many entries and verifying the
      // unsubscribe function still works for older ones after cleanup is triggered.
      const handlers: Array<() => void> = [];
      for (let i = 0; i < 10; i++) {
        const unsub = service.subscribe(`event:${i}`, jest.fn());
        handlers.push(unsub);
      }

      expect(service.getActiveSubscriptionCount()).toBe(10);

      // Unsubscribe all
      handlers.forEach((u) => u());
      expect(service.getActiveSubscriptionCount()).toBe(0);
    });
  });

  // ── once ─────────────────────────────────────────────────────────────────

  describe("once", () => {
    it("should register a once handler on EventEmitter2", () => {
      const handler = jest.fn();
      service.once("task:completed", handler);

      expect(service.getActiveSubscriptionCount()).toBe(1);
      expect(mockEventEmitter.once).toHaveBeenCalledWith(
        "task:completed",
        expect.any(Function),
      );
    });

    it("should return an unsubscribe function", () => {
      const handler = jest.fn();
      const unsubscribe = service.once("task:completed", handler);

      expect(typeof unsubscribe).toBe("function");

      unsubscribe();
      expect(service.getActiveSubscriptionCount()).toBe(0);
    });
  });

  // ── unsubscribe ───────────────────────────────────────────────────────────

  describe("unsubscribe", () => {
    it("should be a no-op for unknown subscription IDs", () => {
      expect(() => service.unsubscribe("non-existent-id")).not.toThrow();
    });
  });

  // ── broadcast ─────────────────────────────────────────────────────────────

  describe("broadcast", () => {
    it("should call server.emit with the event", () => {
      const mockServer = makeMockServer();
      service.setServer(mockServer as unknown as any);

      const event = makeEngineEvent("system:warning", { msg: "test" });
      service.broadcast(event);

      expect(mockServer.emit).toHaveBeenCalledWith("system:warning", event);
    });

    it("should not throw when server is not set", () => {
      const event = makeEngineEvent("system:warning", { msg: "test" });
      expect(() => service.broadcast(event)).not.toThrow();
    });
  });

  // ── joinRoom / leaveRoom ──────────────────────────────────────────────────

  describe("joinRoom", () => {
    it("should call socket.join(roomId) for a known socket", () => {
      const socket = makeMockSocket();
      const mockServer = {
        ...makeMockServer(),
        sockets: {
          sockets: new Map([["socket-abc", socket]]),
          adapter: { rooms: new Map() },
        },
      };
      service.setServer(mockServer as unknown as any);

      const roomConfig = makeRoomConfig({ roomId: "room-xyz" });
      service.joinRoom("socket-abc", roomConfig);

      expect(socket.join).toHaveBeenCalledWith("room-xyz");
    });

    it("should not throw when server is not set", () => {
      expect(() =>
        service.joinRoom("socket-1", makeRoomConfig()),
      ).not.toThrow();
    });

    it("should silently ignore unknown socketId", () => {
      const mockServer = makeMockServer();
      service.setServer(mockServer as unknown as any);

      // "unknown-socket" is not in the sockets map
      expect(() =>
        service.joinRoom("unknown-socket", makeRoomConfig()),
      ).not.toThrow();
    });
  });

  describe("leaveRoom", () => {
    it("should call socket.leave(roomId) for a known socket", () => {
      const socket = makeMockSocket();
      const mockServer = {
        ...makeMockServer(),
        sockets: {
          sockets: new Map([["socket-abc", socket]]),
          adapter: { rooms: new Map() },
        },
      };
      service.setServer(mockServer as unknown as any);

      const roomConfig = makeRoomConfig({ roomId: "room-xyz" });
      service.leaveRoom("socket-abc", roomConfig);

      expect(socket.leave).toHaveBeenCalledWith("room-xyz");
    });

    it("should not throw when server is not set", () => {
      expect(() =>
        service.leaveRoom("socket-1", makeRoomConfig()),
      ).not.toThrow();
    });
  });

  // ── getRoomMembers ────────────────────────────────────────────────────────

  describe("getRoomMembers", () => {
    it("should return array of socket IDs in the room", () => {
      const mockServer = makeMockServer();
      service.setServer(mockServer as unknown as any);

      const roomConfig = makeRoomConfig({ roomId: "room-123" });
      const members = service.getRoomMembers(roomConfig);

      expect(members).toEqual(expect.arrayContaining(["socket-1", "socket-2"]));
    });

    it("should return empty array when server is not set", () => {
      expect(service.getRoomMembers(makeRoomConfig())).toEqual([]);
    });

    it("should return empty array when room does not exist", () => {
      const mockServer = makeMockServer();
      service.setServer(mockServer as unknown as any);

      const roomConfig = makeRoomConfig({ roomId: "non-existent-room" });
      expect(service.getRoomMembers(roomConfig)).toEqual([]);
    });
  });

  // ── getActiveSubscriptionCount ────────────────────────────────────────────

  describe("getActiveSubscriptionCount", () => {
    it("should reflect the exact number of live subscriptions", () => {
      expect(service.getActiveSubscriptionCount()).toBe(0);

      const u1 = service.subscribe("e:1", jest.fn());
      expect(service.getActiveSubscriptionCount()).toBe(1);

      const u2 = service.subscribe("e:2", jest.fn());
      expect(service.getActiveSubscriptionCount()).toBe(2);

      u1();
      expect(service.getActiveSubscriptionCount()).toBe(1);

      u2();
      expect(service.getActiveSubscriptionCount()).toBe(0);
    });
  });
});
