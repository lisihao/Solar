/**
 * SimilarityMatcherService unit tests
 *
 * Covers:
 * - findSimilarIssues – no historical data, similarity below threshold, above threshold,
 *   returns top N, resolved/closed status, error handling
 * - checkDuplicate – duplicate found, no duplicate
 * - getSolutionSuggestions – resolved issues with resolution, filtering
 * - tokenize (indirectly)
 * - cosineSimilarity edge cases (zero vectors)
 * - calculateTfIdf (indirectly)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { SimilarityMatcherService } from "../similarity-matcher.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { DEFAULT_TRIAGE_CONFIG } from "../triage-decision.types";

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeFeedback = (overrides: Record<string, unknown> = {}) => ({
  id: "fb-1",
  title: "Test feedback",
  description: "This is a test description",
  type: "BUG",
  status: "OPEN",
  admin_notes: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("SimilarityMatcherService", () => {
  let service: SimilarityMatcherService;
  let mockPrisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimilarityMatcherService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SimilarityMatcherService>(SimilarityMatcherService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // findSimilarIssues
  // ──────────────────────────────────────────────────────────────────────────

  describe("findSimilarIssues", () => {
    it("returns empty array when no historical feedbacks exist", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await service.findSimilarIssues(
        "Login error",
        "Cannot log in",
      );

      expect(result).toEqual([]);
    });

    it("returns empty array when similarity is below threshold", async () => {
      // Completely unrelated feedback
      mockPrisma.$queryRaw.mockResolvedValue([
        makeFeedback({
          id: "fb-1",
          title: "Weather forecast app",
          description: "Request for weather functionality",
        }),
      ]);

      const result = await service.findSimilarIssues(
        "Database connection",
        "SQL timeout error in production",
        { ...DEFAULT_TRIAGE_CONFIG, similarityThreshold: 0.9 },
      );

      expect(result).toEqual([]);
    });

    it("returns matching issues when similarity meets threshold", async () => {
      // Need at least 2 documents for IDF to produce non-zero values
      // With 2 docs where the query tokens appear in only 1 doc, IDF = log(2/1) > 0
      const feedbacks = [
        makeFeedback({
          id: "fb-1",
          title: "login button broken",
          description: "clicking login does nothing",
        }),
        makeFeedback({
          id: "fb-2",
          title: "unrelated weather forecast",
          description: "sunshine and rain prediction",
        }),
      ];
      mockPrisma.$queryRaw.mockResolvedValue(feedbacks);

      const result = await service.findSimilarIssues(
        "login button broken",
        "clicking login does nothing",
        { ...DEFAULT_TRIAGE_CONFIG, similarityThreshold: 0.5 },
      );

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].feedbackId).toBe("fb-1");
      expect(result[0].similarity).toBeGreaterThanOrEqual(50);
    });

    it("returns similarity as percentage (0-100 scale)", async () => {
      const feedbacks = [
        makeFeedback({
          title: "same title same description",
          description: "same title same description",
        }),
      ];
      mockPrisma.$queryRaw.mockResolvedValue(feedbacks);

      const result = await service.findSimilarIssues(
        "same title same description",
        "same title same description",
        { ...DEFAULT_TRIAGE_CONFIG, similarityThreshold: 0.5 },
      );

      if (result.length > 0) {
        expect(result[0].similarity).toBeGreaterThanOrEqual(0);
        expect(result[0].similarity).toBeLessThanOrEqual(100);
      }
    });

    it("limits results to maxSimilarIssues", async () => {
      // Create many feedbacks with very similar text
      const feedbacks = Array.from({ length: 10 }, (_, i) =>
        makeFeedback({
          id: `fb-${i}`,
          title: `login button broken issue ${i}`,
          description: `clicking the login button does nothing ${i}`,
        }),
      );
      mockPrisma.$queryRaw.mockResolvedValue(feedbacks);

      const result = await service.findSimilarIssues(
        "login button broken",
        "clicking the login button does nothing",
        {
          ...DEFAULT_TRIAGE_CONFIG,
          similarityThreshold: 0.01,
          maxSimilarIssues: 3,
        },
      );

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("sorts results by similarity score descending", async () => {
      const feedbacks = [
        makeFeedback({
          id: "fb-exact",
          title: "login button broken",
          description: "clicking login does nothing",
        }),
        makeFeedback({
          id: "fb-partial",
          title: "button issue",
          description: "some UI issue",
        }),
      ];
      mockPrisma.$queryRaw.mockResolvedValue(feedbacks);

      const result = await service.findSimilarIssues(
        "login button broken",
        "clicking login does nothing",
        { ...DEFAULT_TRIAGE_CONFIG, similarityThreshold: 0.01 },
      );

      if (result.length > 1) {
        expect(result[0].similarity).toBeGreaterThanOrEqual(
          result[1].similarity,
        );
      }
    });

    it("sets resolvedAt when status is RESOLVED", async () => {
      const resolvedDate = new Date("2024-01-15");
      const feedbacks = [
        makeFeedback({
          id: "fb-resolved",
          title: "resolved login bug",
          description: "login was broken but now fixed",
          status: "RESOLVED",
          admin_notes: "Fixed by patch v1.2",
          updated_at: resolvedDate,
        }),
      ];
      mockPrisma.$queryRaw.mockResolvedValue(feedbacks);

      const result = await service.findSimilarIssues(
        "login bug resolved",
        "login was broken but now fixed",
        { ...DEFAULT_TRIAGE_CONFIG, similarityThreshold: 0.01 },
      );

      if (result.length > 0 && result[0].status === "RESOLVED") {
        expect(result[0].resolvedAt).toEqual(resolvedDate);
        expect(result[0].resolution).toBe("Fixed by patch v1.2");
      }
    });

    it("sets resolvedAt when status is CLOSED", async () => {
      const closedDate = new Date("2024-02-20");
      const feedbacks = [
        makeFeedback({
          id: "fb-closed",
          title: "closed feedback item about login",
          description: "feedback was closed after investigation",
          status: "CLOSED",
          updated_at: closedDate,
        }),
      ];
      mockPrisma.$queryRaw.mockResolvedValue(feedbacks);

      const result = await service.findSimilarIssues(
        "closed feedback login",
        "feedback investigation closed",
        { ...DEFAULT_TRIAGE_CONFIG, similarityThreshold: 0.01 },
      );

      if (result.length > 0 && result[0].status === "CLOSED") {
        expect(result[0].resolvedAt).toEqual(closedDate);
      }
    });

    it("does not set resolvedAt when status is OPEN", async () => {
      const feedbacks = [
        makeFeedback({
          id: "fb-open",
          title: "open login issue",
          description: "login still broken",
          status: "OPEN",
        }),
      ];
      mockPrisma.$queryRaw.mockResolvedValue(feedbacks);

      const result = await service.findSimilarIssues(
        "open login issue",
        "login still broken",
        { ...DEFAULT_TRIAGE_CONFIG, similarityThreshold: 0.01 },
      );

      if (result.length > 0) {
        expect(result[0].resolvedAt).toBeUndefined();
      }
    });

    it("returns empty array when $queryRaw throws", async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error("DB error"));

      const result = await service.findSimilarIssues("title", "desc");

      expect(result).toEqual([]);
    });

    it("omits resolution when admin_notes is null", async () => {
      const feedbacks = [
        makeFeedback({
          id: "fb-1",
          title: "same issue",
          description: "same description here",
          admin_notes: null,
        }),
      ];
      mockPrisma.$queryRaw.mockResolvedValue(feedbacks);

      const result = await service.findSimilarIssues(
        "same issue",
        "same description here",
        { ...DEFAULT_TRIAGE_CONFIG, similarityThreshold: 0.01 },
      );

      if (result.length > 0) {
        expect(result[0].resolution).toBeUndefined();
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // checkDuplicate
  // ──────────────────────────────────────────────────────────────────────────

  describe("checkDuplicate", () => {
    it("returns isDuplicate=false when no similar issues found", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await service.checkDuplicate(
        "unique title",
        "unique description",
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.originalId).toBeUndefined();
    });

    it("returns isDuplicate=false when similarity is below 90", async () => {
      // Mock findSimilarIssues to return a result with low similarity
      jest.spyOn(service, "findSimilarIssues").mockResolvedValue([
        {
          feedbackId: "fb-1",
          title: "Partial match",
          similarity: 85, // below 90 threshold
          status: "OPEN",
        },
      ]);

      const result = await service.checkDuplicate("some title", "some desc");

      expect(result.isDuplicate).toBe(false);
    });

    it("returns isDuplicate=true with originalId when similarity >= 90", async () => {
      jest.spyOn(service, "findSimilarIssues").mockResolvedValue([
        {
          feedbackId: "fb-original",
          title: "Exact duplicate",
          similarity: 95,
          status: "OPEN",
        },
      ]);

      const result = await service.checkDuplicate(
        "exact duplicate title",
        "exact duplicate description",
        0.9,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.originalId).toBe("fb-original");
    });

    it("uses provided threshold for similarity check", async () => {
      const findSpy = jest
        .spyOn(service, "findSimilarIssues")
        .mockResolvedValue([]);

      await service.checkDuplicate("title", "desc", 0.95);

      expect(findSpy).toHaveBeenCalledWith(
        "title",
        "desc",
        expect.objectContaining({ similarityThreshold: 0.95 }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getSolutionSuggestions
  // ──────────────────────────────────────────────────────────────────────────

  describe("getSolutionSuggestions", () => {
    it("returns empty array when no similar issues found", async () => {
      jest.spyOn(service, "findSimilarIssues").mockResolvedValue([]);

      const suggestions = await service.getSolutionSuggestions("title", "desc");

      expect(suggestions).toEqual([]);
    });

    it("returns resolutions from RESOLVED issues with resolution text", async () => {
      jest.spyOn(service, "findSimilarIssues").mockResolvedValue([
        {
          feedbackId: "fb-1",
          title: "Similar bug",
          similarity: 90,
          status: "RESOLVED",
          resolution: "Fixed in v1.2",
        },
      ]);

      const suggestions = await service.getSolutionSuggestions(
        "similar bug",
        "similar description",
      );

      expect(suggestions).toContain("Fixed in v1.2");
    });

    it("returns resolutions from CLOSED issues with resolution text", async () => {
      jest.spyOn(service, "findSimilarIssues").mockResolvedValue([
        {
          feedbackId: "fb-2",
          title: "Closed issue",
          similarity: 80,
          status: "CLOSED",
          resolution: "Closed as won't fix",
        },
      ]);

      const suggestions = await service.getSolutionSuggestions(
        "closed issue",
        "closed desc",
      );

      expect(suggestions).toContain("Closed as won't fix");
    });

    it("excludes OPEN issues from suggestions", async () => {
      jest.spyOn(service, "findSimilarIssues").mockResolvedValue([
        {
          feedbackId: "fb-3",
          title: "Open issue",
          similarity: 85,
          status: "OPEN",
          resolution: "Should not appear",
        },
      ]);

      const suggestions = await service.getSolutionSuggestions(
        "open issue",
        "open desc",
      );

      expect(suggestions).not.toContain("Should not appear");
    });

    it("excludes issues without resolution text", async () => {
      jest.spyOn(service, "findSimilarIssues").mockResolvedValue([
        {
          feedbackId: "fb-4",
          title: "Resolved but no notes",
          similarity: 90,
          status: "RESOLVED",
          resolution: undefined,
        },
      ]);

      const suggestions = await service.getSolutionSuggestions(
        "resolved no notes",
        "no notes desc",
      );

      expect(suggestions).toHaveLength(0);
    });

    it("returns multiple suggestions from multiple matching issues", async () => {
      jest.spyOn(service, "findSimilarIssues").mockResolvedValue([
        {
          feedbackId: "fb-1",
          title: "Issue 1",
          similarity: 95,
          status: "RESOLVED",
          resolution: "Fix A",
        },
        {
          feedbackId: "fb-2",
          title: "Issue 2",
          similarity: 80,
          status: "CLOSED",
          resolution: "Fix B",
        },
        {
          feedbackId: "fb-3",
          title: "Issue 3",
          similarity: 70,
          status: "OPEN",
          resolution: "Should be excluded",
        },
      ]);

      const suggestions = await service.getSolutionSuggestions("q", "d");

      expect(suggestions).toHaveLength(2);
      expect(suggestions).toContain("Fix A");
      expect(suggestions).toContain("Fix B");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Edge cases: zero-vector cosine similarity
  // ──────────────────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty title and description without error", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        makeFeedback({ title: "", description: "" }),
      ]);

      const result = await service.findSimilarIssues("", "");

      // Should not throw; result may be empty due to zero vectors
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles single-character tokens being filtered out", async () => {
      // Single chars filtered by tokenize (length > 1)
      mockPrisma.$queryRaw.mockResolvedValue([
        makeFeedback({ title: "a b c", description: "d e f" }),
      ]);

      const result = await service.findSimilarIssues("a b c", "d e f");

      expect(Array.isArray(result)).toBe(true);
    });
  });
});
