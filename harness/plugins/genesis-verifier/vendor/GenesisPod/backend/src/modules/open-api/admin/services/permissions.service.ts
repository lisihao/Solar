import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  async getPermissionsOverview() {
    const [totalUsers, adminCount, activeUsers, recentNewUsers, admins] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { role: "ADMIN" } }),
        this.prisma.user.count({ where: { isActive: true } }),
        this.prisma.user.count({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        }),
        this.prisma.user.findMany({
          where: { role: "ADMIN" },
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            createdAt: true,
            lastLoginAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      ]);

    return {
      totalUsers,
      adminCount,
      activeUsers,
      recentNewUsers,
      admins,
    };
  }
}
