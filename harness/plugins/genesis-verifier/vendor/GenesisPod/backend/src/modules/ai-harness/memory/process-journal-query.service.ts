import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * 进程事件日志（process_events）查询服务。
 * standards/24 薄网关整改（Wave C）：kernel.controller 的 listJournal 直接查 Prisma
 * 下沉至此（process event journal 属 harness 运行时数据域）。
 */
@Injectable()
export class ProcessJournalQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listJournal(filter: { processId?: string; type?: string; take: number }) {
    const where: Record<string, unknown> = {};
    if (filter.processId) where.processId = filter.processId;
    if (filter.type) where.type = filter.type;
    try {
      const [entries, total] = await Promise.all([
        this.prisma.processEvent.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: filter.take,
        }),
        this.prisma.processEvent.count({ where }),
      ]);
      return { entries, total };
    } catch {
      return { entries: [], total: 0 };
    }
  }
}
