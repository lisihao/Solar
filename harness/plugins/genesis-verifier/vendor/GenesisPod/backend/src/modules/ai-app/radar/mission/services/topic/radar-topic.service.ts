import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  ContentVisibility,
  Prisma,
  RadarTopic,
  RadarTopicStatus,
} from "@prisma/client";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { computeNextCronTick } from "../scheduler/cron-util";
import {
  CreateRadarTopicDto,
  RadarEntityType,
  UpdateRadarTopicDto,
} from "../../../api/dto";
import { DEFAULT_REFRESH_CRON } from "../../../runtime/radar.constants";

const KEYWORD_MAX_LEN = 80;

// 5 段 cron 校验（与 DTO 同模式，service 内部 fallback）。
// 用 RegExp 构造器避免斜杠星号序列被 TSC 误判为块注释结束。
const CRON_REGEX = new RegExp(
  "^[\\d*/,-]+\\s+[\\d*/,-]+\\s+[\\d*/,-]+\\s+[\\d*/,-]+\\s+[\\d*/,-]+$",
);

/** 最小刷新间隔 10 分钟（防 LLM 暴账，scheduler 每分钟跑也不能引爆 budget） */
const MIN_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

@Injectable()
export class RadarTopicService {
  private readonly log = new Logger(RadarTopicService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateRadarTopicDto): Promise<RadarTopic> {
    const refreshCron = dto.refreshCron ?? DEFAULT_REFRESH_CRON;
    this.assertCron(refreshCron);
    const keywords = this.normalizeKeywords(dto.keywords);
    if (keywords.length === 0) {
      throw new BadRequestException("keywords 不能为空");
    }

    const topic = await this.prisma.radarTopic.create({
      data: {
        userId,
        name: dto.name.trim(),
        description: dto.description?.trim() ?? null,
        entityType: dto.entityType ?? null,
        keywords: keywords as Prisma.InputJsonValue,
        ...(dto.matchMode ? { matchMode: dto.matchMode } : {}),
        refreshCron,
        // ★ 2026-05-25: 新建 topic 默认「自动刷新关闭」(PAUSED)，避免每分钟
        //   调度器静默跑完整 mission 烧用户配额。用户在卡片上显式开启
        //   (resume → ACTIVE) 才进入 scheduler 扫描范围。
        //   nextDueAt 同步留空——PAUSED 不被 sweep，resume 时再置 now。
        status: RadarTopicStatus.PAUSED,
        nextDueAt: null,
      },
    });
    this.log.log(
      `Created radar topic id=${topic.id} user=${userId} name=${topic.name}`,
    );
    return topic;
  }

  async listByUser(
    userId: string,
    opts: {
      status?: RadarTopicStatus;
      limit?: number;
      cursor?: string;
      q?: string;
    } = {},
  ): Promise<{
    items: Array<
      RadarTopic & {
        counts: { sources: number; items: number; runs: number };
      }
    >;
    nextCursor: string | null;
  }> {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const q = opts.q?.trim();
    const rows = await this.prisma.radarTopic.findMany({
      where: {
        userId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: {
        _count: { select: { sources: true, items: true, runs: true } },
      },
    });
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items = sliced.map(({ _count, ...topic }) => ({
      ...topic,
      counts: {
        sources: _count.sources,
        items: _count.items,
        runs: _count.runs,
      },
    }));
    return {
      items,
      nextCursor: hasMore ? (sliced[sliced.length - 1]?.id ?? null) : null,
    };
  }

  async getOwnedById(userId: string, topicId: string): Promise<RadarTopic> {
    const topic = await this.prisma.radarTopic.findUnique({
      where: { id: topicId },
    });
    if (!topic) throw new NotFoundException("Radar topic not found");
    if (topic.userId !== userId) throw new ForbiddenException("Not owner");
    return topic;
  }

  /** 多租户可见性切换（仅所有者，getOwnedById 已强制 owner 校验）。 */
  async updateVisibility(
    userId: string,
    topicId: string,
    visibility: ContentVisibility,
  ): Promise<RadarTopic> {
    await this.getOwnedById(userId, topicId);
    return this.prisma.radarTopic.update({
      where: { id: topicId },
      data: { visibility },
    });
  }

  async update(
    userId: string,
    topicId: string,
    dto: UpdateRadarTopicDto,
  ): Promise<RadarTopic> {
    await this.getOwnedById(userId, topicId);
    if (dto.refreshCron) this.assertCron(dto.refreshCron);
    const data: Prisma.RadarTopicUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() ?? null;
    }
    if (dto.entityType !== undefined) {
      data.entityType = (dto.entityType ?? null) as RadarEntityType | null;
    }
    if (dto.keywords !== undefined) {
      const kw = this.normalizeKeywords(dto.keywords);
      if (kw.length === 0) {
        throw new BadRequestException("keywords 不能为空");
      }
      data.keywords = kw as Prisma.InputJsonValue;
    }
    if (dto.matchMode !== undefined) data.matchMode = dto.matchMode;
    if (dto.refreshCron !== undefined) data.refreshCron = dto.refreshCron;

    // 2026-05-19 R10：原 update 静默丢 PR-DR2 6 个 briefing 字段，用户改完
    // 「每日精选数量 / 信号类型 / 输出语言 / 推送方式 / 精选时间 / 周末跳过」
    // 保存后页面回显原值 —— 因为 service 根本没读这几个字段。
    if (dto.briefingTime !== undefined) data.briefingTime = dto.briefingTime;
    if (dto.briefingTimezone !== undefined)
      data.briefingTimezone = dto.briefingTimezone;
    if (dto.signalsTarget !== undefined) data.signalsTarget = dto.signalsTarget;
    if (dto.signalTypes !== undefined) data.signalTypes = dto.signalTypes;
    if (dto.weekendSkip !== undefined) data.weekendSkip = dto.weekendSkip;
    if (dto.outputLanguage !== undefined)
      data.outputLanguage = dto.outputLanguage;
    if (dto.pushConfig !== undefined) {
      data.pushConfig =
        dto.pushConfig === null
          ? Prisma.JsonNull
          : (dto.pushConfig as Prisma.InputJsonValue);
    }

    return this.prisma.radarTopic.update({ where: { id: topicId }, data });
  }

