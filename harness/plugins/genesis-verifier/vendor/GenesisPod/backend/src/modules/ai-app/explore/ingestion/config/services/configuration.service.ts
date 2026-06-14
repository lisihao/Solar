import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CollectionConfiguration } from "@prisma/client";

@Injectable()
export class ConfigurationService {
  constructor(private prisma: PrismaService) {}

  async getConfigs(resourceType: string): Promise<CollectionConfiguration[]> {
    return this.prisma.collectionConfiguration.findMany({
      where: { resourceType },
    });
  }

  async updateStatus(
    id: string,
    isActive: boolean,
  ): Promise<CollectionConfiguration> {
    return this.prisma.collectionConfiguration.update({
      where: { id },
      data: { isActive },
    });
  }

  async deleteConfig(id: string): Promise<CollectionConfiguration> {
    return this.prisma.collectionConfiguration.delete({
      where: { id },
    });
  }
}
