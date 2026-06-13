import { Injectable } from "@nestjs/common";
import { AuthRequestStatus, AuthRequestType } from "@prisma/client";
import { SkillRegistry } from "../../../ai-engine/facade";
import { PrismaService } from "../../../../common/prisma/prisma.service";

/**
 * 2026-05-28 BYOK「我的技能」(授权版)：系统技能目录 + 当前用户的授权状态。
 * 目录源 = ai-engine SkillRegistry（项目唯一系统技能注册表）。
 * 状态 = AuthorizationGrant / AuthorizationRequest 里 type=SKILL_GRANT 的记录。
 */
export interface UserSkillItem {
  id: string;
  name: string;
  description: string;
  domain: string;
  layer: string;
  /** 已获未撤销未过期的 SKILL_GRANT */
  granted: boolean;
  /** 有 PENDING 的 SKILL_GRANT 申请 */
  pending: boolean;
  /** grant 到期时间（ISO，永久为 null） */
  grantExpiresAt: string | null;
}

@Injectable()
export class UserSkillsService {
  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly prisma: PrismaService,
  ) {}

  async listForUser(userId: string): Promise<UserSkillItem[]> {
    const skills = this.skillRegistry.getAll();
    const now = new Date();

    const [grants, pendings] = await Promise.all([
      this.prisma.authorizationGrant.findMany({
        where: {
          userId,
          type: AuthRequestType.SKILL_GRANT,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { targetId: true, expiresAt: true },
      }),
      this.prisma.authorizationRequest.findMany({
        where: {
          userId,
          type: AuthRequestType.SKILL_GRANT,
          status: AuthRequestStatus.PENDING,
        },
        select: { targetId: true },
      }),
    ]);

    const grantMap = new Map(grants.map((g) => [g.targetId, g.expiresAt]));
    const pendingSet = new Set(pendings.map((p) => p.targetId));

    return skills
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        domain: s.domain,
        layer: String(s.layer),
        granted: grantMap.has(s.id),
        pending: pendingSet.has(s.id),
        grantExpiresAt: grantMap.get(s.id)?.toISOString() ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
