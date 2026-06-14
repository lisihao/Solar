import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import {
  Prisma,
  WritingProject,
  WritingVolume,
  WritingChapter,
} from "@prisma/client";

/**
 * Writing Repository
 *
 * 负责 AI Writing (WritingProject) 的数据访问层操作
 * - 仅处理数据库查询，不包含业务逻辑
 * - 可被 mock 用于测试
 */
@Injectable()
export class WritingRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== WritingProject Operations ====================

  /**
   * 查找用户的所有写作项目
   */
  async findProjectsByOwnerId(
    ownerId: string,
    include?: Prisma.WritingProjectInclude,
  ): Promise<WritingProject[]> {
    return this.prisma.writingProject.findMany({
      where: { ownerId },
      include,
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * 根据ID查找写作项目
   */
  async findProjectById(
    id: string,
    include?: Prisma.WritingProjectInclude,
  ): Promise<WritingProject | null> {
    return this.prisma.writingProject.findUnique({
      where: { id },
      include,
    });
  }

  /**
   * 根据ID和所有者查找项目（权限检查）
   */
  async findProjectByIdAndOwner(
    id: string,
    ownerId: string,
    include?: Prisma.WritingProjectInclude,
  ): Promise<WritingProject | null> {
    return this.prisma.writingProject.findFirst({
      where: { id, ownerId },
      include,
    });
  }

  /**
   * 创建写作项目
   */
  async createProject(
    data: Prisma.WritingProjectCreateInput,
    include?: Prisma.WritingProjectInclude,
  ): Promise<WritingProject> {
    return this.prisma.writingProject.create({
      data,
      include,
    });
  }

  /**
   * 更新写作项目
   */
  async updateProject(
    id: string,
    data: Prisma.WritingProjectUpdateInput,
    include?: Prisma.WritingProjectInclude,
  ): Promise<WritingProject> {
    return this.prisma.writingProject.update({
      where: { id },
      data,
      include,
    });
  }

  /**
   * 删除写作项目
   */
  async deleteProject(id: string): Promise<WritingProject> {
    return this.prisma.writingProject.delete({
      where: { id },
    });
  }

  /**
   * 统计项目数量
   */
  async countProjects(where: Prisma.WritingProjectWhereInput): Promise<number> {
    return this.prisma.writingProject.count({ where });
  }

  // ==================== WritingVolume Operations ====================

  /**
   * 查找项目的所有卷
   */
  async findVolumesByProjectId(
    projectId: string,
    include?: Prisma.WritingVolumeInclude,
  ): Promise<WritingVolume[]> {
    return this.prisma.writingVolume.findMany({
      where: { projectId },
      include,
      orderBy: { volumeNumber: "asc" },
    });
  }

  /**
   * 根据ID查找卷
   */
  async findVolumeById(
    id: string,
    include?: Prisma.WritingVolumeInclude,
  ): Promise<WritingVolume | null> {
    return this.prisma.writingVolume.findUnique({
      where: { id },
      include,
    });
  }

  /**
   * 创建卷
   */
  async createVolume(
    data: Prisma.WritingVolumeCreateInput,
    include?: Prisma.WritingVolumeInclude,
  ): Promise<WritingVolume> {
    return this.prisma.writingVolume.create({
      data,
      include,
    });
  }

  /**
   * 更新卷
   */
  async updateVolume(
    id: string,
    data: Prisma.WritingVolumeUpdateInput,
    include?: Prisma.WritingVolumeInclude,
  ): Promise<WritingVolume> {
    return this.prisma.writingVolume.update({
      where: { id },
      data,
      include,
    });
  }

  /**
   * 删除卷
   */
  async deleteVolume(id: string): Promise<WritingVolume> {
    return this.prisma.writingVolume.delete({
      where: { id },
    });
  }

  /**
   * 批量删除卷
   */
  async deleteManyVolumes(
    where: Prisma.WritingVolumeWhereInput,
  ): Promise<{ count: number }> {
    return this.prisma.writingVolume.deleteMany({
      where,
    });
  }

  // ==================== WritingChapter Operations ====================

  /**
   * 查找卷的所有章节
   */
  async findChaptersByVolumeId(
    volumeId: string,
    include?: Prisma.WritingChapterInclude,
  ): Promise<WritingChapter[]> {
    return this.prisma.writingChapter.findMany({
      where: { volumeId },
      include,
      orderBy: { chapterNumber: "asc" },
    });
  }

  /**
   * 查找项目的所有章节
   */
  async findChaptersByProjectId(
    projectId: string,
    include?: Prisma.WritingChapterInclude,
  ): Promise<WritingChapter[]> {
    return this.prisma.writingChapter.findMany({
      where: { volume: { projectId } },
      include,
      orderBy: [{ volume: { volumeNumber: "asc" } }, { chapterNumber: "asc" }],
    });
  }

  /**
   * 根据ID查找章节
   */
  async findChapterById(
    id: string,
    include?: Prisma.WritingChapterInclude,
  ): Promise<WritingChapter | null> {
    return this.prisma.writingChapter.findUnique({
      where: { id },
      include,
    });
  }

  /**
   * 创建章节
   */
  async createChapter(
    data: Prisma.WritingChapterCreateInput,
    include?: Prisma.WritingChapterInclude,
  ): Promise<WritingChapter> {
    return this.prisma.writingChapter.create({
      data,
      include,
    });
  }

  /**
   * 更新章节
   */
  async updateChapter(
    id: string,
    data: Prisma.WritingChapterUpdateInput,
    include?: Prisma.WritingChapterInclude,
  ): Promise<WritingChapter> {
    return this.prisma.writingChapter.update({
      where: { id },
      data,
      include,
    });
  }

  /**
   * 删除章节
   */
  async deleteChapter(id: string): Promise<WritingChapter> {
    return this.prisma.writingChapter.delete({
      where: { id },
    });
  }

  /**
   * 批量删除章节
   */
  async deleteManyChapters(
    where: Prisma.WritingChapterWhereInput,
  ): Promise<{ count: number }> {
    return this.prisma.writingChapter.deleteMany({
      where,
    });
  }

  /**
   * 统计章节数量
   */
  async countChapters(where: Prisma.WritingChapterWhereInput): Promise<number> {
    return this.prisma.writingChapter.count({ where });
  }

  /**
   * 按状态分组统计章节
   */
  async groupChaptersByStatus(projectId: string) {
    return this.prisma.writingChapter.groupBy({
      by: ["status"],
      where: { volume: { projectId } },
      _count: { status: true },
    });
  }

  // ==================== StoryBible Operations ====================

  /**
   * 查找项目的故事圣经
   */
  async findStoryBibleByProjectId(
    projectId: string,
    include?: Prisma.StoryBibleInclude,
  ) {
    return this.prisma.storyBible.findUnique({
      where: { projectId },
      include,
    });
  }

  /**
   * 创建故事圣经
   */
  async createStoryBible(data: Prisma.StoryBibleCreateInput) {
    return this.prisma.storyBible.create({
      data,
    });
  }

  /**
   * 更新故事圣经
   */
  async updateStoryBible(
    projectId: string,
    data: Prisma.StoryBibleUpdateInput,
  ) {
    return this.prisma.storyBible.update({
      where: { projectId },
      data,
    });
  }

  // ==================== Character Operations ====================

  /**
   * 查找故事圣经的所有角色
   */
  async findCharactersByBibleId(bibleId: string) {
    return this.prisma.writingCharacter.findMany({
      where: { bibleId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 根据ID查找角色
   */
  async findCharacterById(id: string) {
    return this.prisma.writingCharacter.findUnique({
      where: { id },
    });
  }

  /**
   * 创建角色
   */
  async createCharacter(data: Prisma.WritingCharacterCreateInput) {
    return this.prisma.writingCharacter.create({
      data,
    });
  }

  /**
   * 更新角色
   */
  async updateCharacter(id: string, data: Prisma.WritingCharacterUpdateInput) {
    return this.prisma.writingCharacter.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除角色
   */
  async deleteCharacter(id: string) {
    return this.prisma.writingCharacter.delete({
      where: { id },
    });
  }

  // ==================== WorldSetting Operations ====================

  /**
   * 查找故事圣经的所有世界设定
   */
  async findWorldSettingsByBibleId(bibleId: string) {
    return this.prisma.worldSetting.findMany({
      where: { bibleId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 创建世界设定
   */
  async createWorldSetting(data: Prisma.WorldSettingCreateInput) {
    return this.prisma.worldSetting.create({
      data,
    });
  }

  /**
   * 更新世界设定
   */
  async updateWorldSetting(id: string, data: Prisma.WorldSettingUpdateInput) {
    return this.prisma.worldSetting.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除世界设定
   */
  async deleteWorldSetting(id: string) {
    return this.prisma.worldSetting.delete({
      where: { id },
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
