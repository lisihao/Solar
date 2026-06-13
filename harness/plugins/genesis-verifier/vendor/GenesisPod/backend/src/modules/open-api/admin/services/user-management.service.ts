import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import * as bcrypt from "bcrypt";

/**
 * User Management Service
 * Handles all user-related operations for admin panel
 */
@Injectable()
export class UserManagementService {
  private readonly logger = new Logger(UserManagementService.name);
  private readonly adminEmails: string[];

  constructor(private prisma: PrismaService) {
    const emails = process.env.ADMIN_EMAILS || "";
    this.adminEmails = emails
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
  }

  /**
   * 获取所有用户列表
   */
  async getAllUsers(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { username: { contains: search, mode: "insensitive" as const } },
            { fullName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          username: true,
          fullName: true,
          role: true,
          avatarUrl: true,
          isActive: true,
          isVerified: true,
          oauthProvider: true,
          subscriptionTier: true,
          createdAt: true,
          lastLoginAt: true,
          creditAccount: {
            select: {
              balance: true,
              totalEarned: true,
              totalSpent: true,
              isFrozen: true,
            },
          },
          _count: {
            select: {
              notes: true,
              comments: true,
              collections: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // 标记管理员并添加积分信息
    const usersWithAdminFlag = users.map(
      (user: {
        email: string;
        role: string;
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
        isActive: boolean;
        isVerified: boolean;
        oauthProvider: string | null;
        subscriptionTier: string;
        createdAt: Date;
        lastLoginAt: Date | null;
        creditAccount: {
          balance: number;
          totalEarned: number;
          totalSpent: number;
          isFrozen: boolean;
        } | null;
        _count: { notes: number; comments: number; collections: number };
      }) => ({
        ...user,
        // Map fullName/username to name for frontend compatibility (prefer fullName)
        name: user.fullName || user.username,
        // Map isActive boolean to status string for frontend compatibility
        status: user.isActive ? "active" : "inactive",
        isAdmin: user.role === "ADMIN" || this.adminEmails.includes(user.email),
        credits: user.creditAccount
          ? {
              balance: user.creditAccount.balance,
              totalEarned: user.creditAccount.totalEarned,
              totalSpent: user.creditAccount.totalSpent,
              isFrozen: user.creditAccount.isFrozen,
            }
          : null,
      }),
    );

    return {
      users: usersWithAdminFlag,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 获取用户统计信息（用于管理仪表板）
   */
  async getUserStats() {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalUsers,
      activeUsers,
      weeklyActiveUsers,
      monthlyActiveUsers,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
      adminCount,
    ] = await Promise.all([
      // 总用户数
      this.prisma.user.count(),
      // 活跃用户数（isActive = true）
      this.prisma.user.count({ where: { isActive: true } }),
      // 周活跃用户数（过去7天有登录）
      this.prisma.user.count({
        where: { lastLoginAt: { gte: oneWeekAgo } },
      }),
      // 月活跃用户数（过去30天有登录）
      this.prisma.user.count({
        where: { lastLoginAt: { gte: oneMonthAgo } },
      }),
      // 今日新增用户
      this.prisma.user.count({
        where: { createdAt: { gte: today } },
      }),
      // 本周新增用户
      this.prisma.user.count({
        where: { createdAt: { gte: oneWeekAgo } },
      }),
      // 本月新增用户
      this.prisma.user.count({
        where: { createdAt: { gte: oneMonthAgo } },
      }),
      // 管理员数量
      this.prisma.user.count({ where: { role: "ADMIN" } }),
    ]);

    return {
      totalUsers,
      activeUsers,
      weeklyActiveUsers,
      monthlyActiveUsers,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
      adminCount,
    };
  }

  /**
   * 获取用户登录历史
   */
  async getUserLoginHistory(userId: string, limit = 10) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const history = await this.prisma.loginHistory.findMany({
      where: { userId },
      orderBy: { loginAt: "desc" },
      take: limit,
      select: {
        id: true,
        loginAt: true,
        ipAddress: true,
        device: true,
        browser: true,
        os: true,
        location: true,
      },
    });

    return {
      userId,
      email: user.email,
      history,
    };
  }

  /**
   * 创建新用户（管理员功能）
   */
  async createUser(data: {
    email: string;
    username?: string;
    role?: "USER" | "ADMIN";
    password?: string;
  }) {
    // 检查邮箱是否已存在
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      return { success: false, error: "Email already exists" };
    }

    // 如果提供了用户名，检查是否已存在
    if (data.username) {
      const existingUsername = await this.prisma.user.findUnique({
        where: { username: data.username },
      });
      if (existingUsername) {
        return { success: false, error: "Username already exists" };
      }
    }

    // 创建用户
    const userData: Prisma.UserCreateInput = {
      email: data.email,
      username: data.username || null,
      role: data.role || "USER",
      isActive: true,
      isVerified: true, // 管理员创建的用户默认已验证
    };

    // 如果提供了密码，哈希它
    if (data.password) {
      userData.passwordHash = await bcrypt.hash(data.password, 10);
    }

    const user = await this.prisma.user.create({
      data: userData,
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    // 创建积分账户
    await this.prisma.creditAccount.create({
      data: {
        userId: user.id,
        balance: 10000, // 默认初始积分
        totalEarned: 10000,
        totalSpent: 0,
      },
    });

    this.logger.log(`Admin created new user: ${user.email}`);

    return { success: true, ...user };
  }

  /**
   * 更新用户角色
   */
  async updateUserRole(userId: string, role: "USER" | "ADMIN") {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
      },
    });

    this.logger.log(`User ${userId} role updated to ${role}`);

    return updatedUser;
  }

  /**
   * 禁用/启用用户
   */
  async toggleUserStatus(userId: string, isActive: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: {
        id: true,
        email: true,
        username: true,
        isActive: true,
      },
    });

