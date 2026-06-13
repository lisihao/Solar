/**
 * TopicScheduleService - Supplemental Tests
 *
 * Covers the uncovered branch in checkTopicAccess:
 * - $queryRaw returns empty array → return false (line 137)
 * - SHARED visibility but NOT a collaborator → return false (line 153)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException } from "@nestjs/common";
import { TopicScheduleService } from "../topic-schedule.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { TopicRefreshScheduler } from "../../../monitoring/topic-refresh.scheduler";

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

describe("TopicScheduleService (supplemental)", () => {
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

  describe("checkTopicAccess – empty $queryRaw result", () => {
    it("should throw ForbiddenException when $queryRaw returns empty array", async () => {
      // Arrange: non-owner user, topic found, but $queryRaw returns []
      mockPrisma.researchTopic.findUnique.mockResolvedValue(ownerTopic);
      mockPrisma.$queryRaw.mockResolvedValue([]); // empty result → return false

      // Act & Assert
      await expect(service.getSchedule("user-2", "topic-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("checkTopicAccess – SHARED but not collaborator", () => {
    it("should throw ForbiddenException for SHARED topic when user is not a collaborator", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(ownerTopic);
      mockPrisma.$queryRaw.mockResolvedValue([
        { visibility: "SHARED", is_collaborator: false },
      ]);

      await expect(service.getSchedule("user-2", "topic-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
