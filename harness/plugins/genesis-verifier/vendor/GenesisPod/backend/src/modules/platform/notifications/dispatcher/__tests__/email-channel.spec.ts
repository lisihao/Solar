import { Test, TestingModule } from "@nestjs/testing";
import { NotificationType } from "@prisma/client";
import { EmailChannel } from "../channels/email-channel.adapter";
import { EmailService } from "../../../email/email.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("EmailChannel adapter (PR-DR1b)", () => {
  let channel: EmailChannel;
  let emailService: jest.Mocked<EmailService>;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    emailService = {
      sendEmail: jest.fn().mockResolvedValue(true),
      isEnabled: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<EmailService>;
    prisma = {
      user: { findUnique: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailChannel,
        { provide: EmailService, useValue: emailService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    channel = module.get(EmailChannel);
  });

  describe("type / capabilities", () => {
    it("type === 'email'", () => {
      expect(channel.type).toBe("email");
    });

    it("capabilities：无绑定 / 需全局配置 / 上限 50", () => {
      expect(channel.getCapabilities()).toEqual({
        requiresUserBinding: false,
        requiresGlobalConfig: true,
        dailyQuotaPerUser: 50,
      });
    });
  });

  describe("isAvailable", () => {
    it("EmailService 未配置 → false", async () => {
      emailService.isEnabled.mockReturnValue(false);
      expect(await channel.isAvailable("uid-1")).toBe(false);
    });

    it("user 无 email → false", async () => {
      prisma.user.findUnique.mockResolvedValue({ email: null });
      expect(await channel.isAvailable("uid-1")).toBe(false);
    });

    it("user 不存在 → false", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      expect(await channel.isAvailable("uid-1")).toBe(false);
    });

    it("user 有 email + 服务已配置 → true", async () => {
      prisma.user.findUnique.mockResolvedValue({ email: "x@y.com" });
      expect(await channel.isAvailable("uid-1")).toBe(true);
    });
  });

  describe("send", () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        email: "user@example.com",
        locale: "zh-CN",
      });
    });

    it("调既有 EmailService.sendEmail（M2 复用）+ text fallback", async () => {
      await channel.send("uid-1", {
        type: "RADAR_DAILY" as NotificationType,
        title: "今日 TOP 3",
        message: "NVIDIA + Jensen + ASIC",
      });
      expect(emailService.sendEmail).toHaveBeenCalledWith({
        to: "user@example.com",
        subject: "今日 TOP 3",
        text: "NVIDIA + Jensen + ASIC",
      });
    });

    it("emailContext.html 优先于 message", async () => {
      await channel.send("uid-1", {
        type: "RADAR_DAILY" as NotificationType,
        title: "今日 TOP 3",
        message: "fallback text",
        emailContext: { html: "<p>渲染后</p>" },
      });
      expect(emailService.sendEmail).toHaveBeenCalledWith({
        to: "user@example.com",
        subject: "今日 TOP 3",
        html: "<p>渲染后</p>",
      });
    });

    it("EmailService 返回 false → throw（dispatcher 捕获脱敏）", async () => {
      emailService.sendEmail.mockResolvedValueOnce(false);
      await expect(
        channel.send("uid-1", {
          type: "RADAR_DAILY" as NotificationType,
          title: "x",
          message: "y",
        }),
      ).rejects.toThrow("email-transport-failed");
    });

    it("user 没 email → 防御性 throw", async () => {
      prisma.user.findUnique.mockResolvedValue({ email: null });
      await expect(
        channel.send("uid-1", {
          type: "RADAR_DAILY" as NotificationType,
          title: "x",
          message: "y",
        }),
      ).rejects.toThrow("user has no email address");
    });
  });
});
