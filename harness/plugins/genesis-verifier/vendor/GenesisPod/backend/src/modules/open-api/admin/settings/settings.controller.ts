/**
 * System Settings Controller
 *
 * Admin-only endpoints for managing system configuration
 */

import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  Logger,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { AdminGuard } from "@/common/guards/admin.guard";
import {
  SettingsService,
  EmailSettings,
  SmtpSettings,
  SiteSettings,
  AiSettings,
  SecuritySettings,
  StorageSettings,
} from "@/modules/platform/settings/settings.service";
import { EmailService } from "@/modules/platform/email/email.service";

@ApiTags("Admin - Settings")
@Controller("admin/settings")
@UseGuards(JwtAuthGuard, AdminGuard)
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Get all settings (for admin dashboard)
   */
  @Get()
  async getAllSettings() {
    const settings = await this.settingsService.getAll();
    return { settings };
  }

  // ========== Email Settings ==========

  @Get("email")
  async getEmailSettings() {
    const settings = await this.settingsService.getEmailSettings();
    return {
      ...settings,
      // Mask password but show it exists
      pass: settings.pass ? "********" : null,
      // Return full API key for display (admin only endpoint)
      resendApiKey: settings.resendApiKey,
    };
  }

  @Put("email")
  async updateEmailSettings(@Body() dto: Partial<EmailSettings>) {
    this.logger.log("Updating email settings");
    await this.settingsService.updateEmailSettings(dto);
    // Reinitialize email service with new settings
    await this.emailService.reinitialize();
    return { message: "Email settings updated" };
  }

  @Post("email/test")
  async testEmailConnection() {
    this.logger.log("Testing email connection");
    const result = await this.emailService.testConnection();
    return result;
  }

  // ========== SMTP Settings (Legacy) ==========

  @Get("smtp")
  async getSmtpSettings() {
    const settings = await this.settingsService.getSmtpSettings();
    return {
      ...settings,
      pass: settings.pass ? "********" : null,
    };
  }

  @Put("smtp")
  async updateSmtpSettings(@Body() dto: Partial<SmtpSettings>) {
    this.logger.log("Updating SMTP settings");
    await this.settingsService.updateSmtpSettings(dto);
    // Reinitialize email service with new settings
    await this.emailService.reinitialize();
    return { message: "SMTP settings updated" };
  }

  @Post("smtp/test")
  async testSmtpConnection() {
    this.logger.log("Testing SMTP connection");
    const result = await this.emailService.testConnection();
    return result;
  }

  // ========== Site Settings ==========

  @Get("site")
  async getSiteSettings() {
    return this.settingsService.getSiteSettings();
  }

  @Put("site")
  async updateSiteSettings(@Body() dto: Partial<SiteSettings>) {
    this.logger.log("Updating site settings");
    await this.settingsService.updateSiteSettings(dto);
    return { message: "Site settings updated" };
  }

  // ========== AI Settings ==========

  @Get("ai")
  async getAiSettings() {
    return this.settingsService.getAiSettings();
  }

  @Put("ai")
  async updateAiSettings(@Body() dto: Partial<AiSettings>) {
    this.logger.log("Updating AI settings");
    await this.settingsService.updateAiSettings(dto);
    return { message: "AI settings updated" };
  }

  // ========== Security Settings ==========

  @Get("security")
  async getSecuritySettings() {
    return this.settingsService.getSecuritySettings();
  }

  @Put("security")
  async updateSecuritySettings(@Body() dto: Partial<SecuritySettings>) {
    this.logger.log("Updating security settings");
    await this.settingsService.updateSecuritySettings(dto);
    return { message: "Security settings updated" };
  }

  // ========== Storage Settings ==========

  @Get("storage")
  async getStorageSettings() {
    return this.settingsService.getStorageSettings();
  }

  @Put("storage")
  async updateStorageSettings(@Body() dto: Partial<StorageSettings>) {
    this.logger.log("Updating storage settings");
    await this.settingsService.updateStorageSettings(dto);
    return { message: "Storage settings updated" };
  }

  // ========== Cache Management ==========

  @Post("refresh-cache")
  async refreshCache() {
    await this.settingsService.refreshCache();
    return { message: "Settings cache refreshed" };
  }

  // ========== Encryption Diagnostics ==========

  /**
   * 诊断加密设置问题
   * 返回无法解密的设置列表
   */
  @Get("encryption/diagnose")
  async diagnoseEncryption() {
    this.logger.log("Diagnosing encryption issues");
    return this.settingsService.diagnoseEncryptionIssues(false);
  }

  /**
   * 修复加密设置问题
   * 清除无法解密的设置值（需要用户重新配置）
   */
  @Post("encryption/fix")
  async fixEncryption() {
    this.logger.log("Fixing encryption issues - clearing corrupted values");
    const result = await this.settingsService.diagnoseEncryptionIssues(true);
    return {
      ...result,
      message:
        result.fixed.length > 0
          ? `已清除 ${result.fixed.length} 个无法解密的设置，请重新配置: ${result.fixed.join(", ")}`
          : "没有发现需要修复的加密问题",
    };
  }
}
