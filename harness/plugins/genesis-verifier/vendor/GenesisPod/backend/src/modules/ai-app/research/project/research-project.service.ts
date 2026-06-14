import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  CreateStudioProjectDto,
  UpdateProjectDto,
  SedimentToInsightsDto,
} from "./dto";

@Injectable()
export class ResearchProjectService {
  private readonly logger = new Logger(ResearchProjectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a new research project
   */
  async createProject(userId: string, dto: CreateStudioProjectDto) {
    return this.prisma.researchProject.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description,
        icon: dto.icon || "📚",
        color: dto.color || "#6366f1",
        researchType: dto.researchType || "DEEP",
        visibility: dto.visibility || "PRIVATE",
        lastAccessAt: new Date(),
        ...(dto.crossModuleSource && {
          crossModuleSource: dto.crossModuleSource,
        }),
      },
      include: {
        _count: {
          select: {
            sources: true,
            notes: true,
            chats: true,
            outputs: true,
          },
        },
      },
    });
  }

  /**
   * Get all projects for a user
   */
  async getProjects(
    userId: string,
    options?: {
      status?: "ACTIVE" | "ARCHIVED";
      search?: string;
      researchType?: "FAST" | "DEEP";
      take?: number;
      skip?: number;
    },
  ) {
    const statusFilter = options?.status || "ACTIVE";
    const baseConditions: Record<string, unknown> = {
      status: statusFilter,
    };

    if (options?.researchType) {
      baseConditions.researchType = options.researchType;
    }

    const searchConditions = options?.search
      ? [
          { name: { contains: options.search, mode: "insensitive" as const } },
          {
            description: {
              contains: options.search,
              mode: "insensitive" as const,
            },
          },
        ]
      : undefined;

    // Include user's own projects + public projects from others
    const where: Record<string, unknown> = {
      ...baseConditions,
      OR: [
        {
          userId,
          ...(searchConditions ? { OR: searchConditions } : {}),
        },
        {
          visibility: "PUBLIC",
          userId: { not: userId },
          ...(searchConditions ? { OR: searchConditions } : {}),
        },
      ],
    };

    const [projects, total] = await Promise.all([
      this.prisma.researchProject.findMany({
        where,
        orderBy: { lastAccessAt: "desc" },
        take: options?.take || 20,
        skip: options?.skip || 0,
        include: {
          _count: {
            select: {
              sources: true,
              notes: true,
              chats: true,
              outputs: true,
            },
          },
        },
      }),
      this.prisma.researchProject.count({ where }),
    ]);

    return {
      data: projects,
      pagination: {
        total,
        take: options?.take || 20,
        skip: options?.skip || 0,
      },
    };
  }

  /**
   * Get a single project by ID
   */
  async getProject(userId: string, projectId: string) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
      include: {
        sources: {
          orderBy: { createdAt: "desc" },
        },
        notes: {
          orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
        },
        chats: {
          orderBy: { createdAt: "desc" },
          take: 1, // Only get the most recent chat
        },
        outputs: {
          orderBy: { createdAt: "desc" },
        },
        _count: {
          select: {
            sources: true,
            notes: true,
            chats: true,
            outputs: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    const isOwner = project.userId === userId;
    const isPublic = project.visibility === "PUBLIC";

    if (!isOwner && !isPublic) {
      throw new ForbiddenException("Access denied");
    }

    // Update last access time only for the owner
    if (isOwner) {
      await this.prisma.researchProject.update({
        where: { id: projectId },
        data: { lastAccessAt: new Date() },
      });
    }

    return project;
  }

  /**
   * Update a project
   */
  async updateProject(
    userId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    return this.prisma.researchProject.update({
      where: { id: projectId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.icon && { icon: dto.icon }),
        ...(dto.color && { color: dto.color }),
        ...(dto.status && { status: dto.status }),
        ...(dto.visibility && { visibility: dto.visibility }),
      },
      include: {
        _count: {
          select: {
            sources: true,
            notes: true,
            chats: true,
            outputs: true,
          },
        },
      },
    });
  }

  /**
   * Delete a project (soft delete)
   */
  async deleteProject(userId: string, projectId: string) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    return this.prisma.researchProject.update({
      where: { id: projectId },
      data: { status: "DELETED" },
    });
  }

  /**
   * Archive a project
   */
  async archiveProject(userId: string, projectId: string) {
    return this.updateProject(userId, projectId, { status: "ARCHIVED" });
  }

  /**
   * Restore an archived project
   */
  async restoreProject(userId: string, projectId: string) {
    return this.updateProject(userId, projectId, { status: "ACTIVE" });
  }

  /**
   * Sediment research output to AI Insights (Topic Insights module)
   * Calls the Topic Insights API via HTTP with the user's JWT token.
   */
  async sedimentToInsights(
    userId: string,
    projectId: string,
    dto: SedimentToInsightsDto,
    userToken: string,
  ): Promise<{
    success: boolean;
    result: {
      mode: "add_dimension" | "new_topic";
      topicId: string | undefined;
      dimensionId: string | undefined;
      topicName: string | undefined;
      dimensionName: string;
      viewUrl: string;
    };
  }> {
    // Verify the output belongs to the project and user
    const output = await this.prisma.researchProjectOutput.findFirst({
      where: {
        id: dto.outputId,
        projectId,
        project: { userId },
      },
      include: { project: true },
    });

    if (!output) {
      throw new NotFoundException("Output not found");
    }

    if (output.status !== "COMPLETED") {
      throw new BadRequestException("Output is not completed");
    }

    const contentText =
      typeof output.content === "string" ? output.content.slice(0, 500) : "";

    const apiBase = this.configService.get<string>(
      "APP_URL",
      "http://localhost:3001",
    );
    const headers: Record<string, string> = {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    };

    if (dto.mode === "add_dimension") {
      if (!dto.targetTopicId) {
        throw new BadRequestException(
          "targetTopicId required for add_dimension mode",
        );
      }

      const dimName = dto.dimensionName || output.title.slice(0, 200);
      const dimDesc = dto.dimensionDescription || contentText;

      this.logger.log(
        `Sedimenting output "${output.title}" to topic ${dto.targetTopicId} as dimension`,
      );

      const resp = await fetch(
        `${apiBase}/api/v1/topic-insights/topics/${dto.targetTopicId}/dimensions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ name: dimName, description: dimDesc }),
        },
      );

      if (!resp.ok) {
        this.logger.error(`Failed to add dimension: ${resp.statusText}`);
        throw new BadRequestException(
          `Failed to add dimension: ${resp.statusText}`,
        );
      }

      const result = (await resp.json()) as {
        data?: { id?: string; topicId?: string };
        id?: string;
        topicId?: string;
      };
      const dimData = result.data ?? result;

      return {
        success: true,
        result: {
          mode: "add_dimension",
          topicId: dto.targetTopicId,
          dimensionId: dimData.id,
          topicName: undefined,
          dimensionName: dimName,
          viewUrl: `/ai-insights/topic/${dto.targetTopicId}`,
        },
      };
    } else {
      // new_topic mode
      const topicName = dto.topicName || output.title.slice(0, 200);
      const topicType = dto.topicType || "MACRO_INSIGHT";

      this.logger.log(
        `Sedimenting output "${output.title}" to new topic "${topicName}"`,
      );

      const topicResp = await fetch(`${apiBase}/api/v1/topic-insights/topics`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: topicName,
          type: topicType,
          description: dto.topicDescription || contentText,
        }),
      });

      if (!topicResp.ok) {
        this.logger.error(`Failed to create topic: ${topicResp.statusText}`);
        throw new BadRequestException(
          `Failed to create topic: ${topicResp.statusText}`,
        );
      }

      const topicResult = (await topicResp.json()) as {
        data?: { id?: string };
        id?: string;
      };
      const topicData = topicResult.data ?? topicResult;
      const newTopicId = topicData.id;

      if (!newTopicId) {
        throw new BadRequestException(
          "Failed to get new topic ID from response",
        );
      }

      // Add first dimension from the output
      const dimName = dto.dimensionName || output.title.slice(0, 200);
      const dimResp = await fetch(
        `${apiBase}/api/v1/topic-insights/topics/${newTopicId}/dimensions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ name: dimName, description: contentText }),
        },
      );

      if (!dimResp.ok) {
        this.logger.error(
          `Failed to add dimension to new topic: ${dimResp.statusText}`,
        );
        throw new BadRequestException(
          `Failed to add dimension: ${dimResp.statusText}`,
        );
      }

      return {
        success: true,
        result: {
          mode: "new_topic",
          topicId: newTopicId,
          dimensionId: undefined,
          topicName,
          dimensionName: dimName,
          viewUrl: `/ai-insights/topic/${newTopicId}`,
        },
      };
    }
  }
}
