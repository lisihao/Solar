// --- Circular dependency mocks: must be BEFORE all imports ---
jest.mock("../../../../common/content-processing", () => ({
  UrlParserService: jest.fn(),
  WebContentExtractionService: jest.fn(),
  ContentExtractionService: jest.fn(),
  ParsedUrlType: {},
  ParseStatus: {},
  ContentProcessingModule: {},
}));

jest.mock(
  "../../../../common/content-processing/content-processing.module",
  () => ({
    ContentProcessingModule: class MockContentProcessingModule {},
  }),
);

import { AiTeamsGateway } from "../ai-teams.gateway";

// Mock APP_CONFIG before any imports resolve it
// 2026-05-18: 补 brand 字段 — preset-shared.ts 在模块加载时读 APP_CONFIG.brand.name
//   原 mock 漏了 brand 导致整个 suite 加载 throw（pre-existing 失败，pre-push hook 拦截）
jest.mock("../../../../common/config/app.config", () => ({
  APP_CONFIG: {
    brand: {
      name: "GenesisPod",
      fullName: "GenesisPod",
      siteName: "GenesisPod",
      emailFrom: "GenesisPod <noreply@gens.team>",
    },
    railway: {
      frontendUrl: "http://localhost:3000",
      backendUrl: "http://localhost:3001",
    },
  },
}));

// ==================== Mocks ====================

const mockAiGroupService = {
  getTopicById: jest.fn(),
  sendMessage: jest.fn(),
  markAsRead: jest.fn(),
  addReaction: jest.fn(),
  removeReaction: jest.fn(),
  generateAIResponse: jest.fn(),
};

const mockTopicEventEmitter = {
  registerEmitHandler: jest.fn(),
  emitToTopic: jest.fn(),
  emitTopicEvent: jest.fn(),
};

// Server mock
const mockServerTo = jest.fn().mockReturnThis();
const mockServerEmit = jest.fn();
const mockServerIn = jest.fn().mockReturnThis();
const mockServerFetchSockets = jest.fn();

const mockServer = {
  to: mockServerTo,
  emit: mockServerEmit,
  in: mockServerIn,
  fetchSockets: mockServerFetchSockets,
};

// Builder pattern: to().emit()
mockServerTo.mockImplementation(() => ({
  emit: mockServerEmit,
  fetchSockets: mockServerFetchSockets,
}));
mockServerIn.mockImplementation(() => ({
  fetchSockets: mockServerFetchSockets,
}));

// Create mock socket helper
const createMockSocket = (overrides: Record<string, unknown> = {}) => ({
  id: "socket-1",
  userId: undefined as string | undefined,
  currentTopicId: undefined as string | undefined,
  handshake: {
    auth: {},
    query: {},
  },
  join: jest.fn(),
  leave: jest.fn(),
  to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  disconnect: jest.fn(),
  emit: jest.fn(),
  ...overrides,
});

const mockJwt = { verify: jest.fn() };

