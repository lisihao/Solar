import { Test, TestingModule } from "@nestjs/testing";
import { CanActivate, ExecutionContext, Logger } from "@nestjs/common";
import { SettingsController } from "../settings.controller";
import { SettingsService } from "@/modules/platform/settings/settings.service";
import { EmailService } from "@/modules/platform/email/email.service";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { AdminGuard } from "@/common/guards/admin.guard";

const mockGuard: CanActivate = {
  canActivate: (_ctx: ExecutionContext) => true,
};

// ============================================================================
// Mocks
// ============================================================================

function makeSettingsServiceMock() {
  return {
    getAll: jest.fn().mockResolvedValue({ site: {}, ai: {} }),
    getEmailSettings: jest.fn().mockResolvedValue({
      host: "smtp.example.com",
      port: 587,
      pass: "secret",
      resendApiKey: "re_abc",
    }),
    updateEmailSettings: jest.fn().mockResolvedValue(undefined),
    getSmtpSettings: jest.fn().mockResolvedValue({
      host: "smtp.legacy.com",
      port: 25,
      pass: "oldpass",
    }),
    updateSmtpSettings: jest.fn().mockResolvedValue(undefined),
    getSiteSettings: jest.fn().mockResolvedValue({ name: "GenesisPod" }),
    updateSiteSettings: jest.fn().mockResolvedValue(undefined),
    getAiSettings: jest.fn().mockResolvedValue({ defaultModel: "gpt-4" }),
    updateAiSettings: jest.fn().mockResolvedValue(undefined),
    getSecuritySettings: jest.fn().mockResolvedValue({ mfaEnabled: false }),
    updateSecuritySettings: jest.fn().mockResolvedValue(undefined),
    getStorageSettings: jest.fn().mockResolvedValue({ provider: "s3" }),
    updateStorageSettings: jest.fn().mockResolvedValue(undefined),
    refreshCache: jest.fn().mockResolvedValue(undefined),
    diagnoseEncryptionIssues: jest.fn().mockResolvedValue({
      issues: [],
      fixed: [],
    }),
  };
}

