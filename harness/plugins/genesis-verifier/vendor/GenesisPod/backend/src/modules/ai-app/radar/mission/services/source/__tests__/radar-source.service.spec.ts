import { Test, TestingModule } from "@nestjs/testing";
import { RadarSourceService } from "../radar-source.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { RadarTopicService } from "../../topic/radar-topic.service";
import { CollectorRouter } from "../../collectors/collector-router.service";

const mockTopic = {
  id: "topic-1",
  userId: "user-1",
  title: "Test",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  radarSource: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const mockTopics = {
  getOwnedById: jest.fn().mockResolvedValue(mockTopic),
};

const mockCollectorRouter = {
  fanOut: jest.fn().mockResolvedValue([]),
};

describe("RadarSourceService", () => {
  let service: RadarSourceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadarSourceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RadarTopicService, useValue: mockTopics },
        { provide: CollectorRouter, useValue: mockCollectorRouter },
      ],
    }).compile();
    service = module.get<RadarSourceService>(RadarSourceService);
  });

  describe("create", () => {
    it("writes isPublicSource=true for a plain RSS URL with no auth", async () => {
      const fakeSource = { id: "src-1", isPublicSource: true };
      mockPrisma.radarSource.create.mockResolvedValue(fakeSource);

      await service.create("user-1", "topic-1", {
        type: "RSS" as never,
        identifier: "https://feeds.arstechnica.com/arstechnica/index",
        enabled: true,
      });

      expect(mockPrisma.radarSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPublicSource: true }),
        }),
      );
    });

    it("writes isPublicSource=false for an RSS URL with basic auth credentials", async () => {
      const fakeSource = { id: "src-2", isPublicSource: false };
      mockPrisma.radarSource.create.mockResolvedValue(fakeSource);

      await service.create("user-1", "topic-1", {
        type: "RSS" as never,
        identifier: "https://user:secret@internal.example.com/feed",
        enabled: true,
      });

      expect(mockPrisma.radarSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPublicSource: false }),
        }),
      );
    });
  });
});
