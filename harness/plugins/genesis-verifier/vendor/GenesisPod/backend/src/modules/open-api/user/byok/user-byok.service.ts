import { Injectable } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  KeyResolverService,
  UserApiKeysService,
} from "@/modules/ai-harness/facade";

/**
 * 用户 BYOK 公共能力（可用模型 / 引导状态）。
 *
 * 从 open-api 薄控制器下沉的业务逻辑（律4：controller 不直接注入 Prisma）。
 * 直接查 AIModel 表，不经 ai-engine/ModelResolver，避免反向层依赖；模型高级路由
 * 仍由 ai-engine 内部负责，这里只给 UI 展示可选项。
 */
@Injectable()
export class UserByokService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keyResolver: KeyResolverService,
    private readonly userApiKeys: UserApiKeysService,
  ) {}

  async getAvailableModels(userId: string, modelType?: string) {
    const providers = await this.keyResolver.getAvailableProviders(userId);
    const effectiveType: AIModelType =
      modelType && Object.values(AIModelType).includes(modelType as AIModelType)
        ? (modelType as AIModelType)
        : AIModelType.CHAT;

    const models =
      providers.length > 0
        ? await this.prisma.aIModel.findMany({
            where: {
              isEnabled: true,
              modelType: effectiveType,
              provider: {
                in: providers.map((p) => p.toLowerCase()),
                mode: "insensitive",
              },
            },
            orderBy: [{ priority: "desc" }, { name: "asc" }],
            select: {
              id: true,
              name: true,
              displayName: true,
              modelId: true,
              provider: true,
              modelType: true,
              isReasoning: true,
              maxTokens: true,
              priority: true,
            },
          })
        : [];

    return { availableProviders: providers, modelType: effectiveType, models };
  }

  async completeOnboarding(userId: string) {
    await this.userApiKeys.markOnboardedIfNeeded(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { byokOnboardedAt: true },
    });
    return { byokOnboardedAt: user?.byokOnboardedAt ?? null };
  }

  async getOnboardingStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { byokOnboardedAt: true, role: true },
    });
    return {
      byokOnboardedAt: user?.byokOnboardedAt ?? null,
      isAdmin: user?.role === "ADMIN",
      requiresOnboarding:
        user?.role !== "ADMIN" && user?.byokOnboardedAt === null,
    };
  }
}
