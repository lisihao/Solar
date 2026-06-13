/**
 * Team Member Service
 *
 * 负责团队成员管理，从 TeamMissionService 中提取
 * - setLeader: 设置 Leader
 * - getTeamMembers: 获取团队成员列表
 */

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

@Injectable()
export class TeamMemberService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 设置 Leader
   */
  async setLeader(topicId: string, aiMemberId: string) {
    // 先取消该 Topic 下其他 Leader
    await this.prisma.topicAIMember.updateMany({
      where: { topicId, isLeader: true },
      data: { isLeader: false },
    });

    // 设置新 Leader
    return this.prisma.topicAIMember.update({
      where: { id: aiMemberId },
      data: { isLeader: true },
    });
  }

  /**
   * 获取团队成员列表
   */
  async getTeamMembers(topicId: string) {
    const members = await this.prisma.topicAIMember.findMany({
      where: { topicId },
      orderBy: [{ isLeader: "desc" }, { createdAt: "asc" }],
    });

    const leader = members.find((m) => m.isLeader);
    const otherMembers = members.filter((m) => !m.isLeader);

    return {
      leader,
      members: otherMembers,
      all: members,
    };
  }
}
