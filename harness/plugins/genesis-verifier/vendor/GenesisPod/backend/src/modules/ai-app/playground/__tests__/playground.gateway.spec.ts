/**
 * AgentPlaygroundGateway unit tests
 *
 * Tests: afterInit adapter registration, handleJoin, handleLeave, extractUserId
 */

import { UnauthorizedException } from "@nestjs/common";
import { AgentPlaygroundGateway } from "../api/controller/playground.gateway";
import { SocketBroadcastAdapter } from "@/modules/ai-harness/protocols/realtime/socket-broadcast.adapter";

jest.mock("@/modules/ai-harness/protocols/realtime/socket-broadcast.adapter");

function makeMockEventBus() {
  return {
    registerAdapter: jest.fn(),
    emit: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMockOwnership() {
  return {
    assign: jest.fn(),
    getOwner: jest.fn(),
    release: jest.fn(),
  };
}

function makeMockStore() {
  return {
    getById: jest.fn().mockResolvedValue(null),
  };
}

function makeMockJwt(
  payload: Record<string, unknown> | null = { sub: "user-1" },
) {
  return {
    verify: jest.fn().mockImplementation(() => {
      if (payload === null) throw new Error("invalid token");
      return payload;
    }),
  };
}

function makeMockCache() {
  return {
    // default: not blocked (get returns undefined)
    get: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMockSocket(
  auth: Record<string, unknown> = { token: "valid-token" },
) {
  return {
    id: "socket-id-1",
    handshake: { auth },
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
  };
}

describe("AgentPlaygroundGateway", () => {
  let gateway: AgentPlaygroundGateway;
  let eventBus: ReturnType<typeof makeMockEventBus>;
  let ownership: ReturnType<typeof makeMockOwnership>;
  let jwt: ReturnType<typeof makeMockJwt>;
  let store: ReturnType<typeof makeMockStore>;
  let cache: ReturnType<typeof makeMockCache>;
  let mockIo: { to: jest.Mock };

  beforeEach(() => {
    eventBus = makeMockEventBus();
    ownership = makeMockOwnership();
    jwt = makeMockJwt();
    store = makeMockStore();
    cache = makeMockCache();
    gateway = new AgentPlaygroundGateway(
      eventBus as never,
      ownership as never,
      jwt as never,
      store as never,
      cache as never,
    );
    mockIo = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) };
    // inject io server
    (gateway as unknown as { io: unknown }).io = mockIo;
  });

  describe("afterInit", () => {
    it("registers SocketBroadcastAdapter on the eventBus", () => {
      gateway.afterInit();
      expect(eventBus.registerAdapter).toHaveBeenCalledTimes(1);
      expect(eventBus.registerAdapter).toHaveBeenCalledWith(
        expect.any(SocketBroadcastAdapter),
      );
    });

    it("passes the io server + options to SocketBroadcastAdapter constructor", () => {
      const MockAdapter = SocketBroadcastAdapter as jest.MockedClass<
        typeof SocketBroadcastAdapter
      >;
      MockAdapter.mockClear();
      gateway.afterInit();
      expect(MockAdapter).toHaveBeenCalledWith(mockIo, {
        id: "playground.socket",
        eventTypePrefix: "playground.",
        roomPrefix: "playground",
      });
    });
  });

  describe("handleJoin", () => {
    it("returns error when missionId is missing", async () => {
      const socket = makeMockSocket();
      const result = await gateway.handleJoin(socket as never, {
        missionId: "",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("missionId required");
    });

    it("returns error when payload is null-ish", async () => {
      const socket = makeMockSocket();
      const result = await gateway.handleJoin(
        socket as never,
        null as unknown as { missionId: string },
      );
      expect(result.ok).toBe(false);
    });

    it("returns auth error when token is missing", async () => {
      const socket = makeMockSocket({});
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-1",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("auth");
    });

    it("returns auth error when JWT is invalid", async () => {
      jwt.verify.mockImplementation(() => {
        throw new UnauthorizedException("bad token");
      });
      const socket = makeMockSocket({ token: "bad" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-1",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns mission not found when ownership registry returns no owner", async () => {
      ownership.getOwner.mockReturnValue(undefined);
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-1",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("mission not found");
    });

    it("returns forbidden when owner does not match userId", async () => {
      ownership.getOwner.mockReturnValue("other-user");
      jwt.verify.mockReturnValue({ sub: "user-1" });
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-1",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("forbidden");
    });

    it("joins room and returns ok when ownership matches", async () => {
      ownership.getOwner.mockReturnValue("user-1");
      jwt.verify.mockReturnValue({ sub: "user-1" });
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-abc",
      });
      expect(result.ok).toBe(true);
      expect(socket.join).toHaveBeenCalledWith("playground:m-abc");
    });

    it("extracts userId from Authorization Bearer header", async () => {
      ownership.getOwner.mockReturnValue("user-2");
      jwt.verify.mockReturnValue({ sub: "user-2" });
      const socket = makeMockSocket({
        Authorization: "Bearer my-token",
      });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-1",
      });
      expect(result.ok).toBe(true);
      expect(jwt.verify).toHaveBeenCalledWith("my-token");
    });

    it("extracts userId from id field in JWT payload when sub missing", async () => {
      ownership.getOwner.mockReturnValue("user-from-id");
      jwt.verify.mockReturnValue({ id: "user-from-id" });
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-1",
      });
      expect(result.ok).toBe(true);
    });

    it("extracts userId from userId field in JWT payload when sub and id missing", async () => {
      ownership.getOwner.mockReturnValue("user-from-userId");
      jwt.verify.mockReturnValue({ userId: "user-from-userId" });
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-1",
      });
      expect(result.ok).toBe(true);
    });

    it("returns error when JWT has no user fields", async () => {
      jwt.verify.mockReturnValue({});
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-1",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("no user");
    });

    // ★ P32 安全修 (e2e P0-#6): WS 鉴权查 Redis blocklist
    it("rejects join when user is in Redis blocklist (disabled user)", async () => {
      jwt.verify.mockReturnValue({ sub: "banned-user" });
      cache.get.mockResolvedValue("true"); // blocklist:user:banned-user 命中
      const socket = makeMockSocket({ token: "valid-but-banned" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-1",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("disabled");
      // 验证查的是 blocklist:user:<userId>
      expect(cache.get).toHaveBeenCalledWith("blocklist:user:banned-user");
      // 被禁用户不应进 ownership / join 流程
      expect(socket.join).not.toHaveBeenCalled();
    });

    it("checks blocklist before ownership resolution (not blocked → proceeds)", async () => {
      ownership.getOwner.mockReturnValue("user-1");
      jwt.verify.mockReturnValue({ sub: "user-1" });
      cache.get.mockResolvedValue(undefined); // 未禁用
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-ok",
      });
      expect(result.ok).toBe(true);
      expect(cache.get).toHaveBeenCalledWith("blocklist:user:user-1");
    });

    // ★ 2026-05-27 Screenshot_49 致命修复：cache 异常 fail-open。Redis 不可达
    //   时 cache.get throw —— 旧实现 throw 上抛 → join 失败 → WS 0 事件到达前端
    //   → 新 mission 页面永远"待启动"。新实现：log warn + 允许连接。
    it("fail-open when cache.get throws (Redis unavailable)", async () => {
      ownership.getOwner.mockReturnValue("user-1");
      jwt.verify.mockReturnValue({ sub: "user-1" });
      cache.get.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:6379"));
      const socket = makeMockSocket({ token: "valid" });
      const result = await gateway.handleJoin(socket as never, {
        missionId: "m-resilient",
      });
      // join 应当成功（fail-open），用户可以正常使用 mission
      expect(result.ok).toBe(true);
      expect(socket.join).toHaveBeenCalledWith("playground:m-resilient");
    });
  });

  describe("handleLeave", () => {
    it("returns ok=false when missionId is missing", async () => {
      const socket = makeMockSocket();
      const result = await gateway.handleLeave(socket as never, {
        missionId: "",
      });
      expect(result.ok).toBe(false);
    });

    it("calls socket.leave with correct room name", async () => {
      const socket = makeMockSocket();
      const result = await gateway.handleLeave(socket as never, {
        missionId: "m-xyz",
      });
      expect(result.ok).toBe(true);
      expect(socket.leave).toHaveBeenCalledWith("playground:m-xyz");
    });

    it("returns ok when missionId provided", async () => {
      const socket = makeMockSocket();
      const result = await gateway.handleLeave(socket as never, {
        missionId: "some-id",
      });
      expect(result.ok).toBe(true);
    });
  });
});
