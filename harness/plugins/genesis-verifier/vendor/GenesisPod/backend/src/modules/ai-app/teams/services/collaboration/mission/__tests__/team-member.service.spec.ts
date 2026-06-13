/**
 * TeamMemberService Unit Tests
 *
 * Tests the two core methods:
 * - setLeader: first clears existing leaders, then sets the new one
 * - getTeamMembers: retrieves members ordered by isLeader/createdAt,
 *   then splits into { leader, members, all }
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TeamMemberService } from "../team-member.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

const mockPrisma = {
  topicAIMember: {
    updateMany: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMember(
  id: string,
  isLeader: boolean,
  createdAt: Date = new Date("2025-01-01"),
) {
  return {
    id,
    topicId: "topic-1",
    isLeader,
    displayName: `Agent ${id}`,
    agentName: "researcher",
    avatar: null,
    aiModel: "gpt-4",
    createdAt,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("TeamMemberService", () => {
  let service: TeamMemberService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamMemberService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TeamMemberService>(TeamMemberService);
    jest.clearAllMocks();
  });

  // =========================================================================
  // setLeader
  // =========================================================================

  describe("setLeader", () => {
    it("first calls updateMany to clear existing leaders in the topic", async () => {
      const updated = makeMember("member-2", true);
      mockPrisma.topicAIMember.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.topicAIMember.update.mockResolvedValue(updated);

      await service.setLeader("topic-1", "member-2");

      expect(mockPrisma.topicAIMember.updateMany).toHaveBeenCalledWith({
        where: { topicId: "topic-1", isLeader: true },
        data: { isLeader: false },
      });
    });

    it("then calls update to set the new leader", async () => {
      const updated = makeMember("member-2", true);
      mockPrisma.topicAIMember.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.topicAIMember.update.mockResolvedValue(updated);

      await service.setLeader("topic-1", "member-2");

      expect(mockPrisma.topicAIMember.update).toHaveBeenCalledWith({
        where: { id: "member-2" },
        data: { isLeader: true },
      });
    });

    it("returns the updated member record from prisma.update", async () => {
      const updated = makeMember("member-3", true);
      mockPrisma.topicAIMember.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.topicAIMember.update.mockResolvedValue(updated);

      const result = await service.setLeader("topic-1", "member-3");

      expect(result).toBe(updated);
    });

    it("calls updateMany before update (sequential ordering)", async () => {
      const callOrder: string[] = [];
      mockPrisma.topicAIMember.updateMany.mockImplementation(() => {
        callOrder.push("updateMany");
        return Promise.resolve({ count: 1 });
      });
      mockPrisma.topicAIMember.update.mockImplementation(() => {
        callOrder.push("update");
        return Promise.resolve(makeMember("m1", true));
      });

      await service.setLeader("topic-1", "m1");

      expect(callOrder).toEqual(["updateMany", "update"]);
    });

    it("propagates prisma.updateMany errors", async () => {
      mockPrisma.topicAIMember.updateMany.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(service.setLeader("topic-1", "member-1")).rejects.toThrow(
        "DB error",
      );
      expect(mockPrisma.topicAIMember.update).not.toHaveBeenCalled();
    });

    it("propagates prisma.update errors", async () => {
      mockPrisma.topicAIMember.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.topicAIMember.update.mockRejectedValue(new Error("Not found"));

      await expect(service.setLeader("topic-1", "member-1")).rejects.toThrow(
        "Not found",
      );
    });
  });

  // =========================================================================
  // getTeamMembers
  // =========================================================================

  describe("getTeamMembers", () => {
    it("queries topicAIMember with correct where and orderBy clauses", async () => {
      mockPrisma.topicAIMember.findMany.mockResolvedValue([]);

      await service.getTeamMembers("topic-1");

      expect(mockPrisma.topicAIMember.findMany).toHaveBeenCalledWith({
        where: { topicId: "topic-1" },
        orderBy: [{ isLeader: "desc" }, { createdAt: "asc" }],
      });
    });

    it("returns leader, non-leader members, and full all array", async () => {
      const leader = makeMember("leader-1", true, new Date("2025-01-01"));
      const member1 = makeMember("member-1", false, new Date("2025-01-02"));
      const member2 = makeMember("member-2", false, new Date("2025-01-03"));
      mockPrisma.topicAIMember.findMany.mockResolvedValue([
        leader,
        member1,
        member2,
      ]);

      const result = await service.getTeamMembers("topic-1");

      expect(result.leader).toBe(leader);
      expect(result.members).toEqual([member1, member2]);
      expect(result.all).toEqual([leader, member1, member2]);
    });

    it("returns undefined leader when no leader exists", async () => {
      const member1 = makeMember("member-1", false);
      const member2 = makeMember("member-2", false);
      mockPrisma.topicAIMember.findMany.mockResolvedValue([member1, member2]);

      const result = await service.getTeamMembers("topic-1");

      expect(result.leader).toBeUndefined();
      expect(result.members).toEqual([member1, member2]);
      expect(result.all).toEqual([member1, member2]);
    });

    it("returns empty members array and undefined leader for empty topic", async () => {
      mockPrisma.topicAIMember.findMany.mockResolvedValue([]);

      const result = await service.getTeamMembers("topic-empty");

      expect(result.leader).toBeUndefined();
      expect(result.members).toEqual([]);
      expect(result.all).toEqual([]);
    });

    it("excludes the leader from the members array", async () => {
      const leader = makeMember("leader-1", true);
      const member = makeMember("member-1", false);
      mockPrisma.topicAIMember.findMany.mockResolvedValue([leader, member]);

      const result = await service.getTeamMembers("topic-1");

      expect(result.members).not.toContain(leader);
      expect(result.members).toContain(member);
    });

    it("handles a single member who is the leader", async () => {
      const soloLeader = makeMember("solo-1", true);
      mockPrisma.topicAIMember.findMany.mockResolvedValue([soloLeader]);

      const result = await service.getTeamMembers("topic-1");

      expect(result.leader).toBe(soloLeader);
      expect(result.members).toEqual([]);
      expect(result.all).toEqual([soloLeader]);
    });

    it("propagates prisma.findMany errors", async () => {
      mockPrisma.topicAIMember.findMany.mockRejectedValue(
        new Error("DB unavailable"),
      );

      await expect(service.getTeamMembers("topic-1")).rejects.toThrow(
        "DB unavailable",
      );
    });
  });
});
