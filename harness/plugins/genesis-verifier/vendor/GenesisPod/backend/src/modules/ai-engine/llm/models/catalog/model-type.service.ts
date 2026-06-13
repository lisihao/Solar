import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * ModelType 目录服务（model_types 表的系统级 CRUD + 内置保护规则）。
 *
 * standards/24 薄网关整改（Wave C）：原逻辑在 open-api/admin/providers/
 * model-types.controller 内直接操作 Prisma；下沉到 engine 的 catalog
 * 聚合（模型类型字典属 LLM 模型目录领域），controller 仅保留薄 HTTP + 委派。
 */
export interface ModelTypeInput {
  slug: string;
  name: string;
  description?: string;
  category: string;
  defaultApiFormat?: string;
  displayOrder?: number;
  isEnabled?: boolean;
}

@Injectable()
export class ModelTypeService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.modelType.findMany({
      where: { scope: "system" },
      orderBy: [{ isBuiltin: "desc" }, { displayOrder: "asc" }, { name: "asc" }],
    });
  }

  create(dto: ModelTypeInput) {
    return this.prisma.modelType.create({
      data: { ...dto, isBuiltin: false, scope: "system", ownerUserId: null },
    });
  }

  async update(id: string, dto: Partial<ModelTypeInput>) {
    const existing = await this.prisma.modelType.findUnique({ where: { id } });
    if (existing?.isBuiltin && dto.slug && dto.slug !== existing.slug) {
      throw new BadRequestException("不允许修改内置 ModelType 的 slug");
    }
    return this.prisma.modelType.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const existing = await this.prisma.modelType.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException("ModelType 不存在");
    if (existing.isBuiltin) {
      throw new BadRequestException("不允许删除内置 ModelType");
    }
    await this.prisma.modelType.delete({ where: { id } });
    return { success: true };
  }
}
