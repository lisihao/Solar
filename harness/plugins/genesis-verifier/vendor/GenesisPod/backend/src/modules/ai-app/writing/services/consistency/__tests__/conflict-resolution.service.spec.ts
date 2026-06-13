import { Test, TestingModule } from "@nestjs/testing";
import { ConflictResolutionService } from "../conflict-resolution.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ConsistencyIssue } from "../post-write-validation.service";

describe("ConflictResolutionService", () => {
  let service: ConflictResolutionService;
  let mockPrisma: jest.Mocked<PrismaService>;

  const makeIssue = (
    severity: "CRITICAL" | "WARNING" | "INFO",
    suggestion?: string,
  ): ConsistencyIssue => ({
    type: "CHARACTER",
    severity,
    location: "Chapter 1",
    description: `Test ${severity} issue`,
    suggestion,
  });

  beforeEach(async () => {
    mockPrisma = {
      consistencyCheck: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConflictResolutionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ConflictResolutionService>(ConflictResolutionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("resolve", () => {
    it("should auto-resolve INFO severity issues", async () => {
      const issues = [makeIssue("INFO")];
      const result = await service.resolve("chapter-1", issues);

      expect(result.resolved).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.details[0].action).toBe("auto-resolved");
    });

    it("should auto-resolve WARNING issues that have a suggestion", async () => {
      const issues = [makeIssue("WARNING", "Use consistent spelling")];
      const result = await service.resolve("chapter-1", issues);

      expect(result.resolved).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.details[0].action).toBe("auto-resolved with suggestion");
    });

    it("should NOT auto-resolve WARNING issues without suggestion", async () => {
      const issues = [makeIssue("WARNING")];
      const result = await service.resolve("chapter-1", issues);

      expect(result.resolved).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.details[0].action).toBe("requires manual review");
    });

    it("should NOT auto-resolve CRITICAL issues", async () => {
      const issues = [makeIssue("CRITICAL", "Fix character death")];
      const result = await service.resolve("chapter-1", issues);

      expect(result.resolved).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.details[0].action).toBe("requires manual resolution");
    });

    it("should handle mixed severity issues", async () => {
      const issues = [
        makeIssue("INFO"),
        makeIssue("WARNING", "Fix it"),
        makeIssue("WARNING"),
        makeIssue("CRITICAL"),
      ];
      const result = await service.resolve("chapter-1", issues);

      expect(result.resolved).toBe(2);
      expect(result.failed).toBe(2);
      expect(result.details).toHaveLength(4);
    });

    it("should update consistency check status to RESOLVED", async () => {
      const issues = [makeIssue("INFO")];
      await service.resolve("chapter-1", issues);

      expect(mockPrisma.consistencyCheck.updateMany).toHaveBeenCalledWith({
        where: { chapterId: "chapter-1", status: "ISSUES_FOUND" },
        data: {
          status: "RESOLVED",
          resolvedAt: expect.any(Date),
        },
      });
    });

    it("should return empty arrays when no issues provided", async () => {
      const result = await service.resolve("chapter-1", []);

      expect(result.resolved).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.details).toEqual([]);
    });

    it("should include the original issue in each result detail", async () => {
      const issue = makeIssue("INFO");
      const result = await service.resolve("chapter-1", [issue]);

      expect(result.details[0].issue).toEqual(issue);
    });

    it("should process all issues in order", async () => {
      const issues = [
        makeIssue("INFO"),
        makeIssue("WARNING", "Suggestion"),
        makeIssue("CRITICAL"),
      ];
      const result = await service.resolve("chapter-1", issues);

      expect(result.details[0].resolved).toBe(true);
      expect(result.details[1].resolved).toBe(true);
      expect(result.details[2].resolved).toBe(false);
    });
  });

  describe("markResolved", () => {
    it("should update consistency check to RESOLVED status", async () => {
      const mockCheck = {
        id: "check-1",
        status: "RESOLVED",
        resolvedAt: new Date(),
      };
      (mockPrisma.consistencyCheck.update as jest.Mock).mockResolvedValue(
        mockCheck,
      );

      const result = await service.markResolved("check-1");

      expect(mockPrisma.consistencyCheck.update).toHaveBeenCalledWith({
        where: { id: "check-1" },
        data: {
          status: "RESOLVED",
          resolvedAt: expect.any(Date),
        },
      });
      expect(result).toEqual(mockCheck);
    });

    it("should propagate errors from prisma", async () => {
      (mockPrisma.consistencyCheck.update as jest.Mock).mockRejectedValue(
        new Error("Record not found"),
      );

      await expect(service.markResolved("nonexistent-id")).rejects.toThrow(
        "Record not found",
      );
    });
  });
});
