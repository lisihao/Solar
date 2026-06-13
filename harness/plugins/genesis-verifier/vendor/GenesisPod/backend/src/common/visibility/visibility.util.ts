import { ForbiddenException } from "@nestjs/common";
import { ContentVisibility } from "@prisma/client";

/**
 * 多租户可见性 —— 公共能力（统一三档：PRIVATE / SHARED / PUBLIC）。
 *
 * 各 AI App 模块复用这里的助手，不各写一套：
 *  - `visibleWhere(ctx)`：列表查询的多租户过滤片段（own + 同工作区 SHARED + 全体 PUBLIC）。
 *  - `assertCanSetVisibility(ownerId, requesterId)`：仅所有者可改可见性。
 *
 * 约定：可见性的实体需带 `userId`（所有者）；若支持工作区共享还需 `workspaceId`。
 */

/** 列表多租户过滤：本人的全部 + 全体公开 + （有工作区时）同工作区共享。 */
export function visibleWhere(ctx: {
  userId: string;
  workspaceId?: string | null;
}): {
  OR: Array<Record<string, unknown>>;
} {
  const or: Array<Record<string, unknown>> = [
    { userId: ctx.userId },
    { visibility: ContentVisibility.PUBLIC },
  ];
  if (ctx.workspaceId) {
    or.push({
      visibility: ContentVisibility.SHARED,
      workspaceId: ctx.workspaceId,
    });
  }
  return { OR: or };
}

/** 仅资源所有者可修改其可见性，否则 403。 */
export function assertCanSetVisibility(
  ownerId: string,
  requesterId: string,
): void {
  if (ownerId !== requesterId) {
    throw new ForbiddenException("无权修改该资源的可见性");
  }
}
