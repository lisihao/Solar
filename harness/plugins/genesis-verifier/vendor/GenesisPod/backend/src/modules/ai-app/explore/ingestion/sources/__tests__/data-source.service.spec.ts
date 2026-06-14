import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException } from "@nestjs/common";
import { DataSourceStatus, DataSourceType } from "@prisma/client";
import { DataSourceService, CreateDataSourceDto } from "../data-source.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

// ============================================================================
// Helpers
// ============================================================================

function makePrismaMock() {
  return {
    dataSource: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function makeDataSource(overrides: Record<string, unknown> = {}) {
  return {
    id: "ds-1",
    name: "OpenAI Blog",
    description: "AI research",
    type: DataSourceType.RSS,
    category: "BLOG",
    baseUrl: "https://openai.com",
    apiEndpoint: "/news/rss.xml",
    authType: "NONE",
    credentials: null,
    crawlerType: "RSS",
    crawlerConfig: { rssUrl: "https://openai.com/news/rss.xml" },
    rateLimit: null,
    keywords: [],
    categories: [],
    languages: ["en"],
    minQualityScore: 0,
    deduplicationConfig: {},
    status: "ACTIVE" as DataSourceStatus,
    isVerified: false,
    createdBy: null,
    totalCollected: 0,
    totalSuccess: 0,
    totalFailed: 0,
    totalDuplicates: 0,
    successRate: 0,
    lastTestedAt: null,
    lastSuccessAt: null,
    lastErrorMessage: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

const baseCreateDto: CreateDataSourceDto = {
  name: "OpenAI Blog",
  type: DataSourceType.RSS,
  category: "BLOG",
  baseUrl: "https://openai.com",
  crawlerType: "RSS",
  crawlerConfig: { rssUrl: "https://openai.com/news/rss.xml" },
};

// ============================================================================
// Tests
// ============================================================================

describe("DataSourceService", () => {
  let service: DataSourceService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataSourceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DataSourceService>(DataSourceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // create
  // --------------------------------------------------------------------------

  describe("create", () => {
    it("returns existing data source when duplicate found", async () => {
      const existing = makeDataSource();
      prisma.dataSource.findFirst.mockResolvedValue(existing);

      const result = await service.create(baseCreateDto);

      expect(prisma.dataSource.create).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    it("creates a new data source when no duplicate exists", async () => {
      const created = makeDataSource();
      prisma.dataSource.findFirst.mockResolvedValue(null);
      prisma.dataSource.create.mockResolvedValue(created);

      const result = await service.create(baseCreateDto);

      expect(prisma.dataSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "OpenAI Blog",
            type: DataSourceType.RSS,
            authType: "NONE",
            languages: ["en"],
            status: "ACTIVE",
            isVerified: false,
          }),
        }),
      );
      expect(result).toEqual(created);
    });

    it("uses provided authType when specified", async () => {
      const created = makeDataSource({ authType: "API_KEY" });
      prisma.dataSource.findFirst.mockResolvedValue(null);
      prisma.dataSource.create.mockResolvedValue(created);

      await service.create({ ...baseCreateDto, authType: "API_KEY" });

      expect(prisma.dataSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ authType: "API_KEY" }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // findAll
  // --------------------------------------------------------------------------

  describe("findAll", () => {
    it("returns all data sources when no filter provided", async () => {
      const sources = [makeDataSource(), makeDataSource({ id: "ds-2" })];
      prisma.dataSource.findMany.mockResolvedValue(sources);

      const result = await service.findAll();

      expect(prisma.dataSource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
      expect(result).toHaveLength(2);
    });

    it("applies type filter when provided", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);

      await service.findAll({ type: DataSourceType.RSS });

      expect(prisma.dataSource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: DataSourceType.RSS }),
        }),
      );
    });

    it("applies status filter when provided", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);

      await service.findAll({ status: "ACTIVE" as DataSourceStatus });

      expect(prisma.dataSource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "ACTIVE" }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // findOne
  // --------------------------------------------------------------------------

  describe("findOne", () => {
    it("returns data source when found", async () => {
      const source = makeDataSource();
      prisma.dataSource.findUnique.mockResolvedValue(source);

      const result = await service.findOne("ds-1");

      expect(result).toEqual(source);
    });

    it("throws NotFoundException when data source does not exist", async () => {
      prisma.dataSource.findUnique.mockResolvedValue(null);

      await expect(service.findOne("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // update
  // --------------------------------------------------------------------------

  describe("update", () => {
    it("updates and returns the data source", async () => {
      const existing = makeDataSource();
      const updated = makeDataSource({ name: "Updated Blog" });
      prisma.dataSource.findUnique.mockResolvedValue(existing);
      prisma.dataSource.update.mockResolvedValue(updated);

      const result = await service.update("ds-1", { name: "Updated Blog" });

      expect(prisma.dataSource.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "ds-1" } }),
      );
      expect(result).toEqual(updated);
    });

    it("throws NotFoundException when data source does not exist", async () => {
      prisma.dataSource.findUnique.mockResolvedValue(null);

      await expect(
        service.update("nonexistent", { name: "X" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // --------------------------------------------------------------------------
  // remove
  // --------------------------------------------------------------------------

  describe("remove", () => {
    it("deletes data source when it exists", async () => {
      const existing = makeDataSource();
      prisma.dataSource.findUnique.mockResolvedValue(existing);
      prisma.dataSource.delete.mockResolvedValue(existing);

      await service.remove("ds-1");

      expect(prisma.dataSource.delete).toHaveBeenCalledWith({
        where: { id: "ds-1" },
      });
    });

    it("throws NotFoundException when data source does not exist", async () => {
      prisma.dataSource.findUnique.mockResolvedValue(null);

      await expect(service.remove("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // test
  // --------------------------------------------------------------------------

  describe("test", () => {
    it("marks data source as verified and returns success", async () => {
      const source = makeDataSource();
      prisma.dataSource.findUnique.mockResolvedValue(source);
      prisma.dataSource.update.mockResolvedValue({
        ...source,
        isVerified: true,
      });

      const result = await service.test("ds-1");

      expect(result.success).toBe(true);
      expect(prisma.dataSource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isVerified: true }),
        }),
      );
    });

    it("throws NotFoundException when data source does not exist before testing", async () => {
      prisma.dataSource.findUnique.mockResolvedValue(null);

      await expect(service.test("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // updateStats
  // --------------------------------------------------------------------------

  describe("updateStats", () => {
    it("accumulates stats and updates successRate", async () => {
      const source = makeDataSource({
        totalCollected: 10,
        totalSuccess: 8,
        totalFailed: 2,
        totalDuplicates: 1,
      });
      prisma.dataSource.findUnique.mockResolvedValue(source);
      prisma.dataSource.update.mockResolvedValue(source);

      await service.updateStats("ds-1", {
        collected: 5,
        success: 4,
        failed: 1,
        duplicates: 0,
      });

      expect(prisma.dataSource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalCollected: 15,
            totalSuccess: 12,
            totalFailed: 3,
            totalDuplicates: 1,
            successRate: expect.closeTo(80, 0),
          }),
        }),
      );
    });

    it("sets successRate to 0 when totalCollected is 0", async () => {
      const source = makeDataSource({
        totalCollected: 0,
        totalSuccess: 0,
        totalFailed: 0,
        totalDuplicates: 0,
      });
      prisma.dataSource.findUnique.mockResolvedValue(source);
      prisma.dataSource.update.mockResolvedValue(source);

      await service.updateStats("ds-1", {});

      expect(prisma.dataSource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ successRate: 0 }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // getStatsSummary
  // --------------------------------------------------------------------------

  describe("getStatsSummary", () => {
    it("returns correct counts by status and type", async () => {
      prisma.dataSource.findMany.mockResolvedValue([
        makeDataSource({ status: "ACTIVE", type: DataSourceType.RSS }),
        makeDataSource({
          id: "ds-2",
          status: "ACTIVE",
          type: DataSourceType.RSS,
        }),
        makeDataSource({
          id: "ds-3",
          status: "PAUSED",
          type: DataSourceType.ARXIV,
        }),
        makeDataSource({
          id: "ds-4",
          status: "FAILED",
          type: DataSourceType.ARXIV,
        }),
      ]);

      const result = await service.getStatsSummary();

      expect(result.total).toBe(4);
      expect(result.active).toBe(2);
      expect(result.paused).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.byType[DataSourceType.RSS]).toBe(2);
      expect(result.byType[DataSourceType.ARXIV]).toBe(2);
    });

    it("returns zero counts when no data sources exist", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);

      const result = await service.getStatsSummary();

      expect(result.total).toBe(0);
      expect(result.active).toBe(0);
      expect(result.byType).toEqual({});
    });
  });

  // --------------------------------------------------------------------------
  // bulkCreate
  // --------------------------------------------------------------------------

  describe("bulkCreate", () => {
    it("creates sources that do not already exist", async () => {
      prisma.dataSource.findFirst.mockResolvedValue(null);
      prisma.dataSource.create.mockResolvedValue(makeDataSource());

      const result = await service.bulkCreate([baseCreateDto]);

      expect(result.created).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("skips sources that already exist", async () => {
      prisma.dataSource.findFirst.mockResolvedValue(makeDataSource());

      const result = await service.bulkCreate([baseCreateDto]);

      expect(result.skipped).toBe(1);
      expect(result.created).toBe(0);
      expect(prisma.dataSource.create).not.toHaveBeenCalled();
    });

    it("records failed entries and continues processing", async () => {
      prisma.dataSource.findFirst.mockResolvedValue(null);
      prisma.dataSource.create.mockRejectedValue(
        new Error("DB constraint error"),
      );

      const result = await service.bulkCreate([baseCreateDto]);

      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].name).toBe("OpenAI Blog");
    });

    it("returns combined stats for mixed batch", async () => {
      const dto2: CreateDataSourceDto = {
        ...baseCreateDto,
        name: "New Source",
        baseUrl: "https://example.com",
      };

      prisma.dataSource.findFirst
        .mockResolvedValueOnce(makeDataSource()) // first: skip
        .mockResolvedValueOnce(null); // second: create
      prisma.dataSource.create.mockResolvedValue(
        makeDataSource({ id: "ds-2" }),
      );

      const result = await service.bulkCreate([baseCreateDto, dto2]);

      expect(result.skipped).toBe(1);
      expect(result.created).toBe(1);
    });
  });
});
