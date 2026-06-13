/**
 * Email Service
 *
 * Runtime-only email transport for SMTP and Resend.
 * Business-specific email compositions must live outside this file.
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import { Resend } from "resend";
import { SettingsService } from "../settings/settings.service";
import { APP_CONFIG } from "../../../common/config/app.config";

interface ResendEmailPayload {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer | string }>;
  [key: string]: unknown;
}

export type EmailProvider = "smtp" | "resend";

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private smtpTransporter: nodemailer.Transporter | null = null;
  private resendClient: Resend | null = null;
  private provider: EmailProvider = "smtp";
  private isConfigured = false;
  private emailFrom: string = APP_CONFIG.brand.emailFrom;
  private adminEmail = "";

  constructor(private readonly settingsService: SettingsService) {}

  async onModuleInit() {
    await this.initializeEmailProvider();
  }

  private async initializeEmailProvider() {
    try {
      const emailSettings = await this.settingsService.getEmailSettings();

      this.provider = emailSettings.provider;
      this.emailFrom = emailSettings.from;
      this.adminEmail =
        emailSettings.adminEmail || process.env.ADMIN_EMAIL || "";

      this.logger.log(
        `Email provider: ${this.provider}, adminEmail: ${this.adminEmail ? "configured" : "NOT configured"}`,
      );

      if (!this.adminEmail) {
        this.logger.warn(
          "Admin email is not configured. Set ADMIN_EMAIL env var or configure in Admin > Settings > Email.",
        );
      }

      if (!emailSettings.enabled) {
        this.logger.warn(
          "Email service is disabled. Enable it in Admin > Settings > Email or set EMAIL_ENABLED=true.",
        );
        return;
      }

      if (this.provider === "resend") {
        await this.initializeResend(emailSettings.resendApiKey);
        return;
      }

      await this.initializeSmtp(emailSettings);
    } catch (error) {
      this.logger.error("Failed to initialize email provider", error);
    }
  }

  private async initializeResend(apiKey: string | null) {
    if (!apiKey) {
      this.logger.warn(
        "Resend API key not configured. Configure it in Admin > Settings > Email.",
      );
      return;
    }

    try {
      this.resendClient = new Resend(apiKey);
      this.isConfigured = true;
      this.logger.log("Resend email client initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize Resend client", error);
    }
  }

  private async initializeSmtp(settings: {
    host: string | null;
    port: number;
    user: string | null;
    pass: string | null;
  }) {
    const { host, port, user, pass } = settings;

    this.logger.log(
      `SMTP Config check: host=${host ? "set" : "missing"}, user=${user ? "set" : "missing"}, pass=${pass ? "set" : "missing"}`,
    );

    if (!host || !user || !pass) {
      this.logger.warn(
        "SMTP settings incomplete. Configure in Admin > Settings > Email.",
      );
      return;
    }

    try {
      this.smtpTransporter = nodemailer.createTransport({
        host,
        port: port || 587,
        secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 30000,
      });

      this.isConfigured = true;
      this.logger.log("SMTP email transporter initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize SMTP transporter", error);
    }
  }

  isEnabled(): boolean {
    return this.isConfigured;
  }

  getProvider(): EmailProvider {
    return this.provider;
  }

  getAdminEmail(): string {
    return this.adminEmail;
  }

  async sendEmail(options: SendEmailOptions): Promise<boolean> {
    if (!this.isEnabled()) {
      this.logger.warn(
        "Email service not configured. Skipping email send.",
        options.subject,
      );
      return false;
    }

    const recipients = Array.isArray(options.to) ? options.to : [options.to];

    this.logger.log(
      `Sending email via ${this.provider} to: ${recipients.join(", ")}, subject: ${options.subject}`,
    );

    try {
      if (this.provider === "resend") {
        return await this.sendViaResend(options, recipients);
      }

      return await this.sendViaSmtp(options, recipients);
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${recipients.join(", ")}: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async sendViaResend(
    options: SendEmailOptions,
    recipients: string[],
  ): Promise<boolean> {
    if (!this.resendClient) {
      this.logger.error("Resend client not initialized");
      return false;
    }

    try {
      const emailOptions: ResendEmailPayload = {
        from: this.emailFrom,
        to: recipients,
        subject: options.subject,
      };

      if (options.html) {
        emailOptions.html = options.html;
      } else if (options.text) {
        emailOptions.text = options.text;
      }

      if (options.replyTo) {
        emailOptions.replyTo = options.replyTo;
      }

      if (options.attachments && options.attachments.length > 0) {
        emailOptions.attachments = options.attachments.map((attachment) => ({
          filename: attachment.filename,
          content:
            typeof attachment.content === "string"
              ? Buffer.from(attachment.content)
              : attachment.content,
        }));
      }

      const response = await this.resendClient.emails.send(
        emailOptions as Parameters<typeof this.resendClient.emails.send>[0],
      );

      if (response.error) {
        this.logger.error(`Resend error: ${response.error.message}`);
        return false;
      }

      this.logger.log(`Email sent via Resend: ${response.data?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Resend send error: ${(error as Error).message}`);
      return false;
    }
  }

  private async sendViaSmtp(
    options: SendEmailOptions,
    recipients: string[],
  ): Promise<boolean> {
    if (!this.smtpTransporter) {
      this.logger.error("SMTP transporter not initialized");
      return false;
    }

    const mailOptions: nodemailer.SendMailOptions = {
      from: this.emailFrom,
      to: recipients.join(", "),
      subject: options.subject,
      text: options.text,
      html: options.html,
      replyTo: options.replyTo,
      attachments: options.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
      })),
    };

    const sendMailPromise = this.smtpTransporter.sendMail(mailOptions);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Email send timeout after 30s")),
        30000,
      );
    });

    const info = await Promise.race([sendMailPromise, timeoutPromise]);
    this.logger.log(`Email sent via SMTP: ${info.messageId}`);
    return true;
  }

  async reinitialize(): Promise<void> {
    this.logger.log("Reinitializing email provider...");
    this.smtpTransporter = null;
    this.resendClient = null;
    this.isConfigured = false;
    await this.initializeEmailProvider();
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.isEnabled()) {
      return {
        success: false,
        message: "Email service not configured",
      };
    }

    if (this.provider === "resend") {
      return this.testResendConnection();
    }

    return this.testSmtpConnection();
  }

  private async testResendConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    if (!this.resendClient) {
      return { success: false, message: "Resend client not initialized" };
    }

    try {
      const result = await this.resendClient.emails.send({
        from: this.emailFrom,
        to: this.adminEmail,
        subject: `${APP_CONFIG.brand.name} Email Test (Resend)`,
        text: `This is a test email from ${APP_CONFIG.brand.name} using Resend. If you received this, your email configuration is working!`,
        html: `
          <div style="font-family: sans-serif; padding: 20px;">
            <h2>${APP_CONFIG.brand.name} Email Test</h2>
            <p>This is a test email sent via <strong>Resend</strong>.</p>
            <p>If you received this, your email configuration is working correctly!</p>
            <hr>
            <p style="color: #666; font-size: 12px;">Sent at: ${new Date().toISOString()}</p>
          </div>
        `,
      });

      if (result.error) {
        return {
          success: false,
          message: `Resend error: ${result.error.message}`,
        };
      }

      return {
        success: true,
        message: `Test email sent successfully via Resend to ${this.adminEmail}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Resend test failed: ${(error as Error).message}`,
      };
    }
  }

  private async testSmtpConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    if (!this.smtpTransporter) {
      return { success: false, message: "SMTP transporter not initialized" };
    }

    try {
      await this.smtpTransporter.verify();
      await this.smtpTransporter.sendMail({
        from: this.emailFrom,
        to: this.adminEmail,
        subject: `${APP_CONFIG.brand.name} Email Test (SMTP)`,
        text: `This is a test email from ${APP_CONFIG.brand.name} using SMTP. If you received this, your email configuration is working!`,
        html: `
          <div style="font-family: sans-serif; padding: 20px;">
            <h2>${APP_CONFIG.brand.name} Email Test</h2>
            <p>This is a test email sent via <strong>SMTP</strong>.</p>
            <p>If you received this, your email configuration is working correctly!</p>
            <hr>
            <p style="color: #666; font-size: 12px;">Sent at: ${new Date().toISOString()}</p>
          </div>
        `,
      });

      return {
        success: true,
        message: `Test email sent successfully via SMTP to ${this.adminEmail}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `SMTP test failed: ${(error as Error).message}`,
      };
    }
  }
}
