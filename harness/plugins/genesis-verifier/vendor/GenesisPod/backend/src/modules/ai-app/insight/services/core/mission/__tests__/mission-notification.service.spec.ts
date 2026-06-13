/**
 * MissionNotificationService Unit Tests
 *
 * Covers all public methods and all branches (Optional deps present / absent).
 */

import { Test, TestingModule } from "@nestjs/testing";
import { MissionNotificationService } from "../mission-notification.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  MissionCompletionPreset,
  SettingsService,
} from "@/modules/platform/facade";

// ─── Mock factories ───────────────────────────────────────────────────────────
// PR-DR1b F3 整改：原 EmailNotificationPresetsService.sendMissionCompletionNotification
// 已替换为 MissionCompletionPreset.notify（走 dispatcher）

function buildMockPrisma() {
  return {
    researchTopic: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };
}

function buildMockEmailService() {
  // MissionCompletionPreset.notify 替换 sendMissionCompletionNotification
  return {
    notify: jest.fn(),
  };
}

function buildMockSettingsService() {
  return {
    getAiSettings: jest.fn(),
  };
}

// ─── Test builder helpers ─────────────────────────────────────────────────────

async function buildService(opts?: {
  withEmail?: boolean;
  withSettings?: boolean;
}): Promise<{
  service: MissionNotificationService;
  prisma: ReturnType<typeof buildMockPrisma>;
  emailService: ReturnType<typeof buildMockEmailService>;
  settingsService: ReturnType<typeof buildMockSettingsService>;
}> {
  const prisma = buildMockPrisma();
  const emailService = buildMockEmailService();
  const settingsService = buildMockSettingsService();

  const providers: { provide: unknown; useValue: unknown }[] = [
    MissionNotificationService,
    { provide: PrismaService, useValue: prisma },
  ];

  if (opts?.withEmail !== false) {
    providers.push({
      provide: MissionCompletionPreset,
      useValue: emailService,
    });
  }
  if (opts?.withSettings !== false) {
    providers.push({ provide: SettingsService, useValue: settingsService });
  }

  const module: TestingModule = await Test.createTestingModule({
    providers,
  }).compile();

  return {
    service: module.get<MissionNotificationService>(MissionNotificationService),
    prisma,
    emailService,
    settingsService,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MissionNotificationService", () => {
  afterEach(() => jest.clearAllMocks());

  // ─── notifyCompletion ─────────────────────────────────────────────────────────

  describe("notifyCompletion", () => {
    it("should dispatch completion when topic + userId present (user lookup moved inside preset)", async () => {
      const { service, prisma, emailService } = await buildService();

      prisma.researchTopic.findUnique.mockResolvedValue({
        userId: "user-1",
        name: "AI Research Topic",
      });
      emailService.notify.mockResolvedValue(undefined);

      service.notifyCompletion({
        missionId: "m1",
        topicId: "t1",
        completedTasks: 4,
        totalTasks: 5,
      });

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      expect(prisma.researchTopic.findUnique).toHaveBeenCalledWith({
        where: { id: "t1" },
        select: { userId: true, name: true },
      });
      // User lookup now happens inside preset, not in MissionNotificationService
      expect(emailService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          missionId: "m1",
          missionTitle: "AI Research Topic",
          reportUrl: "/topics/t1/reports",
          summary: "4/5 dimensions completed",
        }),
      );
    });

    it("should not dispatch when preset is absent (Optional degraded)", async () => {
      const { service, prisma } = await buildService({ withEmail: false });

      service.notifyCompletion({
        missionId: "m1",
        topicId: "t1",
        completedTasks: 3,
        totalTasks: 3,
      });

      await new Promise((r) => setImmediate(r));
      expect(prisma.researchTopic.findUnique).not.toHaveBeenCalled();
    });

    it("should not dispatch when topic is not found", async () => {
      const { service, prisma, emailService } = await buildService();

      prisma.researchTopic.findUnique.mockResolvedValue(null);

      service.notifyCompletion({
        missionId: "m1",
        topicId: "no-such-topic",
        completedTasks: 2,
        totalTasks: 2,
      });

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      expect(emailService.notify).not.toHaveBeenCalled();
    });

    it("should not dispatch when topic has no userId", async () => {
      const { service, prisma, emailService } = await buildService();

      prisma.researchTopic.findUnique.mockResolvedValue({
        userId: null,
        name: "Topic Without Owner",
      });

      service.notifyCompletion({
        missionId: "m1",
        topicId: "t1",
        completedTasks: 1,
        totalTasks: 1,
      });

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      expect(emailService.notify).not.toHaveBeenCalled();
    });

    // User-lookup edge cases (user not found / no email) now handled inside
    // MissionCompletionPreset (see mission-completion.preset.spec.ts coverage).
    // MissionNotificationService is no longer responsible for that lookup.

    it("should handle prisma errors gracefully without throwing", async () => {
      const { service, prisma } = await buildService();

      prisma.researchTopic.findUnique.mockRejectedValue(
        new Error("DB connection failed"),
      );

      // Should not propagate
      service.notifyCompletion({
        missionId: "m1",
        topicId: "t1",
        completedTasks: 1,
        totalTasks: 1,
      });

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      // No assertion needed — just verifying it doesn't throw
    });

    it("should handle dispatch errors gracefully", async () => {
      const { service, prisma, emailService } = await buildService();

      prisma.researchTopic.findUnique.mockResolvedValue({
        userId: "user-1",
        name: "Research Topic",
      });
      emailService.notify.mockRejectedValue(new Error("dispatch failed"));

      service.notifyCompletion({
        missionId: "m1",
        topicId: "t1",
        completedTasks: 3,
        totalTasks: 3,
      });

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      // Should not throw — error is caught inside the IIFE
    });
  });

  // ─── getAiSettings ───────────────────────────────────────────────────────────

  describe("getAiSettings", () => {
    it("should return empty object when settingsService is absent", async () => {
      const { service } = await buildService({ withSettings: false });
      const result = await service.getAiSettings();
      expect(result).toEqual({});
    });

    it("should return rateLimitHint when rateLimitPerMinute > 0", async () => {
      const { service, settingsService } = await buildService();
      settingsService.getAiSettings.mockResolvedValue({
        rateLimitPerMinute: 90,
      });

      const result = await service.getAiSettings();

      expect(result).toEqual({ rateLimitHint: 30 }); // floor(90 / 3) = 30
    });

    it("should floor the hint correctly", async () => {
      const { service, settingsService } = await buildService();
      settingsService.getAiSettings.mockResolvedValue({
        rateLimitPerMinute: 100,
      });

      const result = await service.getAiSettings();
      expect(result).toEqual({ rateLimitHint: 33 }); // floor(100 / 3) = 33
    });

    it("should return empty object when rateLimitPerMinute is 0", async () => {
      const { service, settingsService } = await buildService();
      settingsService.getAiSettings.mockResolvedValue({
        rateLimitPerMinute: 0,
      });

      const result = await service.getAiSettings();
      expect(result).toEqual({});
    });

    it("should return empty object when rateLimitPerMinute is negative", async () => {
      const { service, settingsService } = await buildService();
      settingsService.getAiSettings.mockResolvedValue({
        rateLimitPerMinute: -5,
      });

      const result = await service.getAiSettings();
      expect(result).toEqual({});
    });

    it("should return empty object when settingsService.getAiSettings throws", async () => {
      const { service, settingsService } = await buildService();
      settingsService.getAiSettings.mockRejectedValue(
        new Error("settings unavailable"),
      );

      const result = await service.getAiSettings();
      expect(result).toEqual({});
    });
  });
});
