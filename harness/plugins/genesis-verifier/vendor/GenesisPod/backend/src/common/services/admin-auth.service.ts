import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * 管理员权限服务
 *
 * 统一管理管理员身份验证逻辑
 * 支持两种管理员认证方式：
 * 1. 用户 role 字段为 'ADMIN'
 * 2. 用户邮箱在环境变量 ADMIN_EMAILS 白名单中
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly adminEmails: string[];

  constructor(private readonly configService: ConfigService) {
    const emails = this.configService.get<string>("ADMIN_EMAILS", "");
    this.adminEmails = emails
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    this.logger.log(
      `AdminAuthService initialized with ${this.adminEmails.length} admin email(s)`,
    );
  }

  /**
   * 检查用户是否为管理员
   *
   * @param user - 用户对象，必须包含 role 和 email 字段
   * @returns true 表示是管理员，false 表示不是
   */
  isAdmin(user: { role?: string; email?: string }): boolean {
    if (!user) {
      return false;
    }

    // 检查 role 字段
    if (user.role === "ADMIN") {
      return true;
    }

    // 检查邮箱白名单（不区分大小写）
    if (
      user.email &&
      this.adminEmails.some((email) => email === user.email?.toLowerCase())
    ) {
      return true;
    }

    return false;
  }

  /**
   * 获取配置的管理员邮箱列表（用于调试和日志）
   *
   * @returns 管理员邮箱数组
   */
  getAdminEmails(): string[] {
    return [...this.adminEmails];
  }

  /**
   * 获取管理员邮箱数量
   *
   * @returns 管理员邮箱数量
   */
  getAdminEmailCount(): number {
    return this.adminEmails.length;
  }
}