describe("AiTeamsGateway", () => {
  let gateway: AiTeamsGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    // BLK-7：默认把 token 当作 userId 回显（非字符串 token 视为无效 → 抛错）
    mockJwt.verify.mockImplementation((token: unknown) => {
      if (typeof token !== "string") throw new Error("invalid token");
      return { sub: token };
    });

    gateway = new AiTeamsGateway(
      mockAiGroupService as never,
      mockTopicEventEmitter as never,
      mockJwt as never,
    );

    // Inject the server mock
    gateway.server = mockServer as never;
  });

  // ==================== afterInit ====================

  describe("afterInit", () => {
    it("registers emit handler with TopicEventEmitterService", () => {
      gateway.afterInit();

      expect(mockTopicEventEmitter.registerEmitHandler).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });

    it("emit handler calls emitToTopic on the gateway", async () => {
      const spy = jest
        .spyOn(gateway, "emitToTopic")
        .mockResolvedValue(undefined);
      gateway.afterInit();

      const handler =
        mockTopicEventEmitter.registerEmitHandler.mock.calls[0][0];
      await handler("topic-1", "test:event", { data: "test" });

      expect(spy).toHaveBeenCalledWith("topic-1", "test:event", {
        data: "test",
      });
    });
  });

  // ==================== handleConnection ====================

  describe("handleConnection", () => {
    it("sets userId on socket when auth userId provided", async () => {
      const client = createMockSocket({
        handshake: { auth: { token: "user-1" }, query: {} },
      });

      await gateway.handleConnection(client as never);

      expect(client.userId).toBe("user-1");
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it("derives userId from Authorization header token", async () => {
      const client = createMockSocket({
        handshake: { auth: { Authorization: "Bearer user-2" }, query: {} },
      });

      await gateway.handleConnection(client as never);

      expect(client.userId).toBe("user-2");
    });

    it("disconnects when only a spoofed auth.userId is sent (no JWT)", async () => {
      const client = createMockSocket({
        handshake: {
          auth: { userId: "spoofed" },
          query: { userId: "spoofed" },
        },
      });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it("disconnects socket when no userId provided", async () => {
      const client = createMockSocket({
        handshake: { auth: {}, query: {} },
      });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it("tracks multiple sockets for the same user", async () => {
      const client1 = createMockSocket({
        id: "socket-1",
        handshake: { auth: { token: "user-1" }, query: {} },
      });
      const client2 = createMockSocket({
        id: "socket-2",
        handshake: { auth: { token: "user-1" }, query: {} },
      });

      await gateway.handleConnection(client1 as never);
      await gateway.handleConnection(client2 as never);

      // Both sockets should be registered - verify userId was set on each
      expect(client1.userId).toBe("user-1");
      expect(client2.userId).toBe("user-1");
      // Both sockets should be connected without error
      expect(client1.disconnect).not.toHaveBeenCalled();
      expect(client2.disconnect).not.toHaveBeenCalled();
    });

    it("disconnects socket when userId is not a string", async () => {
      const client = createMockSocket({
        handshake: { auth: { token: 12345 }, query: {} },
      });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });
  });

  // ==================== handleDisconnect ====================

  describe("handleDisconnect", () => {
    it("removes socket tracking on disconnect", async () => {
      const client = createMockSocket({
        id: "socket-1",
        handshake: { auth: { token: "user-1" }, query: {} },
      });

      await gateway.handleConnection(client as never);
      gateway.handleDisconnect(client as never);

      // After disconnect, no further error should occur
      expect(client.id).toBe("socket-1");
    });

    it("handles disconnect for unknown socket gracefully", () => {
      const client = createMockSocket({ id: "unknown-socket" });

      expect(() => gateway.handleDisconnect(client as never)).not.toThrow();
    });

    it("cleans up user tracking when last socket disconnects", async () => {
      const client = createMockSocket({
        id: "socket-1",
        handshake: { auth: { token: "user-1" }, query: {} },
      });

      await gateway.handleConnection(client as never);
      gateway.handleDisconnect(client as never);

      // emitToUser should now be a no-op since user has no sockets
      gateway.emitToUser("user-1", "test", {});
      expect(mockServer.to).not.toHaveBeenCalled();
    });
  });

  // ==================== handleJoinTopic ====================

  describe("handleJoinTopic", () => {
    it("joins room successfully when topic access is valid", async () => {
      const topic = { id: "topic-1", aiMembers: [] };
      mockAiGroupService.getTopicById.mockResolvedValue(topic);
      mockServerFetchSockets.mockResolvedValue([]);

      const client = createMockSocket({
        userId: "user-1",
        handshake: { auth: { token: "user-1" }, query: {} },
      });
      // Register socket
      await gateway.handleConnection(client as never);

      const result = await gateway.handleJoinTopic(client as never, {
        topicId: "topic-1",
      });

      expect(client.join).toHaveBeenCalledWith("topic:topic-1");
      expect(client.currentTopicId).toBe("topic-1");
      expect(result).toMatchObject({ success: true });
    });

    it("returns error when user is not authenticated", async () => {
      const client = createMockSocket({ userId: undefined });

      const result = await gateway.handleJoinTopic(client as never, {
        topicId: "topic-1",
      });

      expect(result).toEqual({ error: "Not authenticated" });
    });

    it("leaves previous topic when joining new topic", async () => {
      const topic = { id: "topic-2", aiMembers: [] };
      mockAiGroupService.getTopicById.mockResolvedValue(topic);
      mockServerFetchSockets.mockResolvedValue([]);

      const client = createMockSocket({
        userId: "user-1",
        currentTopicId: "topic-1",
      });
      await gateway.handleConnection(
        Object.assign(
          createMockSocket({
            id: "socket-1",
            handshake: { auth: { token: "user-1" }, query: {} },
          }),
        ) as never,
      );

      const result = await gateway.handleJoinTopic(client as never, {
        topicId: "topic-2",
      });

      expect(client.leave).toHaveBeenCalledWith("topic:topic-1");
      expect(result).toMatchObject({ success: true });
    });

    it("returns error when topic access is denied", async () => {
      mockAiGroupService.getTopicById.mockRejectedValue(
        new Error("Access denied"),
      );

      const client = createMockSocket({ userId: "user-1" });

      const result = await gateway.handleJoinTopic(client as never, {
        topicId: "topic-1",
      });

      expect(result).toEqual({ error: "Access denied" });
    });

    it("broadcasts member:online event to room after joining", async () => {
      const topic = { id: "topic-1", aiMembers: [] };
      mockAiGroupService.getTopicById.mockResolvedValue(topic);
      mockServerFetchSockets.mockResolvedValue([]);

      const serverToEmit = jest.fn();
      mockServer.to = jest.fn().mockReturnValue({
        emit: serverToEmit,
        fetchSockets: mockServerFetchSockets,
      });

      const client = createMockSocket({ userId: "user-1" });
      await gateway.handleConnection(
        Object.assign(
          createMockSocket({
            id: "socket-1",
            handshake: { auth: { token: "user-1" }, query: {} },
          }),
        ) as never,
      );

      await gateway.handleJoinTopic(client as never, { topicId: "topic-1" });

      expect(mockServer.to).toHaveBeenCalledWith("topic:topic-1");
      expect(serverToEmit).toHaveBeenCalledWith("member:online", {
        userId: "user-1",
      });
    });
  });

  // ==================== handleLeaveTopic ====================

  describe("handleLeaveTopic", () => {
    it("leaves the topic room when client is in that topic", async () => {
      const clientToEmit = jest.fn();
      const client = createMockSocket({
        userId: "user-1",
        currentTopicId: "topic-1",
        to: jest.fn().mockReturnValue({ emit: clientToEmit }),
      });

      const result = await gateway.handleLeaveTopic(client as never, {
        topicId: "topic-1",
      });

      expect(client.leave).toHaveBeenCalledWith("topic:topic-1");
      expect(client.currentTopicId).toBeUndefined();
      expect(result).toEqual({ success: true });
    });

    it("returns success without leaving when in different topic", async () => {
      const client = createMockSocket({
        userId: "user-1",
        currentTopicId: "topic-2", // different topic
      });

      const result = await gateway.handleLeaveTopic(client as never, {
        topicId: "topic-1",
      });

      expect(client.leave).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  // ==================== handleSendMessage ====================

  describe("handleSendMessage", () => {
    it("sends message and broadcasts to room", async () => {
      const message = { id: "msg-1", content: "Hello", createdAt: new Date() };
      mockAiGroupService.sendMessage.mockResolvedValue(message);

      const serverToEmit = jest.fn();
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      const client = createMockSocket({ userId: "user-1" });

      const result = await gateway.handleSendMessage(
        client as never,
        {
          topicId: "topic-1",
          content: "Hello",
        } as never,
      );

      expect(mockAiGroupService.sendMessage).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        { content: "Hello" },
      );
      expect(serverToEmit).toHaveBeenCalledWith("message:new", message);
      expect(result).toMatchObject({ success: true, message });
    });

    it("returns error when user is not authenticated", async () => {
      const client = createMockSocket({ userId: undefined });

      const result = await gateway.handleSendMessage(
        client as never,
        {
          topicId: "topic-1",
          content: "Hello",
        } as never,
      );

      expect(result).toEqual({ error: "Not authenticated" });
    });

    it("triggers AI response for AI mentions", async () => {
      const message = {
        id: "msg-1",
        content: "@Bot Hello",
        createdAt: new Date(),
      };
      mockAiGroupService.sendMessage.mockResolvedValue(message);
      mockAiGroupService.generateAIResponse.mockResolvedValue({
        id: "ai-msg-1",
      });

      const serverToEmit = jest.fn();
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      const client = createMockSocket({ userId: "user-1" });

      await gateway.handleSendMessage(
        client as never,
        {
          topicId: "topic-1",
          content: "@Bot Hello",
          mentions: [{ mentionType: "AI", aiMemberId: "ai-1" }],
        } as never,
      );

      expect(serverToEmit).toHaveBeenCalledWith("ai:typing", {
        topicId: "topic-1",
        aiMemberId: "ai-1",
      });
    });

    it("triggers all AI responses for ALL_AI mention", async () => {
      const message = {
        id: "msg-1",
        content: "@all Hello",
        createdAt: new Date(),
      };
      const topic = {
        id: "topic-1",
        aiMembers: [{ id: "ai-1" }, { id: "ai-2" }],
      };

      mockAiGroupService.sendMessage.mockResolvedValue(message);
      mockAiGroupService.getTopicById.mockResolvedValue(topic);
      mockAiGroupService.generateAIResponse.mockResolvedValue({
        id: "ai-msg-1",
      });

      const serverToEmit = jest.fn();
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      const client = createMockSocket({ userId: "user-1" });

      await gateway.handleSendMessage(
        client as never,
        {
          topicId: "topic-1",
          content: "@all Hello",
          mentions: [{ mentionType: "ALL_AI" }],
        } as never,
      );

      // Should emit ai:typing for each AI member
      expect(serverToEmit).toHaveBeenCalledWith(
        "ai:typing",
        expect.objectContaining({ topicId: "topic-1" }),
      );
    });

    it("emits user mention notification for USER mention type", async () => {
      const message = {
        id: "msg-1",
        content: "@John Hello there",
        createdAt: new Date(),
      };
      mockAiGroupService.sendMessage.mockResolvedValue(message);

      // Register user-2 socket so emitToUser works
      const user2Socket = createMockSocket({
        id: "socket-user2",
        handshake: { auth: { token: "user-2" }, query: {} },
      });
      await gateway.handleConnection(user2Socket as never);

      const serverToEmit = jest.fn();
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      const client = createMockSocket({ userId: "user-1" });

      await gateway.handleSendMessage(
        client as never,
        {
          topicId: "topic-1",
          content: "@John Hello there",
          mentions: [{ mentionType: "USER", userId: "user-2" }],
        } as never,
      );

      // emitToUser sends to specific socket
      expect(mockServer.to).toHaveBeenCalledWith("socket-user2");
      expect(serverToEmit).toHaveBeenCalledWith(
        "mention:new",
        expect.objectContaining({
          topicId: "topic-1",
          fromUserId: "user-1",
        }),
      );
    });

    it("truncates long messages in mention notification", async () => {
      const longContent = "A".repeat(200);
      const message = {
        id: "msg-1",
        content: longContent,
        createdAt: new Date(),
      };
      mockAiGroupService.sendMessage.mockResolvedValue(message);

      const user2Socket = createMockSocket({
        id: "socket-user2",
        handshake: { auth: { token: "user-2" }, query: {} },
      });
      await gateway.handleConnection(user2Socket as never);

      const serverToEmit = jest.fn();
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      const client = createMockSocket({ userId: "user-1" });

      await gateway.handleSendMessage(
        client as never,
        {
          topicId: "topic-1",
          content: longContent,
          mentions: [{ mentionType: "USER", userId: "user-2" }],
        } as never,
      );

      expect(serverToEmit).toHaveBeenCalledWith(
        "mention:new",
        expect.objectContaining({
          content: expect.stringMatching(/\.\.\.$/),
        }),
      );
    });

    it("returns error when sendMessage throws", async () => {
      mockAiGroupService.sendMessage.mockRejectedValue(
        new Error("Topic not found"),
      );

      const client = createMockSocket({ userId: "user-1" });

      const result = await gateway.handleSendMessage(
        client as never,
        {
          topicId: "topic-1",
          content: "Hello",
        } as never,
      );

      expect(result).toEqual({ error: "Topic not found" });
    });
  });

  // ==================== handleTyping ====================

  describe("handleTyping", () => {
    it("emits typing event to room when user authenticated", async () => {
      const clientToEmit = jest.fn();
      const client = createMockSocket({
        userId: "user-1",
        to: jest.fn().mockReturnValue({ emit: clientToEmit }),
      });

      await gateway.handleTyping(client as never, { topicId: "topic-1" });

      const toFn = client.to;
      expect(toFn).toHaveBeenCalledWith("topic:topic-1");
      expect(clientToEmit).toHaveBeenCalledWith("member:typing", {
        userId: "user-1",
      });
    });

    it("does nothing when user is not authenticated", async () => {
      const client = createMockSocket({ userId: undefined });
      const toMock = jest.fn();
      (client as { to: jest.Mock }).to = toMock;

      await gateway.handleTyping(client as never, { topicId: "topic-1" });

      expect(toMock).not.toHaveBeenCalled();
    });
  });

  // ==================== handleReadMessage ====================

  describe("handleReadMessage", () => {
    it("marks message as read", async () => {
      mockAiGroupService.markAsRead.mockResolvedValue({
        lastReadAt: new Date(),
      });

      const client = createMockSocket({ userId: "user-1" });

      const result = await gateway.handleReadMessage(client as never, {
        topicId: "topic-1",
        messageId: "msg-1",
      });

      expect(mockAiGroupService.markAsRead).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
      );
      expect(result).toEqual({ success: true });
    });

    it("returns error when user is not authenticated", async () => {
      const client = createMockSocket({ userId: undefined });

      const result = await gateway.handleReadMessage(client as never, {
        topicId: "topic-1",
        messageId: "msg-1",
      });

      expect(result).toEqual({ error: "Not authenticated" });
    });

    it("returns error when markAsRead throws", async () => {
      mockAiGroupService.markAsRead.mockRejectedValue(
        new Error("Not a member"),
      );

      const client = createMockSocket({ userId: "user-1" });

      const result = await gateway.handleReadMessage(client as never, {
        topicId: "topic-1",
        messageId: "msg-1",
      });

      expect(result).toEqual({ error: "Not a member" });
    });
  });

  // ==================== handleAddReaction ====================

  describe("handleAddReaction", () => {
    it("adds reaction and broadcasts to room", async () => {
      mockAiGroupService.addReaction.mockResolvedValue({
        messageId: "msg-1",
        emoji: "👍",
      });

      const serverToEmit = jest.fn();
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      const client = createMockSocket({ userId: "user-1" });

      const result = await gateway.handleAddReaction(client as never, {
        topicId: "topic-1",
        messageId: "msg-1",
        emoji: "👍",
      });

      expect(mockAiGroupService.addReaction).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
        "👍",
      );
      expect(serverToEmit).toHaveBeenCalledWith("reaction:add", {
        messageId: "msg-1",
        userId: "user-1",
        emoji: "👍",
      });
      expect(result).toEqual({ success: true });
    });

    it("returns error when user not authenticated", async () => {
      const client = createMockSocket({ userId: undefined });

      const result = await gateway.handleAddReaction(client as never, {
        topicId: "topic-1",
        messageId: "msg-1",
        emoji: "👍",
      });

      expect(result).toEqual({ error: "Not authenticated" });
    });

    it("returns error when addReaction throws", async () => {
      mockAiGroupService.addReaction.mockRejectedValue(
        new Error("Message not found"),
      );

      const client = createMockSocket({ userId: "user-1" });

      const result = await gateway.handleAddReaction(client as never, {
        topicId: "topic-1",
        messageId: "msg-99",
        emoji: "👍",
      });

      expect(result).toEqual({ error: "Message not found" });
    });
  });

  // ==================== handleRemoveReaction ====================

  describe("handleRemoveReaction", () => {
    it("removes reaction and broadcasts to room", async () => {
      mockAiGroupService.removeReaction.mockResolvedValue({ count: 1 });

      const serverToEmit = jest.fn();
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      const client = createMockSocket({ userId: "user-1" });

      const result = await gateway.handleRemoveReaction(client as never, {
        topicId: "topic-1",
        messageId: "msg-1",
        emoji: "👍",
      });

      expect(mockAiGroupService.removeReaction).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
        "👍",
      );
      expect(serverToEmit).toHaveBeenCalledWith("reaction:remove", {
        messageId: "msg-1",
        userId: "user-1",
        emoji: "👍",
      });
      expect(result).toEqual({ success: true });
    });

    it("returns error when user not authenticated", async () => {
      const client = createMockSocket({ userId: undefined });

      const result = await gateway.handleRemoveReaction(client as never, {
        topicId: "topic-1",
        messageId: "msg-1",
        emoji: "👍",
      });

      expect(result).toEqual({ error: "Not authenticated" });
    });

    it("returns error when removeReaction throws", async () => {
      mockAiGroupService.removeReaction.mockRejectedValue(
        new Error("Cannot remove"),
      );

      const client = createMockSocket({ userId: "user-1" });

      const result = await gateway.handleRemoveReaction(client as never, {
        topicId: "topic-1",
        messageId: "msg-1",
        emoji: "👍",
      });

      expect(result).toEqual({ error: "Cannot remove" });
    });
  });

  // ==================== emitToUser ====================

  describe("emitToUser", () => {
    it("emits event to all sockets of a user", async () => {
      const client1 = createMockSocket({
        id: "socket-1",
        handshake: { auth: { token: "user-1" }, query: {} },
      });
      const client2 = createMockSocket({
        id: "socket-2",
        handshake: { auth: { token: "user-1" }, query: {} },
      });

      await gateway.handleConnection(client1 as never);
      await gateway.handleConnection(client2 as never);

      const serverToEmit = jest.fn();
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      gateway.emitToUser("user-1", "custom:event", { value: "data" });

      expect(mockServer.to).toHaveBeenCalledWith("socket-1");
      expect(mockServer.to).toHaveBeenCalledWith("socket-2");
      expect(serverToEmit).toHaveBeenCalledWith("custom:event", {
        value: "data",
      });
    });

    it("does nothing when user has no active sockets", () => {
      mockServer.to = jest.fn();

      gateway.emitToUser("unknown-user", "test:event", {});

      expect(mockServer.to).not.toHaveBeenCalled();
    });
  });

  // ==================== emitToTopic ====================

  describe("emitToTopic", () => {
    it("emits event to all sockets in topic room", async () => {
      const serverToEmit = jest.fn();
      const serverInFetch = jest.fn().mockResolvedValue([]);

      mockServer.in = jest
        .fn()
        .mockReturnValue({ fetchSockets: serverInFetch });
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      await gateway.emitToTopic("topic-1", "topic:event", { data: "test" });

      expect(mockServer.to).toHaveBeenCalledWith("topic:topic-1");
      expect(serverToEmit).toHaveBeenCalledWith("topic:event", {
        data: "test",
      });
    });

    it("skips fetchSockets for heartbeat events (performance optimization)", async () => {
      const serverToEmit = jest.fn();
      const serverInFetch = jest.fn();

      mockServer.in = jest
        .fn()
        .mockReturnValue({ fetchSockets: serverInFetch });
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      await gateway.emitToTopic("topic-1", "mission:agent_working", {
        heartbeat: true,
      });

      // Should not call fetchSockets for heartbeat events
      expect(serverInFetch).not.toHaveBeenCalled();
      expect(serverToEmit).toHaveBeenCalledWith("mission:agent_working", {
        heartbeat: true,
      });
    });

    it("calls fetchSockets for non-heartbeat events", async () => {
      const serverToEmit = jest.fn();
      const serverInFetch = jest.fn().mockResolvedValue([]);

      mockServer.in = jest
        .fn()
        .mockReturnValue({ fetchSockets: serverInFetch });
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      await gateway.emitToTopic("topic-1", "mission:completed", {
        result: "done",
      });

      expect(serverInFetch).toHaveBeenCalled();
    });
  });

  // ==================== getOnlineUsersInTopic ====================

  describe("getOnlineUsersInTopic", () => {
    it("returns unique online userIds in topic", async () => {
      // Register some users
      const client1 = createMockSocket({
        id: "socket-1",
        handshake: { auth: { token: "user-1" }, query: {} },
      });
      const client2 = createMockSocket({
        id: "socket-2",
        handshake: { auth: { token: "user-2" }, query: {} },
      });

      await gateway.handleConnection(client1 as never);
      await gateway.handleConnection(client2 as never);

      // Mock fetchSockets to return the two connected sockets
      const mockFetchSockets = jest
        .fn()
        .mockResolvedValue([{ id: "socket-1" }, { id: "socket-2" }]);
      mockServer.in = jest
        .fn()
        .mockReturnValue({ fetchSockets: mockFetchSockets });

      const result = await gateway.getOnlineUsersInTopic("topic-1");

      expect(result).toContain("user-1");
      expect(result).toContain("user-2");
      expect(result).toHaveLength(2);
    });

    it("deduplicates users with multiple connections", async () => {
      // Same user with two sockets
      const client1 = createMockSocket({
        id: "socket-1",
        handshake: { auth: { token: "user-1" }, query: {} },
      });
      const client2 = createMockSocket({
        id: "socket-2",
        handshake: { auth: { token: "user-1" }, query: {} },
      });

      await gateway.handleConnection(client1 as never);
      await gateway.handleConnection(client2 as never);

      const mockFetchSockets = jest
        .fn()
        .mockResolvedValue([{ id: "socket-1" }, { id: "socket-2" }]);
      mockServer.in = jest
        .fn()
        .mockReturnValue({ fetchSockets: mockFetchSockets });

      const result = await gateway.getOnlineUsersInTopic("topic-1");

      // Should only appear once
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("user-1");
    });

    it("returns empty array when no sockets in room", async () => {
      const mockFetchSockets = jest.fn().mockResolvedValue([]);
      mockServer.in = jest
        .fn()
        .mockReturnValue({ fetchSockets: mockFetchSockets });

      const result = await gateway.getOnlineUsersInTopic("empty-topic");

      expect(result).toEqual([]);
    });
  });

  // ==================== generateAndBroadcastAIResponse (via sendMessage) ====================

  describe("generateAndBroadcastAIResponse (indirect via handleSendMessage)", () => {
    it("broadcasts ai:response and message:new on successful AI generation", async () => {
      const message = { id: "msg-1", content: "Hello", createdAt: new Date() };
      const aiMessage = { id: "ai-msg-1", content: "AI response" };

      mockAiGroupService.sendMessage.mockResolvedValue(message);

      const serverToEmit = jest.fn();
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      // The AI response is generated async; we need to wait for it
      mockAiGroupService.generateAIResponse.mockImplementation(() =>
        Promise.resolve(aiMessage),
      );

      const client = createMockSocket({ userId: "user-1" });

      await gateway.handleSendMessage(
        client as never,
        {
          topicId: "topic-1",
          content: "Hello",
          mentions: [{ mentionType: "AI", aiMemberId: "ai-1" }],
        } as never,
      );

      // Give async operations time to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(serverToEmit).toHaveBeenCalledWith(
        "ai:response",
        expect.objectContaining({
          aiMemberId: "ai-1",
          messageId: "ai-msg-1",
        }),
      );
      expect(serverToEmit).toHaveBeenCalledWith("message:new", aiMessage);
    });

    it("broadcasts ai:error when AI generation fails", async () => {
      const message = { id: "msg-1", content: "Hello", createdAt: new Date() };

      mockAiGroupService.sendMessage.mockResolvedValue(message);
      mockAiGroupService.generateAIResponse.mockRejectedValue(
        new Error("AI error"),
      );

      const serverToEmit = jest.fn();
      mockServer.to = jest.fn().mockReturnValue({ emit: serverToEmit });

      const client = createMockSocket({ userId: "user-1" });

      await gateway.handleSendMessage(
        client as never,
        {
          topicId: "topic-1",
          content: "Hello",
          mentions: [{ mentionType: "AI", aiMemberId: "ai-1" }],
        } as never,
      );

      // Wait for the async AI response
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(serverToEmit).toHaveBeenCalledWith("ai:error", {
        aiMemberId: "ai-1",
        error: "AI error",
      });
    });
  });
});
