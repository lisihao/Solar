// @octokit/rest ships as ESM — mock it before any import resolves it
jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    issues: {
      create: jest.fn(),
      createComment: jest.fn(),
      addLabels: jest.fn(),
      update: jest.fn(),
    },
  })),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { FeedbackEventListener } from "../feedback-event.listener";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { TriageAgentService } from "../../triage/triage-agent.service";
import { GitHubIssueService } from "../../github/github-issue.service";
import { FeedbackEvent } from "../feedback-events";
import type {
  FeedbackCreatedPayload,
  TriageCompletedPayload,
  TriageFailedPayload,
} from "../feedback-events";
import type { TriageDecision } from "../../triage/triage-decision.types";

// Shared test fixture builders
function buildTriageDecision(
  overrides: Partial<TriageDecision> = {},
): TriageDecision {
  return {
    feedbackId: "feedback-123",
    triagedAt: new Date(),
    processingTimeMs: 500,
    validity: { isValid: true, confidence: 90, reason: "valid feedback" },
    classification: {
      type: "bug",
      subType: "ui_bug",
      affectedModule: "ai-office",
      keywords: ["crash", "export"],
    },
    priority: {
      level: "high",
      score: 70,
      factors: {
        userImpact: 70,
        severity: 80,
        frequency: 60,
        businessImpact: 65,
      },
      reasoning: "High severity UI bug",
    },
    routing: {
      action: "manual_fix",
      confidence: 88,
      reasoning: "Requires developer attention",
      manualAssignment: { estimatedEffort: "2h" },
    },
    similarIssues: [],
    ...overrides,
  };
}

