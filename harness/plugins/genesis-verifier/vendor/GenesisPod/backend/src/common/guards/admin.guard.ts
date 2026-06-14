import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AdminAuthService } from "../services";

/**
 * 管理员守卫
 *
 * 检查当前用户是否为管理员
 * 必须在JwtAuthGuard之后使用
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminAuthService: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException("Authentication required");
    }

    // 从数据库获取用户完整信息
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true, email: true },
    });

    if (!dbUser) {
      throw new ForbiddenException("User not found");
    }

    // 使用 AdminAuthService 统一检查管理员权限
    const isAdmin = this.adminAuthService.isAdmin(dbUser);

    if (!isAdmin) {
      this.logger.warn(
        `Admin access denied for user ${dbUser.email} (role: ${dbUser.role}). ` +
          `Admin emails configured: ${this.adminAuthService.getAdminEmailCount()}`,
      );
      throw new ForbiddenException("Admin access required");
    }

    // 将isAdmin标记添加到请求中
    request.isAdmin = true;

    return true;
  }
}
