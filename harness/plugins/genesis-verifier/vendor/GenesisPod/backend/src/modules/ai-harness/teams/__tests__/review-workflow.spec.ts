/**
 * ReviewWorkflowService structural tests
 *
 * Strategy: ReviewWorkflowService has a Phase-4.1 guard (isModelAvailable())
 * that returns a safe default when the Review Prisma model is absent.
 * We exploit that guard to test the service without a real database.
 *
 * Goals:
 *   1. Service instantiates (with mocked Prisma) without throwing.
 *   2. IReviewWorkflow structural contract is satisfied.
 *   3. createReview() returns an empty-review placeholder (model unavailable path).
 *   4. getReview() returns null (model unavailable path).
 *   5. getReviewsForEntity() returns [] (model unavailable path).
 *   6. getPendingReviews() returns [] (model unavailable path).
 *   7. getStats() returns zero-counts (model unavailable path).
 *   8. Operations that require an existing record throw NotFoundException
 *      (model unavailable path).
 */

import { NotFoundException } from "@nestjs/common";
import { ReviewWorkflowService } from "../collaboration/review/review-workflow.service";
import type {
  IReviewWorkflow,
  ReviewRequest,
} from "../collaboration/review/review.interface";

// Suppress Logger noise
jest.mock("@nestjs/common", () => {
  const actual = jest.requireActual("@nestjs/common");
  return {
    ...actual,
    Logger: jest.fn().mockImplementation(() => ({
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    })),
  };
});

function makePrismaStub() {
  return {
    // No "review" key → isModelAvailable() returns false
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
}

function makeEventEmitterStub() {
  return { emit: jest.fn() };
}

function makeReviewRequest(): ReviewRequest {
  return {
    entityType: "report",
    entityId: "entity-1",
    requesterId: "user-1",
    criteria: ["accuracy", "completeness"],
    priority: "medium",
  };
}

describe("ReviewWorkflowService (model-unavailable path)", () => {
  let svc: ReviewWorkflowService;

  beforeEach(() => {
    svc = new ReviewWorkflowService(
      makePrismaStub() as never,
      makeEventEmitterStub() as never,
    );
  });

  it("instantiates without throwing", () => {
    expect(svc).toBeInstanceOf(ReviewWorkflowService);
  });

  it("satisfies IReviewWorkflow structural contract", () => {
    const typed: IReviewWorkflow = svc;
    expect(typeof typed.createReview).toBe("function");
    expect(typeof typed.assignReviewer).toBe("function");
    expect(typeof typed.startReview).toBe("function");
    expect(typeof typed.submitFeedback).toBe("function");
    expect(typeof typed.updateStatus).toBe("function");
    expect(typeof typed.getReview).toBe("function");
    expect(typeof typed.getReviewsForEntity).toBe("function");
    expect(typeof typed.getPendingReviews).toBe("function");
    expect(typeof typed.getStats).toBe("function");
    expect(typeof typed.cancelReview).toBe("function");
    expect(typeof typed.reopenReview).toBe("function");
  });

  it("createReview() returns an empty Review placeholder (id is empty string)", async () => {
    const review = await svc.createReview(makeReviewRequest());
    expect(review).toBeDefined();
    // Phase 4.1 placeholder: id is ""
    expect(review.id).toBe("");
    expect(review.status).toBe("pending");
    expect(review.timeline).toEqual([]);
    expect(review.version).toBe(0);
  });

  it("getReview() returns null when model is unavailable", async () => {
    const result = await svc.getReview("any-id");
    expect(result).toBeNull();
  });

  it("getReviewsForEntity() returns empty array when model is unavailable", async () => {
    const results = await svc.getReviewsForEntity("report", "entity-1");
    expect(results).toEqual([]);
  });

  it("getPendingReviews() returns empty array when model is unavailable", async () => {
    const results = await svc.getPendingReviews("reviewer-1");
    expect(results).toEqual([]);
  });

  it("getStats() returns all-zero counts when model is unavailable", async () => {
    const stats = await svc.getStats();
    expect(stats.totalReviews).toBe(0);
    expect(stats.pendingCount).toBe(0);
    expect(stats.inProgressCount).toBe(0);
    expect(stats.completedCount).toBe(0);
    expect(stats.avgCompletionTime).toBe(0);
    expect(stats.avgRating).toBe(0);
  });

  it("assignReviewer() throws NotFoundException when model is unavailable", async () => {
    await expect(
      svc.assignReviewer("review-1", "reviewer-1", "admin"),
    ).rejects.toThrow(NotFoundException);
  });

  it("startReview() throws NotFoundException when model is unavailable", async () => {
    await expect(svc.startReview("review-1", "reviewer-1")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("cancelReview() throws NotFoundException when model is unavailable", async () => {
    await expect(svc.cancelReview("review-1", "admin")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("reopenReview() throws NotFoundException when model is unavailable", async () => {
    await expect(svc.reopenReview("review-1", "admin")).rejects.toThrow(
      NotFoundException,
    );
  });
});
