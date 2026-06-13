import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { InputJsonValue } from "@prisma/client/runtime/library";
import { AddSourceDto } from "./dto";
import { FileParserService } from "./services/file-parser.service";

@Injectable()
export class SourceIngestionService {
  private readonly logger = new Logger(SourceIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileParserService: FileParserService,
  ) {}

  /**
   * Add a source to a project (with deduplication)
   */
  async addSource(userId: string, projectId: string, dto: AddSourceDto) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    const existingSource = await this.findDuplicateSource(
      projectId,
      dto.title,
      dto.sourceUrl,
      dto.resourceId,
    );

    if (existingSource) {
      this.logger.log(
        `Source already exists in project: ${existingSource.title}`,
      );
      return existingSource;
    }

    const source = await this.prisma.researchProjectSource.create({
      data: {
        projectId,
        title: dto.title,
        sourceType: dto.sourceType,
        sourceUrl: dto.sourceUrl,
        abstract: dto.abstract,
        content: dto.content,
        authors: dto.authors,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
        metadata: (dto.metadata || {}) as unknown as InputJsonValue,
        resourceId: dto.resourceId,
        analysisStatus: "PENDING",
      },
    });

    await this.prisma.researchProject.update({
      where: { id: projectId },
      data: {
        sourceCount: { increment: 1 },
      },
    });

    return source;
  }

  /**
   * Add multiple sources to a project (with deduplication)
   */
  async addSources(userId: string, projectId: string, sources: AddSourceDto[]) {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (project.userId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    const uniqueSources: AddSourceDto[] = [];
    for (const dto of sources) {
      const existingSource = await this.findDuplicateSource(
        projectId,
        dto.title,
        dto.sourceUrl,
        dto.resourceId,
      );
      if (!existingSource) {
        const isDuplicateInBatch = uniqueSources.some(
          (s) =>
            (s.title &&
              dto.title &&
              s.title.toLowerCase() === dto.title.toLowerCase()) ||
            (s.sourceUrl && s.sourceUrl === dto.sourceUrl) ||
            (s.resourceId && s.resourceId === dto.resourceId),
        );
        if (!isDuplicateInBatch) {
          uniqueSources.push(dto);
        }
      }
    }

    if (uniqueSources.length === 0) {
      this.logger.log("All sources already exist in project, skipping");
      return [];
    }

    this.logger.log(
      `Adding ${uniqueSources.length} unique sources (${sources.length - uniqueSources.length} duplicates skipped)`,
    );

    const createdSources = await this.prisma.$transaction(
      uniqueSources.map((dto) =>
        this.prisma.researchProjectSource.create({
          data: {
            projectId,
            title: dto.title,
            sourceType: dto.sourceType,
            sourceUrl: dto.sourceUrl,
            abstract: dto.abstract,
            content: dto.content,
            authors: dto.authors,
            publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
            metadata: (dto.metadata || {}) as unknown as InputJsonValue,
            resourceId: dto.resourceId,
            analysisStatus: "PENDING",
          },
        }),
      ),
    );

    await this.prisma.researchProject.update({
      where: { id: projectId },
      data: {
        sourceCount: { increment: uniqueSources.length },
      },
    });

    return createdSources;
  }

  /**
   * Upload and parse files as sources
   */
  async uploadFiles(
    userId: string,
    projectId: string,
    files: Express.Multer.File[],
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

    const results: Array<Record<string, unknown>> = [];
    const errors: Array<{ fileName: string; error: string }> = [];

    for (const file of files) {
      try {
        const parsed = await this.fileParserService.parseFile(file, userId);

        const existing = await this.findDuplicateSource(
          projectId,
          parsed.title,
          parsed.fileUrl,
          null,
        );

        if (existing) {
          this.logger.log(`File already exists: ${parsed.title}`);
          results.push(existing);
          continue;
        }

        const source = await this.prisma.researchProjectSource.create({
          data: {
            projectId,
            title: parsed.title,
            sourceType: "file",
            sourceUrl: parsed.fileUrl,
            abstract: parsed.abstract,
            content: parsed.content,
            metadata: {
              fileName: file.originalname,
              fileUrl: parsed.fileUrl,
              storageKey: parsed.metadata.storageKey,
              ...parsed.metadata,
            } as unknown as InputJsonValue,
            analysisStatus: "COMPLETED",
          },
        });

        results.push(source);
      } catch (error: unknown) {
        this.logger.error(
          `Failed to process file ${file.originalname}: ${error instanceof Error ? error.message : String(error)}`,
        );
        errors.push({
          fileName: file.originalname,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (results.length > 0) {
      await this.prisma.researchProject.update({
        where: { id: projectId },
        data: {
          sourceCount: { increment: results.length },
        },
      });
    }

    return { sources: results, errors };
  }

  /**
   * Find duplicate source in project by title, URL, or resourceId
   */
  private async findDuplicateSource(
    projectId: string,
    title: string,
    sourceUrl?: string | null,
    resourceId?: string | null,
  ) {
    const conditions: Array<{
      title?: { equals: string; mode: "insensitive" };
      sourceUrl?: { equals: string; mode: "insensitive" };
      resourceId?: string;
    }> = [];

    if (title) {
      conditions.push({ title: { equals: title, mode: "insensitive" } });
    }

    if (sourceUrl) {
      conditions.push({
        sourceUrl: { equals: sourceUrl, mode: "insensitive" },
      });
    }

    if (resourceId) {
      conditions.push({ resourceId: resourceId });
    }

    if (conditions.length === 0) {
      return null;
    }

    return this.prisma.researchProjectSource.findFirst({
      where: {
        projectId,
        OR: conditions,
      },
    });
  }
}
