/**
 * social.gateway.spec.ts
 *
 * Unit tests for SocialGateway.
 * Mirror of playground.gateway.spec.ts pattern.
 *
 * Tests: afterInit adapter registration, handleJoin (auth / ownership /
 * room join), handleLeave, extractUserId edge cases.
 */

import { UnauthorizedException } from "@nestjs/common";
import { SocialGateway } from "../social.gateway";
import { SocketBroadcastAdapter } from "@/modules/ai-harness/protocols/realtime/socket-broadcast.adapter";

jest.mock("@/modules/ai-harness/protocols/realtime/socket-broadcast.adapter");

// ---------------------------------------------------------------------------
// mock factories
// ---------------------------------------------------------------------------

function makeMockEventBus() {
  return {
    registerAdapter: jest.fn(),
    emit: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMockStore() {
  return {
    getOwner: jest
      .fn<Promise<string | undefined>, [string]>()
      .mockResolvedValue(undefined),
  };
}

function makeMockJwt(
  payload: Record<string, unknown> | null = { sub: "user-abc" },
) {
  return {
    verify: jest.fn().mockImplementation(() => {
      if (payload === null) throw new Error("invalid token");
      return payload;
    }),
  };
}

function makeMockSocket(
  auth: Record<string, unknown> = { token: "valid-token" },
) {
  return {
    id: "socket-xyz",
    handshake: { auth },
    join: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    leave: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("SocialGateway", () => {
  let gateway: SocialGateway;
  let eventBus: ReturnType<typeof makeMockEventBus>;
  let store: ReturnType<typeof makeMockStore>;
  let jwt: ReturnType<typeof makeMockJwt>;
  let mockIo: { to: jest.Mock };

  beforeEach(() => {
    eventBus = makeMockEventBus();
    store = makeMockStore();
    jwt = makeMockJwt();
    gateway = new SocialGateway(
      eventBus as never,
      store as never,
      jwt as never,
    );
    mockIo = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) };
    (gateway as unknown as { io: unknown }).io = mockIo;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── afterInit ─────────────────────────────────────────────────────────────

  describe("afterInit", () => {
    it("registers a SocketBroadcastAdapter on the eventBus", () => {
      gateway.afterInit();
      expect(eventBus.registerAdapter).toHaveBeenCalledTimes(1);
      expect(eventBus.registerAdapter).toHaveBeenCalledWith(
        expect.any(SocketBroadcastAdapter),
      );
    });

    it("passes correct options to SocketBroadcastAdapter constructor", () => {
      const MockAdapter = SocketBroadcastAdapter as jest.MockedClass<
        typeof SocketBroadcastAdapter
      >;
      MockAdapter.mockClear();
      gateway.afterInit();
      expect(MockAdapter).toHaveBeenCalledWith(mockIo, {
        id: "social.socket",
        eventTypePrefix: "social.",
        roomPrefix: "social",
      });
    });
  });

  // ── handleJoin ────────────────────────────────────────────────────────────

  describe("handleJoin", () => {
    it("returns error when missionId is empty string", async () => {
      const socket = makeMockSocket();
      const result = await gateway.handleJoin(socket as never, {
        missionId: "",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("missionId required");
    });

    it("returns error when payload is null", async () => {
      const socket = makeMockSocket();
      const result = await gateway.handleJoin(
        socket as never,
        null as unknown as { missionId: string },
      );
      expect(result.ok).toBe(false);
    });

    it("returns auth error when no token in handshake", async () => {
      const socket = makeMockSocket({});
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-1",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("auth");
    });

    it("returns auth error when JWT verification throws", async () => {
      jwt.verify.mockImplementation(() => {
        throw new UnauthorizedException("bad token");
      });
      const socket = makeMockSocket({ token: "bad-token" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-1",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns MISSION_NOT_FOUND when store returns undefined owner", async () => {
      store.getOwner.mockResolvedValue(undefined);
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-notfound",
      });
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("MISSION_NOT_FOUND");
    });

    it("returns forbidden when owner does not match userId", async () => {
      store.getOwner.mockResolvedValue("other-user-999");
      jwt.verify.mockReturnValue({ sub: "user-abc" });
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-forbidden",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("forbidden");
    });

    it("joins room and returns ok=true when ownership matches", async () => {
      store.getOwner.mockResolvedValue("user-abc");
      jwt.verify.mockReturnValue({ sub: "user-abc" });
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-owned",
      });
      expect(result.ok).toBe(true);
      expect(socket.join).toHaveBeenCalledWith("social:m-owned");
    });

    it("room name uses 'social:' prefix (not 'playground:')", async () => {
      store.getOwner.mockResolvedValue("user-abc");
      jwt.verify.mockReturnValue({ sub: "user-abc" });
      const socket = makeMockSocket({ token: "valid" });
      await gateway.handleJoin(socket as never, {
        missionId: "m-check-prefix",
      });
      expect(socket.join).toHaveBeenCalledWith("social:m-check-prefix");
    });

    it("extracts userId from Authorization Bearer header", async () => {
      store.getOwner.mockResolvedValue("user-bearer");
      jwt.verify.mockReturnValue({ sub: "user-bearer" });
      const socket = makeMockSocket({
        Authorization: "Bearer bearer-token-value",
      });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-bearer",
      });
      expect(result.ok).toBe(true);
      expect(jwt.verify).toHaveBeenCalledWith("bearer-token-value");
    });

    it("uses id field from JWT payload when sub is absent", async () => {
      store.getOwner.mockResolvedValue("user-from-id");
      jwt.verify.mockReturnValue({ id: "user-from-id" });
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-id-field",
      });
      expect(result.ok).toBe(true);
    });

    it("uses userId field from JWT payload when sub and id are absent", async () => {
      store.getOwner.mockResolvedValue("user-from-userId");
      jwt.verify.mockReturnValue({ userId: "user-from-userId" });
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-userId-field",
      });
      expect(result.ok).toBe(true);
    });

    it("returns error when JWT payload has no user identifier fields", async () => {
      jwt.verify.mockReturnValue({});
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-no-user",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("no user");
    });
  });

  // ── handleLeave ───────────────────────────────────────────────────────────

  describe("handleLeave", () => {
    it("returns ok=false when missionId is empty", async () => {
      const socket = makeMockSocket();
      const result = await gateway.handleLeave(socket as never, {
        missionId: "",
      });
      expect(result.ok).toBe(false);
    });

    it("calls socket.leave with correct room name", async () => {
      const socket = makeMockSocket();
      const result = await gateway.handleLeave(socket as never, {
        missionId: "m-leave-me",
      });
      expect(result.ok).toBe(true);
      expect(socket.leave).toHaveBeenCalledWith("social:m-leave-me");
    });

    it("returns ok=true when missionId is provided", async () => {
      const socket = makeMockSocket();
      const result = await gateway.handleLeave(socket as never, {
        missionId: "any-id",
      });
      expect(result.ok).toBe(true);
    });
  });
});
