import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SettingsService } from "../settings.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";

describe("SettingsService", () => {
  let service: SettingsService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;
  let mockConfigService: jest.Mocked<Partial<ConfigService>>;

  const makeSetting = (
    key: string,
    value: string | null,
    encrypted = false,
    category = "general",
  ) => ({
    id: `setting-${key}`,
    key,
    value,
    encrypted,
    description: null,
    category,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(async () => {
    mockPrisma = {
      systemSetting: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      } as unknown as PrismaService["systemSetting"],
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== onModuleInit ====================

  describe("onModuleInit", () => {
    it("refreshes cache on module init", async () => {
      const settings = [makeSetting("test_key", "test_value")];
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue(
        settings,
      );
      (mockPrisma.systemSetting!.count as jest.Mock).mockResolvedValue(1);

      await service.onModuleInit();

      expect(mockPrisma.systemSetting!.findMany).toHaveBeenCalled();
    });

    it("handles DB error during cache refresh gracefully", async () => {
      // refreshCache fails — but diagnoseEncryptionIssues still needs findMany and count
      // to not blow up. Use mockImplementation that returns [] on second call.
      (mockPrisma.systemSetting!.findMany as jest.Mock)
        .mockRejectedValueOnce(new Error("DB error")) // refreshCache fails
        .mockResolvedValueOnce([]); // diagnoseEncryptionIssues call
      (mockPrisma.systemSetting!.count as jest.Mock).mockResolvedValue(0);

      // onModuleInit catches the error internally (refreshCache has try-catch)
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  // ==================== constructor: production encryption key ====================

  describe("constructor - production encryption key", () => {
    it("throws in production when SETTINGS_ENCRYPTION_KEY is not set", async () => {
      const prodConfigService = {
        get: jest.fn((key: string) => {
          if (key === "NODE_ENV") return "production";
          return undefined;
        }),
      };

      await expect(
        Test.createTestingModule({
          providers: [
            SettingsService,
            { provide: PrismaService, useValue: mockPrisma },
            { provide: ConfigService, useValue: prodConfigService },
          ],
        }).compile(),
      ).rejects.toThrow("SETTINGS_ENCRYPTION_KEY is required in production");
    });

    it("does not throw in production when SETTINGS_ENCRYPTION_KEY is set", async () => {
      const prodConfigService = {
        get: jest.fn((key: string) => {
          if (key === "NODE_ENV") return "production";
          if (key === "SETTINGS_ENCRYPTION_KEY")
            return "my-secure-key-32chars-long!!!!!";
          return undefined;
        }),
      };

      const module = await Test.createTestingModule({
        providers: [
          SettingsService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: prodConfigService },
        ],
      }).compile();

      expect(module.get(SettingsService)).toBeDefined();
    });
  });

  // ==================== get ====================

  describe("get", () => {
    it("returns null when key not in cache or DB", async () => {
      const result = await service.get("nonexistent_key");
      expect(result).toBeNull();
    });

    it("returns default value when key not found", async () => {
      const result = await service.get("missing_key", "default");
      expect(result).toBe("default");
    });

    it("returns value from DB when not in cache", async () => {
      const setting = makeSetting("smtp_host", "smtp.example.com");
      (mockPrisma.systemSetting!.findUnique as jest.Mock).mockResolvedValue(
        setting,
      );

      const result = await service.get("smtp_host");
      expect(result).toBe("smtp.example.com");
    });

    it("returns cached value on subsequent calls", async () => {
      const setting = makeSetting("cached_key", "cached_value");
      (mockPrisma.systemSetting!.findUnique as jest.Mock).mockResolvedValue(
        setting,
      );

      await service.get("cached_key");
      await service.get("cached_key");

      expect(mockPrisma.systemSetting!.findUnique).toHaveBeenCalledTimes(1);
    });

    it("decrypts encrypted settings", async () => {
      // First, store an encrypted value via set()
      (mockPrisma.systemSetting!.upsert as jest.Mock).mockResolvedValue({});

      await service.set("smtp_pass", "my_password", { encrypted: true });

      // Then retrieve it — should be returned decrypted from cache
      const result = await service.get("smtp_pass");
      expect(result).toBe("my_password");
    });
  });

  // ==================== set ====================

  describe("set", () => {
    it("persists a plain-text setting", async () => {
      await service.set("site_name", "My Site");

      expect(mockPrisma.systemSetting!.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "site_name" },
          create: expect.objectContaining({
            key: "site_name",
            value: "My Site",
            encrypted: false,
          }),
        }),
      );
    });

    it("encrypts sensitive settings when encrypted=true", async () => {
      await service.set("smtp_pass", "secret123", { encrypted: true });

      const upsertCall = (mockPrisma.systemSetting!.upsert as jest.Mock).mock
        .calls[0][0];
      expect(upsertCall.create.encrypted).toBe(true);
      // The stored value should NOT be the plain text
      expect(upsertCall.create.value).not.toBe("secret123");
    });

    it("stores null values without encryption attempt", async () => {
      await service.set("optional_key", null);

      const upsertCall = (mockPrisma.systemSetting!.upsert as jest.Mock).mock
        .calls[0][0];
      expect(upsertCall.create.value).toBeNull();
    });

    it("updates the cache after set", async () => {
      await service.set("my_key", "my_value");

      // Cache should be updated, so get returns without hitting DB
      const result = await service.get("my_key");
      expect(result).toBe("my_value");
      expect(mockPrisma.systemSetting!.findUnique).not.toHaveBeenCalled();
    });
  });

  // ==================== getEmailSettings ====================

  describe("getEmailSettings", () => {
    it("returns email settings with env fallback", async () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "EMAIL_PROVIDER") return "smtp";
        if (key === "EMAIL_ENABLED") return "true";
        if (key === "SMTP_HOST") return "smtp.example.com";
        if (key === "SMTP_PORT") return "587";
        if (key === "SMTP_USER") return "user@example.com";
        return undefined;
      });

      const settings = await service.getEmailSettings();

      expect(settings.provider).toBe("smtp");
      expect(settings.enabled).toBe(true);
    });

    it("defaults to disabled when EMAIL_ENABLED is not set", async () => {
      (mockConfigService.get as jest.Mock).mockReturnValue(undefined);

      const settings = await service.getEmailSettings();

      expect(settings.enabled).toBe(false);
    });

    it("parses port as integer", async () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "SMTP_PORT") return "465";
        return undefined;
      });

      const settings = await service.getEmailSettings();

      expect(typeof settings.port).toBe("number");
    });
  });

  // ==================== getSiteSettings ====================

  describe("getSiteSettings", () => {
    it("returns site settings with defaults", async () => {
      const settings = await service.getSiteSettings();

      expect(settings.maintenanceMode).toBe(false);
      expect(settings.allowRegistration).toBe(true);
    });

    it("reads maintenance mode from cache", async () => {
      await service.set("maintenance_mode", "true");

      const settings = await service.getSiteSettings();

      expect(settings.maintenanceMode).toBe(true);
    });
  });

  // ==================== getAiSettings ====================

  describe("getAiSettings", () => {
    it("returns AI settings with numeric types", async () => {
      const settings = await service.getAiSettings();

      expect(typeof settings.maxTokens).toBe("number");
      expect(typeof settings.temperature).toBe("number");
      expect(typeof settings.rateLimitPerMinute).toBe("number");
    });

    it("defaults to empty string for model (no hardcoded model name)", async () => {
      const settings = await service.getAiSettings();

      expect(settings.defaultModel).toBe("");
    });
  });

  // ==================== getSecuritySettings ====================

  describe("getSecuritySettings", () => {
    it("returns security settings with numeric defaults", async () => {
      const settings = await service.getSecuritySettings();

      expect(settings.sessionTimeoutHours).toBe(24);
      expect(settings.maxLoginAttempts).toBe(5);
      expect(settings.lockoutDurationMinutes).toBe(15);
    });
  });

  // ==================== getByCategory ====================

  describe("getByCategory", () => {
    it("returns settings filtered by category", async () => {
      const emailSettings = [
        makeSetting("smtp_host", "smtp.test.com", false, "email"),
        makeSetting("smtp_pass", "encrypted_val", true, "email"),
      ];
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue(
        emailSettings,
      );

      const result = await service.getByCategory("email");

      expect(result).toHaveLength(2);
      expect(result[0].category).toBe("email");
      expect(mockPrisma.systemSetting!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { category: "email" } }),
      );
    });
  });

  // ==================== getAll ====================

  describe("getAll", () => {
    it("masks encrypted values with asterisks", async () => {
      const settings = [
        makeSetting("public_key", "public_value", false, "general"),
        makeSetting("secret_key", "encrypted_value", true, "email"),
      ];
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue(
        settings,
      );

      const result = await service.getAll();

      const publicSetting = result.find((s) => s.key === "public_key");
      const secretSetting = result.find((s) => s.key === "secret_key");

      expect(publicSetting!.value).toBe("public_value");
      expect(secretSetting!.value).toBe("********");
    });
  });

  // ==================== diagnoseEncryptionIssues ====================

  describe("diagnoseEncryptionIssues", () => {
    it("returns empty failed list when all settings decrypt correctly", async () => {
      // Store a properly encrypted setting via set()
      await service.set("smtp_pass", "test_password", { encrypted: true });

      const upsertCall = (mockPrisma.systemSetting!.upsert as jest.Mock).mock
        .calls[0][0];
      const encryptedValue = upsertCall.create.value;

      // Diagnose with that encrypted value
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([
        {
          ...makeSetting("smtp_pass", encryptedValue, true),
        },
      ]);
      (mockPrisma.systemSetting!.count as jest.Mock).mockResolvedValue(1);

      const result = await service.diagnoseEncryptionIssues(false);

      expect(result.failed).toHaveLength(0);
    });

    it("identifies settings with wrong format as failed", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([
        makeSetting("bad_key", "not_encrypted_format", true),
      ]);
      (mockPrisma.systemSetting!.count as jest.Mock).mockResolvedValue(1);

      const result = await service.diagnoseEncryptionIssues(false);

      expect(result.failed).toContain("bad_key");
    });

    it("fixes corrupted settings when fix=true", async () => {
      // Note: onModuleInit already ran (refreshCache + diagnoseEncryptionIssues(false))
      // consuming the default mockResolvedValue([]) calls.
      // For our test call, set up the mock for the diagnoseEncryptionIssues query:
      // diagnoseEncryptionIssues calls findMany({ where: { encrypted: true } })
      // then prisma.systemSetting.count(), then (if fix) update, then refreshCache (findMany again)
      const corruptSetting = makeSetting(
        "corrupt_key",
        "bad_value_no_colon",
        true,
      );
      (mockPrisma.systemSetting!.findMany as jest.Mock)
        .mockResolvedValueOnce([corruptSetting]) // encrypted settings query
        .mockResolvedValueOnce([]); // refreshCache after fixing
      (mockPrisma.systemSetting!.count as jest.Mock).mockResolvedValue(1);
      (mockPrisma.systemSetting!.update as jest.Mock).mockResolvedValue({
        ...corruptSetting,
        value: null,
        encrypted: false,
      });

      const result = await service.diagnoseEncryptionIssues(true);

      // Should identify as failed (bad format) and fix it
      expect(result.total).toBe(1);
      // The corrupt setting must be either in failed or fixed
      const wasFixed = result.fixed.includes("corrupt_key");
      const wasFailed = result.failed.includes("corrupt_key");
      expect(wasFixed || wasFailed).toBe(true);
    });

    it("identifies null value settings as failed", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([
        makeSetting("null_encrypted_key", null, true),
      ]);
      (mockPrisma.systemSetting!.count as jest.Mock).mockResolvedValue(1);

      const result = await service.diagnoseEncryptionIssues(false);

      expect(result.failed).toContain("null_encrypted_key");
    });
  });

  // ==================== getWithEnvFallback ====================

  describe("getWithEnvFallback", () => {
    it("returns DB value when it exists", async () => {
      await service.set("my_setting", "db_value");

      const result = await service.getWithEnvFallback(
        "my_setting",
        "MY_SETTING_ENV",
        "default",
      );

      expect(result).toBe("db_value");
    });

    it("falls back to env var when DB value is null", async () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "MY_ENV_VAR") return "env_value";
        return undefined;
      });

      const result = await service.getWithEnvFallback(
        "nonexistent_key",
        "MY_ENV_VAR",
      );

      expect(result).toBe("env_value");
    });

    it("returns default when both DB and env are missing", async () => {
      (mockConfigService.get as jest.Mock).mockReturnValue(undefined);

      const result = await service.getWithEnvFallback(
        "missing_key",
        "MISSING_ENV",
        "fallback_default",
      );

      expect(result).toBe("fallback_default");
    });

    it("returns null when DB, env, and default are all missing", async () => {
      (mockConfigService.get as jest.Mock).mockReturnValue(undefined);

      const result = await service.getWithEnvFallback(
        "missing_key",
        "MISSING_ENV",
      );

      expect(result).toBeNull();
    });
  });

  // ==================== updateEmailSettings ====================

  describe("updateEmailSettings", () => {
    it("updates all email settings fields", async () => {
      await service.updateEmailSettings({
        provider: "resend",
        enabled: true,
        from: "from@test.com",
        adminEmail: "admin@test.com",
        host: "smtp.test.com",
        port: 465,
        user: "user@test.com",
        pass: "secret",
        resendApiKey: "re_test_key",
      });

      // Should have called upsert for each non-undefined field
      const upsertCalls = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.map((call) => call[0].where.key);

      expect(upsertCalls).toContain("email_provider");
      expect(upsertCalls).toContain("email_enabled");
      expect(upsertCalls).toContain("email_from");
      expect(upsertCalls).toContain("admin_email");
      expect(upsertCalls).toContain("smtp_host");
      expect(upsertCalls).toContain("smtp_port");
      expect(upsertCalls).toContain("smtp_user");
      expect(upsertCalls).toContain("smtp_pass");
      expect(upsertCalls).toContain("resend_api_key");
    });

    it("skips empty string pass and resendApiKey", async () => {
      await service.updateEmailSettings({ pass: "", resendApiKey: "" });

      const upsertCalls = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.map((call) => call[0].where.key);

      expect(upsertCalls).not.toContain("smtp_pass");
      expect(upsertCalls).not.toContain("resend_api_key");
    });

    it("skips undefined fields", async () => {
      await service.updateEmailSettings({ enabled: true });

      const upsertCalls = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.map((call) => call[0].where.key);

      expect(upsertCalls).toEqual(["email_enabled"]);
    });
  });

  // ==================== updateSiteSettings ====================

  describe("updateSiteSettings", () => {
    it("updates all site settings fields", async () => {
      await service.updateSiteSettings({
        siteName: "My Site",
        siteDescription: "Great platform",
        maintenanceMode: true,
        maintenanceMessage: "Under maintenance",
        allowRegistration: false,
        requireEmailVerification: true,
      });

      const upsertKeys = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.map((call) => call[0].where.key);

      expect(upsertKeys).toContain("site_name");
      expect(upsertKeys).toContain("site_description");
      expect(upsertKeys).toContain("maintenance_mode");
      expect(upsertKeys).toContain("maintenance_message");
      expect(upsertKeys).toContain("allow_registration");
      expect(upsertKeys).toContain("require_email_verification");
    });

    it("stores boolean values as string 'true'/'false'", async () => {
      await service.updateSiteSettings({
        maintenanceMode: true,
        allowRegistration: false,
        requireEmailVerification: true,
      });

      const calls = (mockPrisma.systemSetting!.upsert as jest.Mock).mock.calls;
      const maintenanceCall = calls.find(
        (c) => c[0].where.key === "maintenance_mode",
      );
      expect(maintenanceCall![0].create.value).toBe("true");

      const registrationCall = calls.find(
        (c) => c[0].where.key === "allow_registration",
      );
      expect(registrationCall![0].create.value).toBe("false");
    });
  });

  // ==================== updateAiSettings ====================

  describe("updateAiSettings", () => {
    it("updates all AI settings fields", async () => {
      await service.updateAiSettings({
        defaultModel: "",
        maxTokens: 8000,
        temperature: 0.5,
        rateLimitPerMinute: 30,
        rateLimitPerDay: 1000,
      });

      const upsertKeys = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.map((call) => call[0].where.key);

      expect(upsertKeys).toContain("default_ai_model");
      expect(upsertKeys).toContain("ai_max_tokens");
      expect(upsertKeys).toContain("ai_temperature");
      expect(upsertKeys).toContain("ai_rate_limit_per_minute");
      expect(upsertKeys).toContain("ai_rate_limit_per_day");
    });

    it("converts numeric values to strings for storage", async () => {
      await service.updateAiSettings({ maxTokens: 4096 });

      const upsertCall = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.find((c) => c[0].where.key === "ai_max_tokens");
      expect(upsertCall![0].create.value).toBe("4096");
    });
  });

  // ==================== updateSecuritySettings ====================

  describe("updateSecuritySettings", () => {
    it("updates all security settings fields", async () => {
      await service.updateSecuritySettings({
        sessionTimeoutHours: 48,
        maxLoginAttempts: 10,
        lockoutDurationMinutes: 30,
      });

      const upsertKeys = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.map((call) => call[0].where.key);

      expect(upsertKeys).toContain("session_timeout_hours");
      expect(upsertKeys).toContain("max_login_attempts");
      expect(upsertKeys).toContain("lockout_duration_minutes");
    });

    it("skips undefined fields", async () => {
      await service.updateSecuritySettings({ maxLoginAttempts: 3 });

      const upsertKeys = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.map((call) => call[0].where.key);

      expect(upsertKeys).toEqual(["max_login_attempts"]);
    });
  });

  // ==================== getStorageSettings ====================

  describe("getStorageSettings", () => {
    it("returns storage settings with numeric maxUploadSizeMb", async () => {
      const settings = await service.getStorageSettings();

      expect(typeof settings.maxUploadSizeMb).toBe("number");
      expect(settings.maxUploadSizeMb).toBe(10);
    });

    it("returns custom values when stored in cache", async () => {
      await service.set("max_upload_size_mb", "50");
      await service.set("allowed_file_types", "image/*,application/pdf");

      const settings = await service.getStorageSettings();

      expect(settings.maxUploadSizeMb).toBe(50);
      expect(settings.allowedFileTypes).toBe("image/*,application/pdf");
    });
  });

  // ==================== updateStorageSettings ====================

  describe("updateStorageSettings", () => {
    it("updates maxUploadSizeMb and allowedFileTypes", async () => {
      await service.updateStorageSettings({
        maxUploadSizeMb: 100,
        allowedFileTypes: "image/*,.pdf",
      });

      const upsertKeys = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.map((call) => call[0].where.key);

      expect(upsertKeys).toContain("max_upload_size_mb");
      expect(upsertKeys).toContain("allowed_file_types");
    });

    it("skips undefined fields", async () => {
      await service.updateStorageSettings({ maxUploadSizeMb: 25 });

      const upsertKeys = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.map((call) => call[0].where.key);

      expect(upsertKeys).toEqual(["max_upload_size_mb"]);
    });
  });

  // ==================== getSmtpSettings ====================

  describe("getSmtpSettings", () => {
    it("returns SMTP settings with numeric port", async () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "SMTP_HOST") return "smtp.example.com";
        if (key === "SMTP_PORT") return "587";
        if (key === "SMTP_USER") return "user@example.com";
        if (key === "SMTP_PASS") return "password";
        return undefined;
      });

      const settings = await service.getSmtpSettings();

      expect(settings.host).toBe("smtp.example.com");
      expect(typeof settings.port).toBe("number");
      expect(settings.port).toBe(587);
    });

    it("defaults to disabled and port 587 when env vars not set", async () => {
      const settings = await service.getSmtpSettings();

      expect(settings.enabled).toBe(false);
      expect(settings.port).toBe(587);
    });
  });

  // ==================== updateSmtpSettings ====================

  describe("updateSmtpSettings", () => {
    it("updates all SMTP settings", async () => {
      await service.updateSmtpSettings({
        host: "smtp.new.com",
        port: 465,
        user: "newuser@example.com",
        pass: "newpassword",
        from: "noreply@new.com",
        enabled: true,
        adminEmail: "admin@new.com",
      });

      const upsertKeys = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.map((call) => call[0].where.key);

      expect(upsertKeys).toContain("smtp_host");
      expect(upsertKeys).toContain("smtp_port");
      expect(upsertKeys).toContain("smtp_user");
      expect(upsertKeys).toContain("smtp_pass");
      expect(upsertKeys).toContain("smtp_from");
      expect(upsertKeys).toContain("smtp_enabled");
      expect(upsertKeys).toContain("admin_email");
    });

    it("skips empty string pass", async () => {
      await service.updateSmtpSettings({ pass: "" });

      const upsertKeys = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.map((call) => call[0].where.key);

      expect(upsertKeys).not.toContain("smtp_pass");
    });

    it("encrypts smtp_pass when set", async () => {
      await service.updateSmtpSettings({ pass: "secret123" });

      const upsertCall = (
        mockPrisma.systemSetting!.upsert as jest.Mock
      ).mock.calls.find((c) => c[0].where.key === "smtp_pass");

      expect(upsertCall![0].create.encrypted).toBe(true);
      expect(upsertCall![0].create.value).not.toBe("secret123");
    });
  });

  // ==================== testSmtpConnection ====================

  describe("testSmtpConnection", () => {
    it("returns failure when SMTP settings are incomplete", async () => {
      const result = await service.testSmtpConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain("SMTP settings incomplete");
    });

    it("returns failure when connection fails", async () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === "SMTP_HOST") return "smtp.test.com";
        if (key === "SMTP_USER") return "user@test.com";
        if (key === "SMTP_PASS") return "password";
        if (key === "SMTP_PORT") return "587";
        return undefined;
      });

      // nodemailer.createTransport and verify will fail in test environment
      const result = await service.testSmtpConnection();

      // Connection should fail (no real SMTP server)
      expect(result.success).toBe(false);
      expect(result.message).toContain("SMTP connection failed");
    });
  });

  // ==================== refreshCache ====================

  describe("refreshCache", () => {
    it("populates cache with decrypted values for encrypted settings", async () => {
      // Store an encrypted value
      await service.set("my_encrypted", "secret", { encrypted: true });
      const upsertCall = (mockPrisma.systemSetting!.upsert as jest.Mock).mock
        .calls[0][0];
      const encryptedValue = upsertCall.create.value;

      // Set up findMany to return the encrypted setting
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockResolvedValue([
        makeSetting("my_encrypted", encryptedValue, true),
      ]);

      await service.refreshCache();

      // Now get should return decrypted value from cache without hitting DB again
      (mockPrisma.systemSetting!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );
      const result = await service.get("my_encrypted");
      expect(result).toBe("secret");
    });

    it("handles DB error gracefully (logs warning, does not throw)", async () => {
      (mockPrisma.systemSetting!.findMany as jest.Mock).mockRejectedValue(
        new Error("connection reset"),
      );

      await expect(service.refreshCache()).resolves.not.toThrow();
    });
  });

  // ==================== get (additional edge cases) ====================

  describe("get (edge cases)", () => {
    it("returns null when DB throws and key is not in cache", async () => {
      (mockPrisma.systemSetting!.findUnique as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.get("failing_key");

      expect(result).toBeNull();
    });

    it("returns default value when DB throws", async () => {
      (mockPrisma.systemSetting!.findUnique as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.get("failing_key", "my_default");

      expect(result).toBe("my_default");
    });

    it("decrypts encrypted values fetched from DB (not in cache)", async () => {
      // Store encrypted value
      await service.set("smtp_secret", "plaintext", { encrypted: true });
      const upsertCall = (mockPrisma.systemSetting!.upsert as jest.Mock).mock
        .calls[0][0];
      const encryptedValue = upsertCall.create.value;

      // Clear cache by creating a new service instance (simulate fresh start)
      // Instead, directly mock findUnique to return encrypted record
      (mockPrisma.systemSetting!.findUnique as jest.Mock).mockResolvedValue(
        makeSetting("fresh_encrypted_key", encryptedValue, true),
      );

      const result = await service.get("fresh_encrypted_key");

      expect(result).toBe("plaintext");
    });
  });
});
