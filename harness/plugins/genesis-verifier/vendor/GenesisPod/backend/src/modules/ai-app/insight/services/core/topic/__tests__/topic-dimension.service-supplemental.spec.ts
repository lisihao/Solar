/**
 * TopicDimensionService — Supplemental Tests
 *
 * Covers uncovered branches:
 * - getDefaultDimensionsByType: EVENT case (line 279)
 * - checkTopicAccess: creator short-circuit (line 351)
 * - checkTopicAccess: empty SQL result → false (line 371)
 * - checkTopicAccess: visibility=PUBLIC → true (line 378)
 * - checkTopicAccess: visibility=SHARED + is_collaborator=true → true (line 383)
 * - checkTopicAccess: visibility=SHARED + is_collaborator=false → false
 * - checkTopicAccess: visibility=PRIVATE → false
 * - verifyTopicReadAccess: non-owner without access → ForbiddenException
 * - verifyTopicReadAccess: non-owner with PUBLIC access → OK (no throw)
 * - getTemplates: EVENT type returns EVENT_INSIGHT_REFERENCE_DIMENSIONS
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TopicDimensionService } from "../topic-dimension.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ForbiddenException } from "@nestjs/common";
import { ResearchTopicType } from "@prisma/client";

// ─── Mock factory ─────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchTopic: {
      findUnique: jest.fn(),
    },
    topicDimension: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(async (ops: unknown) => {
      if (Array.isArray(ops)) {
        return Promise.all(ops);
      }
      return (ops as (tx: unknown) => Promise<unknown>)(mockPrisma);
    }),
    $queryRaw: jest.fn(),
  };
  return { mockPrisma };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TopicDimensionService — supplemental", () => {
  let service: TopicDimensionService;
  let prisma: ReturnType<typeof buildMocks>["mockPrisma"];

  beforeEach(async () => {
    const mocks = buildMocks();
    prisma = mocks.mockPrisma;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicDimensionService,
        { provide: PrismaService, useValue: mocks.mockPrisma },
      ],
    }).compile();

    service = module.get<TopicDimensionService>(TopicDimensionService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── getTemplates: EVENT type ──────────────────────────────────────────────

  describe("getTemplates — EVENT type", () => {
    it("should return EVENT templates for ResearchTopicType.EVENT", async () => {
      const result = await service.getTemplates({
        type: ResearchTopicType.EVENT,
      } as never);

      expect(result.type).toBe(ResearchTopicType.EVENT);
      expect(Array.isArray(result.dimensions)).toBe(true);
      // EVENT_INSIGHT_REFERENCE_DIMENSIONS is non-empty
      expect(result.dimensions.length).toBeGreaterThan(0);
    });
  });

  // ─── checkTopicAccess: via listDimensions (calls verifyTopicReadAccess) ────

  describe("verifyTopicReadAccess — non-owner paths", () => {
    it("throws ForbiddenException for non-owner when checkTopicAccess returns false (PRIVATE)", async () => {
      // findUnique returns topic owned by someone else
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "owner-1" });

      // $queryRaw returns PRIVATE, is_collaborator=false
      prisma.$queryRaw.mockResolvedValue([
        { visibility: "PRIVATE", is_collaborator: false },
      ]);

      await expect(
        service.listDimensions("other-user", "topic-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ForbiddenException for non-owner when checkTopicAccess returns false (SHARED, not collaborator)", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "owner-1" });
      prisma.$queryRaw.mockResolvedValue([
        { visibility: "SHARED", is_collaborator: false },
      ]);

      await expect(
        service.listDimensions("other-user", "topic-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("does NOT throw for non-owner when visibility=PUBLIC", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "owner-1" });
      prisma.$queryRaw.mockResolvedValue([
        { visibility: "PUBLIC", is_collaborator: false },
      ]);
      prisma.topicDimension.findMany.mockResolvedValue([]);

      await expect(
        service.listDimensions("other-user", "topic-1"),
      ).resolves.toEqual([]);
    });

    it("does NOT throw for non-owner when visibility=SHARED and user is a collaborator", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "owner-1" });
      prisma.$queryRaw.mockResolvedValue([
        { visibility: "SHARED", is_collaborator: true },
      ]);
      prisma.topicDimension.findMany.mockResolvedValue([]);

      await expect(
        service.listDimensions("other-user", "topic-1"),
      ).resolves.toEqual([]);
    });

    it("throws ForbiddenException when $queryRaw returns empty result (topic gone)", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "owner-1" });
      // Empty array → checkTopicAccess returns false
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.listDimensions("other-user", "topic-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("does NOT call $queryRaw when user is the owner (creator short-circuit)", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-1" });
      prisma.topicDimension.findMany.mockResolvedValue([]);

      await service.listDimensions("user-1", "topic-1");

      // $queryRaw should never be called when creator accesses their own topic
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