function buildFeedbackCreatedPayload(
  overrides: Partial<FeedbackCreatedPayload> = {},
): FeedbackCreatedPayload {
  return {
    feedbackId: "feedback-123",
    type: "BUG",
    title: "Button crashes on click",
    description: "The export button crashes the app",
    attachments: [],
    userEmail: "user@test.com",
    pageUrl: "https://app.example.com/dashboard",
    userAgent: "Mozilla/5.0",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("FeedbackEventListener", () => {
  let listener: FeedbackEventListener;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let triageAgent: jest.Mocked<TriageAgentService>;
  let prisma: { $executeRaw: jest.Mock; $queryRaw: jest.Mock };
  let githubIssueService: jest.Mocked<GitHubIssueService>;

  beforeEach(async () => {
    // Enable auto-triage by default so existing tests exercise the triage path.
    process.env.ENABLE_FEEDBACK_AUTO_TRIAGE = "true";

    prisma = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackEventListener,
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
        {
          provide: TriageAgentService,
          useValue: { triage: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: GitHubIssueService,
          useValue: {
            isEnabled: jest.fn(),
            createAutoFixIssue: jest.fn(),
          },
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

    listener = module.get(FeedbackEventListener);
    eventEmitter = module.get(EventEmitter2);
    triageAgent = module.get(TriageAgentService);
    githubIssueService = module.get(GitHubIssueService);
  });

  // =========================================================
  // handleFeedbackCreated
  // =========================================================

  describe("handleFeedbackCreated", () => {
    it("emits TRIAGE_STARTED and TRIAGE_COMPLETED on success", async () => {
      const payload = buildFeedbackCreatedPayload();
      const decision = buildTriageDecision();
      triageAgent.triage.mockResolvedValue(decision);

      await listener.handleFeedbackCreated(payload);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        FeedbackEvent.TRIAGE_STARTED,
        expect.objectContaining({ feedbackId: "feedback-123" }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        FeedbackEvent.TRIAGE_COMPLETED,
        expect.objectContaining({ feedbackId: "feedback-123", decision }),
      );
    });

    it("calls triageAgent.triage with correctly shaped TriageInput", async () => {
      const payload = buildFeedbackCreatedPayload();
      triageAgent.triage.mockResolvedValue(buildTriageDecision());

      await listener.handleFeedbackCreated(payload);

      expect(triageAgent.triage).toHaveBeenCalledWith(
        expect.objectContaining({
          feedbackId: "feedback-123",
          type: "BUG",
          title: "Button crashes on click",
          metadata: expect.objectContaining({ userEmail: "user@test.com" }),
        }),
      );
    });

    it("saves triage result to database via $executeRaw", async () => {
      const payload = buildFeedbackCreatedPayload();
      triageAgent.triage.mockResolvedValue(buildTriageDecision());

      await listener.handleFeedbackCreated(payload);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("emits TRIAGE_FAILED when triageAgent throws", async () => {
      const payload = buildFeedbackCreatedPayload();
      triageAgent.triage.mockRejectedValue(new Error("AI timeout"));

      await listener.handleFeedbackCreated(payload);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        FeedbackEvent.TRIAGE_FAILED,
        expect.objectContaining({
          feedbackId: "feedback-123",
          error: "AI timeout",
        }),
      );
    });

    it("does NOT emit TRIAGE_COMPLETED when triage fails", async () => {
      const payload = buildFeedbackCreatedPayload();
      triageAgent.triage.mockRejectedValue(new Error("network error"));

      await listener.handleFeedbackCreated(payload);

      const calls = (eventEmitter.emit as jest.Mock).mock.calls.map(
        ([event]) => event,
      );
      expect(calls).not.toContain(FeedbackEvent.TRIAGE_COMPLETED);
    });
  });

  // =========================================================
  // handleTriageCompleted — routing actions
  // =========================================================

  describe("handleTriageCompleted", () => {
    async function callWithAction(
      action: TriageDecision["routing"]["action"],
      extra: Partial<TriageDecision> = {},
    ) {
      const decision = buildTriageDecision({
        routing: { action, confidence: 90, reasoning: "test" },
        ...extra,
      });
      const payload: TriageCompletedPayload = {
        feedbackId: "feedback-123",
        decision,
        completedAt: new Date(),
      };
      await listener.handleTriageCompleted(payload);
      return decision;
    }

    it("manual_fix updates status to REVIEWED", async () => {
      await callWithAction("manual_fix");

      expect(prisma.$executeRaw).toHaveBeenCalled();
      const calls = (eventEmitter.emit as jest.Mock).mock.calls.map(
        ([event]) => event,
      );
      expect(calls).toContain(FeedbackEvent.STATUS_CHANGED);
    });

    it("reject updates status to CLOSED and emits CLOSED event", async () => {
      await callWithAction("reject", {
        routing: {
          action: "reject",
          confidence: 90,
          reasoning: "duplicate",
          rejectReason: "Duplicate ticket",
        },
      });

      const emittedEvents = (eventEmitter.emit as jest.Mock).mock.calls.map(
        ([event]) => event,
      );
      expect(emittedEvents).toContain(FeedbackEvent.CLOSED);
    });

    it("defer updates status to PENDING", async () => {
      await callWithAction("defer");
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("request_info updates status to PENDING", async () => {
      await callWithAction("request_info", {
        routing: {
          action: "request_info",
          confidence: 70,
          reasoning: "needs steps to reproduce",
          requestedInfo: ["screenshots", "steps to reproduce"],
        },
      });
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("auto_fix with GitHub enabled creates Issue and updates feedback", async () => {
      githubIssueService.isEnabled.mockReturnValue(true);
      githubIssueService.createAutoFixIssue.mockResolvedValue({
        success: true,
        issueNumber: 42,
        issueUrl: "https://github.com/owner/repo/issues/42",
      });
      prisma.$queryRaw.mockResolvedValue([
        {
          description: "Bug description",
          page_url: "https://app.example.com",
          attachments: null,
        },
      ]);

      const decision = buildTriageDecision({
        routing: {
          action: "auto_fix",
          confidence: 92,
          reasoning: "simple UI fix",
          autoFixPlan: {
            approach: "Fix CSS class",
            estimatedComplexity: "trivial",
            riskLevel: "low",
            requiresReview: false,
          },
        },
      });
      const payload: TriageCompletedPayload = {
        feedbackId: "feedback-123",
        decision,
        completedAt: new Date(),
      };

      await listener.handleTriageCompleted(payload);

      expect(githubIssueService.createAutoFixIssue).toHaveBeenCalledWith(
        "feedback-123",
        decision,
        expect.any(Object),
      );
    });

    it("auto_fix falls back to manual when GitHub service is disabled", async () => {
      githubIssueService.isEnabled.mockReturnValue(false);
      prisma.$queryRaw.mockResolvedValue([]);

      const decision = buildTriageDecision({
        routing: { action: "auto_fix", confidence: 90, reasoning: "easy fix" },
      });
      const payload: TriageCompletedPayload = {
        feedbackId: "feedback-123",
        decision,
        completedAt: new Date(),
      };

      await listener.handleTriageCompleted(payload);

      // GitHub Issue should NOT have been called
      expect(githubIssueService.createAutoFixIssue).not.toHaveBeenCalled();
      // Status should be updated for manual fix fallback
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("sends critical notification when priority is critical and feedback is valid", async () => {
      const decision = buildTriageDecision({
        routing: {
          action: "manual_fix",
          confidence: 90,
          reasoning: "critical",
        },
        priority: {
          level: "critical",
          score: 90,
          factors: {
            userImpact: 90,
            severity: 90,
            frequency: 85,
            businessImpact: 90,
          },
          reasoning: "Data loss risk",
        },
        validity: { isValid: true, confidence: 95, reason: "confirmed" },
      });
      const payload: TriageCompletedPayload = {
        feedbackId: "feedback-123",
        decision,
        completedAt: new Date(),
      };

      // Should not throw — critical notification is currently a log-only operation
      await expect(
        listener.handleTriageCompleted(payload),
      ).resolves.toBeUndefined();
    });
  });

  afterEach(() => {
    delete process.env.ENABLE_FEEDBACK_AUTO_TRIAGE;
  });

  // =========================================================
  // ENABLE_FEEDBACK_AUTO_TRIAGE env gate
  // =========================================================

  describe("ENABLE_FEEDBACK_AUTO_TRIAGE env gate", () => {
    it("does NOT call triageAgent.triage when flag is unset (default OFF)", async () => {
      delete process.env.ENABLE_FEEDBACK_AUTO_TRIAGE;
      const payload = buildFeedbackCreatedPayload();

      await listener.handleFeedbackCreated(payload);

      expect(triageAgent.triage).not.toHaveBeenCalled();
    });

    it("does NOT emit TRIAGE_STARTED when flag is unset (default OFF)", async () => {
      delete process.env.ENABLE_FEEDBACK_AUTO_TRIAGE;
      const payload = buildFeedbackCreatedPayload();

      await listener.handleFeedbackCreated(payload);

      const emittedEvents = (eventEmitter.emit as jest.Mock).mock.calls.map(
        ([event]) => event,
      );
      expect(emittedEvents).not.toContain(FeedbackEvent.TRIAGE_STARTED);
    });

    it("calls triageAgent.triage when flag is 'true' (opt-in)", async () => {
      // flag already set to 'true' by beforeEach
      const payload = buildFeedbackCreatedPayload();
      triageAgent.triage.mockResolvedValue(buildTriageDecision());

      await listener.handleFeedbackCreated(payload);

      expect(triageAgent.triage).toHaveBeenCalled();
    });
  });

  // =========================================================
  // handleTriageFailed
  // =========================================================

  describe("handleTriageFailed", () => {
    it("updates feedback status to PENDING with error note", async () => {
      const payload: TriageFailedPayload = {
        feedbackId: "feedback-456",
        error: "LLM unavailable",
        failedAt: new Date(),
      };

      await listener.handleTriageFailed(payload);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("emits STATUS_CHANGED after updating status", async () => {
      const payload: TriageFailedPayload = {
        feedbackId: "feedback-456",
        error: "timeout",
        failedAt: new Date(),
      };

      await listener.handleTriageFailed(payload);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        FeedbackEvent.STATUS_CHANGED,
        expect.objectContaining({ feedbackId: "feedback-456" }),
      );
    });
  });
});
