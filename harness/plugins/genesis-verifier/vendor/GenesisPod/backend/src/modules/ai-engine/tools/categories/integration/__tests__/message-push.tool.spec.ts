/**
 * Unit tests for MessagePushTool
 */

import { MessagePushTool } from "../message-push.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Mock axios and nodemailer
// ============================================================================

const mockSendMail = jest.fn().mockResolvedValue({});

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({}),
  })),
}));

jest.mock("axios", () => ({
  default: {
    post: jest.fn(),
    request: jest.fn(),
  },
  post: jest.fn(),
  request: jest.fn(),
}));

import axios from "axios";
import * as nodemailer from "nodemailer";

const mockedAxiosPost = axios.post as jest.Mock;
const mockedAxiosRequest = axios.request as jest.Mock;
const mockedCreateTransport = nodemailer.createTransport as jest.Mock;

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "message-push",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeAxiosResponse(status: number, data: unknown = {}) {
  return { status, data };
}

// ============================================================================
// Test suite
// ============================================================================

describe("MessagePushTool", () => {
  let tool: MessagePushTool;

  beforeEach(() => {
    jest.clearAllMocks();
    // Default successful responses
    mockedAxiosPost.mockResolvedValue(makeAxiosResponse(200, "ok"));
    mockedAxiosRequest.mockResolvedValue(makeAxiosResponse(200, {}));
    mockedCreateTransport.mockReturnValue({ sendMail: mockSendMail });
    mockSendMail.mockResolvedValue({});
    tool = new MessagePushTool();
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for valid slack config", () => {
      expect(
        tool.validateInput({
          platform: "slack",
          message: "Hello Slack!",
          config: { channel: "https://hooks.slack.com/services/xxx" },
        }),
      ).toBe(true);
    });

    it("should return true for valid discord config", () => {
      expect(
        tool.validateInput({
          platform: "discord",
          message: "Hello Discord!",
          config: { webhookUrl: "https://discord.com/api/webhooks/123/abc" },
        }),
      ).toBe(true);
    });

    it("should return true for valid email config", () => {
      expect(
        tool.validateInput({
          platform: "email",
          message: "Email body",
          config: { to: ["alice@example.com"], subject: "Test" },
        }),
      ).toBe(true);
    });

    it("should return true for valid webhook config", () => {
      expect(
        tool.validateInput({
          platform: "webhook",
          message: "Webhook payload",
          config: { url: "https://example.com/hook" },
        }),
      ).toBe(true);
    });

    it("should return true for valid feishu config", () => {
      expect(
        tool.validateInput({
          platform: "feishu",
          message: "Feishu message",
          config: {
            receiveId: "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
          },
        }),
      ).toBe(true);
    });

    it("should return false when message is empty", () => {
      expect(
        tool.validateInput({
          platform: "slack",
          message: "",
          config: { channel: "#general" },
        }),
      ).toBe(false);
    });

    it("should return false when message is whitespace only", () => {
      expect(
        tool.validateInput({
          platform: "slack",
          message: "   ",
          config: { channel: "#general" },
        }),
      ).toBe(false);
    });

    it("should return false when discord webhookUrl does not start with https://", () => {
      expect(
        tool.validateInput({
          platform: "discord",
          message: "Hello",
          config: { webhookUrl: "http://discord.com/api/webhooks/123" },
        }),
      ).toBe(false);
    });

    it("should return false when email has no recipients", () => {
      expect(
        tool.validateInput({
          platform: "email",
          message: "Hello",
          config: { to: [], subject: "Test" },
        }),
      ).toBe(false);
    });

    it("should return false when email subject is missing", () => {
      expect(
        tool.validateInput({
          platform: "email",
          message: "Hello",
          config: { to: ["alice@example.com"], subject: "" },
        }),
      ).toBe(false);
    });

    it("should return false when webhook URL does not start with http", () => {
      expect(
        tool.validateInput({
          platform: "webhook",
          message: "Hello",
          config: { url: "ftp://example.com/hook" },
        }),
      ).toBe(false);
    });

    it("should return false when feishu receiveId is empty", () => {
      expect(
        tool.validateInput({
          platform: "feishu",
          message: "Hello",
          config: { receiveId: "" },
        }),
      ).toBe(false);
    });

    it("should return false when message exceeds platform length limit", () => {
      const longMessage = "a".repeat(2001); // Discord limit is 2000
      expect(
        tool.validateInput({
          platform: "discord",
          message: longMessage,
          config: { webhookUrl: "https://discord.com/api/webhooks/123" },
        }),
      ).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Slack - incoming webhook
  // --------------------------------------------------------------------------

  describe("Slack incoming webhook", () => {
    it("should POST to webhookUrl for Slack incoming webhook", async () => {
      mockedAxiosPost.mockResolvedValueOnce(makeAxiosResponse(200, "ok"));
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "slack",
          message: "Deploy complete!",
          config: { channel: "https://hooks.slack.com/services/T00/B00/xxx" },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("delivered");
      expect(mockedAxiosPost).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/T00/B00/xxx",
        expect.objectContaining({ text: "Deploy complete!" }),
        expect.any(Object),
      );
    });

    it("should throw when Slack webhook does not return 'ok'", async () => {
      mockedAxiosPost.mockResolvedValueOnce(
        makeAxiosResponse(200, "invalid_payload"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "slack",
          message: "Hello",
          config: { channel: "https://hooks.slack.com/services/T00/B00/xxx" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.status).toBe("failed");
    });
  });

  // --------------------------------------------------------------------------
  // Slack - bot token API
  // --------------------------------------------------------------------------

  describe("Slack bot token API", () => {
    it("should POST to chat.postMessage with Authorization header", async () => {
      mockedAxiosPost.mockResolvedValueOnce(
        makeAxiosResponse(200, { ok: true, ts: "1234567890.123456" }),
      );
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "slack",
          message: "Bot message",
          config: {
            channel: "#general",
            token: "xoxb-bot-token",
          },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(mockedAxiosPost).toHaveBeenCalledWith(
        "https://slack.com/api/chat.postMessage",
        expect.objectContaining({ channel: "#general", text: "Bot message" }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer xoxb-bot-token",
          }),
        }),
      );
    });

    it("should fail when Slack bot API returns ok=false", async () => {
      mockedAxiosPost.mockResolvedValueOnce(
        makeAxiosResponse(200, { ok: false, error: "channel_not_found" }),
      );
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "slack",
          message: "Hello",
          config: { channel: "#nonexistent", token: "xoxb-token" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("channel_not_found");
    });
  });

  // --------------------------------------------------------------------------
  // Discord
  // --------------------------------------------------------------------------

  describe("Discord", () => {
    it("should POST to Discord webhookUrl and return success for 200", async () => {
      mockedAxiosPost.mockResolvedValueOnce(makeAxiosResponse(200, {}));
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "discord",
          message: "Hello Discord!",
          config: { webhookUrl: "https://discord.com/api/webhooks/123/abc" },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("delivered");
      expect(mockedAxiosPost).toHaveBeenCalledWith(
        "https://discord.com/api/webhooks/123/abc",
        expect.objectContaining({ content: "Hello Discord!" }),
        expect.any(Object),
      );
    });

    it("should return success for Discord response status 204", async () => {
      mockedAxiosPost.mockResolvedValueOnce(makeAxiosResponse(204, null));
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "discord",
          message: "Hello",
          config: { webhookUrl: "https://discord.com/api/webhooks/123/abc" },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
    });

    it("should return success=false for non-200/204 Discord response", async () => {
      mockedAxiosPost.mockResolvedValueOnce(
        makeAxiosResponse(400, { code: 50035 }),
      );
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "discord",
          message: "Hello",
          config: { webhookUrl: "https://discord.com/api/webhooks/123/abc" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Email
  // --------------------------------------------------------------------------

  describe("Email", () => {
    it("should call nodemailer sendMail with email config", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "email",
          message: "Email body content",
          config: {
            to: ["alice@example.com"],
            subject: "Test Email",
          },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("sent");
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "alice@example.com",
          subject: "Test Email",
        }),
      );
    });

    it("should return success=false when sendMail throws", async () => {
      mockSendMail.mockRejectedValueOnce(new Error("SMTP auth failed"));
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "email",
          message: "Hello",
          config: { to: ["alice@example.com"], subject: "Test" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("SMTP auth failed");
    });
  });

  // --------------------------------------------------------------------------
  // Webhook
  // --------------------------------------------------------------------------

  describe("Webhook", () => {
    it("should POST to webhook URL with default method", async () => {
      mockedAxiosRequest.mockResolvedValueOnce(
        makeAxiosResponse(200, { received: true }),
      );
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "webhook",
          message: "Webhook message",
          config: { url: "https://example.com/hook" },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(mockedAxiosRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "POST",
          url: "https://example.com/hook",
        }),
      );
    });

    it("should use configured method (PUT)", async () => {
      mockedAxiosRequest.mockResolvedValueOnce(makeAxiosResponse(200, {}));
      const context = createMockContext();

      await tool.execute(
        {
          platform: "webhook",
          message: "PUT message",
          config: { url: "https://example.com/hook", method: "PUT" },
        },
        context,
      );

      const callArg = mockedAxiosRequest.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(callArg.method).toBe("PUT");
    });

    it("should merge custom headers into request", async () => {
      mockedAxiosRequest.mockResolvedValueOnce(makeAxiosResponse(200, {}));
      const context = createMockContext();

      await tool.execute(
        {
          platform: "webhook",
          message: "Hello",
          config: {
            url: "https://example.com/hook",
            headers: { "X-Custom": "value" },
          },
        },
        context,
      );

      const callArg = mockedAxiosRequest.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      const headers = callArg.headers as Record<string, string>;
      expect(headers["X-Custom"]).toBe("value");
    });

    it("should add X-Webhook-Secret header when secret is configured", async () => {
      mockedAxiosRequest.mockResolvedValueOnce(makeAxiosResponse(200, {}));
      const context = createMockContext();

      await tool.execute(
        {
          platform: "webhook",
          message: "Signed message",
          config: {
            url: "https://example.com/hook",
            secret: "my-webhook-secret",
          },
        },
        context,
      );

      const callArg = mockedAxiosRequest.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      const headers = callArg.headers as Record<string, string>;
      expect(headers["X-Webhook-Secret"]).toBe("my-webhook-secret");
    });

    it("should return success=false when webhook returns non-2xx", async () => {
      mockedAxiosRequest.mockResolvedValueOnce(
        makeAxiosResponse(500, { error: "Server error" }),
      );
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "webhook",
          message: "Hello",
          config: { url: "https://example.com/hook" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Feishu
  // --------------------------------------------------------------------------

  describe("Feishu", () => {
    it("should POST to Feishu webhook URL and return success when StatusCode=0", async () => {
      mockedAxiosPost.mockResolvedValueOnce(
        makeAxiosResponse(200, { StatusCode: 0 }),
      );
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "feishu",
          message: "Hello Feishu!",
          config: {
            receiveId: "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
          },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("delivered");
      expect(mockedAxiosPost).toHaveBeenCalledWith(
        "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
        expect.objectContaining({
          msg_type: "text",
          content: { text: "Hello Feishu!" },
        }),
        expect.any(Object),
      );
    });

    it("should return success when Feishu response has code=0", async () => {
      mockedAxiosPost.mockResolvedValueOnce(
        makeAxiosResponse(200, { code: 0 }),
      );
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "feishu",
          message: "Hello",
          config: {
            receiveId: "https://open.feishu.cn/open-apis/bot/v2/hook/yyy",
          },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
    });

    it("should return success=false when Feishu webhook returns error code", async () => {
      mockedAxiosPost.mockResolvedValueOnce(
        makeAxiosResponse(200, { StatusCode: 19001, msg: "sign match fail" }),
      );
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "feishu",
          message: "Hello",
          config: {
            receiveId: "https://open.feishu.cn/open-apis/bot/v2/hook/bad",
          },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
    });

    it("should return success=false when feishu receiveId is not a URL", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "feishu",
          message: "Hello",
          config: { receiveId: "ou_abc123" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("webhook URL");
    });
  });

  // --------------------------------------------------------------------------
  // axios throws
  // --------------------------------------------------------------------------

  describe("axios throws", () => {
    it("should return success=false with error message when axios.post throws for Slack", async () => {
      mockedAxiosPost.mockRejectedValueOnce(new Error("Network timeout"));
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "slack",
          message: "Hello",
          config: { channel: "https://hooks.slack.com/services/T00/B00/xxx" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Network timeout");
    });

    it("should return success=false with error message when axios.request throws for webhook", async () => {
      mockedAxiosRequest.mockRejectedValueOnce(new Error("Connection refused"));
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "webhook",
          message: "Hello",
          config: { url: "https://example.com/hook" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Connection refused");
    });
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have correct id and category", () => {
      expect(tool.id).toBe("message-push");
      expect(tool.category).toBe("integration");
    });

    it("should include platform metadata in successful response", async () => {
      mockedAxiosPost.mockResolvedValueOnce(makeAxiosResponse(200, "ok"));
      const context = createMockContext();

      const result = await tool.execute(
        {
          platform: "slack",
          message: "Hello",
          config: { channel: "https://hooks.slack.com/services/T00/B00/xxx" },
        },
        context,
      );

      expect(result.data?.metadata?.platform).toBe("slack");
    });
  });
});
