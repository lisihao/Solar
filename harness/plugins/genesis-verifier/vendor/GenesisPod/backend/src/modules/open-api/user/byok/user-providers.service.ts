import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { UpsertCustomProviderDto } from "./user-providers.dto";

/**
 * 用户自定义 AI Provider CRUD（scope=user / ownerUserId=self）。
 * 从 open-api 薄控制器下沉（律4：controller 不直接注入 Prisma）。
 */
@Injectable()
export class UserProvidersService {
  constructor(private readonly prisma: PrismaService) {}

  /** 列出当前用户的 user-scope provider */
  list(userId: string) {
    return this.prisma.aIProvider.findMany({
      where: { scope: "user", ownerUserId: userId },
      orderBy: [{ name: "asc" }],
    });
  }

  create(userId: string, dto: UpsertCustomProviderDto) {
    return this.prisma.aIProvider.create({
      data: { ...dto, scope: "user", ownerUserId: userId },
    });
  }

  async update(
    userId: string,
    id: string,
    dto: Partial<UpsertCustomProviderDto>,
  ) {
    await this.assertOwned(userId, id);
    return this.prisma.aIProvider.update({ where: { id }, data: dto });
  }

  async remove(userId: string, id: string) {
    await this.assertOwned(userId, id);
    await this.prisma.aIProvider.delete({ where: { id } });
    return { success: true };
  }

  /** 只能操作自己的 user-scope provider */
  private async assertOwned(userId: string, id: string) {
    const existing = await this.prisma.aIProvider.findFirst({
      where: { id, scope: "user", ownerUserId: userId },
    });
    if (!existing) {
      throw new ForbiddenException("Provider not found or not owned by you");
    }
  }
}
