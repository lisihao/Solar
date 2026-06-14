import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * ApiFormat 目录服务（api_formats 表系统级 CRUD + 内置保护 / custom authStyle 规则）。
 * standards/24 薄网关整改（Wave C）：从 open-api/admin/providers/api-formats-admin
 * controller 下沉至 engine catalog 聚合。
 */
export interface ApiFormatInput {
  slug: string;
  name: string;
  authStyle: string;
  customHeaderName?: string;
  customHeaderPrefix?: string;
  description?: string;
  displayOrder?: number;
  isEnabled?: boolean;
}

@Injectable()
export class ApiFormatService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.apiFormat.findMany({
      where: { scope: "system" },
      orderBy: [{ isBuiltin: "desc" }, { displayOrder: "asc" }, { name: "asc" }],
    });
  }

  create(dto: ApiFormatInput) {
    if (dto.authStyle === "custom" && !dto.customHeaderName) {
      throw new BadRequestException("authStyle=custom 时必须填 customHeaderName");
    }
    return this.prisma.apiFormat.create({
      data: { ...dto, isBuiltin: false, scope: "system", ownerUserId: null },
    });
  }

  async update(id: string, dto: Partial<ApiFormatInput>) {
    const existing = await this.prisma.apiFormat.findUnique({ where: { id } });
    if (existing?.isBuiltin && dto.slug && dto.slug !== existing.slug) {
      throw new BadRequestException("不允许修改内置 ApiFormat 的 slug");
    }
    return this.prisma.apiFormat.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const existing = await this.prisma.apiFormat.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException("ApiFormat 不存在");
    if (existing.isBuiltin) {
      throw new BadRequestException("不允许删除内置 ApiFormat");
    }
    await this.prisma.apiFormat.delete({ where: { id } });
    return { success: true };
  }
}
