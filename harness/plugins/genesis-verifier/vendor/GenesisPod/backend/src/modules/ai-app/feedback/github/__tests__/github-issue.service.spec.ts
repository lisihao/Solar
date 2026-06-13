import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { GitHubIssueService } from "../github-issue.service";
import type { TriageDecision } from "../../triage/triage-decision.types";

// Mock Octokit before imports resolve the module
jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn().mockImplementation(() => mockOctokit),
}));

// Shared mock instance — individual tests reassign methods as needed
const mockOctokit = {
  issues: {
    create: jest.fn(),
    createComment: jest.fn(),
    addLabels: jest.fn(),
    update: jest.fn(),
  },
};

function buildDecision(
  overrides: Partial<TriageDecision> = {},
): TriageDecision {
  return {
    feedbackId: "fb-abc123",
    triagedAt: new Date(),
    processingTimeMs: 300,
    validity: { isValid: true, confidence: 88, reason: "clear bug report" },
    classification: {
      type: "bug",
      subType: "ui_bug",
      affectedModule: "ai-office",
      keywords: ["export", "crash"],
    },
    priority: {
      level: "high",
      score: 72,
      factors: {
        userImpact: 70,
        severity: 75,
        frequency: 65,
        businessImpact: 68,
      },
      reasoning: "Frequent UI crash",
    },
    routing: {
      action: "auto_fix",
      confidence: 90,
      reasoning: "Isolated CSS issue",
      autoFixPlan: {
        approach: "Fix button CSS class",
        estimatedComplexity: "trivial",
        riskLevel: "low",
        requiresReview: false,
      },
    },
    similarIssues: [],
    ...overrides,
  };
}

function buildConfigService(
  overrides: Record<string, string | undefined> = {},
) {
  const defaults: Record<string, string | undefined> = {
    GITHUB_TOKEN: "ghp_test_token",
    GITHUB_OWNER: "test-owner",
    GITHUB_REPO: "test-repo",
    AUTO_FIX_GITHUB_ENABLED: "true",
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => defaults[key]),
  };
}

