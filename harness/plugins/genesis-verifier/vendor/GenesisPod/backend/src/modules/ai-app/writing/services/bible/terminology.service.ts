import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  CreateTerminologyData,
  UpdateTerminologyData,
} from "./bible-entity.types";

@Injectable()
export class TerminologyService {
  constructor(private readonly prisma: PrismaService) {}

  async create(bibleId: string, data: CreateTerminologyData) {
    return this.prisma.terminology.create({
      data: {
        bibleId,
        term: data.term,
        definition: data.definition,
        category: data.category,
        variants: data.variants || [],
        usage: data.usage,
      },
    });
  }

  async findAll(bibleId: string) {
    return this.prisma.terminology.findMany({
      where: { bibleId },
      orderBy: { term: "asc" },
    });
  }

  async findByCategory(bibleId: string, category: string) {
    return this.prisma.terminology.findMany({
      where: { bibleId, category },
    });
  }

  async search(bibleId: string, query: string) {
    return this.prisma.terminology.findMany({
      where: {
        bibleId,
        OR: [
          { term: { contains: query, mode: "insensitive" } },
          { variants: { has: query } },
        ],
      },
    });
  }

  async update(id: string, data: UpdateTerminologyData) {
    return this.prisma.terminology.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return this.prisma.terminology.delete({
      where: { id },
    });
  }
}
