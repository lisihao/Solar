import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * AIProvider 目录服务（ai_providers 表系统级 provider CRUD，数据驱动 BYOK catalog）。
 * standards/24 薄网关整改（Wave C）：从 open-api/admin/providers/ai-providers-admin
 * controller 下沉至 engine catalog 聚合。
 */
export interface AiProviderInput {
  slug: string;
  name: string;
  endpoint: string;
  apiFormat: string;
  testModel: string;
  capabilities: string[];
  iconUrl?: string;
  description?: string;
  docUrl?: string;
  freeTierNote?: string;
  displayOrder?: number;
  isEnabled?: boolean;
}

@Injectable()
export class AiProviderService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.aIProvider.findMany({
      where: { scope: "system" },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
  }

  create(dto: AiProviderInput) {
    return this.prisma.aIProvider.create({
      data: { ...dto, scope: "system", ownerUserId: null },
    });
  }

  update(id: string, dto: Partial<AiProviderInput>) {
    return this.prisma.aIProvider.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.prisma.aIProvider.delete({ where: { id } });
    return { success: true };
  }
}
