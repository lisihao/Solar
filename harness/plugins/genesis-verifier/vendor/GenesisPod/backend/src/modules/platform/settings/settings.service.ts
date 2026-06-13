/**
 * System Settings Service
 *
 * Manages system configuration stored in database
 * Supports encrypted values for sensitive data like passwords
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  InternalServerErrorException,
} from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { APP_CONFIG } from "../../../common/config/app.config";

export interface SettingValue {
  key: string;
  value: string | null;
  encrypted: boolean;
  description?: string;
  category: string;
}

export type EmailProvider = "smtp" | "resend";

export interface SmtpSettings {
  host: string | null;
  port: number;
  user: string | null;
  pass: string | null;
  from: string;
  enabled: boolean;
  adminEmail: string | null;
}

export interface EmailSettings {
  provider: EmailProvider;
  enabled: boolean;
  from: string;
  adminEmail: string | null;
  // SMTP settings
  host: string | null;
  port: number;
  user: string | null;
  pass: string | null;
  // Resend settings
  resendApiKey: string | null;
}

export interface SiteSettings {
  siteName: string;
  siteDescription: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  allowRegistration: boolean;
  requireEmailVerification: boolean;
}

export interface AiSettings {
  defaultModel: string;
  maxTokens: number;
  temperature: number;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
}

export interface SecuritySettings {
  sessionTimeoutHours: number;
  maxLoginAttempts: number;
  lockoutDurationMinutes: number;
}

export interface StorageSettings {
  maxUploadSizeMb: number;
  allowedFileTypes: string;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private readonly encryptionKey: string;
  private cache: Map<string, string | null> = new Map();

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const key = this.configService.get<string>("SETTINGS_ENCRYPTION_KEY");
    if (!key && this.configService.get<string>("NODE_ENV") === "production") {
      throw new InternalServerErrorException(
        "SETTINGS_ENCRYPTION_KEY is required in production. Set this environment variable before starting the application.",
      );
    }
    this.encryptionKey = (key || "deepdive-default-encryption-key!")
      .padEnd(32, "0")
      .substring(0, 32);
  }

  async onModuleInit() {
    await this.refreshCache();
    // ★ 启动时诊断加密问题，便于快速发现密钥不匹配的情况
    const diagnosis = await this.diagnoseEncryptionIssues(false);
    if (diagnosis.failed.length > 0) {
      this.logger.warn(
        `⚠️ Encryption key mismatch detected! ${diagnosis.failed.length} settings cannot be decrypted: ${diagnosis.failed.join(", ")}`,
      );
      this.logger.warn(
        `To fix: Call POST /api/v1/admin/settings/encryption/fix to clear corrupted values, then reconfigure these settings.`,
      );
    }
  }

  async refreshCache(): Promise<void> {
    try {
      const settings = await this.prisma.systemSetting.findMany();
      this.cache.clear();
      for (const setting of settings) {
        const value = setting.encrypted
          ? this.decrypt(setting.value)
          : setting.value;
        this.cache.set(setting.key, value);
      }
      this.logger.log(`Settings cache refreshed: ${settings.length} entries`);
    } catch (error) {
      this.logger.warn(
        `Failed to refresh settings cache: ${(error as Error).message}`,
      );
    }
  }

  async get(key: string, defaultValue?: string): Promise<string | null> {
    if (this.cache.has(key)) {
      return this.cache.get(key) ?? defaultValue ?? null;
    }

    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key },
      });

      if (!setting) {
        return defaultValue ?? null;
      }

      const value = setting.encrypted
        ? this.decrypt(setting.value)
        : setting.value;
      this.cache.set(key, value);
      return value ?? defaultValue ?? null;
    } catch {
      return defaultValue ?? null;
    }
  }

  async getWithEnvFallback(
    key: string,
    envKey: string,
    defaultValue?: string,
  ): Promise<string | null> {
    const dbValue = await this.get(key);
    if (dbValue) {
      return dbValue;
    }
    return this.configService.get<string>(envKey) ?? defaultValue ?? null;
  }

  async set(
    key: string,
    value: string | null,
    options?: { encrypted?: boolean; description?: string; category?: string },
  ): Promise<void> {
    const {
      encrypted = false,
      description,
      category = "general",
    } = options || {};

    const storedValue = encrypted && value ? this.encrypt(value) : value;

    await this.prisma.systemSetting.upsert({
      where: { key },
      update: {
        value: storedValue,
        encrypted,
        description,
        category,
      },
      create: {
        key,
        value: storedValue,
        encrypted,
        description,
        category,
      },
    });

    this.cache.set(key, value);
    this.logger.log(`Setting updated: ${key}`);
  }

  async getByCategory(category: string): Promise<SettingValue[]> {
    const settings = await this.prisma.systemSetting.findMany({
      where: { category },
      orderBy: { key: "asc" },
    });

    return settings.map((s) => ({
      key: s.key,
      value: s.encrypted ? this.decrypt(s.value) : s.value,
      encrypted: s.encrypted,
      description: s.description ?? undefined,
      category: s.category,
    }));
  }

  async getAll(): Promise<SettingValue[]> {
    const settings = await this.prisma.systemSetting.findMany({
      orderBy: [{ category: "asc" }, { key: "asc" }],
    });

    return settings.map((s) => ({
      key: s.key,
      value: s.encrypted ? "********" : s.value,
      encrypted: s.encrypted,
      description: s.description ?? undefined,
      category: s.category,
    }));
  }

  // ========== Email Settings ==========

  async getEmailSettings(): Promise<EmailSettings> {
    const provider =
      ((await this.getWithEnvFallback(
        "email_provider",
        "EMAIL_PROVIDER",
        "smtp",
      )) as EmailProvider) || "smtp";

    return {
      provider,
      enabled:
        (await this.getWithEnvFallback(
          "email_enabled",
          "EMAIL_ENABLED",
          "false",
        )) === "true",
      from:
        (await this.getWithEnvFallback("email_from", "EMAIL_FROM")) ||
        APP_CONFIG.brand.emailFrom,
      adminEmail: await this.getWithEnvFallback("admin_email", "ADMIN_EMAIL"),
      // SMTP settings
      host: await this.getWithEnvFallback("smtp_host", "SMTP_HOST"),
      port: parseInt(
        (await this.getWithEnvFallback("smtp_port", "SMTP_PORT", "587")) ||
          "587",
      ),
      user: await this.getWithEnvFallback("smtp_user", "SMTP_USER"),
      pass: await this.getWithEnvFallback("smtp_pass", "SMTP_PASS"),
      // Resend settings
      resendApiKey: await this.getWithEnvFallback(
        "resend_api_key",
        "RESEND_API_KEY",
      ),
    };
  }

  async updateEmailSettings(settings: Partial<EmailSettings>): Promise<void> {
    if (settings.provider !== undefined) {
      await this.set("email_provider", settings.provider, {
        category: "email",
        description: "Email provider (smtp or resend)",
      });
    }
    if (settings.enabled !== undefined) {
      await this.set("email_enabled", settings.enabled.toString(), {
        category: "email",
        description: "Enable email notifications",
      });
    }
    if (settings.from !== undefined) {
      await this.set("email_from", settings.from, {
        category: "email",
        description: "Email sender address",
      });
    }
    if (settings.adminEmail !== undefined) {
      await this.set("admin_email", settings.adminEmail, {
        category: "email",
        description: "Admin email for notifications",
      });
    }
    // SMTP settings
    if (settings.host !== undefined) {
      await this.set("smtp_host", settings.host, {
        category: "email",
        description: "SMTP server host",
      });
    }
    if (settings.port !== undefined) {
      await this.set("smtp_port", settings.port.toString(), {
        category: "email",
        description: "SMTP server port",
      });
    }
    if (settings.user !== undefined) {
      await this.set("smtp_user", settings.user, {
        category: "email",
        description: "SMTP username/email",
      });
    }
    if (settings.pass !== undefined && settings.pass !== "") {
      await this.set("smtp_pass", settings.pass, {
        encrypted: true,
        category: "email",
        description: "SMTP password",
      });
    }
    // Resend settings
    if (settings.resendApiKey !== undefined && settings.resendApiKey !== "") {
      await this.set("resend_api_key", settings.resendApiKey, {
        encrypted: true,
        category: "email",
        description: "Resend API key",
      });
    }
  }

  // ========== SMTP Settings (Legacy - use getEmailSettings instead) ==========

  async getSmtpSettings(): Promise<SmtpSettings> {
    return {
      host: await this.getWithEnvFallback("smtp_host", "SMTP_HOST"),
      port: parseInt(
        (await this.getWithEnvFallback("smtp_port", "SMTP_PORT", "587")) ||
          "587",
      ),
      user: await this.getWithEnvFallback("smtp_user", "SMTP_USER"),
      pass: await this.getWithEnvFallback("smtp_pass", "SMTP_PASS"),
      from:
        (await this.getWithEnvFallback("smtp_from", "SMTP_FROM")) ||
        APP_CONFIG.brand.emailFrom,
      enabled:
        (await this.getWithEnvFallback(
          "email_enabled",
          "EMAIL_ENABLED",
          "false",
        )) === "true",
      adminEmail: await this.getWithEnvFallback("admin_email", "ADMIN_EMAIL"),
    };
  }

  async updateSmtpSettings(settings: Partial<SmtpSettings>): Promise<void> {
    if (settings.host !== undefined) {
      await this.set("smtp_host", settings.host, {
        category: "email",
        description: "SMTP server host",
      });
    }
    if (settings.port !== undefined) {
      await this.set("smtp_port", settings.port.toString(), {
        category: "email",
        description: "SMTP server port",
      });
    }
    if (settings.user !== undefined) {
      await this.set("smtp_user", settings.user, {
        category: "email",
        description: "SMTP username/email",
      });
    }
    if (settings.pass !== undefined && settings.pass !== "") {
      await this.set("smtp_pass", settings.pass, {
        encrypted: true,
        category: "email",
        description: "SMTP password",
      });
    }
    if (settings.from !== undefined) {
      await this.set("smtp_from", settings.from, {
        category: "email",
        description: "Email sender address",
      });
    }
    if (settings.enabled !== undefined) {
      await this.set("smtp_enabled", settings.enabled ? "true" : "false", {
        category: "email",
        description: "Enable email notifications",
      });
    }
    if (settings.adminEmail !== undefined) {
      await this.set("admin_email", settings.adminEmail, {
        category: "email",
        description: "Admin notification email",
      });
    }
  }

  async testSmtpConnection(): Promise<{ success: boolean; message: string }> {
    const settings = await this.getSmtpSettings();

    if (!settings.host || !settings.user || !settings.pass) {
      return {
        success: false,
        message:
          "SMTP settings incomplete. Please configure host, user, and password.",
      };
    }

    try {
      const nodemailer = await import("nodemailer");

      const transporter = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.port === 465,
        auth: {
          user: settings.user,
          pass: settings.pass,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
      });

      await transporter.verify();
      return { success: true, message: "SMTP connection successful!" };
    } catch (error) {
      return {
        success: false,
        message: `SMTP connection failed: ${(error as Error).message}`,
      };
    }
  }

  // ========== Site Settings ==========

  async getSiteSettings(): Promise<SiteSettings> {
    return {
      siteName:
        (await this.get("site_name", APP_CONFIG.brand.siteName)) ||
        APP_CONFIG.brand.siteName,
      siteDescription:
        (await this.get(
          "site_description",
          "AI-Driven Knowledge Discovery Platform",
        )) || "AI-Driven Knowledge Discovery Platform",
      maintenanceMode: (await this.get("maintenance_mode")) === "true",
      maintenanceMessage:
        (await this.get("maintenance_message")) ||
        "System is under maintenance.",
      allowRegistration:
        (await this.get("allow_registration", "true")) !== "false",
      requireEmailVerification:
        (await this.get("require_email_verification")) === "true",
    };
  }

  async updateSiteSettings(settings: Partial<SiteSettings>): Promise<void> {
    if (settings.siteName !== undefined) {
      await this.set("site_name", settings.siteName, {
        category: "site",
        description: "Site display name",
      });
    }
    if (settings.siteDescription !== undefined) {
      await this.set("site_description", settings.siteDescription, {
        category: "site",
        description: "Site description",
      });
    }
    if (settings.maintenanceMode !== undefined) {
      await this.set(
        "maintenance_mode",
        settings.maintenanceMode ? "true" : "false",
        { category: "site", description: "Enable maintenance mode" },
      );
    }
    if (settings.maintenanceMessage !== undefined) {
      await this.set("maintenance_message", settings.maintenanceMessage, {
        category: "site",
        description: "Maintenance mode message",
      });
    }
    if (settings.allowRegistration !== undefined) {
      await this.set(
        "allow_registration",
        settings.allowRegistration ? "true" : "false",
        { category: "site", description: "Allow new user registration" },
      );
    }
    if (settings.requireEmailVerification !== undefined) {
      await this.set(
        "require_email_verification",
        settings.requireEmailVerification ? "true" : "false",
        { category: "site", description: "Require email verification" },
      );
    }
  }

  // ========== AI Settings ==========

  async getAiSettings(): Promise<AiSettings> {
    return {
      defaultModel: (await this.get("default_ai_model", "")) || "",
      maxTokens: parseInt((await this.get("ai_max_tokens", "4096")) || "4096"),
      temperature: parseFloat(
        (await this.get("ai_temperature", "0.7")) || "0.7",
      ),
      rateLimitPerMinute: parseInt(
        (await this.get("ai_rate_limit_per_minute", "20")) || "20",
      ),
      rateLimitPerDay: parseInt(
        (await this.get("ai_rate_limit_per_day", "500")) || "500",
      ),
    };
  }

  async updateAiSettings(settings: Partial<AiSettings>): Promise<void> {
    if (settings.defaultModel !== undefined) {
      await this.set("default_ai_model", settings.defaultModel, {
        category: "ai",
        description: "Default AI model",
      });
    }
    if (settings.maxTokens !== undefined) {
      await this.set("ai_max_tokens", settings.maxTokens.toString(), {
        category: "ai",
        description: "Maximum tokens for AI responses",
      });
    }
    if (settings.temperature !== undefined) {
      await this.set("ai_temperature", settings.temperature.toString(), {
        category: "ai",
        description: "Default temperature for AI",
      });
    }
    if (settings.rateLimitPerMinute !== undefined) {
      await this.set(
        "ai_rate_limit_per_minute",
        settings.rateLimitPerMinute.toString(),
        { category: "ai", description: "AI requests per minute per user" },
      );
    }
    if (settings.rateLimitPerDay !== undefined) {
      await this.set(
        "ai_rate_limit_per_day",
        settings.rateLimitPerDay.toString(),
        { category: "ai", description: "AI requests per day per user" },
      );
    }
  }

  // ========== Security Settings ==========

  async getSecuritySettings(): Promise<SecuritySettings> {
    return {
      sessionTimeoutHours: parseInt(
        (await this.get("session_timeout_hours", "24")) || "24",
      ),
      maxLoginAttempts: parseInt(
        (await this.get("max_login_attempts", "5")) || "5",
      ),
      lockoutDurationMinutes: parseInt(
        (await this.get("lockout_duration_minutes", "15")) || "15",
      ),
    };
  }

  async updateSecuritySettings(
    settings: Partial<SecuritySettings>,
  ): Promise<void> {
    if (settings.sessionTimeoutHours !== undefined) {
      await this.set(
        "session_timeout_hours",
        settings.sessionTimeoutHours.toString(),
        { category: "security", description: "Session timeout in hours" },
      );
    }
    if (settings.maxLoginAttempts !== undefined) {
      await this.set(
        "max_login_attempts",
        settings.maxLoginAttempts.toString(),
        { category: "security", description: "Max failed login attempts" },
      );
    }
    if (settings.lockoutDurationMinutes !== undefined) {
      await this.set(
        "lockout_duration_minutes",
        settings.lockoutDurationMinutes.toString(),
        { category: "security", description: "Account lockout duration" },
      );
    }
  }

  // ========== Storage Settings ==========

  async getStorageSettings(): Promise<StorageSettings> {
    return {
      maxUploadSizeMb: parseInt(
        (await this.get("max_upload_size_mb", "10")) || "10",
      ),
      allowedFileTypes:
        (await this.get(
          "allowed_file_types",
          "image/*,application/pdf,.doc,.docx,.xls,.xlsx",
        )) || "image/*,application/pdf",
    };
  }

  async updateStorageSettings(
    settings: Partial<StorageSettings>,
  ): Promise<void> {
    if (settings.maxUploadSizeMb !== undefined) {
      await this.set(
        "max_upload_size_mb",
        settings.maxUploadSizeMb.toString(),
        { category: "storage", description: "Maximum file upload size in MB" },
      );
    }
    if (settings.allowedFileTypes !== undefined) {
      await this.set("allowed_file_types", settings.allowedFileTypes, {
        category: "storage",
        description: "Allowed file types for upload",
      });
    }
  }

  // ========== Encryption Helpers ==========

  private encrypt(text: string | null): string | null {
    if (!text) return null;
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        "aes-256-cbc",
        Buffer.from(this.encryptionKey),
        iv,
      );
      let encrypted = cipher.update(text, "utf8", "hex");
      encrypted += cipher.final("hex");
      return iv.toString("hex") + ":" + encrypted;
    } catch (error) {
      this.logger.error(`Encryption failed: ${(error as Error).message}`);
      return null;
    }
  }

  private decrypt(encryptedText: string | null): string | null {
    if (!encryptedText) return null;
    try {
      const parts = encryptedText.split(":");
      if (parts.length !== 2) return encryptedText;
      const iv = Buffer.from(parts[0], "hex");
      const encrypted = parts[1];
      const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        Buffer.from(this.encryptionKey),
        iv,
      );
      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (error) {
      this.logger.error(`Decryption failed: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * ★ 诊断并修复无法解密的设置
   * 识别因密钥不匹配而无法解密的设置，可选择清除这些值
   */
  async diagnoseEncryptionIssues(fix = false): Promise<{
    total: number;
    encrypted: number;
    failed: string[];
    fixed: string[];
  }> {
    const settings = await this.prisma.systemSetting.findMany({
      where: { encrypted: true },
    });

    const failed: string[] = [];
    const fixed: string[] = [];

    for (const setting of settings) {
      try {
        const parts = setting.value?.split(":");
        if (!parts || parts.length !== 2) {
          // 格式不正确，可能未正确加密
          failed.push(setting.key);
          continue;
        }

        const iv = Buffer.from(parts[0], "hex");
        const encrypted = parts[1];
        const decipher = crypto.createDecipheriv(
          "aes-256-cbc",
          Buffer.from(this.encryptionKey),
          iv,
        );
        decipher.update(encrypted, "hex", "utf8");
        decipher.final("utf8");
        // 解密成功，无需处理
      } catch {
        failed.push(setting.key);

        // 如果需要修复，清除无法解密的值
        if (fix) {
          await this.prisma.systemSetting.update({
            where: { key: setting.key },
            data: { value: null, encrypted: false },
          });
          fixed.push(setting.key);
          this.logger.warn(
            `Cleared corrupted encrypted setting: ${setting.key}`,
          );
        }
      }
    }

    const allSettings = await this.prisma.systemSetting.count();

    if (failed.length > 0) {
      this.logger.warn(
        `Found ${failed.length} settings with decryption issues: ${failed.join(", ")}`,
      );
    }

    // 刷新缓存
    if (fix && fixed.length > 0) {
      await this.refreshCache();
    }

    return {
      total: allSettings,
      encrypted: settings.length,
      failed,
      fixed,
    };
  }
}
