import { Test, TestingModule } from "@nestjs/testing";
import { ReleaseService } from "../release.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { AI_CHAT_TOKEN } from "../../abstractions/ai-services.interface";
import { NotificationService } from "../../notifications/notification.service";
import { NotificationTypeDto } from "../../notifications/notification.types";
import { ReleaseInfo } from "../release.types";

// Mock child_process to avoid real git commands
jest.mock("child_process", () => ({
  execFileSync: jest.fn(),
}));

import { execFileSync } from "child_process";
const mockExecFileSync = execFileSync as jest.MockedFunction<
  typeof execFileSync
>;

const mockPrismaService = {
  user: {
    findMany: jest.fn(),
  },
};

const mockAIFacade = {
  chat: jest.fn(),
};

const mockNotificationService = {
  batchCreateNotifications: jest.fn(),
};

describe("ReleaseService", () => {
  let service: ReleaseService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReleaseService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AI_CHAT_TOKEN, useValue: mockAIFacade },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<ReleaseService>(ReleaseService);
  });

  // ─── collectGitChanges ────────────────────────────────────────────

  describe("collectGitChanges", () => {
    it("parses conventional commits correctly", async () => {
      const rawCommits = [
        "abc1234|feat(auth): add OAuth support|John Doe|2026-01-01",
        "def5678|fix(api): handle null response|Jane Doe|2026-01-02",
        "ghi9012|chore: update dependencies|Bot|2026-01-03",
      ].join("\n");

      const rawStats = "5 files changed, 100 insertions(+), 20 deletions(-)";

      mockExecFileSync
        .mockReturnValueOnce(rawCommits as any)
        .mockReturnValueOnce(rawStats as any);

      const result = await service.collectGitChanges("v1.0.0", "v1.1.0");

      expect(result.commits).toHaveLength(3);
      expect(result.commits[0]).toMatchObject({
        hash: "abc1234",
        type: "feat",
        scope: "auth",
        message: "add OAuth support",
        author: "John Doe",
      });
      expect(result.commits[1]).toMatchObject({
        type: "fix",
        scope: "api",
        message: "handle null response",
      });
    });

    it("classifies non-conventional commits as chore", async () => {
      const rawCommits = "abc1234|Merged PR #42|Dev|2026-01-01";
      const rawStats = "1 file changed, 5 insertions(+)";

      mockExecFileSync
        .mockReturnValueOnce(rawCommits as any)
        .mockReturnValueOnce(rawStats as any);

      const result = await service.collectGitChanges("v1.0.0", "v1.1.0");

      expect(result.commits[0].type).toBe("chore");
      expect(result.commits[0].message).toBe("Merged PR #42");
    });

    it("handles empty commit log", async () => {
      mockExecFileSync
        .mockReturnValueOnce("" as any)
        .mockReturnValueOnce("0 files changed" as any);

      const result = await service.collectGitChanges("v1.0.0", "v1.0.1");

      expect(result.commits).toHaveLength(0);
    });

    it("parses stats with only insertions", async () => {
      mockExecFileSync
        .mockReturnValueOnce("abc|feat: something|Dev|2026-01-01" as any)
        .mockReturnValueOnce("3 files changed, 50 insertions(+)" as any);

      const result = await service.collectGitChanges("v1.0.0", "v1.1.0");

      expect(result.stats.filesChanged).toBe(3);
      expect(result.stats.insertions).toBe(50);
      expect(result.stats.deletions).toBe(0);
    });

    it("throws when git command fails", async () => {
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error("not a git repository");
      });

      await expect(
        service.collectGitChanges("v1.0.0", "v1.1.0"),
      ).rejects.toThrow("Failed to collect git changes");
    });

    it("rejects invalid tag format to prevent command injection", async () => {
      await expect(
        service.collectGitChanges("v1.0.0; rm -rf /", "v1.1.0"),
      ).rejects.toThrow("Invalid tag format");

      await expect(
        service.collectGitChanges("v1.0.0", "$(malicious)"),
      ).rejects.toThrow("Invalid tag format");
    });
  });

  // ─── generateReleaseNotes ─────────────────────────────────────────

  describe("generateReleaseNotes", () => {
    const buildReleaseInfo = (
      overrides?: Partial<ReleaseInfo>,
    ): ReleaseInfo => ({
      fromVersion: "v1.0.0",
      toVersion: "v1.1.0",
      commits: [
        {
          hash: "a1",
          type: "feat",
          scope: "auth",
          message: "add login",
          author: "Dev",
          date: "2026-01-01",
        },
        {
          hash: "b2",
          type: "fix",
          message: "fix crash",
          author: "Dev",
          date: "2026-01-02",
        },
      ],
      stats: { filesChanged: 5, insertions: 100, deletions: 20 },
      ...overrides,
    });

    it("returns AI-generated release notes when AI responds correctly", async () => {
      const aiResponse = {
        content: JSON.stringify({
          summary: "This update adds new auth features",
          highlights: [{ title: "Login", description: "New OAuth login" }],
          changes: [{ type: "feat", scope: "auth", description: "add login" }],
        }),
      };
      mockAIFacade.chat.mockResolvedValue(aiResponse);

      const result = await service.generateReleaseNotes(buildReleaseInfo());

      expect(result.version).toBe("v1.1.0");
      expect(result.summary).toBe("This update adds new auth features");
      expect(result.highlights).toHaveLength(1);
    });

    it("extracts JSON from markdown code blocks in AI response", async () => {
      const aiResponse = {
        content:
          "```json\n" +
          JSON.stringify({
            summary: "Update with code blocks",
            highlights: [],
            changes: [],
          }) +
          "\n```",
      };
      mockAIFacade.chat.mockResolvedValue(aiResponse);

      const result = await service.generateReleaseNotes(buildReleaseInfo());
      expect(result.summary).toBe("Update with code blocks");
    });

    it("falls back to basic release notes when AI returns invalid JSON", async () => {
      mockAIFacade.chat.mockResolvedValue({
        content: "This is not JSON at all.",
      });

      const result = await service.generateReleaseNotes(buildReleaseInfo());

      expect(result.version).toBe("v1.1.0");
      expect(typeof result.summary).toBe("string");
      expect(result.summary.length).toBeGreaterThan(0);
    });

    it("falls back when AI chat throws", async () => {
      mockAIFacade.chat.mockRejectedValue(new Error("AI service down"));

      const result = await service.generateReleaseNotes(buildReleaseInfo());

      expect(result.version).toBe("v1.1.0");
      expect(result.changes).toBeDefined();
    });

    it("generates fallback summary with only fixes (no feats)", async () => {
      mockAIFacade.chat.mockRejectedValue(new Error("fail"));
      const releaseInfo = buildReleaseInfo({
        commits: [
          {
            hash: "a1",
            type: "fix",
            message: "fix crash",
            author: "Dev",
            date: "2026-01-01",
          },
        ],
      });

      const result = await service.generateReleaseNotes(releaseInfo);

      expect(result.summary).toContain("1");
    });

    it("generates fallback summary with no feats and no fixes", async () => {
      mockAIFacade.chat.mockRejectedValue(new Error("fail"));
      const releaseInfo = buildReleaseInfo({
        commits: [
          {
            hash: "a1",
            type: "chore",
            message: "update deps",
            author: "Dev",
            date: "2026-01-01",
          },
        ],
      });

      const result = await service.generateReleaseNotes(releaseInfo);
      expect(result.summary).toContain("1");
    });
  });

  // ─── getAllActiveUserIds ───────────────────────────────────────────

  describe("getAllActiveUserIds", () => {
    it("returns IDs of users active in last 30 days", async () => {
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: "u1" },
        { id: "u2" },
        { id: "u3" },
      ]);

      const result = await service.getAllActiveUserIds();

      expect(result).toEqual(["u1", "u2", "u3"]);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lastLoginAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        }),
      );
    });

    it("returns empty array when no active users", async () => {
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await service.getAllActiveUserIds();
      expect(result).toEqual([]);
    });
  });

  // ─── sendReleaseNotification ──────────────────────────────────────

  describe("sendReleaseNotification", () => {
    const mockNotes = {
      version: "v1.1.0",
      summary: "New features",
      highlights: [{ title: "Login", description: "OAuth" }],
      changes: [],
    };

    it("sends notifications to all users and returns counts", async () => {
      mockNotificationService.batchCreateNotifications.mockResolvedValue({
        succeeded: [{ userId: "u1" }, { userId: "u2" }],
        failed: [],
      });

      const result = await service.sendReleaseNotification(mockNotes, [
        "u1",
        "u2",
      ]);

      expect(result.sent).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.failedUsers).toBeUndefined();
    });

    it("returns zero counts when userIds is empty", async () => {
      const result = await service.sendReleaseNotification(mockNotes, []);
      expect(result).toEqual({ sent: 0, failed: 0 });
      expect(
        mockNotificationService.batchCreateNotifications,
      ).not.toHaveBeenCalled();
    });

    it("returns failed users list when some notifications fail", async () => {
      mockNotificationService.batchCreateNotifications.mockResolvedValue({
        succeeded: [{ userId: "u1" }],
        failed: [{ userId: "u2" }],
      });

      const result = await service.sendReleaseNotification(mockNotes, [
        "u1",
        "u2",
      ]);

      expect(result.sent).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.failedUsers).toEqual(["u2"]);
    });

    it("returns all as failed when notification service throws", async () => {
      mockNotificationService.batchCreateNotifications.mockRejectedValue(
        new Error("Notification service down"),
      );

      const result = await service.sendReleaseNotification(mockNotes, [
        "u1",
        "u2",
        "u3",
      ]);

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(3);
      expect(result.failedUsers).toEqual(["u1", "u2", "u3"]);
    });

    it("calls batchCreateNotifications with correct notification type", async () => {
      mockNotificationService.batchCreateNotifications.mockResolvedValue({
        succeeded: [],
        failed: [],
      });

      await service.sendReleaseNotification(mockNotes, ["u1"]);

      expect(
        mockNotificationService.batchCreateNotifications,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationTypeDto.UPDATE,
          actionUrl: "/changelog",
        }),
      );
    });
  });

  // ─── processRelease ───────────────────────────────────────────────

  describe("processRelease", () => {
    const setupProcessReleaseMocks = () => {
      const rawCommits = "abc|feat(ui): add dark mode|Dev|2026-01-01";
      const rawStats = "10 files changed, 200 insertions(+), 50 deletions(-)";

      mockExecFileSync
        .mockReturnValueOnce(rawCommits as any)
        .mockReturnValueOnce(rawStats as any);

      mockAIFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          summary: "Dark mode added",
          highlights: [{ title: "UI", description: "Dark mode" }],
          changes: [{ type: "feat", scope: "ui", description: "dark mode" }],
        }),
      });

      mockPrismaService.user.findMany.mockResolvedValue([
        { id: "u1" },
        { id: "u2" },
      ]);

      mockNotificationService.batchCreateNotifications.mockResolvedValue({
        succeeded: [{ userId: "u1" }, { userId: "u2" }],
        failed: [],
      });
    };

    it("completes full release flow and returns result", async () => {
      setupProcessReleaseMocks();

      const result = await service.processRelease("v1.0.0", "v1.1.0");

      expect(result.success).toBe(true);
      expect(result.version).toBe("v1.1.0");
      expect(result.releaseNotes.summary).toBe("Dark mode added");
      expect(result.notification.sent).toBe(2);
      expect(result.dryRun).toBe(false);
    });

    it("skips notification sending in dry-run mode", async () => {
      setupProcessReleaseMocks();

      const result = await service.processRelease("v1.0.0", "v1.1.0", true);

      expect(
        mockNotificationService.batchCreateNotifications,
      ).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
      expect(result.notification.sent).toBe(0);
    });

    it("throws when no commits found between tags", async () => {
      mockExecFileSync
        .mockReturnValueOnce("" as any)
        .mockReturnValueOnce("0 files changed" as any);

      await expect(service.processRelease("v1.0.0", "v1.0.0")).rejects.toThrow(
        "No commits found between",
      );
    });

    it("sets success=false when some notifications fail", async () => {
      const rawCommits = "abc|feat: stuff|Dev|2026-01-01";
      const rawStats = "1 file changed, 10 insertions(+)";
      mockExecFileSync
        .mockReturnValueOnce(rawCommits as any)
        .mockReturnValueOnce(rawStats as any);

      mockAIFacade.chat.mockRejectedValue(new Error("AI down"));
      mockPrismaService.user.findMany.mockResolvedValue([{ id: "u1" }]);
      mockNotificationService.batchCreateNotifications.mockResolvedValue({
        succeeded: [],
        failed: [{ userId: "u1" }],
      });

      const result = await service.processRelease("v1.0.0", "v1.1.0");

      expect(result.success).toBe(false);
    });
  });
});
