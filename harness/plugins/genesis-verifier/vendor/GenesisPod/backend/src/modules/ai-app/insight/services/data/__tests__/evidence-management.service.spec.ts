import { Test, TestingModule } from "@nestjs/testing";
import { EvidenceManagementService } from "../evidence-management.service";
import { PrismaService } from "@/common/prisma/prisma.service";

const mockPrisma = {
  topicEvidence: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe("EvidenceManagementService", () => {
  let service: EvidenceManagementService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceManagementService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<EvidenceManagementService>(EvidenceManagementService);
  });

  // ============================================================
  // listEvidence
  // ============================================================

  describe("listEvidence", () => {
    it("should return evidence list and total count", async () => {
      const mockEvidences = [
        { id: "e1", reportId: "r1", citationIndex: 1 },
        { id: "e2", reportId: "r1", citationIndex: 2 },
      ];
      mockPrisma.topicEvidence.findMany.mockResolvedValue(mockEvidences);
      mockPrisma.topicEvidence.count.mockResolvedValue(2);

      const result = await service.listEvidence("r1");

      expect(result.evidences).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(mockPrisma.topicEvidence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reportId: "r1" },
          orderBy: { citationIndex: "asc" },
        }),
      );
    });

    it("should filter by sourceType when provided", async () => {
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);
      mockPrisma.topicEvidence.count.mockResolvedValue(0);

      await service.listEvidence("r1", { sourceType: "academic" });

      expect(mockPrisma.topicEvidence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reportId: "r1", sourceType: "academic" },
        }),
      );
    });

    it("should filter by minCredibility when provided", async () => {
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);
      mockPrisma.topicEvidence.count.mockResolvedValue(0);

      await service.listEvidence("r1", { minCredibility: 70 });

      expect(mockPrisma.topicEvidence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reportId: "r1", credibilityScore: { gte: 70 } },
        }),
      );
    });

    it("should apply pagination options", async () => {
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);
      mockPrisma.topicEvidence.count.mockResolvedValue(0);

      await service.listEvidence("r1", { skip: 10, take: 20 });

      expect(mockPrisma.topicEvidence.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 20 }),
      );
    });
  });

  // ============================================================
  // getEvidence
  // ============================================================

  describe("getEvidence", () => {
    it("should return evidence by id", async () => {
      const mockEvidence = { id: "e1", url: "https://example.com" };
      mockPrisma.topicEvidence.findUnique.mockResolvedValue(mockEvidence);

      const result = await service.getEvidence("e1");

      expect(result).toEqual(mockEvidence);
      expect(mockPrisma.topicEvidence.findUnique).toHaveBeenCalledWith({
        where: { id: "e1" },
      });
    });

    it("should return null when evidence not found", async () => {
      mockPrisma.topicEvidence.findUnique.mockResolvedValue(null);

      const result = await service.getEvidence("nonexistent");

      expect(result).toBeNull();
    });
  });

  // ============================================================
  // getEvidenceForAnalysis
  // ============================================================

  describe("getEvidenceForAnalysis", () => {
    it("should return evidences for a given analysis", async () => {
      const mockEvidences = [{ id: "e1", analysisId: "a1" }];
      mockPrisma.topicEvidence.findMany.mockResolvedValue(mockEvidences);

      const result = await service.getEvidenceForAnalysis("a1");

      expect(result).toEqual(mockEvidences);
      expect(mockPrisma.topicEvidence.findMany).toHaveBeenCalledWith({
        where: { analysisId: "a1" },
        orderBy: { citationIndex: "asc" },
      });
    });
  });

  // ============================================================
  // updateCredibilityScore
  // ============================================================

  describe("updateCredibilityScore", () => {
    it("should update credibility score and clamp to 0-100", async () => {
      const updated = { id: "e1", credibilityScore: 85 };
      mockPrisma.topicEvidence.update.mockResolvedValue(updated);

      const result = await service.updateCredibilityScore("e1", 85);

      expect(result).toEqual(updated);
      expect(mockPrisma.topicEvidence.update).toHaveBeenCalledWith({
        where: { id: "e1" },
        data: { credibilityScore: 85 },
      });
    });

    it("should clamp score above 100 to 100", async () => {
      mockPrisma.topicEvidence.update.mockResolvedValue({
        id: "e1",
        credibilityScore: 100,
      });

      await service.updateCredibilityScore("e1", 150);

      expect(mockPrisma.topicEvidence.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { credibilityScore: 100 },
        }),
      );
    });

    it("should clamp score below 0 to 0", async () => {
      mockPrisma.topicEvidence.update.mockResolvedValue({
        id: "e1",
        credibilityScore: 0,
      });

      await service.updateCredibilityScore("e1", -10);

      expect(mockPrisma.topicEvidence.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { credibilityScore: 0 },
        }),
      );
    });
  });

  // ============================================================
  // reindexCitations
  // ============================================================

  describe("reindexCitations", () => {
    it("should reindex citations and update indices", async () => {
      const evidences = [{ id: "e1" }, { id: "e2" }, { id: "e3" }];
      mockPrisma.topicEvidence.findMany.mockResolvedValue(evidences);
      mockPrisma.$transaction.mockImplementation(async (ops: any[]) => {
        for (const op of ops) await op;
      });
      mockPrisma.topicEvidence.update.mockResolvedValue({});

      await service.reindexCitations("r1");

      expect(mockPrisma.topicEvidence.update).toHaveBeenCalledTimes(3);
      expect(mockPrisma.topicEvidence.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { citationIndex: 1 } }),
      );
      expect(mockPrisma.topicEvidence.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { citationIndex: 3 } }),
      );
    });
  });

  // ============================================================
  // isDuplicateUrl
  // ============================================================

  describe("isDuplicateUrl", () => {
    it("should return true when URL already exists", async () => {
      mockPrisma.topicEvidence.findFirst.mockResolvedValue({ id: "e1" });

      const result = await service.isDuplicateUrl(
        "r1",
        "https://example.com/article",
      );

      expect(result).toBe(true);
    });

    it("should return false when URL does not exist", async () => {
      mockPrisma.topicEvidence.findFirst.mockResolvedValue(null);

      const result = await service.isDuplicateUrl(
        "r1",
        "https://new.com/article",
      );

      expect(result).toBe(false);
    });

    it("should strip UTM parameters before checking", async () => {
      mockPrisma.topicEvidence.findFirst.mockResolvedValue(null);

      await service.isDuplicateUrl(
        "r1",
        "https://example.com?utm_source=twitter&utm_medium=social",
      );

      expect(mockPrisma.topicEvidence.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            url: expect.objectContaining({
              contains: expect.not.stringContaining("utm_source"),
            }),
          }),
        }),
      );
    });
  });

  // ============================================================
  // getEvidenceStats
  // ============================================================

  describe("getEvidenceStats", () => {
    it("should calculate stats correctly", async () => {
      const _recentDate = new Date();
      const _oldDate = new Date("2020-01-01");

      mockPrisma.topicEvidence.findMany.mockResolvedValue([
        { sourceType: "web", credibilityScore: 80 },
        { sourceType: "academic", credibilityScore: 90 },
        { sourceType: "web", credibilityScore: 30 },
        { sourceType: "academic", credibilityScore: 55 },
        { sourceType: null, credibilityScore: null },
      ]);

      const stats = await service.getEvidenceStats("r1");

      expect(stats.total).toBe(5);
      expect(stats.bySourceType["web"]).toBe(2);
      expect(stats.bySourceType["academic"]).toBe(2);
      expect(stats.bySourceType["unknown"]).toBe(1);
      expect(stats.byCredibility.high).toBe(2); // scores 80, 90
      expect(stats.byCredibility.medium).toBe(1); // score 55
      expect(stats.byCredibility.low).toBe(1); // score 30
      expect(stats.avgCredibility).toBe(Math.round((80 + 90 + 30 + 55) / 4));
    });

    it("should return zero avgCredibility when no evidences have scores", async () => {
      mockPrisma.topicEvidence.findMany.mockResolvedValue([
        { sourceType: "web", credibilityScore: null },
      ]);

      const stats = await service.getEvidenceStats("r1");

      expect(stats.avgCredibility).toBe(0);
    });
  });

  // ============================================================
  // cleanupOrphanedEvidence
  // ============================================================

  describe("cleanupOrphanedEvidence", () => {
    it("should delete orphaned evidence and return count", async () => {
      mockPrisma.topicEvidence.deleteMany.mockResolvedValue({ count: 3 });

      const count = await service.cleanupOrphanedEvidence();

      expect(count).toBe(3);
      expect(mockPrisma.topicEvidence.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ analysisId: null }),
        }),
      );
    });

    it("should return 0 when no orphaned evidence found", async () => {
      mockPrisma.topicEvidence.deleteMany.mockResolvedValue({ count: 0 });

      const count = await service.cleanupOrphanedEvidence();

      expect(count).toBe(0);
    });
  });

  // ============================================================
  // recalculateCredibilityScores
  // ============================================================

  describe("recalculateCredibilityScores", () => {
    it("should return zeros when no evidences found", async () => {
      mockPrisma.topicEvidence.findMany.mockResolvedValue([]);

      const result = await service.recalculateCredibilityScores("r1");

      expect(result.updated).toBe(0);
      expect(result.avgScore).toBe(0);
    });

    it("should recalculate and update scores for all evidences", async () => {
      const evidences = [
        {
          id: "e1",
          url: "https://arxiv.org/paper",
          domain: "arxiv.org",
          sourceType: "academic",
          snippet: "X".repeat(600),
          publishedAt: new Date(),
        },
        {
          id: "e2",
          url: "https://nytimes.com/article",
          domain: null,
          sourceType: "news",
          snippet: "Y".repeat(300),
          publishedAt: null,
        },
      ];
      mockPrisma.topicEvidence.findMany.mockResolvedValue(evidences);
      mockPrisma.$transaction.mockImplementation(async (ops: any[]) => {
        for (const op of ops) await op;
      });
      mockPrisma.topicEvidence.update.mockResolvedValue({});

      const result = await service.recalculateCredibilityScores("r1");

      expect(result.updated).toBe(2);
      expect(result.avgScore).toBeGreaterThan(0);
      expect(mockPrisma.topicEvidence.update).toHaveBeenCalledTimes(2);
    });
  });
});