  async delete(userId: string, topicId: string): Promise<void> {
    await this.getOwnedById(userId, topicId);
    await this.prisma.radarTopic.delete({ where: { id: topicId } });
    this.log.log(`Deleted radar topic id=${topicId} user=${userId}`);
  }

  async pause(userId: string, topicId: string): Promise<RadarTopic> {
    await this.getOwnedById(userId, topicId);
    return this.prisma.radarTopic.update({
      where: { id: topicId },
      data: { status: RadarTopicStatus.PAUSED, nextDueAt: null },
    });
  }

  async resume(userId: string, topicId: string): Promise<RadarTopic> {
    await this.getOwnedById(userId, topicId);
    return this.prisma.radarTopic.update({
      where: { id: topicId },
      data: { status: RadarTopicStatus.ACTIVE, nextDueAt: new Date() },
    });
  }

  async archive(userId: string, topicId: string): Promise<RadarTopic> {
    await this.getOwnedById(userId, topicId);
    return this.prisma.radarTopic.update({
      where: { id: topicId },
      data: { status: RadarTopicStatus.ARCHIVED, nextDueAt: null },
    });
  }

  /**
   * 计数关联资源，给详情页/卡片展示用。
   */
  async getCounts(topicId: string) {
    const [sources, items, runs] = await Promise.all([
      this.prisma.radarSource.count({ where: { topicId } }),
      this.prisma.radarItem.count({ where: { topicId } }),
      this.prisma.radarRun.count({ where: { topicId } }),
    ]);
    return { sources, items, runs };
  }

  private assertCron(expr: string): void {
    if (!CRON_REGEX.test(expr)) {
      throw new BadRequestException(`非法 cron 表达式: ${expr}`);
    }
    // 计算前两次 tick 间隔，强制 ≥ MIN_REFRESH_INTERVAL_MS（10 分钟）
    const now = new Date();
    const t1 = computeNextCronTick(expr, now);
    if (!t1) {
      throw new BadRequestException(`cron 表达式无法解析: ${expr}`);
    }
    const t2 = computeNextCronTick(expr, t1);
    if (!t2) return;
    if (t2.getTime() - t1.getTime() < MIN_REFRESH_INTERVAL_MS) {
      throw new BadRequestException(
        `刷新间隔过短（最小 ${MIN_REFRESH_INTERVAL_MS / 60000} 分钟），请放宽 cron 表达式`,
      );
    }
  }

  private normalizeKeywords(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const set = new Set<string>();
    for (const v of raw) {
      if (typeof v !== "string") continue;
      const trimmed = v.trim();
      if (!trimmed) continue;
      if (trimmed.length > KEYWORD_MAX_LEN) continue;
      set.add(trimmed);
    }
    return Array.from(set);
  }
}
