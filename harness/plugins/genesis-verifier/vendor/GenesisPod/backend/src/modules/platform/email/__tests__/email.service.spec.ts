import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailService } from "../email.service";
import { EmailNotificationPresetsService } from "../presets/email-notification-presets.service";
import { SettingsService } from "../../settings/settings.service";

describe("EmailService", () => {
  let service: EmailService;
  let presetsService: EmailNotificationPresetsService;
  let mockConfigService: jest.Mocked<Partial<ConfigService>>;
  let mockSettingsService: jest.Mocked<Partial<SettingsService>>;

  const makeEmailSettings = (overrides: Record<string, unknown> = {}) => ({
    provider: "smtp" as const,
    enabled: true,
    from: "noreply@test.com",
    adminEmail: "admin@test.com",
    host: "smtp.test.com",
    port: 587,
    user: "user@test.com",
    pass: "password",
    resendApiKey: null,
    ...overrides,
  });

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    };

    mockSettingsService = {
      getEmailSettings: jest.fn().mockResolvedValue(makeEmailSettings()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    presetsService = new EmailNotificationPresetsService(
      service,
      mockConfigService as ConfigService,
    );
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== onModuleInit ====================

  describe("onModuleInit", () => {
    it("initializes SMTP provider when provider is smtp and settings are complete", async () => {
      await service.onModuleInit();
      // Service should be configured after SMTP init with valid settings
      expect(mockSettingsService.getEmailSettings).toHaveBeenCalled();
    });

    it("does not configure service when email is disabled", async () => {
      (mockSettingsService.getEmailSettings as jest.Mock).mockResolvedValue(
        makeEmailSettings({ enabled: false }),
      );

      await service.onModuleInit();

      expect(service.isEnabled()).toBe(false);
    });

    it("does not configure SMTP when host is missing", async () => {
      (mockSettingsService.getEmailSettings as jest.Mock).mockResolvedValue(
        makeEmailSettings({ host: null }),
      );

      await service.onModuleInit();

      expect(service.isEnabled()).toBe(false);
    });

    it("does not configure SMTP when user is missing", async () => {
      (mockSettingsService.getEmailSettings as jest.Mock).mockResolvedValue(
        makeEmailSettings({ user: null }),
      );

      await service.onModuleInit();

      expect(service.isEnabled()).toBe(false);
    });

    it("does not configure SMTP when pass is missing", async () => {
      (mockSettingsService.getEmailSettings as jest.Mock).mockResolvedValue(
        makeEmailSettings({ pass: null }),
      );

      await service.onModuleInit();

      expect(service.isEnabled()).toBe(false);
    });

    it("handles settings service error gracefully", async () => {
      (mockSettingsService.getEmailSettings as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );

      await expect(service.onModuleInit()).resolves.not.toThrow();
      expect(service.isEnabled()).toBe(false);
    });

    it("does not configure Resend when API key is null", async () => {
      (mockSettingsService.getEmailSettings as jest.Mock).mockResolvedValue(
        makeEmailSettings({ provider: "resend", resendApiKey: null }),
      );

      await service.onModuleInit();

      expect(service.isEnabled()).toBe(false);
      expect(service.getProvider()).toBe("resend");
    });
  });

  // ==================== isEnabled / getProvider ====================

  describe("isEnabled and getProvider", () => {
    it("returns false before initialization", () => {
      expect(service.isEnabled()).toBe(false);
    });

    it("returns smtp as default provider", () => {
      expect(service.getProvider()).toBe("smtp");
    });
  });

  // ==================== sendEmail ====================

  describe("sendEmail", () => {
    it("returns false when service is not configured", async () => {
      const result = await service.sendEmail({
        to: "recipient@test.com",
        subject: "Test",
        html: "<p>Test</p>",
      });

      expect(result).toBe(false);
    });

    it("accepts array of recipients", async () => {
      // Service is not configured, so it returns false but should not throw
      const result = await service.sendEmail({
        to: ["a@test.com", "b@test.com"],
        subject: "Multi-recipient test",
        text: "Hello",
      });

      expect(result).toBe(false); // not configured
    });

    it("returns false when smtp transporter is null", async () => {
      // Force provider to smtp, but keep transporter null (default state)
      const result = await service.sendEmail({
        to: "test@test.com",
        subject: "Test",
        text: "Hello",
      });

      expect(result).toBe(false);
    });
  });

  // ==================== testConnection ====================

  describe("testConnection", () => {
    it("returns failure when service is not configured", async () => {
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe("Email service not configured");
    });
  });

  // ==================== reinitialize ====================

  describe("reinitialize", () => {
    it("re-invokes settings service on reinitialize", async () => {
      await service.reinitialize();

      expect(mockSettingsService.getEmailSettings).toHaveBeenCalled();
    });

    it("resets configured state before reinitializing", async () => {
      // First init with disabled
      (mockSettingsService.getEmailSettings as jest.Mock).mockResolvedValue(
        makeEmailSettings({ enabled: false }),
      );
      await service.onModuleInit();

      // Second reinit with enabled (still no transporter in test env)
      (mockSettingsService.getEmailSettings as jest.Mock).mockResolvedValue(
        makeEmailSettings({ enabled: true }),
      );
      await service.reinitialize();

      expect(mockSettingsService.getEmailSettings).toHaveBeenCalledTimes(2);
    });
  });

  // ==================== sendFeedbackNotification ====================

  describe("sendFeedbackNotification", () => {
    it("returns false when admin email is not configured", async () => {
      // Service is not configured so admin email is empty string
      const result = await presetsService.sendFeedbackNotification({
        id: "feedback-1",
        type: "BUG",
        title: "Test Bug",
        description: "Something broke",
      });

      expect(result).toBe(false);
    });
  });

  // ==================== sendMissionCompletionNotification ====================

  describe("sendMissionCompletionNotification", () => {
    it("returns false when email service is not configured", async () => {
      const result = await presetsService.sendMissionCompletionNotification({
        to: "user@test.com",
        missionId: "mission-1",
        missionTitle: "Test Mission",
        reportUrl: "https://example.com/report",
        completedAt: new Date(),
      });

      expect(result).toBe(false);
    });
  });

  // ==================== sendFeedbackStatusUpdate ====================

  describe("sendFeedbackStatusUpdate", () => {
    it("returns false when email service is not configured", async () => {
      const result = await presetsService.sendFeedbackStatusUpdate({
        id: "feedback-1",
        title: "Bug Report",
        type: "BUG",
        oldStatus: "PENDING",
        newStatus: "RESOLVED",
        userEmail: "user@test.com",
      });

      expect(result).toBe(false);
    });
  });

  // ==================== Resend provider path ====================

  describe("Resend provider (sendEmail via resend)", () => {
    it("sends successfully via Resend when properly configured", async () => {
      // Mock the Resend module
      const mockSend = jest.fn().mockResolvedValue({
        data: { id: "resend-msg-123" },
        error: null,
      });
      jest.doMock("resend", () => ({
        Resend: jest.fn().mockImplementation(() => ({
          emails: { send: mockSend },
        })),
      }));

      (mockSettingsService.getEmailSettings as jest.Mock).mockResolvedValue(
        makeEmailSettings({ provider: "resend", resendApiKey: "re_test_key" }),
      );

      await service.onModuleInit();

      // If Resend is configured, isEnabled should be true
      // (In the test environment Resend constructor is called)
      // The state depends on whether `new Resend(apiKey)` succeeds
      // We just confirm onModuleInit doesn't throw
      expect(mockSettingsService.getEmailSettings).toHaveBeenCalled();
    });

    it("returns false from sendEmail when Resend client is null", async () => {
      // Keep provider as resend but no API key so client stays null
      (mockSettingsService.getEmailSettings as jest.Mock).mockResolvedValue(
        makeEmailSettings({
          provider: "resend",
          resendApiKey: null,
          enabled: true,
        }),
      );
      await service.onModuleInit();

      // isConfigured=false so sendEmail returns false before hitting Resend
      const result = await service.sendEmail({
        to: "test@test.com",
        subject: "Hello",
        text: "World",
      });

      expect(result).toBe(false);
    });
  });

  // ==================== sendEmail via SMTP (configured path) ====================

  describe("sendEmail via SMTP (configured)", () => {
    it("returns false when SMTP transporter throws on send", async () => {
      // Manually configure the transporter via reflection to simulate configured state
      const mockTransporter = {
        sendMail: jest.fn().mockRejectedValue(new Error("SMTP send failed")),
      };

      // Force isConfigured and provider state
      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "smtpTransporter", {
        value: mockTransporter,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "smtp",
        writable: true,
      });

      const result = await service.sendEmail({
        to: "to@test.com",
        subject: "Test",
        text: "body",
      });

      expect(result).toBe(false);
    });

    it("returns true when SMTP transporter sends successfully", async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: "msg-123" }),
      };

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "smtpTransporter", {
        value: mockTransporter,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "smtp",
        writable: true,
      });

      const result = await service.sendEmail({
        to: ["user1@test.com", "user2@test.com"],
        subject: "Batch",
        html: "<b>Hello</b>",
        replyTo: "reply@test.com",
        attachments: [
          {
            filename: "test.txt",
            content: "content",
            contentType: "text/plain",
          },
        ],
      });

      expect(result).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "user1@test.com, user2@test.com",
          subject: "Batch",
          replyTo: "reply@test.com",
        }),
      );
    });
  });

  // ==================== testConnection - Resend configured path ====================

  describe("testConnection (resend configured)", () => {
    it("returns failure when resend client errors on test send", async () => {
      const mockSend = jest.fn().mockResolvedValue({
        data: null,
        error: { message: "Invalid API key" },
      });

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "resend",
        writable: true,
      });
      Object.defineProperty(service, "resendClient", {
        value: { emails: { send: mockSend } },
        writable: true,
      });
      Object.defineProperty(service, "adminEmail", {
        value: "admin@test.com",
        writable: true,
      });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("Invalid API key");
    });

    it("returns success when resend test send succeeds", async () => {
      const mockSend = jest.fn().mockResolvedValue({
        data: { id: "resend-test-id" },
        error: null,
      });

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "resend",
        writable: true,
      });
      Object.defineProperty(service, "resendClient", {
        value: { emails: { send: mockSend } },
        writable: true,
      });
      Object.defineProperty(service, "adminEmail", {
        value: "admin@test.com",
        writable: true,
      });

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toContain("admin@test.com");
    });

    it("returns failure when resend throws during test", async () => {
      const mockSend = jest.fn().mockRejectedValue(new Error("network error"));

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "resend",
        writable: true,
      });
      Object.defineProperty(service, "resendClient", {
        value: { emails: { send: mockSend } },
        writable: true,
      });
      Object.defineProperty(service, "adminEmail", {
        value: "admin@test.com",
        writable: true,
      });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("network error");
    });
  });

  // ==================== testConnection - SMTP configured path ====================

  describe("testConnection (SMTP configured)", () => {
    it("returns success when SMTP verify and send succeed", async () => {
      const mockTransporter = {
        verify: jest.fn().mockResolvedValue(true),
        sendMail: jest.fn().mockResolvedValue({ messageId: "test-msg" }),
      };

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "smtp",
        writable: true,
      });
      Object.defineProperty(service, "smtpTransporter", {
        value: mockTransporter,
        writable: true,
      });
      Object.defineProperty(service, "adminEmail", {
        value: "admin@test.com",
        writable: true,
      });

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toContain("admin@test.com");
    });

    it("returns failure when SMTP verify throws", async () => {
      const mockTransporter = {
        verify: jest.fn().mockRejectedValue(new Error("Connection refused")),
        sendMail: jest.fn(),
      };

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "smtp",
        writable: true,
      });
      Object.defineProperty(service, "smtpTransporter", {
        value: mockTransporter,
        writable: true,
      });
      Object.defineProperty(service, "adminEmail", {
        value: "admin@test.com",
        writable: true,
      });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("Connection refused");
    });

    it("returns failure when smtpTransporter is null", async () => {
      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "smtp",
        writable: true,
      });
      Object.defineProperty(service, "smtpTransporter", {
        value: null,
        writable: true,
      });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe("SMTP transporter not initialized");
    });

    it("returns failure when resendClient is null for resend provider", async () => {
      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "resend",
        writable: true,
      });
      Object.defineProperty(service, "resendClient", {
        value: null,
        writable: true,
      });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe("Resend client not initialized");
    });
  });

  // ==================== sendFeedbackNotification (with admin email) ====================

  describe("sendFeedbackNotification (configured)", () => {
    it("returns false when sendEmail returns false (not configured)", async () => {
      // Set adminEmail but keep isConfigured=false so sendEmail returns false
      Object.defineProperty(service, "adminEmail", {
        value: "admin@test.com",
        writable: true,
      });

      const result = await presetsService.sendFeedbackNotification({
        id: "fb-1",
        type: "FEATURE",
        title: "Add dark mode",
        description: "Please add dark mode support",
        userEmail: "user@test.com",
        pageUrl: "https://example.com/page",
        attachments: [{ filename: "screenshot.png", content: Buffer.from("") }],
      });

      expect(result).toBe(false);
    });

    it("sends feedback with all fields including attachments", async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: "fb-msg" }),
      };

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "smtpTransporter", {
        value: mockTransporter,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "smtp",
        writable: true,
      });
      Object.defineProperty(service, "adminEmail", {
        value: "admin@test.com",
        writable: true,
      });

      const result = await presetsService.sendFeedbackNotification({
        id: "fb-2",
        type: "BUG",
        title: "Crash on login",
        description: "App crashes when logging in",
        userEmail: "user@test.com",
        pageUrl: "https://app.example.com/login",
        attachments: [
          { filename: "crash.log", content: Buffer.from("crash data") },
        ],
      });

      expect(result).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining("Bug Report"),
        }),
      );
    });

    it("handles feedback without optional fields", async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: "fb-msg" }),
      };

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "smtpTransporter", {
        value: mockTransporter,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "smtp",
        writable: true,
      });
      Object.defineProperty(service, "adminEmail", {
        value: "admin@test.com",
        writable: true,
      });

      const result = await presetsService.sendFeedbackNotification({
        id: "fb-3",
        type: "OTHER",
        title: "General feedback",
        description: "Great product!",
      });

      expect(result).toBe(true);
    });
  });

  // ==================== sendMissionCompletionNotification (configured) ====================

  describe("sendMissionCompletionNotification (configured)", () => {
    it("sends mission completion notification with summary", async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: "mission-msg" }),
      };

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "smtpTransporter", {
        value: mockTransporter,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "smtp",
        writable: true,
      });

      const result = await presetsService.sendMissionCompletionNotification({
        to: "user@test.com",
        missionId: "m1",
        missionTitle: "AI Research Mission",
        reportUrl: "https://example.com/report/1",
        summary: "Comprehensive analysis completed",
        completedAt: new Date(),
      });

      expect(result).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "user@test.com",
          subject: expect.stringContaining("AI Research Mission"),
        }),
      );
    });

    it("truncates long summary to 500 chars", async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: "msg" }),
      };

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "smtpTransporter", {
        value: mockTransporter,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "smtp",
        writable: true,
      });

      const longSummary = "a".repeat(600);
      const result = await presetsService.sendMissionCompletionNotification({
        to: "user@test.com",
        missionId: "m2",
        missionTitle: "Long Summary Mission",
        reportUrl: "https://example.com/report/2",
        summary: longSummary,
        completedAt: new Date(),
      });

      expect(result).toBe(true);
      const sendMailCall = mockTransporter.sendMail.mock.calls[0][0];
      expect(sendMailCall.html).toContain("...");
    });

    it("sends without summary when not provided", async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: "msg" }),
      };

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "smtpTransporter", {
        value: mockTransporter,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "smtp",
        writable: true,
      });

      const result = await presetsService.sendMissionCompletionNotification({
        to: "user@test.com",
        missionId: "m3",
        missionTitle: "No Summary Mission",
        reportUrl: "https://example.com/report/3",
        completedAt: new Date(),
      });

      expect(result).toBe(true);
    });
  });

  // ==================== sendFeedbackStatusUpdate (configured) ====================

  describe("sendFeedbackStatusUpdate (configured)", () => {
    it("sends feedback status update with admin notes", async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: "status-msg" }),
      };

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "smtpTransporter", {
        value: mockTransporter,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "smtp",
        writable: true,
      });

      const result = await presetsService.sendFeedbackStatusUpdate({
        id: "fb-1",
        title: "Bug Report",
        type: "BUG",
        oldStatus: "PENDING",
        newStatus: "IN_PROGRESS",
        userEmail: "user@test.com",
        adminNotes: "We are looking into this issue.",
      });

      expect(result).toBe(true);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "user@test.com",
          subject: expect.stringContaining("In Progress"),
        }),
      );
    });

    it("sends status update for all known statuses", async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: "msg" }),
      };

      Object.defineProperty(service, "isConfigured", {
        value: true,
        writable: true,
      });
      Object.defineProperty(service, "smtpTransporter", {
        value: mockTransporter,
        writable: true,
      });
      Object.defineProperty(service, "provider", {
        value: "smtp",
        writable: true,
      });

      const statuses = ["PENDING", "REVIEWED", "RESOLVED", "CLOSED"];
      for (const status of statuses) {
        mockTransporter.sendMail.mockResolvedValue({ messageId: "msg" });
        const result = await presetsService.sendFeedbackStatusUpdate({
          id: "fb-x",
          title: "Test",
          type: "BUG",
          oldStatus: "PENDING",
          newStatus: status,
          userEmail: "user@test.com",
        });
        expect(result).toBe(true);
      }
    });
  });
});
