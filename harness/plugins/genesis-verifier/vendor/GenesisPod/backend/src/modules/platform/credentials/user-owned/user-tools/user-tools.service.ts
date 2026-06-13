import { Injectable } from "@nestjs/common";
import { AuthRequestType } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { EXTERNAL_TOOL_DEFINITIONS } from "@/modules/platform/credentials/storage/secrets/external-tool-definitions";

export interface UserToolItem {
  toolId: string;
  name: string;
  category: string;
  secretName: string;
  userConfigurable: boolean;
  /** 该用户有自己的同名 key（user-scoped secrets） */
  configured: boolean;
  /** admin 是否配了同名系统 secret（只返回 boolean，不泄露值/id） */
  systemConfigured: boolean;
  /** 该用户有未撤销未过期的 TOOL_GRANT */
  granted: boolean;
  /** 该用户现在能否直接使用此工具（自有 key / 授权 / FALLBACK 下平台兜底） */
  usable: boolean;
  /** 可用来源：user=自有 key, granted=被授权平台 key, platform=FALLBACK 平台兜底, none=不可用需配置 */
  source: "user" | "granted" | "platform" | "none";
}

/**
 * 用户工具目录服务（/me/tools 端点后端）
 *
 * 安全原则：
 * - systemConfigured 只返回 boolean，绝不返回 admin secret 的 hint / value / id（安全 high-3）
 * - 批量查询避免 N+1（一次 findMany 覆盖所有 secretName / toolId）
 */
@Injectable()
export class UserToolsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 返回用户可配置的工具目录，叠加「当前用户 Key 状态」。
   * 只列 userConfigurable !== false 且有 secretKeyName 的工具。
   */
  async listForUser(userId: string): Promise<UserToolItem[]> {
    // 1. 筛选可配置工具（跳过 noKeyRequired 和无 secretKeyName 的工具）
    const configurableTools = EXTERNAL_TOOL_DEFINITIONS.filter(
      (def) => def.userConfigurable !== false && !!def.secretKeyName,
    );

    if (configurableTools.length === 0) {
      return [];
    }

    const secretNames = configurableTools.map((d) => d.secretKeyName as string);
    const toolIds = configurableTools.map((d) => d.id);

    // 2. 批量查询（一次查完，不 N+1）：用户自有 key（user-scoped secrets）、
    //    admin 系统 secret、TOOL_GRANT、以及该用户的 toolKeyFallbackMode。
    const [userSecrets, adminSecrets, grants, user] = await Promise.all([
      // 用户工具 key 落 user-scoped secrets（W5 后 user_credentials 已退役）
      this.prisma.secret.findMany({
        where: { userId, deletedAt: null, name: { in: secretNames } },
        select: { name: true },
      }),
      // admin 系统 secret（userId=null）——只取 boolean，不返回值
      this.prisma.secret.findMany({
        where: { userId: null, isActive: true, name: { in: secretNames } },
        select: { name: true },
      }),
      this.prisma.authorizationGrant.findMany({
        where: {
          userId,
          type: AuthRequestType.TOOL_GRANT,
          revokedAt: null,
          targetId: { in: [...toolIds, ...secretNames] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { targetId: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { toolKeyFallbackMode: true },
      }),
    ]);

    const userKeySet = new Set(userSecrets.map((s) => s.name));
    const adminSecretSet = new Set(adminSecrets.map((s) => s.name));
    const grantTargetSet = new Set(grants.map((g) => g.targetId));
    // schema 默认 FALLBACK（工具开箱即用）；此处仅当 user 记录缺失/为 null 时保守不兜底。
    const fallback = user?.toolKeyFallbackMode === "FALLBACK";

    return configurableTools.map((def) => {
      const secretName = def.secretKeyName as string;
      const configured = userKeySet.has(secretName);
      const granted =
        grantTargetSet.has(def.id) || grantTargetSet.has(secretName);
      const systemConfigured = adminSecretSet.has(secretName);

      // 可用性 + 来源：自有 key > 授权平台 key > FALLBACK 平台兜底 > 不可用
      let source: UserToolItem["source"];
      if (configured) source = "user";
      else if (granted) source = "granted";
      else if (systemConfigured && fallback) source = "platform";
      else source = "none";

      return {
        toolId: def.id,
        name: def.name,
        category: def.category,
        secretName,
        userConfigurable: true,
        configured,
        systemConfigured,
        granted,
        usable: source !== "none",
        source,
      };
    });
  }
}
