import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { DataIntegrityValidatorService } from "../data-integrity-validator.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";

// ============================================================================
// Helpers
// ============================================================================

function makePrismaMock() {
  return {
    resource: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };
}

/**
 * Builds a mock RawDataCollection that satisfies the interface expected by
 * DataIntegrityValidatorService.validateMongoDB / validateBidirectionalReferences.
 */
function makeRawDataCollectionMock(
  overrides: {
    totalRawData?: number;
    rawDataWithResourceId?: number;
    findOneResult?: { resourceId?: string } | null;
    findResults?: Array<{ resourceId?: string }>;
  } = {},
) {
  const {
    totalRawData = 0,
    rawDataWithResourceId = 0,
    findOneResult = null,
    findResults = [],
  } = overrides;

  return {
    countDocuments: jest
      .fn()
      .mockImplementation((filter: Record<string, unknown>) => {
        if (Object.keys(filter).length === 0) {
          return Promise.resolve(totalRawData);
        }
        return Promise.resolve(rawDataWithResourceId);
      }),
    findOne: jest.fn().mockResolvedValue(findOneResult),
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(findResults),
    }),
  };
}

function makeMongoServiceMock(
  collectionOverrides: Parameters<typeof makeRawDataCollectionMock>[0] = {},
) {
  return {
    getRawDataCollection: jest
      .fn()
      .mockReturnValue(makeRawDataCollectionMock(collectionOverrides)),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("DataIntegrityValidatorService", () => {
  let service: DataIntegrityValidatorService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let mongodb: ReturnType<typeof makeMongoServiceMock>;

  async function buildModule(
    mongoOverrides: Parameters<typeof makeRawDataCollectionMock>[0] = {},
  ) {
    prisma = makePrismaMock();
    mongodb = makeMongoServiceMock(mongoOverrides);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataIntegrityValidatorService,
        { provide: PrismaService, useValue: prisma },
        { provide: RawDataService, useValue: mongodb },
      ],
    }).compile();

    service = module.get<DataIntegrityValidatorService>(
      DataIntegrityValidatorService,
    );
  }

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    await buildModule();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // validateAll
  // --------------------------------------------------------------------------

  describe("validateAll", () => {
    it("returns a report with healthy status when all data is consistent", async () => {
      // 10 papers, all have rawDataId
      prisma.resource.count
        .mockResolvedValueOnce(10) // totalPapers
        .mockResolvedValueOnce(10); // papersWithRawDataId
      prisma.resource.findMany.mockResolvedValue([]); // no resources need reference check
      await buildModule({
        totalRawData: 10,
        rawDataWithResourceId: 10,
        findResults: [],
      });

      prisma.resource.count.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
      prisma.resource.findMany.mockResolvedValue([]);

      const report = await service.validateAll();

      expect(report.status).toBe("healthy");
      expect(report.postgresql.completenessPercentage).toBe(100);
      expect(report.mongodb.rawDataWithoutResourceId).toBe(0);
      expect(report.recommendations).toContain(
        "✅ 系统状态良好，所有双向引用都保持一致",
      );
    });

    it("returns warning status when completeness is between 90-100% and broken refs < 5", async () => {
      // 100 papers, 95 have rawDataId → 95% completeness
      prisma.resource.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(95);
      prisma.resource.findMany.mockResolvedValue([]);
      await buildModule({ totalRawData: 100, rawDataWithResourceId: 95 });

      prisma.resource.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(95);
      prisma.resource.findMany.mockResolvedValue([]);

      const report = await service.validateAll();

      expect(report.status).toBe("warning");
    });

    it("returns critical status when completeness drops below 90%", async () => {
      // 100 papers, only 80 have rawDataId
      prisma.resource.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80);
      prisma.resource.findMany.mockResolvedValue([]);
      await buildModule({ totalRawData: 100, rawDataWithResourceId: 80 });

      prisma.resource.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80);
      prisma.resource.findMany.mockResolvedValue([]);

      const report = await service.validateAll();

      expect(report.status).toBe("critical");
    });

    it("report contains a timestamp", async () => {
      prisma.resource.count.mockResolvedValue(0);
      prisma.resource.findMany.mockResolvedValue([]);

      const report = await service.validateAll();

      expect(report.timestamp).toBeInstanceOf(Date);
    });

    it("re-throws when an inner validation throws", async () => {
      prisma.resource.count.mockRejectedValue(new Error("DB connection lost"));

      await expect(service.validateAll()).rejects.toThrow("DB connection lost");
    });

    it("includes papers without rawDataId in recommendations", async () => {
      prisma.resource.count.mockResolvedValueOnce(10).mockResolvedValueOnce(8); // 2 missing
      prisma.resource.findMany.mockResolvedValue([]);
      await buildModule({ totalRawData: 10, rawDataWithResourceId: 10 });

      prisma.resource.count.mockResolvedValueOnce(10).mockResolvedValueOnce(8);
      prisma.resource.findMany.mockResolvedValue([]);

      const report = await service.validateAll();

      const hasPaperRec = report.recommendations.some((r) =>
        r.includes("2 篇论文缺少MongoDB原始数据"),
      );
      expect(hasPaperRec).toBe(true);
    });

    it("completenessPercentage is 100 when there are 0 papers", async () => {
      prisma.resource.count.mockResolvedValue(0);
      prisma.resource.findMany.mockResolvedValue([]);

      const report = await service.validateAll();

      expect(report.postgresql.completenessPercentage).toBe(100);
      expect(report.status).toBe("healthy");
    });
  });

  // --------------------------------------------------------------------------
  // getDiagnosticReport
  // --------------------------------------------------------------------------

  describe("getDiagnosticReport", () => {
    it("returns a non-empty string containing the separator line", async () => {
      prisma.resource.count.mockResolvedValue(0);
      prisma.resource.findMany.mockResolvedValue([]);

      const text = await service.getDiagnosticReport();

      expect(typeof text).toBe("string");
      expect(text).toContain("=".repeat(70));
    });

    it("includes PostgreSQL and MongoDB section headers", async () => {
      prisma.resource.count.mockResolvedValue(0);
      prisma.resource.findMany.mockResolvedValue([]);

      const text = await service.getDiagnosticReport();

      expect(text).toContain("PostgreSQL");
      expect(text).toContain("MongoDB");
    });

    it("includes the overall status in the report", async () => {
      prisma.resource.count.mockResolvedValue(0);
      prisma.resource.findMany.mockResolvedValue([]);

      const text = await service.getDiagnosticReport();

      // Status should appear uppercased
      expect(text).toMatch(/HEALTHY|WARNING|CRITICAL/);
    });
  });
});
