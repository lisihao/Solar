/**
 * EventBusService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";

// Suppress logger output in tests
jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

import { EventBusService } from "../event-bus.service";
import type {
  EngineEvent,
  ProgressEvent,
  RoomConfig,
} from "../../realtime/abstractions/event-emitter.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeRoomConfig = (overrides: Partial<RoomConfig> = {}): RoomConfig => ({
  roomId: "room-abc",
  roomType: "session",
  entityId: "entity-1",
  ...overrides,
});

const makeEvent = <T = unknown>(
  type = "test:event",
  payload: T = {} as T,
): EngineEvent<T> => ({
  type,
  payload,
  metadata: {
    timestamp: new Date(),
    source: "test",
  },
});

const makeProgressEvent = (): ProgressEvent => ({
  taskId: "task-1",
  taskType: "research",
  phase: "planning",
  progress: 42,
});

// ---------------------------------------------------------------------------
// Minimal mock for socket.io Server
// ---------------------------------------------------------------------------
function makeMockServer() {
  const mockSocket = {
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
  };

  const mockRoom = new Set(["socket-a", "socket-b"]);

  return {
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    sockets: {
      sockets: new Map([["socket-1", mockSocket]]),
      adapter: {
        rooms: new Map([["room-abc", mockRoom]]),
      },
    },
    mockSocket,
    mockRoom,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("EventBusService", () => {
  let service: EventBusService;
  let mockEventEmitter: jest.Mocked<
    Pick<EventEmitter2, "emit" | "on" | "once" | "off">
  >;

  beforeEach(async () => {
    mockEventEmitter = {
      emit: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      off: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventBusService,
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<EventBusService>(EventBusService);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // setServer()
  // -------------------------------------------------------------------------
  describe("setServer()", () => {
    it("should store the server and log a message", () => {
      const mockServer = makeMockServer() as any;
      service.setServer(mockServer);
      // No direct getter; verify indirectly via broadcast
      service.broadcast(makeEvent());
      expect(mockServer.emit).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // emit()
  // -------------------------------------------------------------------------
  describe("emit()", () => {
    it("should dispatch to EventEmitter2", () => {
      const event = makeEvent("task:started");
      service.emit(event);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith("task:started", event);
    });

    it("should also emit to WebSocket server when server is set", () => {
      const mockServer = makeMockServer() as any;
      service.setServer(mockServer);

      const event = makeEvent("task:started");
      service.emit(event);

      expect(mockServer.emit).toHaveBeenCalledWith("task:started", event);
    });

    it("should not throw when no server is set", () => {
      expect(() => service.emit(makeEvent())).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // emitToRoom()
  // -------------------------------------------------------------------------
  describe("emitToRoom()", () => {
    it("should dispatch to EventEmitter2 with roomId in metadata", () => {
      const room = makeRoomConfig({ roomId: "explicit-room" });
      const event = makeEvent("task:progress");

      service.emitToRoom(room, event);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "task:progress",
        expect.objectContaining({
          metadata: expect.objectContaining({ roomId: "explicit-room" }),
        }),
      );
    });

    it("should derive roomId from roomType:entityId when roomId is empty", () => {
      const room: RoomConfig = {
        roomId: "",
        roomType: "topic",
        entityId: "ent-99",
      };
      const event = makeEvent("x:event");

      service.emitToRoom(room, event);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "x:event",
        expect.objectContaining({
          metadata: expect.objectContaining({ roomId: "topic:ent-99" }),
        }),
      );
    });

    it("should emit to the WebSocket room when server is set", () => {
      const mockServer = makeMockServer() as any;
      service.setServer(mockServer);

      const room = makeRoomConfig({ roomId: "ws-room" });
      service.emitToRoom(room, makeEvent("ev:room"));

      expect(mockServer.to).toHaveBeenCalledWith("ws-room");
    });

    it("should not throw when no server is set", () => {
      expect(() =>
        service.emitToRoom(makeRoomConfig(), makeEvent()),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // emitProgress()
  // -------------------------------------------------------------------------
  describe("emitProgress()", () => {
    it("should wrap progress in a task:progress EngineEvent and emit to room", () => {
      const room = makeRoomConfig();
      const progress = makeProgressEvent();

      service.emitProgress(room, progress);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "task:progress",
        expect.objectContaining({
          type: "task:progress",
          payload: progress,
          metadata: expect.objectContaining({
            source: "engine",
            correlationId: "task-1",
          }),
        }),
      );
    });

    it("should set a timestamp in the event metadata", () => {
      const before = new Date();
      service.emitProgress(makeRoomConfig(), makeProgressEvent());
      const after = new Date();

      const call = (mockEventEmitter.emit as jest.Mock).mock.calls[0];
      const emitted = call[1] as EngineEvent;
      const ts = emitted.metadata.timestamp;
      expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(ts.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  // -------------------------------------------------------------------------
  // subscribe()
  // -------------------------------------------------------------------------
  describe("subscribe()", () => {
    it("should register the handler on EventEmitter2", () => {
      const handler = jest.fn();
      service.subscribe("task:started", handler);
      expect(mockEventEmitter.on).toHaveBeenCalledWith("task:started", handler);
    });

    it("should return an unsubscribe function", () => {
      const handler = jest.fn();
      const unsub = service.subscribe("task:started", handler);
      expect(typeof unsub).toBe("function");
    });

    it("should remove the handler from EventEmitter2 when unsubscribed", () => {
      const handler = jest.fn();
      const unsub = service.subscribe("task:started", handler);
      unsub();
      expect(mockEventEmitter.off).toHaveBeenCalledTimes(1);
    });

    it("should increment the active subscription count", () => {
      service.subscribe("ev:a", jest.fn());
      service.subscribe("ev:b", jest.fn());
      expect(service.getActiveSubscriptionCount()).toBe(2);
    });

    it("should decrement active subscription count after unsubscribe", () => {
      const unsub = service.subscribe("ev:a", jest.fn());
      expect(service.getActiveSubscriptionCount()).toBe(1);
      unsub();
      expect(service.getActiveSubscriptionCount()).toBe(0);
    });

    it("should trigger cleanupOldSubscriptions when MAX_SUBSCRIPTIONS is reached", () => {
      // Access the private MAX_SUBSCRIPTIONS via any
      const maxSubs = (service as any).MAX_SUBSCRIPTIONS as number;

      // Manually fill the subscriptions map up to maxSubs with old entries
      const subscriptions: Map<
        string,
        { id: string; eventType: string; handler: jest.Mock; createdAt: Date }
      > = (service as any).subscriptions;

      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
      for (let i = 0; i < maxSubs; i++) {
        subscriptions.set(`pre_${i}`, {
          id: `pre_${i}`,
          eventType: "pre:event",
          handler: jest.fn(),
          createdAt: oldDate,
        });
      }

      // This subscribe call should trigger cleanup because size === maxSubs
      const handler = jest.fn();
      service.subscribe("new:event", handler);

      // After cleanup the old entries should be gone, new entry added
      // The overall count should be much smaller
      expect(service.getActiveSubscriptionCount()).toBeLessThan(maxSubs);
    });
  });

  // -------------------------------------------------------------------------
  // once()
  // -------------------------------------------------------------------------
  describe("once()", () => {
    it("should register handler via EventEmitter2.once", () => {
      const handler = jest.fn();
      service.once("task:done", handler);
      expect(mockEventEmitter.once).toHaveBeenCalledWith(
        "task:done",
        expect.any(Function), // wrapped handler
      );
    });

    it("should auto-unsubscribe after the first invocation", () => {
      const handler = jest.fn();
      service.once("task:done", handler);

      // Get the wrapped handler that was registered with EventEmitter2
      const wrappedHandler = (mockEventEmitter.once as jest.Mock).mock
        .calls[0][1] as (event: EngineEvent) => void;

      // Simulate first event firing
      wrappedHandler(makeEvent("task:done"));
      expect(handler).toHaveBeenCalledTimes(1);

      // The internal subscription should be removed (unsubscribe called)
      expect(mockEventEmitter.off).toHaveBeenCalledTimes(1);
      expect(service.getActiveSubscriptionCount()).toBe(0);
    });

    it("should return an unsubscribe function", () => {
      const handler = jest.fn();
      const unsub = service.once("task:done", handler);
      expect(typeof unsub).toBe("function");
    });

    it("should allow manual unsubscription before event fires", () => {
      const handler = jest.fn();
      const unsub = service.once("task:done", handler);

      unsub();

      expect(mockEventEmitter.off).toHaveBeenCalledTimes(1);
      expect(service.getActiveSubscriptionCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // unsubscribe()
  // -------------------------------------------------------------------------
  describe("unsubscribe()", () => {
    it("should remove subscription and call EventEmitter2.off", () => {
      const handler = jest.fn();
      service.subscribe("task:running", handler);

      // Get the subscription id from the internal map
      const subs: Map<string, { id: string }> = (service as any).subscriptions;
      const subId = Array.from(subs.keys())[0];

      service.unsubscribe(subId);
      expect(mockEventEmitter.off).toHaveBeenCalledTimes(1);
      expect(service.getActiveSubscriptionCount()).toBe(0);
    });

    it("should do nothing for an unknown subscription id", () => {
      expect(() => service.unsubscribe("sub_unknown")).not.toThrow();
      expect(mockEventEmitter.off).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // joinRoom()
  // -------------------------------------------------------------------------
  describe("joinRoom()", () => {
    it("should call socket.join with the correct roomId", () => {
      const mockServer = makeMockServer() as any;
      service.setServer(mockServer);

      service.joinRoom("socket-1", makeRoomConfig({ roomId: "my-room" }));

      expect(mockServer.mockSocket.join).toHaveBeenCalledWith("my-room");
    });

    it("should do nothing when server is not set", () => {
      // Should not throw, just warn
      expect(() =>
        service.joinRoom("socket-1", makeRoomConfig()),
      ).not.toThrow();
    });

    it("should do nothing when socket id is not found", () => {
      const mockServer = makeMockServer() as any;
      service.setServer(mockServer);

      expect(() =>
        service.joinRoom("nonexistent-socket", makeRoomConfig()),
      ).not.toThrow();
      expect(mockServer.mockSocket.join).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // leaveRoom()
  // -------------------------------------------------------------------------
  describe("leaveRoom()", () => {
    it("should call socket.leave with the correct roomId", () => {
      const mockServer = makeMockServer() as any;
      service.setServer(mockServer);

      service.leaveRoom("socket-1", makeRoomConfig({ roomId: "my-room" }));

      expect(mockServer.mockSocket.leave).toHaveBeenCalledWith("my-room");
    });

    it("should do nothing when server is not set", () => {
      expect(() =>
        service.leaveRoom("socket-1", makeRoomConfig()),
      ).not.toThrow();
    });

    it("should do nothing when socket id is not found", () => {
      const mockServer = makeMockServer() as any;
      service.setServer(mockServer);

      expect(() =>
        service.leaveRoom("nonexistent-socket", makeRoomConfig()),
      ).not.toThrow();
      expect(mockServer.mockSocket.leave).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getRoomMembers()
  // -------------------------------------------------------------------------
  describe("getRoomMembers()", () => {
    it("should return socket ids of members in the room", () => {
      const mockServer = makeMockServer() as any;
      service.setServer(mockServer);

      const members = service.getRoomMembers(
        makeRoomConfig({ roomId: "room-abc" }),
      );
      expect(members).toEqual(expect.arrayContaining(["socket-a", "socket-b"]));
    });

    it("should return empty array when room does not exist", () => {
      const mockServer = makeMockServer() as any;
      service.setServer(mockServer);

      const members = service.getRoomMembers(
        makeRoomConfig({ roomId: "no-such-room" }),
      );
      expect(members).toEqual([]);
    });

    it("should return empty array when server is not set", () => {
      const members = service.getRoomMembers(makeRoomConfig());
      expect(members).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // broadcast()
  // -------------------------------------------------------------------------
  describe("broadcast()", () => {
    it("should emit to all clients via server.emit when server is set", () => {
      const mockServer = makeMockServer() as any;
      service.setServer(mockServer);

      const event = makeEvent("sys:broadcast");
      service.broadcast(event);

      expect(mockServer.emit).toHaveBeenCalledWith("sys:broadcast", event);
    });

    it("should warn and not throw when server is not set", () => {
      expect(() => service.broadcast(makeEvent("sys:broadcast"))).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getActiveSubscriptionCount()
  // -------------------------------------------------------------------------
  describe("getActiveSubscriptionCount()", () => {
    it("should return 0 initially", () => {
      expect(service.getActiveSubscriptionCount()).toBe(0);
    });

    it("should reflect current number of active subscriptions", () => {
      service.subscribe("a", jest.fn());
      service.subscribe("b", jest.fn());
      service.subscribe("c", jest.fn());
      expect(service.getActiveSubscriptionCount()).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // getRoomId (private) tested indirectly via emitToRoom / getRoomMembers
  // -------------------------------------------------------------------------
  describe("getRoomId() — indirect via emitToRoom", () => {
    it("should prefer explicit roomId over derived one", () => {
      const room: RoomConfig = {
        roomId: "explicit",
        roomType: "topic",
        entityId: "ignored",
      };

      service.emitToRoom(room, makeEvent("ev"));

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "ev",
        expect.objectContaining({
          metadata: expect.objectContaining({ roomId: "explicit" }),
        }),
      );
    });
  });
});
