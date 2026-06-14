import { Test, TestingModule } from "@nestjs/testing";
import { TimelineService } from "../timeline.service";
import { PrismaService } from "@/common/prisma/prisma.service";

describe("TimelineService", () => {
  let service: TimelineService;
  let mockPrisma: jest.Mocked<PrismaService>;

  const mockEvent = {
    id: "event-1",
    bibleId: "bible-1",
    eventName: "初次进宫",
    description: "主角第一次进入宫廷",
    storyTime: "大汉元年正月",
    importance: 5,
    involvedCharacterIds: ["char-1"],
    relatedChapterId: "chap-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = {
      timelineEvent: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimelineService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TimelineService>(TimelineService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("create", () => {
    it("should create a timeline event with all fields", async () => {
      (mockPrisma.timelineEvent.create as jest.Mock).mockResolvedValue(
        mockEvent,
      );

      const result = await service.create("bible-1", {
        eventName: "初次进宫",
        description: "主角第一次进入宫廷",
        storyTime: "大汉元年正月",
        importance: 5,
        involvedCharacterIds: ["char-1"],
        relatedChapterId: "chap-1",
      });

      expect(mockPrisma.timelineEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bibleId: "bible-1",
          eventName: "初次进宫",
          description: "主角第一次进入宫廷",
          storyTime: "大汉元年正月",
          importance: 5,
          involvedCharacterIds: ["char-1"],
          relatedChapterId: "chap-1",
        }),
      });
      expect(result.id).toBe("event-1");
    });

    it("should use default importance of 1 when not provided", async () => {
      (mockPrisma.timelineEvent.create as jest.Mock).mockResolvedValue({
        ...mockEvent,
        importance: 1,
        involvedCharacterIds: [],
      });

      await service.create("bible-1", {
        eventName: "小事件",
        description: "描述",
        storyTime: "某日",
      });

      expect(mockPrisma.timelineEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          importance: 1,
          involvedCharacterIds: [],
        }),
      });
    });

    it("should use empty array for involvedCharacterIds when not provided", async () => {
      (mockPrisma.timelineEvent.create as jest.Mock).mockResolvedValue({
        ...mockEvent,
        involvedCharacterIds: [],
      });

      await service.create("bible-1", {
        eventName: "事件",
        description: "描述",
        storyTime: "某日",
      });

      expect(mockPrisma.timelineEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          involvedCharacterIds: [],
        }),
      });
    });
  });

  describe("findAll", () => {
    it("should return all events ordered by storyTime ascending", async () => {
      const events = [
        { ...mockEvent, storyTime: "大汉元年" },
        { ...mockEvent, id: "event-2", storyTime: "大汉二年" },
      ];
      (mockPrisma.timelineEvent.findMany as jest.Mock).mockResolvedValue(
        events,
      );

      const result = await service.findAll("bible-1");

      expect(mockPrisma.timelineEvent.findMany).toHaveBeenCalledWith({
        where: { bibleId: "bible-1" },
        orderBy: { storyTime: "asc" },
      });
      expect(result).toHaveLength(2);
    });

    it("should return empty array when no events exist", async () => {
      (mockPrisma.timelineEvent.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll("bible-1");

      expect(result).toHaveLength(0);
    });
  });

  describe("update", () => {
    it("should update timeline event", async () => {
      const updatedEvent = { ...mockEvent, eventName: "更新后的事件" };
      (mockPrisma.timelineEvent.update as jest.Mock).mockResolvedValue(
        updatedEvent,
      );

      const result = await service.update("event-1", {
        eventName: "更新后的事件",
      });

      expect(mockPrisma.timelineEvent.update).toHaveBeenCalledWith({
        where: { id: "event-1" },
        data: { eventName: "更新后的事件" },
      });
      expect(result.eventName).toBe("更新后的事件");
    });

    it("should update importance field", async () => {
      (mockPrisma.timelineEvent.update as jest.Mock).mockResolvedValue({
        ...mockEvent,
        importance: 10,
      });

      await service.update("event-1", { importance: 10 });

      expect(mockPrisma.timelineEvent.update).toHaveBeenCalledWith({
        where: { id: "event-1" },
        data: { importance: 10 },
      });
    });
  });

  describe("delete", () => {
    it("should delete timeline event by id", async () => {
      (mockPrisma.timelineEvent.delete as jest.Mock).mockResolvedValue(
        mockEvent,
      );

      await service.delete("event-1");

      expect(mockPrisma.timelineEvent.delete).toHaveBeenCalledWith({
        where: { id: "event-1" },
      });
    });

    it("should return the deleted event", async () => {
      (mockPrisma.timelineEvent.delete as jest.Mock).mockResolvedValue(
        mockEvent,
      );

      const result = await service.delete("event-1");

      expect(result).toEqual(mockEvent);
    });
  });
});
