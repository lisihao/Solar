/**
 * BaseMissionController —— 共享 ownership / store 注入 + assertOwnership helper
 *
 * 2026-05-15 PR-C god-class 拆分：原 playground.controller.ts (856 行)
 * 拆为 3 个聚焦 controller，共享 assertOwnership 行为。NestJS 装饰器在子类
 * 工作正常，本类不带 @Controller 装饰器，仅作 abstract base。
 */

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { MissionOwnershipRegistry } from "@/modules/ai-harness/facade";
import { assertResourceAccess } from "@/common/access/assert-resource-access";
import { MissionStore } from "../../mission/lifecycle/mission-store.service";

export abstract class BaseMissionController {
  constructor(
    protected readonly ownership: MissionOwnershipRegistry,
    protected readonly store: MissionStore,
  ) {}

  /**
   * 读访问守卫（IDOR 收口）：own ∨ PUBLIC，否则 404。返回 mission 所有者 userId，
   * 供调用方按所有者身份拉取数据（PUBLIC mission 跨用户可读时需用所有者 id 取行，
   * 因 `getById(id, userId)` 按 (id, userId) 过滤会对非所有者 miss）。
   *
   * 判定：先查内存 registry（fast path）—— 命中即所有者直接放行，返回 requester
   * 自身 id；miss 时经 `getAccessMetaById` 按 id（不带 userId 过滤）拿真实
   * {userId, visibility}，交 `assertResourceAccess` 统一判定（own ∨ PUBLIC，否则
   * 404 不泄露存在性）。查不到（meta=null）→ 404。判定逻辑集中在 `common/access`。
   *
   * ★ 写/取消/删除等变更操作请改用 {@link assertOwnership}（仅所有者）。
   */
  protected async assertReadAccess(
    missionId: string,
    userId?: string,
  ): Promise<string> {
    if (!userId) throw new ForbiddenException("Authentication required");
    // Fast path：registry 命中所有者 → 直接放行（所有者即 requester）。
    if (this.ownership.getOwner(missionId) === userId) return userId;

    // 按 id 取真实 owner + visibility（不带 userId 过滤），让 PUBLIC 真生效。
    const meta = await this.store.getAccessMetaById(missionId);
    if (!meta) throw new NotFoundException("Mission not found");

    // 命中所有者 → 重新登记 in-memory（下次 hot path），保留 ownership。
    if (meta.userId === userId) this.ownership.assign(missionId, userId);

    // 经 access 助手统一判定：own ∨ PUBLIC，否则 404。
    assertResourceAccess(
      { userId: meta.userId, visibility: meta.visibility },
      {
        userId,
      },
    );
    return meta.userId;
  }

  /**
   * 变更操作守卫：仅所有者放行（写/取消/删除）。沿用历史 403 语义。
   * Topic 角色（如 ADMIN 可代管）留待后续接入。
   */
  protected async assertOwnership(
    missionId: string,
    userId?: string,
  ): Promise<void> {
    if (!userId) throw new ForbiddenException("Authentication required");
    const owner = this.ownership.getOwner(missionId);
    if (owner) {
      if (owner !== userId) {
        throw new ForbiddenException(`mission ${missionId} not owned by you`);
      }
      return;
    }
    // Fallback: registry miss → 查 DB（按 id+userId 过滤，命中即所有者）。
    const persisted = await this.store.getById(missionId, userId);
    if (!persisted) {
      throw new ForbiddenException(`mission ${missionId} not found`);
    }
    this.ownership.assign(missionId, userId);
  }
}
