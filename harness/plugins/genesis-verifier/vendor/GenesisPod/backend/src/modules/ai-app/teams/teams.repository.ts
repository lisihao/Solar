import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import {
  Prisma,
  Topic,
  TopicMember,
  TopicAIMember,
  TopicMessage,
} from "@prisma/client";

/**
 * Teams Repository
 *
 * 负责 AI Teams (Topic) 的数据访问层操作
 * - 仅处理数据库查询，不包含业务逻辑
 * - 可被 mock 用于测试
 */
@Injectable()
export class TeamsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== Topic Operations ====================

  /**
   * 查找用户的所有话题
   */
  async findTopicsByUserId(
    userId: string,
    where?: Prisma.TopicWhereInput,
    include?: Prisma.TopicInclude,
  ): Promise<Topic[]> {
    return this.prisma.topic.findMany({
      where: {
        members: {
          some: { userId },
        },
        ...where,
      },
      include,
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * 根据ID查找话题
   */
  async findTopicById(
    id: string,
    include?: Prisma.TopicInclude,
  ): Promise<Topic | null> {
    return this.prisma.topic.findUnique({
      where: { id },
      include,
    });
  }

  /**
   * 创建话题
   */
  async createTopic(
    data: Prisma.TopicCreateInput,
    include?: Prisma.TopicInclude,
  ): Promise<Topic> {
    return this.prisma.topic.create({
      data,
      include,
    });
  }

  /**
   * 更新话题
   */
  async updateTopic(
    id: string,
    data: Prisma.TopicUpdateInput,
    include?: Prisma.TopicInclude,
  ): Promise<Topic> {
    return this.prisma.topic.update({
      where: { id },
      data,
      include,
    });
  }

  /**
   * 删除话题
   */
  async deleteTopic(id: string): Promise<Topic> {
    return this.prisma.topic.delete({
      where: { id },
    });
  }

  /**
   * 统计话题数量
   */
  async countTopics(where: Prisma.TopicWhereInput): Promise<number> {
    return this.prisma.topic.count({ where });
  }

  // ==================== TopicMember Operations ====================

  /**
   * 查找话题的所有成员
   */
  async findMembersByTopicId(
    topicId: string,
    include?: Prisma.TopicMemberInclude,
  ): Promise<TopicMember[]> {
    return this.prisma.topicMember.findMany({
      where: { topicId },
      include,
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    });
  }

  /**
   * 查找特定成员
   */
  async findMemberByTopicAndUser(
    topicId: string,
    userId: string,
  ): Promise<TopicMember | null> {
    return this.prisma.topicMember.findUnique({
      where: {
        topicId_userId: { topicId, userId },
      },
    });
  }

  /**
   * 根据ID查找成员
   */
  async findMemberById(
    id: string,
    include?: Prisma.TopicMemberInclude,
  ): Promise<TopicMember | null> {
    return this.prisma.topicMember.findUnique({
      where: { id },
      include,
    });
  }

  /**
   * 创建成员
   */
  async createMember(
    data: Prisma.TopicMemberCreateInput,
  ): Promise<TopicMember> {
    return this.prisma.topicMember.create({
      data,
    });
  }

  /**
   * 批量创建成员
   */
  async createManyMembers(
    data: Prisma.TopicMemberCreateManyInput[],
  ): Promise<{ count: number }> {
    return this.prisma.topicMember.createMany({
      data,
      skipDuplicates: true,
    });
  }

  /**
   * 更新成员
   */
  async updateMember(
    id: string,
    data: Prisma.TopicMemberUpdateInput,
  ): Promise<TopicMember> {
    return this.prisma.topicMember.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除成员
   */
  async deleteMember(id: string): Promise<TopicMember> {
    return this.prisma.topicMember.delete({
      where: { id },
    });
  }

  /**
   * 批量删除成员
   */
  async deleteManyMembers(
    where: Prisma.TopicMemberWhereInput,
  ): Promise<{ count: number }> {
    return this.prisma.topicMember.deleteMany({
      where,
    });
  }

  /**
   * 统计成员数量
   */
  async countMembers(where: Prisma.TopicMemberWhereInput): Promise<number> {
    return this.prisma.topicMember.count({ where });
  }

  // ==================== TopicAIMember Operations ====================

  /**
   * 查找话题的所有AI成员
   */
  async findAIMembersByTopicId(topicId: string): Promise<TopicAIMember[]> {
    return this.prisma.topicAIMember.findMany({
      where: { topicId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * 根据ID查找AI成员
   */
  async findAIMemberById(id: string): Promise<TopicAIMember | null> {
    return this.prisma.topicAIMember.findUnique({
      where: { id },
    });
  }

  /**
   * 创建AI成员
   */
  async createAIMember(
    data: Prisma.TopicAIMemberCreateInput,
  ): Promise<TopicAIMember> {
    return this.prisma.topicAIMember.create({
      data,
    });
  }

  /**
   * 批量创建AI成员
   */
  async createManyAIMembers(
    data: Prisma.TopicAIMemberCreateManyInput[],
  ): Promise<{ count: number }> {
    return this.prisma.topicAIMember.createMany({
      data,
    });
  }

  /**
   * 更新AI成员
   */
  async updateAIMember(
    id: string,
    data: Prisma.TopicAIMemberUpdateInput,
  ): Promise<TopicAIMember> {
    return this.prisma.topicAIMember.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除AI成员
   */
  async deleteAIMember(id: string): Promise<TopicAIMember> {
    return this.prisma.topicAIMember.delete({
      where: { id },
    });
  }

  /**
   * 批量删除AI成员
   */
  async deleteManyAIMembers(
    where: Prisma.TopicAIMemberWhereInput,
  ): Promise<{ count: number }> {
    return this.prisma.topicAIMember.deleteMany({
      where,
    });
  }

  // ==================== TopicMessage Operations ====================

  /**
   * 查找话题的消息
   */
  async findMessages(params: {
    where: Prisma.TopicMessageWhereInput;
    include?: Prisma.TopicMessageInclude;
    orderBy?: Prisma.TopicMessageOrderByWithRelationInput;
    take?: number;
    skip?: number;
  }): Promise<TopicMessage[]> {
    return this.prisma.topicMessage.findMany(params);
  }

  /**
   * 根据ID查找消息
   */
  async findMessageById(
    id: string,
    include?: Prisma.TopicMessageInclude,
  ): Promise<TopicMessage | null> {
    return this.prisma.topicMessage.findUnique({
      where: { id },
      include,
    });
  }

  /**
   * 创建消息
   */
  async createMessage(
    data: Prisma.TopicMessageCreateInput,
    include?: Prisma.TopicMessageInclude,
  ): Promise<TopicMessage> {
    return this.prisma.topicMessage.create({
      data,
      include,
    });
  }

  /**
   * 更新消息
   */
  async updateMessage(
    id: string,
    data: Prisma.TopicMessageUpdateInput,
  ): Promise<TopicMessage> {
    return this.prisma.topicMessage.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除消息（软删除）
   */
  async softDeleteMessage(id: string): Promise<TopicMessage> {
    return this.prisma.topicMessage.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * 统计消息数量
   */
  async countMessages(where: Prisma.TopicMessageWhereInput): Promise<number> {
    return this.prisma.topicMessage.count({ where });
  }

  /**
   * 批量删除消息
   */
  async deleteManyMessages(
    where: Prisma.TopicMessageWhereInput,
  ): Promise<{ count: number }> {
    return this.prisma.topicMessage.deleteMany({
      where,
    });
  }

  // ==================== TopicResource Operations ====================

  /**
   * 查找话题的资源
   */
  async findResources(topicId: string, include?: Prisma.TopicResourceInclude) {
    return this.prisma.topicResource.findMany({
      where: { topicId },
      include,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 创建话题资源
   */
  async createResource(data: Prisma.TopicResourceCreateInput) {
    return this.prisma.topicResource.create({
      data,
    });
  }

  /**
   * 删除话题资源
   */
  async deleteResource(id: string) {
    return this.prisma.topicResource.delete({
      where: { id },
    });
  }

  /**
   * 批量删除话题资源
   */
  async deleteManyResources(
    where: Prisma.TopicResourceWhereInput,
  ): Promise<{ count: number }> {
    return this.prisma.topicResource.deleteMany({
      where,
    });
  }

  // ==================== TopicSummary Operations ====================

  /**
   * 查找话题的摘要
   */
  async findSummaries(topicId: string, include?: Prisma.TopicSummaryInclude) {
    return this.prisma.topicSummary.findMany({
      where: { topicId },
      include,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 创建话题摘要
   */
  async createSummary(data: Prisma.TopicSummaryCreateInput) {
    return this.prisma.topicSummary.create({
      data,
    });
  }

  /**
   * 删除话题摘要
   */
  async deleteSummary(id: string) {
    return this.prisma.topicSummary.delete({
      where: { id },
    });
  }

  /**
   * 批量删除话题摘要
   */
  async deleteManySummaries(
    where: Prisma.TopicSummaryWhereInput,
  ): Promise<{ count: number }> {
    return this.prisma.topicSummary.deleteMany({
      where,
    });
  }

  // ==================== Transaction Support ====================

  /**
   * 获取 Prisma 事务客户端（用于 Service 层复杂事务）
   */
  getPrismaClient() {
    return this.prisma;
  }
}