    this.logger.log(
      `User ${userId} status updated to ${isActive ? "active" : "inactive"}`,
    );

    return updatedUser;
  }

  /**
   * 更新用户信息
   */
  async updateUser(
    userId: string,
    data: {
      username?: string;
      role?: "USER" | "ADMIN";
      status?: "active" | "inactive" | "banned";
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const updateData: Prisma.UserUpdateInput = {};
    if (data.username !== undefined) updateData.username = data.username;
    if (data.role !== undefined) updateData.role = data.role;
    if (data.status !== undefined) {
      updateData.isActive = data.status === "active";
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
      },
    });

    this.logger.log(`User ${userId} updated`);
    return updatedUser;
  }

  /**
   * 删除用户
   */
  async deleteUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    // Delete user's related data first
    await this.prisma.$transaction([
      // Delete credit account if exists
      this.prisma.creditAccount.deleteMany({ where: { userId } }),
      // Delete user
      this.prisma.user.delete({ where: { id: userId } }),
    ]);

    this.logger.log(`User ${userId} deleted`);
    return { success: true, message: "User deleted successfully" };
  }

  /**
   * 检查用户是否是管理员
   */
  async isUserAdmin(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, role: true },
    });

    if (!user) return false;

    // 检查角色是否为 ADMIN 或者邮箱是否在管理员列表中
    return user.role === "ADMIN" || this.adminEmails.includes(user.email);
  }

  /**
   * 获取用户积分详情
   */
  async getUserCredits(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        creditAccount: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    return {
      userId,
      email: user.email,
      username: user.username,
      credits: user.creditAccount || null,
    };
  }

  /**
   * 给用户发放积分
   */
  async grantCredits(userId: string, amount: number, reason?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { creditAccount: true },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    // Create or update credit account
    const creditAccount = await this.prisma.creditAccount.upsert({
      where: { userId },
      create: {
        userId,
        balance: amount,
        totalEarned: amount,
        totalSpent: 0,
        isFrozen: false,
      },
      update: {
        balance: { increment: amount },
        totalEarned: { increment: amount },
      },
    });

    this.logger.log(
      `Granted ${amount} credits to user ${userId}. Reason: ${reason || "Admin grant"}`,
    );

    return {
      success: true,
      message: `Successfully granted ${amount} credits`,
      newBalance: creditAccount.balance,
    };
  }

  /**
   * 冻结/解冻用户积分账户
   */
  async toggleCreditFreeze(userId: string, freeze: boolean, reason?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { creditAccount: true },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    if (!user.creditAccount) {
      throw new NotFoundException(
        `User ${userId} does not have a credit account`,
      );
    }

    const updatedAccount = await this.prisma.creditAccount.update({
      where: { userId },
      data: { isFrozen: freeze },
    });

    this.logger.log(
      `User ${userId} credit account ${freeze ? "frozen" : "unfrozen"}${reason ? `: ${reason}` : ""}`,
    );

    return updatedAccount;
  }
}
