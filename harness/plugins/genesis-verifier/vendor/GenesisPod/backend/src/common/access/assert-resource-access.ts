import { NotFoundException } from "@nestjs/common";
import { ContentVisibility } from "@prisma/client";

/**
 * 资源访问收口（IDOR 修复）—— 统一 ownership / visibility 判定的纯逻辑助手。
 *
 * 与 `common/visibility/visibleWhere`（列表过滤）互补：本助手做**单资源读访问**
 * 的逐条判定，覆盖 controller 拿到具体资源后的 200/404 决策。
 *
 * 放行条件（任一满足）：
 *  1. own —— `resource.userId === requester.userId`
 *  2. PUBLIC —— `visibility === PUBLIC`
 *
 * 无权时抛 `NotFoundException`（404，不泄露资源存在性），而非 403。
 *
 * 纯逻辑 + 强类型，不直连 DB，保持可单测。
 */

export interface ResourceAccessSubject {
  /** 资源所有者 userId。 */
  readonly userId: string;
  /** 资源可见性档位。缺省按 PRIVATE 处理（仅所有者）。 */
  readonly visibility?: ContentVisibility | null;
}

export interface ResourceAccessRequester {
  readonly userId: string;
}

/**
 * 判定 requester 能否读访问 resource，无权抛 404。
 *
 * @throws NotFoundException 当 requester 既非所有者、又非 PUBLIC。
 */
export function assertResourceAccess(
  resource: ResourceAccessSubject,
  requester: ResourceAccessRequester,
): void {
  // 1. own
  if (resource.userId === requester.userId) return;

  const visibility = resource.visibility ?? ContentVisibility.PRIVATE;

  // 2. PUBLIC
  if (visibility === ContentVisibility.PUBLIC) return;

  // 无权 → 404（不泄露存在性）
  throw new NotFoundException("Resource not found");
}
