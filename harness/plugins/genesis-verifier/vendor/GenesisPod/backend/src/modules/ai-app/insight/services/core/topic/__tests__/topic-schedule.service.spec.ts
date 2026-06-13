import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { TopicScheduleService } from "../topic-schedule.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { TopicRefreshScheduler } from "../../../monitoring/topic-refresh.scheduler";
import { UpdateScheduleDto } from "../../../dto";

const mockPrisma = {
  researchTopic: {
    findUnique: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

const mockScheduler = {
  getSchedule: jest.fn(),
  updateSchedule: jest.fn(),
};

const ownerTopic = {
  id: "topic-1",
  userId: "user-1",
  name: "Test Topic",
};

const mockScheduleResult = {
  topicId: "topic-1",
  frequency: "WEEKLY",
  dayOfWeek: 1,
  hourOfDay: 8,
  enabled: true,
  nextRunAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
};

describe("TopicScheduleService", () => {
  let service: TopicScheduleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicScheduleService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TopicRefreshScheduler, useValue: mockScheduler },
      ],
    }).compile();

    service = module.get<TopicScheduleService>(TopicScheduleService);
    jest.clearAllMocks();
  });

  describe("getSchedule", () => {
    it("should return schedule for topic owner", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(ownerTopic);
      mockScheduler.getSchedule.mockResolvedValue(mockScheduleResult);

      const result = await service.getSchedule("user-1", "topic-1");

      expect(result).toEqual(mockScheduleResult);
      expect(mockScheduler.getSchedule).toHaveBeenCalledWith("topic-1");
    });

    it("should allow non-owner to read PUBLIC topic schedule", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(ownerTopic);
      mockPrisma.$queryRaw.mockResolvedValue([
        { visibility: "PUBLIC", is_collaborator: false },
      ]);
      mockScheduler.getSchedule.mockResolvedValue(mockScheduleResult);

      const result = await service.getSchedule("user-2", "topic-1");

      expect(result).toEqual(mockScheduleResult);
    });

    it("should throw NotFoundException when topic not found", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(service.getSchedule("user-1", "bad-topic")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException for non-owner of PRIVATE topic", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(ownerTopic);
      mockPrisma.$queryRaw.mockResolvedValue([
        { visibility: "PRIVATE", is_collaborator: false },
      ]);

      await expect(service.getSchedule("user-2", "topic-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should allow collaborator to read SHARED topic schedule", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(ownerTopic);
      mockPrisma.$queryRaw.mockResolvedValue([
        { visibility: "SHARED", is_collaborator: true },
      ]);
      mockScheduler.getSchedule.mockResolvedValue(mockScheduleResult);

      const result = await service.getSchedule("collaborator-1", "topic-1");

      expect(result).toEqual(mockScheduleResult);
    });
  });

  describe("updateSchedule", () => {
    it("should update schedule when called by topic owner", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(ownerTopic);
      mockScheduler.updateSchedule.mockResolvedValue({
        ...mockScheduleResult,
        frequency: "DAILY",
      });

      const dto: UpdateScheduleDto = {
        frequency: "DAILY" as never,
        hourOfDay: 9,
      };

      const result = await service.updateSchedule("user-1", "topic-1", dto);

      expect(result.frequency).toBe("DAILY");
      expect(mockScheduler.updateSchedule).toHaveBeenCalledWith(
        "topic-1",
        "DAILY",
        expect.objectContaining({ hourOfDay: 9 }),
      );
    });

    it("should throw NotFoundException when topic not found", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      const dto: UpdateScheduleDto = { frequency: "WEEKLY" as never };
      await expect(
        service.updateSchedule("user-1", "bad-topic", dto),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when non-owner tries to update", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(ownerTopic);

      const dto: UpdateScheduleDto = { frequency: "DAILY" as never };
      await expect(
        service.updateSchedule("user-2", "topic-1", dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should pass all schedule options to scheduler", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(ownerTopic);
      mockScheduler.updateSchedule.mockResolvedValue(mockScheduleResult);

      const dto: UpdateScheduleDto = {
        frequency: "MONTHLY" as never,
        dayOfMonth: 15,
        hourOfDay: 10,
        dayOfWeek: undefined,
      };

      await service.updateSchedule("user-1", "topic-1", dto);

      expect(mockScheduler.updateSchedule).toHaveBeenCalledWith(
        "topic-1",
        "MONTHLY",
        expect.objectContaining({
          dayOfMonth: 15,
          hourOfDay: 10,
        }),
      );
    });
  });
});
