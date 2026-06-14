import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";

@Injectable()
export class ReportTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async listTemplates(category?: string) {
    return this.prisma.reportTemplate.findMany({
      where: category ? { category } : undefined,
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  }

  async getTemplate(id: string) {
    return this.prisma.reportTemplate.findUnique({
      where: { id },
    });
  }
}
