/**
 * Topic Access Guard
 *
 * ★ Security: 统一权限检查机制
 *
 * 用于保护需要专题访问权限的端点
 * 必须在 JwtAuthGuard 之后使用
 *
 * 使用方式：
 * @RequireTopicAccess(CollaboratorRole.EDITOR)
 * @Post('topics/:id/leader/plan')
 * async leaderPlan() { ... }
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TopicCollaboratorService } from "../services";
import { CollaboratorRole } from "../dto/collaborator.dto";
import { createSecurityLogger } from "../utils/security-audit-logger";

// ==================== Metadata Key ====================

export const TOPIC_ACCESS_KEY = "topic_access_role";

// ==================== Decorator ====================

/**
 * 装饰器：指定端点需要的专题访问权限
 *
 * @param role 需要的最低权限级别
 *
 * @example
 * @RequireTopicAccess(CollaboratorRole.EDITOR)
 * @Post('topics/:id/leader/plan')
 * async leaderPlan() { ... }
 */
export const RequireTopicAccess = (role: CollaboratorRole) =>
  SetMetadata(TOPIC_ACCESS_KEY, role);

// ==================== Guard ====================

@Injectable()
export class TopicAccessGuard implements CanActivate {
  private readonly logger = new Logger(TopicAccessGuard.name);
  private readonly securityLogger = createSecurityLogger("TopicAccessGuard");

  constructor(
    private readonly reflector: Reflector,
    private readonly collaboratorService: TopicCollaboratorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const handler = context.getHandler().name;

    // 1. 检查用户是否已认证
    if (!user?.id) {
      throw new ForbiddenException("Authentication required");
    }

    // 2. 获取需要的权限级别
    const requiredRole = this.reflector.getAllAndOverride<CollaboratorRole>(
      TOPIC_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 如果没有设置权限要求，默认通过
    if (!requiredRole) {
      return true;
    }

    // 3. 从路由参数获取 topicId
    const topicId = this.extractTopicId(request);
    if (!topicId) {
      this.logger.warn("TopicAccessGuard: No topicId found in route params");
      throw new ForbiddenException("Topic ID required");
    }

    // 4. 检查权限
    const hasAccess = await this.collaboratorService.hasAccess(
      topicId,
      user.id,
      requiredRole,
    );

    // ★ Security: 记录访问控制事件
    this.securityLogger.logAccessControl({
      userId: user.id,
      topicId,
      requiredRole,
      hasAccess,
      action: `${handler} - ${request.method} ${request.url}`,
    });

    if (!hasAccess) {
      throw new ForbiddenException(this.getAccessDeniedMessage(requiredRole));
    }

    // 5. 将 topicId 添加到请求中，方便后续使用
    request.topicId = topicId;

    return true;
  }

  /**
   * 从请求中提取 topicId
   * 支持多种参数命名：id, topicId
   */
  private extractTopicId(request: {
    params?: Record<string, string>;
    body?: Record<string, unknown>;
  }): string | undefined {
    return (
      request.params?.topicId ||
      request.params?.id ||
      (request.body?.topicId as string | undefined)
    );
  }

  /**
   * 根据权限级别返回对应的拒绝消息
   */
  private getAccessDeniedMessage(role: CollaboratorRole): string {
    switch (role) {
      case CollaboratorRole.ADMIN:
        return "需要管理员权限";
      case CollaboratorRole.EDITOR:
        return "需要编辑权限";
      case CollaboratorRole.VIEWER:
        return "需要查看权限";
      default:
        return "无权访问该专题";
    }
  }
}