function makeEmailServiceMock() {
  return {
    reinitialize: jest.fn().mockResolvedValue(undefined),
    testConnection: jest.fn().mockResolvedValue({ success: true }),
    isEnabled: jest.fn().mockReturnValue(true),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("SettingsController", () => {
  let controller: SettingsController;
  let settingsService: ReturnType<typeof makeSettingsServiceMock>;
  let emailService: ReturnType<typeof makeEmailServiceMock>;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    settingsService = makeSettingsServiceMock();
    emailService = makeEmailServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        { provide: SettingsService, useValue: settingsService },
        { provide: EmailService, useValue: emailService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(AdminGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<SettingsController>(SettingsController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------- getAllSettings ----------

  describe("getAllSettings", () => {
    it("returns settings wrapped in a settings key", async () => {
      const result = await controller.getAllSettings();
      expect(result).toEqual({ settings: { site: {}, ai: {} } });
      expect(settingsService.getAll).toHaveBeenCalledTimes(1);
    });
  });

  // ---------- Email settings ----------

  describe("getEmailSettings", () => {
    it("masks the password and exposes the resend API key", async () => {
      const result = await controller.getEmailSettings();

      expect(result.pass).toBe("********");
      expect(result.resendApiKey).toBe("re_abc");
    });

    it("sets pass to null when no password is stored", async () => {
      settingsService.getEmailSettings.mockResolvedValue({
        host: "smtp.example.com",
        port: 587,
        pass: null,
        resendApiKey: null,
      });

      const result = await controller.getEmailSettings();
      expect(result.pass).toBeNull();
    });
  });

  describe("updateEmailSettings", () => {
    it("calls updateEmailSettings and reinitializes email service", async () => {
      const dto = { host: "new.smtp.com", port: 465 };
      const result = await controller.updateEmailSettings(dto);

      expect(settingsService.updateEmailSettings).toHaveBeenCalledWith(dto);
      expect(emailService.reinitialize).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ message: "Email settings updated" });
    });
  });

  describe("testEmailConnection", () => {
    it("delegates to emailService.testConnection", async () => {
      const result = await controller.testEmailConnection();
      expect(emailService.testConnection).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true });
    });
  });

  // ---------- SMTP settings (Legacy) ----------

  describe("getSmtpSettings", () => {
    it("masks password when set", async () => {
      const result = await controller.getSmtpSettings();
      expect(result.pass).toBe("********");
    });

    it("sets pass to null when no password", async () => {
      settingsService.getSmtpSettings.mockResolvedValue({
        host: "smtp.legacy.com",
        port: 25,
        pass: null,
      });

      const result = await controller.getSmtpSettings();
      expect(result.pass).toBeNull();
    });
  });

  describe("updateSmtpSettings", () => {
    it("updates smtp settings and reinitializes email service", async () => {
      const dto = { host: "smtp.legacy.com", port: 25 };
      const result = await controller.updateSmtpSettings(dto);

      expect(settingsService.updateSmtpSettings).toHaveBeenCalledWith(dto);
      expect(emailService.reinitialize).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ message: "SMTP settings updated" });
    });
  });

  describe("testSmtpConnection", () => {
    it("delegates to emailService.testConnection", async () => {
      const result = await controller.testSmtpConnection();
      expect(emailService.testConnection).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true });
    });
  });

  // ---------- Site settings ----------

  describe("getSiteSettings", () => {
    it("returns site settings from the service", async () => {
      const result = await controller.getSiteSettings();
      expect(result).toEqual({ name: "GenesisPod" });
    });
  });

  describe("updateSiteSettings", () => {
    it("delegates to service and returns success message", async () => {
      const result = await controller.updateSiteSettings({ name: "NewBrand" });
      expect(settingsService.updateSiteSettings).toHaveBeenCalledWith({
        name: "NewBrand",
      });
      expect(result).toEqual({ message: "Site settings updated" });
    });
  });

  // ---------- AI settings ----------

  describe("getAiSettings", () => {
    it("returns AI settings from the service", async () => {
      const result = await controller.getAiSettings();
      expect(result).toEqual({ defaultModel: "gpt-4" });
    });
  });

  describe("updateAiSettings", () => {
    it("delegates to service and returns success message", async () => {
      const dto = { defaultModel: "" };
      const result = await controller.updateAiSettings(dto);
      expect(settingsService.updateAiSettings).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: "AI settings updated" });
    });
  });

  // ---------- Security settings ----------

  describe("getSecuritySettings", () => {
    it("returns security settings from the service", async () => {
      const result = await controller.getSecuritySettings();
      expect(result).toEqual({ mfaEnabled: false });
    });
  });

  describe("updateSecuritySettings", () => {
    it("delegates to service and returns success message", async () => {
      const dto = { mfaEnabled: true };
      const result = await controller.updateSecuritySettings(dto);
      expect(settingsService.updateSecuritySettings).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: "Security settings updated" });
    });
  });

  // ---------- Storage settings ----------

  describe("getStorageSettings", () => {
    it("returns storage settings from the service", async () => {
      const result = await controller.getStorageSettings();
      expect(result).toEqual({ provider: "s3" });
    });
  });

  describe("updateStorageSettings", () => {
    it("delegates to service and returns success message", async () => {
      const dto = { provider: "gcs" };
      const result = await controller.updateStorageSettings(dto);
      expect(settingsService.updateStorageSettings).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ message: "Storage settings updated" });
    });
  });

  // ---------- Cache management ----------

  describe("refreshCache", () => {
    it("calls refreshCache and returns success message", async () => {
      const result = await controller.refreshCache();
      expect(settingsService.refreshCache).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ message: "Settings cache refreshed" });
    });
  });

  // ---------- Encryption diagnostics ----------

  describe("diagnoseEncryption", () => {
    it("calls diagnoseEncryptionIssues with fix=false", async () => {
      const result = await controller.diagnoseEncryption();
      expect(settingsService.diagnoseEncryptionIssues).toHaveBeenCalledWith(
        false,
      );
      expect(result).toEqual({ issues: [], fixed: [] });
    });
  });

  describe("fixEncryption", () => {
    it("returns a message about fixed items", async () => {
      settingsService.diagnoseEncryptionIssues.mockResolvedValue({
        issues: [],
        fixed: ["smtp.pass", "resendApiKey"],
      });

      const result = await controller.fixEncryption();

      expect(settingsService.diagnoseEncryptionIssues).toHaveBeenCalledWith(
        true,
      );
      expect(result.fixed).toEqual(["smtp.pass", "resendApiKey"]);
      expect(result.message).toContain("2");
    });

    it("returns a no-issues message when nothing was fixed", async () => {
      const result = await controller.fixEncryption();

      expect(result.message).toBe("没有发现需要修复的加密问题");
    });
  });
});
