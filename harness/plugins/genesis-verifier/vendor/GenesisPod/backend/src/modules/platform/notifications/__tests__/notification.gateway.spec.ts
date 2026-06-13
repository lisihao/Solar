/**
 * NotificationGateway unit tests
 *
 * Covers:
 * - handleNotificationCreated: happy path emit
 * - handleNotificationCreated: emit failure → retry via EventEmitter2 (up to MAX_EMIT_RETRIES)
 * - handleNotificationCreated: give-up after MAX_EMIT_RETRIES exhausted
 * - handleBroadcast: happy path
 * - handleConnection: valid token → joins user room
 * - handleConnection: missing token → disconnect
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import { NotificationGateway } from "../notification.gateway";

jest.useFakeTimers();

describe("NotificationGateway", () => {
  let gateway: NotificationGateway;
  let mockJwt: jest.Mocked<Pick<JwtService, "verify">>;
  let mockEventEmitter: jest.Mocked<Pick<EventEmitter2, "emit">>;
  let mockIo: { to: jest.Mock; emit: jest.Mock };
  let mockRoom: { emit: jest.Mock };

  beforeEach(async () => {
    mockRoom = { emit: jest.fn() };
    mockIo = {
      to: jest.fn().mockReturnValue(mockRoom),
      emit: jest.fn(),
    };

    mockJwt = {
      verify: jest.fn().mockReturnValue({ sub: "user-abc" }),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationGateway,
        { provide: JwtService, useValue: mockJwt },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    gateway = module.get<NotificationGateway>(NotificationGateway);
    // Inject mock io server
    (gateway as unknown as { io: typeof mockIo }).io =
      mockIo as unknown as typeof gateway.io;

    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });

  // =========================================================================
  // handleNotificationCreated — happy path
  // =========================================================================

  describe("handleNotificationCreated", () => {
    it("should emit notification:new to the correct user room", () => {
      gateway.handleNotificationCreated({
        notificationId: "n-1",
        userId: "user-abc",
        type: "SYSTEM",
        title: "Hello",
        message: "World",
      });

      expect(mockIo.to).toHaveBeenCalledWith("user:user-abc");
      expect(mockRoom.emit).toHaveBeenCalledWith(
        "notification:new",
        expect.objectContaining({
          notificationId: "n-1",
          userId: "user-abc",
          silent: false,
        }),
      );
    });

    it("should not emit when io is not ready", () => {
      (gateway as unknown as { io: null }).io =
        null as unknown as typeof gateway.io;
      gateway.handleNotificationCreated({
        userId: "user-abc",
        type: "SYSTEM",
        title: "Hello",
        message: "World",
      });
      expect(mockRoom.emit).not.toHaveBeenCalled();
    });

    it("should schedule retry via EventEmitter2 when emit throws", () => {
      mockRoom.emit.mockImplementationOnce(() => {
        throw new Error("socket broken");
      });

      gateway.handleNotificationCreated({
        userId: "user-abc",
        type: "SYSTEM",
        title: "Retry Test",
        message: "msg",
      });

      // EventEmitter2.emit should NOT have been called yet (retry uses setTimeout)
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();

      // Advance timer to trigger the scheduled retry
      jest.runAllTimers();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "notification.created",
        expect.objectContaining({ _retryCount: 1, userId: "user-abc" }),
      );
    });

    it("should give up after MAX_EMIT_RETRIES and not schedule another retry", () => {
      mockRoom.emit.mockImplementation(() => {
        throw new Error("socket broken");
      });

      // Simulate event arriving at max retry count
      gateway.handleNotificationCreated({
        userId: "user-abc",
        type: "SYSTEM",
        title: "Final Retry",
        message: "msg",
        _retryCount: 3, // MAX_EMIT_RETRIES = 3
      });

      jest.runAllTimers();

      // No further retry scheduled
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it("should remove timer from retryTimers set after it fires", () => {
      mockRoom.emit.mockImplementationOnce(() => {
        throw new Error("socket broken");
      });

      gateway.handleNotificationCreated({
        userId: "user-abc",
        type: "SYSTEM",
        title: "Self-cleanup",
        message: "msg",
      });

      const timers = (
        gateway as unknown as { retryTimers: Set<NodeJS.Timeout> }
      ).retryTimers;
      expect(timers.size).toBe(1);

      jest.runAllTimers();

      // Timer removed from set after firing
      expect(timers.size).toBe(0);
    });
  });

  // =========================================================================
  // onModuleDestroy — timer cleanup
  // =========================================================================

  describe("onModuleDestroy", () => {
    it("should clear all pending retry timers on destroy", () => {
      mockRoom.emit.mockImplementation(() => {
        throw new Error("socket broken");
      });

      // Queue two retries
      gateway.handleNotificationCreated({
        userId: "user-abc",
        type: "SYSTEM",
        title: "Pending 1",
        message: "msg",
      });
      gateway.handleNotificationCreated({
        userId: "user-abc",
        type: "SYSTEM",
        title: "Pending 2",
        message: "msg",
      });

      const timers = (
        gateway as unknown as { retryTimers: Set<NodeJS.Timeout> }
      ).retryTimers;
      expect(timers.size).toBe(2);

      gateway.onModuleDestroy();

      expect(timers.size).toBe(0);
      // Advancing timers after destroy must not call eventEmitter
      jest.runAllTimers();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // handleBroadcast
  // =========================================================================

  describe("handleBroadcast", () => {
    it("should call io.emit with notification:broadcast payload", () => {
      gateway.handleBroadcast({
        type: "UPDATE",
        title: "Broadcast",
        message: "All users",
        sentCount: 42,
      });

      expect(mockIo.emit).toHaveBeenCalledWith(
        "notification:broadcast",
        expect.objectContaining({ type: "UPDATE", sentCount: 42 }),
      );
    });
  });

  // =========================================================================
  // handleConnection
  // =========================================================================

  describe("handleConnection", () => {
    it("should join user room on valid JWT", async () => {
      const mockClient = {
        handshake: { auth: { token: "valid-token" } },
        join: jest.fn().mockResolvedValue(undefined),
        data: {} as Record<string, unknown>,
        disconnect: jest.fn(),
      } as unknown as Parameters<typeof gateway.handleConnection>[0];

      await gateway.handleConnection(mockClient);

      expect(mockClient.join).toHaveBeenCalledWith("user:user-abc");
    });

    it("should disconnect on missing token", async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error("invalid");
      });

      const mockClient = {
        handshake: { auth: {} },
        join: jest.fn(),
        data: {} as Record<string, unknown>,
        disconnect: jest.fn(),
      } as unknown as Parameters<typeof gateway.handleConnection>[0];

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
      expect(mockClient.join).not.toHaveBeenCalled();
    });
  });
});
