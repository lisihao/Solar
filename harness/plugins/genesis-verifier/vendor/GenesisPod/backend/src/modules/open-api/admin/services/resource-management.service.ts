import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";

/**
 * Resource Management Service
 * Handles resource deletion operations for admin panel
 */
@Injectable()
export class ResourceManagementService {
  private readonly logger = new Logger(ResourceManagementService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 删除资源
   */
  async deleteResource(resourceId: string) {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
    });

    if (!resource) {
      throw new NotFoundException(`Resource ${resourceId} not found`);
    }

    await this.prisma.resource.delete({
      where: { id: resourceId },
    });

    this.logger.log(`Resource deleted: ${resourceId} (${resource.title})`);

    return { success: true, message: "Resource deleted successfully" };
  }

  /**
   * 批量删除资源
   */
  async deleteResources(resourceIds: string[]) {
    const result = await this.prisma.resource.deleteMany({
      where: { id: { in: resourceIds } },
    });

    this.logger.log(`Deleted ${result.count} resources`);

    return {
      success: true,
      message: `Deleted ${result.count} resources`,
      count: result.count,
    };
  }
}
