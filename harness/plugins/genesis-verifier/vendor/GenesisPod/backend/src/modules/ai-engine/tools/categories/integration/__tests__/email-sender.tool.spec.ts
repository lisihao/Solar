/**
 * Unit tests for EmailSenderTool
 */

import { EmailSenderTool } from "../email-sender.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Mock nodemailer
// ============================================================================

const mockSendMail = jest
  .fn()
  .mockResolvedValue({ messageId: "<test-msg-id@smtp>" });

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: "<test-msg-id@smtp>" }),
  })),
}));

import * as nodemailer from "nodemailer";

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "email-sender",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("EmailSenderTool", () => {
  let tool: EmailSenderTool;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the transporter cache so each test gets a fresh mock
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });
    mockSendMail.mockResolvedValue({ messageId: "<test-msg-id@smtp>" });
    tool = new EmailSenderTool();
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for valid to, subject, and body", () => {
      const result = tool.validateInput({
        to: ["alice@example.com"],
        subject: "Hello",
        body: "Test body",
      });
      expect(result).toBe(true);
    });

    it("should return false when to is empty", () => {
      const result = tool.validateInput({
        to: [],
        subject: "Hello",
        body: "Test body",
      });
      expect(result).toBe(false);
    });

    it("should return false when subject is missing", () => {
      const result = tool.validateInput({
        to: ["alice@example.com"],
        subject: "",
        body: "Test body",
      });
      expect(result).toBe(false);
    });

    it("should return false when body is missing", () => {
      const result = tool.validateInput({
        to: ["alice@example.com"],
        subject: "Hello",
        body: "",
      });
      expect(result).toBe(false);
    });

    it("should return false for invalid email format in to", () => {
      const result = tool.validateInput({
        to: ["not-an-email"],
        subject: "Hello",
        body: "Test body",
      });
      expect(result).toBe(false);
    });

    it("should return false when one of multiple emails is invalid", () => {
      const result = tool.validateInput({
        to: ["alice@example.com", "bad-email"],
        subject: "Hello",
        body: "Test body",
      });
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Successful send
  // --------------------------------------------------------------------------

  describe("successful send", () => {
    it("should return status=sent and messageId on success", async () => {
      const context = createMockContext();
      const result = await tool.execute(
        { to: ["alice@example.com"], subject: "Hello", body: "World" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.status).toBe("sent");
      expect(result.data?.messageId).toBe("<test-msg-id@smtp>");
    });

    it("should set sentAt on successful send", async () => {
      const context = createMockContext();
      const result = await tool.execute(
        { to: ["alice@example.com"], subject: "Hello", body: "World" },
        context,
      );

      expect(result.data?.sentAt).toBeDefined();
      expect(typeof result.data?.sentAt).toBe("string");
    });

    it("should return all recipients with status=delivered on success", async () => {
      const context = createMockContext();
      const result = await tool.execute(
        {
          to: ["alice@example.com", "bob@example.com"],
          subject: "Hello",
          body: "World",
        },
        context,
      );

      expect(result.data?.recipients).toHaveLength(2);
      expect(
        result.data?.recipients?.every((r) => r.status === "delivered"),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // HTML email
  // --------------------------------------------------------------------------

  describe("HTML email", () => {
    it("should send body as html when isHtml=true", async () => {
      const context = createMockContext();
      await tool.execute(
        {
          to: ["alice@example.com"],
          subject: "Hello",
          body: "<h1>Hello</h1>",
          isHtml: true,
        },
        context,
      );

      const callArg = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.html).toBe("<h1>Hello</h1>");
      expect(callArg.text).toBeUndefined();
    });

    it("should send body as text when isHtml is false", async () => {
      const context = createMockContext();
      await tool.execute(
        {
          to: ["alice@example.com"],
          subject: "Hello",
          body: "Plain text",
          isHtml: false,
        },
        context,
      );

      const callArg = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.text).toBe("Plain text");
      expect(callArg.html).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // CC and BCC
  // --------------------------------------------------------------------------

  describe("CC and BCC", () => {
    it("should include CC recipients in the delivered recipients list", async () => {
      const context = createMockContext();
      const result = await tool.execute(
        {
          to: ["alice@example.com"],
          cc: ["cc@example.com"],
          subject: "Hello",
          body: "World",
        },
        context,
      );

      const emails = result.data?.recipients?.map((r) => r.email) ?? [];
      expect(emails).toContain("cc@example.com");
    });

    it("should include BCC recipients in the delivered recipients list", async () => {
      const context = createMockContext();
      const result = await tool.execute(
        {
          to: ["alice@example.com"],
          bcc: ["bcc@example.com"],
          subject: "Hello",
          body: "World",
        },
        context,
      );

      const emails = result.data?.recipients?.map((r) => r.email) ?? [];
      expect(emails).toContain("bcc@example.com");
    });

    it("should include to, cc, and bcc in the recipients list", async () => {
      const context = createMockContext();
      const result = await tool.execute(
        {
          to: ["to@example.com"],
          cc: ["cc@example.com"],
          bcc: ["bcc@example.com"],
          subject: "Hello",
          body: "World",
        },
        context,
      );

      const emails = result.data?.recipients?.map((r) => r.email) ?? [];
      expect(emails).toHaveLength(3);
      expect(emails).toContain("to@example.com");
      expect(emails).toContain("cc@example.com");
      expect(emails).toContain("bcc@example.com");
    });
  });

  // --------------------------------------------------------------------------
  // Attachments
  // --------------------------------------------------------------------------

  describe("attachments", () => {
    it("should convert Base64 attachment content to Buffer", async () => {
      const base64Content = Buffer.from("hello attachment").toString("base64");
      const context = createMockContext();

      await tool.execute(
        {
          to: ["alice@example.com"],
          subject: "With attachment",
          body: "See attached",
          attachments: [
            {
              filename: "file.txt",
              content: base64Content,
              contentType: "text/plain",
            },
          ],
        },
        context,
      );

      const callArg = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
      const attachments = callArg.attachments as Array<{
        filename: string;
        content: Buffer;
        contentType: string;
      }>;
      expect(attachments).toHaveLength(1);
      expect(attachments[0].filename).toBe("file.txt");
      expect(Buffer.isBuffer(attachments[0].content)).toBe(true);
      expect(attachments[0].content.toString()).toBe("hello attachment");
    });
  });

  // --------------------------------------------------------------------------
  // Scheduled emails
  // --------------------------------------------------------------------------

  describe("scheduled emails", () => {
    it("should return status=scheduled and queued recipients for a future scheduledAt", async () => {
      const context = createMockContext();
      const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const result = await tool.execute(
        {
          to: ["alice@example.com"],
          subject: "Scheduled",
          body: "Later",
          scheduledAt: futureDate,
        },
        context,
      );

      expect(result.data?.status).toBe("scheduled");
      expect(result.data?.success).toBe(true);
      expect(result.data?.recipients?.every((r) => r.status === "queued")).toBe(
        true,
      );
      // sendMail should NOT be called for future scheduled emails
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it("should actually send (not schedule) when scheduledAt is in the past", async () => {
      const context = createMockContext();
      const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const result = await tool.execute(
        {
          to: ["alice@example.com"],
          subject: "Past scheduled",
          body: "Now",
          scheduledAt: pastDate,
        },
        context,
      );

      expect(result.data?.status).toBe("sent");
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Priority headers
  // --------------------------------------------------------------------------

  describe("priority", () => {
    it("should set X-Priority header to '1' for high priority", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          to: ["alice@example.com"],
          subject: "Urgent",
          body: "Important",
          priority: "high",
        },
        context,
      );

      const callArg = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
      const headers = callArg.headers as Record<string, string>;
      expect(headers["X-Priority"]).toBe("1");
      expect(headers["X-MSMail-Priority"]).toBe("High");
    });

    it("should set X-Priority header to '5' for low priority", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          to: ["alice@example.com"],
          subject: "FYI",
          body: "Not urgent",
          priority: "low",
        },
        context,
      );

      const callArg = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
      const headers = callArg.headers as Record<string, string>;
      expect(headers["X-Priority"]).toBe("5");
      expect(headers["X-MSMail-Priority"]).toBe("Low");
    });

    it("should not set X-Priority for normal priority", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          to: ["alice@example.com"],
          subject: "Normal",
          body: "Regular email",
          priority: "normal",
        },
        context,
      );

      const callArg = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
      const headers = callArg.headers as Record<string, string>;
      expect(headers["X-Priority"]).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return status=failed and success=false when sendMail throws", async () => {
      mockSendMail.mockRejectedValueOnce(new Error("SMTP connection refused"));
      const context = createMockContext();

      const result = await tool.execute(
        { to: ["alice@example.com"], subject: "Test", body: "Body" },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.status).toBe("failed");
      expect(result.data?.error).toBe("SMTP connection refused");
    });
  });

  // --------------------------------------------------------------------------
  // Custom from
  // --------------------------------------------------------------------------

  describe("custom from", () => {
    it("should use custom from email when provided", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          to: ["alice@example.com"],
          subject: "Hello",
          body: "World",
          from: { email: "custom@sender.com", name: "Custom Sender" },
        },
        context,
      );

      const callArg = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.from).toContain("custom@sender.com");
      expect(callArg.from).toContain("Custom Sender");
    });

    it("should use default from email from process.env when no from is provided", async () => {
      const originalEnv = process.env.SMTP_FROM;
      process.env.SMTP_FROM = "env-default@example.com";

      // Reset transporter cache to pick up new env
      const freshTool = new EmailSenderTool();
      const context = createMockContext();

      await freshTool.execute(
        { to: ["alice@example.com"], subject: "Hello", body: "World" },
        context,
      );

      const callArg = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.from).toContain("env-default@example.com");

      process.env.SMTP_FROM = originalEnv;
    });

    it("should fall back to noreply@example.com when SMTP_FROM and SMTP_USER are unset", async () => {
      const originalFrom = process.env.SMTP_FROM;
      const originalUser = process.env.SMTP_USER;
      delete process.env.SMTP_FROM;
      delete process.env.SMTP_USER;

      const freshTool = new EmailSenderTool();
      const context = createMockContext();

      await freshTool.execute(
        { to: ["alice@example.com"], subject: "Hello", body: "World" },
        context,
      );

      const callArg = mockSendMail.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.from).toContain("noreply@example.com");

      process.env.SMTP_FROM = originalFrom;
      process.env.SMTP_USER = originalUser;
    });
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have correct id and category", () => {
      expect(tool.id).toBe("email-sender");
      expect(tool.category).toBe("integration");
    });
  });
});
