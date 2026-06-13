import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  CreateWorldSettingData,
  UpdateWorldSettingData,
} from "./bible-entity.types";

@Injectable()
export class WorldSettingService {
  constructor(private readonly prisma: PrismaService) {}

  async create(bibleId: string, data: CreateWorldSettingData) {
    return this.prisma.worldSetting.create({
      data: {
        bibleId,
        category: data.category,
        name: data.name,
        description: data.description,
        rules: data.rules || [],
        references: data.references,
      },
    });
  }

  async findAll(bibleId: string) {
    return this.prisma.worldSetting.findMany({
      where: { bibleId },
      orderBy: { createdAt: "asc" },
    });
  }

  async findByCategory(bibleId: string, category: string) {
    return this.prisma.worldSetting.findMany({
      where: { bibleId, category },
    });
  }

  async update(id: string, data: UpdateWorldSettingData) {
    return this.prisma.worldSetting.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return this.prisma.worldSetting.delete({
      where: { id },
    });
  }
}
