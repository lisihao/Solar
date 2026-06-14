// Mock heavy dependencies before imports
jest.mock("@/modules/ai-harness/facade");
jest.mock("../../../../../../common/prisma/prisma.service");
jest.mock("../feishu-auth.service");
jest.mock("../feishu-data-source.service");
jest.mock("../../../rag/services/url-fetch.service");
jest.mock("../../../../../../common/config/app.config", () => ({
  APP_CONFIG: {
    brand: { name: "TestBrand" },
  },
}));
jest.mock("@/modules/ai-harness/facade");
jest.mock("../../../../../../common/prisma/prisma.service");
jest.mock("../feishu-auth.service");
jest.mock("../feishu-data-source.service");
jest.mock("../../../rag/services/url-fetch.service");
jest.mock("../../../../../../common/config/app.config", () => ({
  APP_CONFIG: {
    brand: { name: "TestBrand" },
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of } from "rxjs";
import { FeishuService } from "../feishu.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { FeishuAuthService } from "../feishu-auth.service";
import { FeishuDataSourceService } from "../feishu-data-source.service";
import { UrlFetchService } from "../../../rag/services/url-fetch.service";

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_EVENT_HEADER = {
  event_id: "evt-001",
  event_type: "im.message.receive_v1",
  create_time: "1700000000",
  token: "token-abc",
  app_id: "app-001",
  tenant_key: "tenant-001",
};

function makeMessageEvent(overrides: Record<string, unknown> = {}) {
  return {
    sender: {
      sender_id: { open_id: "ou_abc123" },
      sender_type: "user",
      tenant_key: "tenant-001",
    },
    message: {
      message_id: "msg-001",
      create_time: "1700000000",
      chat_id: "chat-001",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "Hello world" }),
    },
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("FeishuService", () => {
  let service: FeishuService;
  let httpService: jest.Mocked<HttpService>;
  let prisma: jest.Mocked<PrismaService>;
  let aiFacade: jest.Mocked<ChatFacade>;
  let _feishuAuth: jest.Mocked<FeishuAuthService>;
  let feishuDataSource: jest.Mocked<FeishuDataSourceService>;
  let urlFetchService: jest.Mocked<UrlFetchService>;

  beforeEach(async () => {
    const mockHttpService = {
      post: jest.fn(),
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeishuService,
        { provide: HttpService, useValue: mockHttpService },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findFirst: jest.fn(),
              count: jest.fn(),
            },
          },
        },
        {
          provide: ChatFacade,
          useValue: {
            getDefaultTextModel: jest.fn(),
            chat: jest.fn(),
          },
        },
        {
          provide: FeishuAuthService,
          useValue: {
            getAuthHeaders: jest.fn().mockResolvedValue({
              Authorization: "Bearer mock-token",
            }),
          },
        },
        {
          provide: FeishuDataSourceService,
          useValue: {
            urlExists: jest.fn(),
            createItem: jest.fn(),
          },
        },
        {
          provide: UrlFetchService,
          useValue: {
            fetchUrl: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FeishuService>(FeishuService);
    httpService = module.get(HttpService);
    prisma = module.get(PrismaService);
    aiFacade = module.get(ChatFacade);
    _feishuAuth = module.get(FeishuAuthService);
    feishuDataSource = module.get(FeishuDataSourceService);
    urlFetchService = module.get(UrlFetchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.onModuleDestroy();
  });

  // ── handleEvent ─────────────────────────────────────────────────────────────

  describe("handleEvent", () => {
    it("should skip duplicate events", async () => {
      const event = makeMessageEvent();
      // First call processes the event
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      await service.handleEvent(
        "im.message.receive_v1",
        event,
        MOCK_EVENT_HEADER,
      );

      const sendMessageSpy = jest.spyOn(service, "sendMessage");

      // Second call with same event_id should be skipped
      await service.handleEvent(
        "im.message.receive_v1",
        event,
        MOCK_EVENT_HEADER,
      );

      // sendMessage should not be called on the second invocation
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    it("should log and skip unhandled event types", async () => {
      const event = makeMessageEvent();
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-unhandled-001" };

      // Should not throw for unknown event types
      await expect(
        service.handleEvent("unknown.event.type", event, header),
      ).resolves.toBeUndefined();
    });

    it("should process im.message.receive_v1 events", async () => {
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      const event = makeMessageEvent();
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-process-001" };

      await expect(
        service.handleEvent("im.message.receive_v1", event, header),
      ).resolves.toBeUndefined();
    });
  });

  // ── sendMessage ──────────────────────────────────────────────────────────────

  describe("sendMessage", () => {
    it("should call Feishu API with correct parameters", async () => {
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: { message_id: "resp-001" } } }),
      );

      const result = await service.sendMessage({
        receiveId: "ou_abc123",
        receiveIdType: "open_id",
        msgType: "text",
        content: JSON.stringify({ text: "Hello" }),
      });

      expect(httpService.post).toHaveBeenCalledWith(
        expect.stringContaining("/im/v1/messages?receive_id_type=open_id"),
        expect.objectContaining({
          receive_id: "ou_abc123",
          msg_type: "text",
        }),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
      expect(result).toEqual({ message_id: "resp-001" });
    });

    it("should throw when API returns non-zero code", async () => {
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 99991663, msg: "Invalid access token" } }),
      );

      await expect(
        service.sendMessage({
          receiveId: "ou_abc123",
          receiveIdType: "open_id",
          msgType: "text",
          content: JSON.stringify({ text: "Hello" }),
        }),
      ).rejects.toThrow("Invalid access token");
    });

    it("should propagate network errors", async () => {
      const { throwError } = await import("rxjs");
      (httpService.post as jest.Mock).mockReturnValue(
        throwError(() => new Error("Network error")),
      );

      await expect(
        service.sendMessage({
          receiveId: "ou_abc123",
          receiveIdType: "open_id",
          msgType: "text",
          content: "{}",
        }),
      ).rejects.toThrow("Network error");
    });

    it("should use correct URL with chat_id receive type", async () => {
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      await service.sendMessage({
        receiveId: "chat-001",
        receiveIdType: "chat_id",
        msgType: "text",
        content: JSON.stringify({ text: "Group message" }),
      });

      expect(httpService.post).toHaveBeenCalledWith(
        expect.stringContaining("receive_id_type=chat_id"),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ── sendTextMessage ──────────────────────────────────────────────────────────

  describe("sendTextMessage", () => {
    it("should send a text message with default open_id type", async () => {
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      await service.sendTextMessage("ou_abc123", "Hello!");

      expect(httpService.post).toHaveBeenCalledWith(
        expect.stringContaining("receive_id_type=open_id"),
        expect.objectContaining({
          msg_type: "text",
          content: JSON.stringify({ text: "Hello!" }),
        }),
        expect.anything(),
      );
    });

    it("should send text message with chat_id receive type", async () => {
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      await service.sendTextMessage("chat-001", "Group message", "chat_id");

      expect(httpService.post).toHaveBeenCalledWith(
        expect.stringContaining("receive_id_type=chat_id"),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ── sendCardMessage ──────────────────────────────────────────────────────────

  describe("sendCardMessage", () => {
    it("should send an interactive card message", async () => {
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      const card = { header: { title: "Card title" }, elements: [] };
      await service.sendCardMessage("ou_abc123", card);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          msg_type: "interactive",
          content: JSON.stringify(card),
        }),
        expect.anything(),
      );
    });
  });

  // ── handleEvent: text message with URL ──────────────────────────────────────

  describe("handleEvent with URL in text message", () => {
    it("should trigger URL import when message contains a URL", async () => {
      // Match user to avoid unbound user path
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: "user-001",
      });
      (feishuDataSource.urlExists as jest.Mock).mockResolvedValue(false);
      (urlFetchService.fetchUrl as jest.Mock).mockResolvedValue({
        title: "Test Page",
        metadata: { description: "A test page", author: "Author" },
      });
      (feishuDataSource.createItem as jest.Mock).mockResolvedValue({
        id: "item-001",
        title: "Test Page",
      });
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      const event = makeMessageEvent({
        message: {
          message_id: "msg-url-001",
          create_time: "1700000000",
          chat_id: "chat-001",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "https://example.com/article" }),
        },
      });
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-url-001" };

      await service.handleEvent("im.message.receive_v1", event, header);

      expect(feishuDataSource.createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-001",
          sourceUrl: "https://example.com/article",
          syncSource: "feishu",
        }),
      );
    });

    it("should reply with binding instructions when user is not found", async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.user.count as jest.Mock).mockResolvedValue(2); // multi-user mode
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      const event = makeMessageEvent({
        message: {
          message_id: "msg-nouser-001",
          create_time: "1700000000",
          chat_id: "chat-001",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "https://example.com/article" }),
        },
      });
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-nouser-001" };

      await service.handleEvent("im.message.receive_v1", event, header);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content: expect.stringContaining("Open ID"),
        }),
        expect.anything(),
      );
    });

    it("should use single-user fallback when only one user exists", async () => {
      (prisma.user.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // findFirst by preference
        .mockResolvedValueOnce({ id: "single-user-001" }); // single-user findFirst
      (prisma.user.count as jest.Mock).mockResolvedValue(1);
      (feishuDataSource.urlExists as jest.Mock).mockResolvedValue(true);
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      const event = makeMessageEvent({
        message: {
          message_id: "msg-single-001",
          create_time: "1700000000",
          chat_id: "chat-001",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "https://example.com" }),
        },
      });
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-single-001" };

      await service.handleEvent("im.message.receive_v1", event, header);

      expect(feishuDataSource.urlExists).toHaveBeenCalledWith(
        "single-user-001",
        "https://example.com",
      );
    });

    it("should reply 'already exists' when URL is already in data source", async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: "user-001",
      });
      (feishuDataSource.urlExists as jest.Mock).mockResolvedValue(true);
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      const event = makeMessageEvent({
        message: {
          message_id: "msg-dup-001",
          create_time: "1700000000",
          chat_id: "chat-001",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "https://example.com/dup" }),
        },
      });
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-dup-001" };

      await service.handleEvent("im.message.receive_v1", event, header);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content: expect.stringContaining("已存在"),
        }),
        expect.anything(),
      );
      expect(feishuDataSource.createItem).not.toHaveBeenCalled();
    });
  });

  // ── handleEvent: AI trigger in text message ──────────────────────────────────

  describe("handleEvent with AI trigger in text message", () => {
    it("should invoke AI analysis when message starts with @AI", async () => {
      (aiFacade.getDefaultTextModel as jest.Mock).mockResolvedValue({
        displayName: "GPT-4",
        modelId: "gpt-4",
      });
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: "AI response content",
      });
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      const event = makeMessageEvent({
        message: {
          message_id: "msg-ai-001",
          create_time: "1700000000",
          chat_id: "chat-001",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "@AI What is machine learning?" }),
        },
      });
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-ai-001" };

      await service.handleEvent("im.message.receive_v1", event, header);

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user" }),
          ]),
        }),
      );
      // Should send "analyzing..." then the actual AI response
      expect(httpService.post).toHaveBeenCalledTimes(2);
    });

    it("should send help message when AI trigger has no query", async () => {
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      const event = makeMessageEvent({
        message: {
          message_id: "msg-empty-ai-001",
          create_time: "1700000000",
          chat_id: "chat-001",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "@AI" }),
        },
      });
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-empty-ai-001" };

      await service.handleEvent("im.message.receive_v1", event, header);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content: expect.stringContaining("使用指南"),
        }),
        expect.anything(),
      );
    });

    it("should send error message when AI analysis fails", async () => {
      (aiFacade.getDefaultTextModel as jest.Mock).mockResolvedValue({
        displayName: "GPT-4",
        modelId: "gpt-4",
      });
      (aiFacade.chat as jest.Mock).mockRejectedValue(
        new Error("LLM service unavailable"),
      );
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      const event = makeMessageEvent({
        message: {
          message_id: "msg-ai-err-001",
          create_time: "1700000000",
          chat_id: "chat-001",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "@AI Summarize this" }),
        },
      });
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-ai-err-001" };

      await service.handleEvent("im.message.receive_v1", event, header);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content: expect.stringContaining("错误"),
        }),
        expect.anything(),
      );
    });
  });

  // ── handleEvent: bot messages are ignored ────────────────────────────────────

  describe("handleEvent: bot messages", () => {
    it("should skip messages from bots (sender_type=app)", async () => {
      const event = makeMessageEvent({
        sender: {
          sender_id: { open_id: "ou_bot" },
          sender_type: "app",
          tenant_key: "tenant-001",
        },
      });
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-bot-001" };

      await service.handleEvent("im.message.receive_v1", event, header);

      expect(httpService.post).not.toHaveBeenCalled();
    });
  });

  // ── handleEvent: unsupported message type ────────────────────────────────────

  describe("handleEvent: unsupported message types", () => {
    it("should send unsupported-type notice for image messages", async () => {
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      const event = makeMessageEvent({
        message: {
          message_id: "msg-img-001",
          create_time: "1700000000",
          chat_id: "chat-001",
          chat_type: "p2p",
          message_type: "image",
          content: JSON.stringify({ image_key: "key-001" }),
        },
      });
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-img-001" };

      await service.handleEvent("im.message.receive_v1", event, header);

      expect(httpService.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content: expect.stringContaining("image"),
        }),
        expect.anything(),
      );
    });
  });

  // ── handleEvent: post (rich-text) messages ───────────────────────────────────

  describe("handleEvent: post messages", () => {
    it("should import URL from post message content", async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: "user-001",
      });
      (feishuDataSource.urlExists as jest.Mock).mockResolvedValue(false);
      (urlFetchService.fetchUrl as jest.Mock).mockResolvedValue({
        title: "Post Link",
        metadata: { description: "desc", author: "auth" },
      });
      (feishuDataSource.createItem as jest.Mock).mockResolvedValue({
        id: "item-002",
        title: "Post Link",
      });
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      const postContent = {
        zh_cn: {
          title: "Test Post",
          content: [
            [
              { tag: "text", text: "Check this out: " },
              { tag: "a", href: "https://example.com/post", text: "link" },
            ],
          ],
        },
      };

      const event = makeMessageEvent({
        message: {
          message_id: "msg-post-001",
          create_time: "1700000000",
          chat_id: "chat-001",
          chat_type: "p2p",
          message_type: "post",
          content: JSON.stringify(postContent),
        },
      });
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-post-001" };

      await service.handleEvent("im.message.receive_v1", event, header);

      expect(feishuDataSource.createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceUrl: "https://example.com/post",
        }),
      );
    });

    it("should handle malformed post message content gracefully", async () => {
      (httpService.post as jest.Mock).mockReturnValue(
        of({ data: { code: 0, data: {} } }),
      );

      const event = makeMessageEvent({
        message: {
          message_id: "msg-badpost-001",
          create_time: "1700000000",
          chat_id: "chat-001",
          chat_type: "p2p",
          message_type: "post",
          content: "not-valid-json",
        },
      });
      const header = { ...MOCK_EVENT_HEADER, event_id: "evt-badpost-001" };

      await service.handleEvent("im.message.receive_v1", event, header);

      // Should send error notice, not throw
      expect(httpService.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content: expect.stringContaining("无法解析"),
        }),
        expect.anything(),
      );
    });
  });

  // ── onModuleDestroy ───────────────────────────────────────────────────────────

  describe("onModuleDestroy", () => {
    it("should clear the cleanup interval", () => {
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      service.onModuleDestroy();
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});
