/**
 * Unit tests for SourceSubscriptionService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SourceSubscriptionService } from "../source-subscription.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

describe("SourceSubscriptionService", () => {
  let service: SourceSubscriptionService;
  let mockPrisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    mockPrisma = {
      $executeRaw: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SourceSubscriptionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SourceSubscriptionService>(SourceSubscriptionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should mark missions as stale when topic report is refreshed", async () => {
    (mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(3);

    const event = {
      topicId: "topic-abc-123",
      reportId: "report-xyz-456",
      refreshedAt: new Date(),
    };

    await service.handleTopicReportRefreshed(event);

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("should handle zero missions updated gracefully", async () => {
    (mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(0);

    const event = {
      topicId: "topic-no-subscribers",
      reportId: "report-001",
      refreshedAt: new Date(),
    };

    // Should not throw
    await expect(
      service.handleTopicReportRefreshed(event),
    ).resolves.not.toThrow();
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("should catch and log errors when database query fails", async () => {
    (mockPrisma.$executeRaw as jest.Mock).mockRejectedValue(
      new Error("DB connection lost"),
    );

    const event = {
      topicId: "topic-db-error",
      reportId: "report-002",
      refreshedAt: new Date(),
    };

    // Should not re-throw - error is caught and logged
    await expect(
      service.handleTopicReportRefreshed(event),
    ).resolves.not.toThrow();
  });

  it("should execute raw SQL with correct topicId parameter", async () => {
    (mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(2);

    const event = {
      topicId: "specific-topic-id",
      reportId: "report-test",
      refreshedAt: new Date("2024-01-15"),
    };

    await service.handleTopicReportRefreshed(event);

    // Verify the raw query was called (template literal contains the topicId)
    const call = (mockPrisma.$executeRaw as jest.Mock).mock.calls[0];
    expect(call).toBeDefined();
    // The tagged template includes 'specific-topic-id' as an interpolated value
    const sqlArgs = call.slice(1); // after the TemplateStringsArray
    expect(sqlArgs).toContain("specific-topic-id");
  });

  it("should update isStale to true in source_subscription JSON field", async () => {
    (mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(5);

    const event = {
      topicId: "topic-large-scale",
      reportId: "report-large",
      refreshedAt: new Date(),
    };

    await service.handleTopicReportRefreshed(event);

    // SQL should be called once with the correct shape
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    const rawCall = (mockPrisma.$executeRaw as jest.Mock).mock.calls[0];
    // The TemplateStringsArray is the first arg
    const sqlParts = rawCall[0];
    const joinedSql = sqlParts.join("?");
    expect(joinedSql).toContain("isStale");
    expect(joinedSql).toContain("slides_missions");
  });

  it("should handle multiple rapid calls independently", async () => {
    (mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(1);

    const events = [
      { topicId: "topic-1", reportId: "report-1", refreshedAt: new Date() },
      { topicId: "topic-2", reportId: "report-2", refreshedAt: new Date() },
      { topicId: "topic-3", reportId: "report-3", refreshedAt: new Date() },
    ];

    await Promise.all(events.map((e) => service.handleTopicReportRefreshed(e)));

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(3);
  });
});
