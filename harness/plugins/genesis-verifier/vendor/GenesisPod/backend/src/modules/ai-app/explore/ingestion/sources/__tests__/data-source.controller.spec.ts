import { Test, TestingModule } from "@nestjs/testing";
import { DataSourceController } from "../data-source.controller";
import {
  DataSourceService,
  CreateDataSourceDto,
  UpdateDataSourceDto,
} from "../data-source.service";

describe("DataSourceController", () => {
  let controller: DataSourceController;
  let dataSourceService: jest.Mocked<DataSourceService>;

  const mockSource = {
    id: "source-1",
    type: "RSS",
    status: "ACTIVE",
    url: "https://example.com/feed",
    name: "Test Feed",
  };

  const mockStats = {
    total: 10,
    active: 8,
    paused: 2,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DataSourceController],
      providers: [
        {
          provide: DataSourceService,
          useValue: {
            create: jest.fn().mockResolvedValue(mockSource),
            bulkCreate: jest.fn().mockResolvedValue([mockSource]),
            findAll: jest.fn().mockResolvedValue([mockSource]),
            getStatsSummary: jest.fn().mockResolvedValue(mockStats),
            findOne: jest.fn().mockResolvedValue(mockSource),
            update: jest.fn().mockResolvedValue(mockSource),
            remove: jest.fn().mockResolvedValue(undefined),
            test: jest.fn().mockResolvedValue({ success: true }),
            fixKnownRssUrls: jest.fn().mockResolvedValue({ fixed: 2 }),
          },
        },
      ],
    }).compile();

    controller = module.get<DataSourceController>(DataSourceController);
    dataSourceService = module.get(DataSourceService);
  });

  describe("create", () => {
    it("should create a data source", async () => {
      const dto: CreateDataSourceDto = {
        type: "RSS",
        url: "https://example.com/feed",
        name: "Test Feed",
      } as unknown as CreateDataSourceDto;

      const result = await controller.create(dto);
      expect(dataSourceService.create).toHaveBeenCalledWith(dto);
      expect(result).toBe(mockSource);
    });
  });

  describe("bulkCreate", () => {
    it("should bulk create data sources", async () => {
      const dtos: CreateDataSourceDto[] = [
        { type: "RSS", url: "https://example.com/feed", name: "Feed 1" },
      ] as unknown as CreateDataSourceDto[];

      const result = await controller.bulkCreate(dtos);
      expect(dataSourceService.bulkCreate).toHaveBeenCalledWith(dtos);
      expect(result).toEqual([mockSource]);
    });
  });

  describe("findAll", () => {
    it("should return all data sources with metadata", async () => {
      const result = await controller.findAll();
      expect(dataSourceService.findAll).toHaveBeenCalledWith({
        type: undefined,
        status: undefined,
        category: undefined,
      });
      expect(result).toEqual({ data: [mockSource], total: 1 });
    });

    it("should pass filters to service", async () => {
      dataSourceService.findAll.mockResolvedValue([]);
      const result = await controller.findAll(
        "RSS" as unknown as import("@prisma/client").DataSourceType,
        "ACTIVE" as unknown as import("@prisma/client").DataSourceStatus,
        "news",
      );
      expect(dataSourceService.findAll).toHaveBeenCalledWith({
        type: "RSS",
        status: "ACTIVE",
        category: "news",
      });
      expect(result).toEqual({ data: [], total: 0 });
    });
  });

  describe("getStats", () => {
    it("should return stats summary", async () => {
      const result = await controller.getStats();
      expect(dataSourceService.getStatsSummary).toHaveBeenCalled();
      expect(result).toBe(mockStats);
    });
  });

  describe("findOne", () => {
    it("should return a single data source by id", async () => {
      const result = await controller.findOne("source-1");
      expect(dataSourceService.findOne).toHaveBeenCalledWith("source-1");
      expect(result).toBe(mockSource);
    });
  });

  describe("update", () => {
    it("should update a data source", async () => {
      const dto: UpdateDataSourceDto = {
        name: "Updated Feed",
      } as unknown as UpdateDataSourceDto;

      const result = await controller.update("source-1", dto);
      expect(dataSourceService.update).toHaveBeenCalledWith("source-1", dto);
      expect(result).toBe(mockSource);
    });
  });

  describe("remove", () => {
    it("should remove a data source", async () => {
      await controller.remove("source-1");
      expect(dataSourceService.remove).toHaveBeenCalledWith("source-1");
    });
  });

  describe("test", () => {
    it("should test a data source connection", async () => {
      const result = await controller.test("source-1");
      expect(dataSourceService.test).toHaveBeenCalledWith("source-1");
      expect(result).toEqual({ success: true });
    });
  });

  describe("pause", () => {
    it("should pause a data source by updating status to PAUSED", async () => {
      const result = await controller.pause("source-1");
      expect(dataSourceService.update).toHaveBeenCalledWith("source-1", {
        status: "PAUSED",
      });
      expect(result).toBe(mockSource);
    });
  });

  describe("resume", () => {
    it("should resume a data source by updating status to ACTIVE", async () => {
      const result = await controller.resume("source-1");
      expect(dataSourceService.update).toHaveBeenCalledWith("source-1", {
        status: "ACTIVE",
      });
      expect(result).toBe(mockSource);
    });
  });

  describe("fixRssUrls", () => {
    it("should fix known RSS URLs", async () => {
      const result = await controller.fixRssUrls();
      expect(dataSourceService.fixKnownRssUrls).toHaveBeenCalled();
      expect(result).toEqual({ fixed: 2 });
    });
  });
});