describe("GitHubIssueService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOctokit.issues.create.mockResolvedValue({
      data: {
        number: 7,
        html_url: "https://github.com/test-owner/test-repo/issues/7",
      },
    });
    mockOctokit.issues.createComment.mockResolvedValue({ data: {} });
    mockOctokit.issues.addLabels.mockResolvedValue({ data: {} });
    mockOctokit.issues.update.mockResolvedValue({ data: {} });
  });

  async function buildService(
    configOverrides: Record<string, string | undefined> = {},
  ) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubIssueService,
        {
          provide: ConfigService,
          useValue: buildConfigService(configOverrides),
        },
      ],
    })
      .setLogger({
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      } as unknown as Logger)
      .compile();

    return module.get(GitHubIssueService);
  }

  // =========================================================
  // isEnabled
  // =========================================================

  describe("isEnabled", () => {
    it("returns true when token is set and AUTO_FIX_GITHUB_ENABLED=true", async () => {
      const service = await buildService();
      expect(service.isEnabled()).toBe(true);
    });

    it("returns false when GITHUB_TOKEN is missing", async () => {
      const service = await buildService({ GITHUB_TOKEN: undefined });
      expect(service.isEnabled()).toBe(false);
    });

    it("returns false when AUTO_FIX_GITHUB_ENABLED is not 'true'", async () => {
      const service = await buildService({ AUTO_FIX_GITHUB_ENABLED: "false" });
      expect(service.isEnabled()).toBe(false);
    });

    it("returns false when AUTO_FIX_GITHUB_ENABLED is missing", async () => {
      const service = await buildService({
        AUTO_FIX_GITHUB_ENABLED: undefined,
      });
      expect(service.isEnabled()).toBe(false);
    });
  });

  // =========================================================
  // createAutoFixIssue
  // =========================================================

  describe("createAutoFixIssue", () => {
    it("returns success result with issue number and URL", async () => {
      const service = await buildService();
      const result = await service.createAutoFixIssue(
        "fb-abc123",
        buildDecision(),
      );

      expect(result.success).toBe(true);
      expect(result.issueNumber).toBe(7);
      expect(result.issueUrl).toBe(
        "https://github.com/test-owner/test-repo/issues/7",
      );
    });

    it("passes correct owner, repo, title, body, labels to Octokit", async () => {
      const service = await buildService();
      await service.createAutoFixIssue("fb-abc123ef", buildDecision());

      expect(mockOctokit.issues.create).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "test-owner",
          repo: "test-repo",
          title: expect.stringContaining("[Auto-Fix]"),
          body: expect.any(String),
          labels: expect.arrayContaining([
            "auto-fix-candidate",
            "ai-generated",
          ]),
        }),
      );
    });

    it("includes feedbackId short-code in the issue title", async () => {
      const service = await buildService();
      await service.createAutoFixIssue("fb-abc123ef", buildDecision());

      const callArgs = mockOctokit.issues.create.mock.calls[0][0] as {
        title: string;
      };
      expect(callArgs.title).toContain("fb-abc12");
    });

    it("includes additional context in issue body when provided", async () => {
      const service = await buildService();
      // screenshotAnalysis.hasScreenshot must be true for the screenshot section to render
      const decisionWithScreenshot = buildDecision({
        screenshotAnalysis: {
          hasScreenshot: true,
          issueDescription: "Button is broken",
          pageIdentified: "dashboard",
        },
      });
      await service.createAutoFixIssue("fb-abc123", decisionWithScreenshot, {
        userDescription: "Steps: 1. Click export 2. App crashes",
        screenshotUrls: ["https://cdn.example.com/shot.png"],
        pageUrl: "https://app.example.com/office",
        errorStack: "TypeError: Cannot read properties of undefined",
      });

      const callArgs = mockOctokit.issues.create.mock.calls[0][0] as {
        body: string;
      };
      expect(callArgs.body).toContain("Steps: 1. Click export");
      expect(callArgs.body).toContain("https://cdn.example.com/shot.png");
      expect(callArgs.body).toContain(
        "TypeError: Cannot read properties of undefined",
      );
    });

    it("returns failure result when service is not enabled", async () => {
      const service = await buildService({ AUTO_FIX_GITHUB_ENABLED: "false" });
      const result = await service.createAutoFixIssue(
        "fb-abc123",
        buildDecision(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(mockOctokit.issues.create).not.toHaveBeenCalled();
    });

    it("returns failure result when Octokit throws", async () => {
      mockOctokit.issues.create.mockRejectedValueOnce(
        new Error("GitHub API rate limit exceeded"),
      );
      const service = await buildService();
      const result = await service.createAutoFixIssue(
        "fb-abc123",
        buildDecision(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("GitHub API rate limit exceeded");
    });

    it("builds labels including priority and module when affectedModule is set", async () => {
      const service = await buildService();
      await service.createAutoFixIssue("fb-abc123", buildDecision());

      const callArgs = mockOctokit.issues.create.mock.calls[0][0] as {
        labels: string[];
      };
      expect(callArgs.labels).toContain("priority:high");
      expect(callArgs.labels).toContain("module:ai-office");
      expect(callArgs.labels).toContain("type:bug");
      expect(callArgs.labels).toContain("complexity:trivial");
    });
  });

  // =========================================================
  // updateIssueStatus
  // =========================================================

  describe("updateIssueStatus", () => {
    it("adds status:in-progress label and posts comment for in_progress", async () => {
      const service = await buildService();
      const result = await service.updateIssueStatus(
        7,
        "in_progress",
        "Work started",
      );

      expect(result).toBe(true);
      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({ issue_number: 7, body: "Work started" }),
      );
      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 7,
          labels: ["status:in-progress"],
        }),
      );
    });

    it("closes the issue when status is completed", async () => {
      const service = await buildService();
      await service.updateIssueStatus(7, "completed");

      expect(mockOctokit.issues.update).toHaveBeenCalledWith(
        expect.objectContaining({ issue_number: 7, state: "closed" }),
      );
    });

    it("adds status:failed label without closing for failed status", async () => {
      const service = await buildService();
      await service.updateIssueStatus(7, "failed");

      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({ labels: ["status:failed"] }),
      );
      expect(mockOctokit.issues.update).not.toHaveBeenCalled();
    });

    it("returns false when service is not enabled", async () => {
      const service = await buildService({ AUTO_FIX_GITHUB_ENABLED: "false" });
      const result = await service.updateIssueStatus(7, "in_progress");

      expect(result).toBe(false);
    });

    it("returns false when Octokit throws during update", async () => {
      mockOctokit.issues.addLabels.mockRejectedValueOnce(
        new Error("API error"),
      );
      const service = await buildService();
      const result = await service.updateIssueStatus(7, "in_progress");

      expect(result).toBe(false);
    });
  });

  // =========================================================
  // linkPullRequest
  // =========================================================

  describe("linkPullRequest", () => {
    it("posts a linking comment referencing the PR number", async () => {
      const service = await buildService();
      const result = await service.linkPullRequest(7, 42);

      expect(result).toBe(true);
      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_number: 7,
          body: expect.stringContaining("#42"),
        }),
      );
    });

    it("returns false when service is not enabled", async () => {
      const service = await buildService({ AUTO_FIX_GITHUB_ENABLED: "false" });
      const result = await service.linkPullRequest(7, 42);

      expect(result).toBe(false);
    });

    it("returns false when createComment throws", async () => {
      mockOctokit.issues.createComment.mockRejectedValueOnce(
        new Error("Not found"),
      );
      const service = await buildService();
      const result = await service.linkPullRequest(7, 42);

      expect(result).toBe(false);
    });
  });
});
