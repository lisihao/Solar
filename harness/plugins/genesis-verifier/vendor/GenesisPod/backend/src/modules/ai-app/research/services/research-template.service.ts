import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * 研究模板目录服务（research_templates 表 CRUD + 内置保护 + 复制）。
 * standards/24 薄网关整改（Wave C）：原逻辑在 open-api/admin/research（T3 已下沉本域）
 * controller 内直接操作 Prisma；下沉到 ai-app/research 领域。controller 仅薄 HTTP。
 * DTO（class-validator）留在 open-api 边界；本服务取结构化输入。
 */
export interface ResearchTemplateInput {
  templateId: string;
  name: string;
  description?: string;
  category: string;
  dimensions: unknown;
  dataSources?: string[];
  guidancePrompt?: string;
  reportStructure?: unknown;
  iterationCount?: number;
  enabled?: boolean;
}

@Injectable()
export class ResearchTemplateService {
  private readonly logger = new Logger(ResearchTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  findAll(filter: { category?: string; enabled?: string }) {
    const where: Record<string, unknown> = {};
    if (filter.category) where.category = filter.category;
    if (filter.enabled !== undefined) where.enabled = filter.enabled === "true";
    return this.prisma.researchTemplate.findMany({
      where,
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  }

  async findOne(id: string) {
    const template = await this.prisma.researchTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException(`Research template ${id} not found`);
    }
    return template;
  }

  create(dto: ResearchTemplateInput) {
    this.logger.log(`Creating research template ${dto.templateId}`);
    return this.prisma.researchTemplate.create({
      data: {
        templateId: dto.templateId,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        dimensions: dto.dimensions as Prisma.InputJsonValue,
        dataSources: dto.dataSources ?? [],
        guidancePrompt: dto.guidancePrompt,
        reportStructure: dto.reportStructure as
          | Prisma.InputJsonValue
          | undefined,
        iterationCount: dto.iterationCount ?? 3,
        enabled: dto.enabled ?? true,
        isBuiltIn: false,
      },
    });
  }

  async update(id: string, dto: Partial<ResearchTemplateInput>) {
    this.logger.log(`Updating research template ${id}`);
    const existing = await this.prisma.researchTemplate.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Research template ${id} not found`);
    }
    return this.prisma.researchTemplate.update({
      where: { id },
      data: dto as Prisma.ResearchTemplateUpdateInput,
    });
  }

  async delete(id: string) {
    this.logger.log(`Deleting research template ${id}`);
    const existing = await this.prisma.researchTemplate.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Research template ${id} not found`);
    }
    if (existing.isBuiltIn) {
      throw new BadRequestException("Cannot delete built-in research template");
    }
    return this.prisma.researchTemplate.delete({ where: { id } });
  }

  async duplicate(id: string, copySuffix: string) {
    this.logger.log(`Duplicating research template ${id}`);
    const existing = await this.prisma.researchTemplate.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Research template ${id} not found`);
    }
    return this.prisma.researchTemplate.create({
      data: {
        templateId: `${existing.templateId}-copy-${copySuffix}`,
        name: `${existing.name} (Copy)`,
        description: existing.description,
        category: existing.category,
        dimensions: existing.dimensions as Prisma.InputJsonValue,
        dataSources: existing.dataSources,
        guidancePrompt: existing.guidancePrompt,
        reportStructure:
          (existing.reportStructure as Prisma.InputJsonValue | undefined) ??
          undefined,
        iterationCount: existing.iterationCount,
        enabled: existing.enabled,
        isBuiltIn: false,
        usageCount: 0,
      },
    });
  }
}
