/**
 * DailyBriefing controller — PR-DR2 P0-7 (X8 review finding)
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §4 / §6
 *
 * 路由：
 * - GET /api/v1/radar/topics/:topicId/daily-briefing[?date=YYYY-MM-DD]
 *   返回当日 briefing（无 date 则取 latest completed）
 *
 * 安全：JwtAuthGuard + ownership 校验（topics.getOwnedById）
 */
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { CacheService } from "@/common/cache/cache.service";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import {
  DailySignal,
  RadarDailyBriefingRepo,
} from "../../mission/services/briefing/radar-daily-briefing.repo";
import { RadarTopicService } from "../../mission/services/topic/radar-topic.service";

/** PR-DR2 收尾：原文来源 —— join RadarItem 得到，前端可点击追溯 */
export interface EvidenceSourceDto {
  name: string;
  url?: string;
  publishedAt: string;
}

export interface DailySignalDto {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  oneLineTakeaway: string;
  whyItMatters: string;
  whatsNext: string;
  signalTags: string[];
  entities: string[];
  evidenceItemIds: string[];
  /** 原文来源（多源全量，按 evidenceItemIds 原序）；无可解析来源时为空数组 */
  evidenceSources: EvidenceSourceDto[];
  narrativeId?: string;
}

export interface DailyBriefingDto {
  id: string;
  topicId: string;
  briefingDate: string;
  status: "completed" | "no_signals" | "generating";
  signals: DailySignalDto[];
  generationRunId?: string;
  /** FU-P2-4: 当日重新精选次数（用户首次自动生成不计入；手动 rerun 计入） */
  rerunCount: number;
  /** FU-P2-4: 是否还可继续 rerun（false → 前端禁用按钮） */
  canRerun: boolean;
}

/** R14 2026-05-19: 4 bucket 聚合 briefing 返回值 */
export type BriefingBucket = "today" | "week" | "month" | "year";

export interface BriefingRangeDto {
  bucket: BriefingBucket;
  /** UTC ISO 字符串，闭区间起点 */
  from: string;
  /** UTC ISO 字符串，闭区间终点（含今天） */
  to: string;
  /** 区间内每天的 briefing（按日升序），每条含 signals 数组 */
  briefings: Array<{
    id: string;
    briefingDate: string;
    status: "completed" | "no_signals" | "generating";
    signals: DailySignalDto[];
  }>;
  /** 扁平合并后所有 signal 总数（便于 UI 显示） */
  totalSignals: number;
}

@Controller("radar/topics")
@UseGuards(JwtAuthGuard)
export class DailyBriefingController {
  constructor(
    private readonly repo: RadarDailyBriefingRepo,
    private readonly topics: RadarTopicService,
    private readonly cache: CacheService,
  ) {}

  @Get(":topicId/daily-briefing")
  async get(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Query("date") date?: string,
  ): Promise<DailyBriefingDto | null> {
    await this.topics.getOwnedById(req.user.id, topicId);

    const row = date
      ? await this.repo.findByTopicAndDate(topicId, parseDate(date))
      : await this.repo.findLatestForTopic(topicId);
    if (!row) return null;

    // FU-P2-4: 读 Redis rerun 计数（与 radar-run.controller 共用 key）
    const dateStr = row.briefingDate.toISOString().slice(0, 10);
    let rerunCount = 0;
    try {
      const raw = await this.cache.get<number | string>(
        `radar:rerun:${topicId}:${dateStr}`,
      );
      rerunCount = typeof raw === "number" ? raw : Number(raw ?? 0) || 0;
    } catch {
      // fail-open：Redis 不可达 → 默认 0，仍可 rerun
    }

    const signals = (row.signals as unknown as DailySignal[]) ?? [];
    return {
      id: row.id,
      topicId: row.topicId,
      briefingDate: dateStr,
      status: row.status as DailyBriefingDto["status"],
      signals: await this.toSignalDtos(signals),
      generationRunId: row.generationRunId ?? undefined,
      rerunCount,
      canRerun: rerunCount < 2, // RERUN_LIMIT_PER_DAY in radar-run.controller
    };
  }

  /**
   * R14 2026-05-19: 4 bucket 聚合 briefing —— 解决「今日精选 0 信号
   * 但本周其实有 5 条」的可见性问题。range 把闭区间内 status=completed
   * 的 briefings 全部返回，前端可按日期分组渲染。
   */
  @Get(":topicId/daily-briefing/range")
  async range(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Query("bucket") bucket?: string,
  ): Promise<BriefingRangeDto> {
    await this.topics.getOwnedById(req.user.id, topicId);

    const validBuckets: BriefingBucket[] = ["today", "week", "month", "year"];
    const b = bucket as BriefingBucket;
    if (!validBuckets.includes(b)) {
      throw new BadRequestException(
        `invalid bucket: ${bucket} (allowed: ${validBuckets.join(", ")})`,
      );
    }

    const now = new Date();
    const { from, to } = computeBucketRange(b, now);
    const rows = await this.repo.findInRange(topicId, from, to);

    const briefings = await Promise.all(
      rows.map(async (row) => {
        const signals = (row.signals as unknown as DailySignal[]) ?? [];
        return {
          id: row.id,
          briefingDate: row.briefingDate.toISOString().slice(0, 10),
          status: row.status as "completed" | "no_signals" | "generating",
          signals: await this.toSignalDtos(signals),
        };
      }),
    );

    return {
      bucket: b,
      from: from.toISOString(),
      to: to.toISOString(),
      briefings,
      totalSignals: briefings.reduce((sum, b) => sum + b.signals.length, 0),
    };
  }

  /**
   * DailySignal → DTO，并 join evidenceItemIds → evidenceSources（多源全量，
   * 按 evidenceItemIds 原序）。一次批量查 RadarItem 防 N+1。
   */
  private async toSignalDtos(
    signals: DailySignal[],
  ): Promise<DailySignalDto[]> {
    const allIds = [
      ...new Set(signals.flatMap((s) => s.evidenceItemIds ?? [])),
    ];
    const sourceMap = await this.repo.findEvidenceSources(allIds);
    return signals.map((s) => ({
      id: s.id,
      tier: s.tier,
      title: s.title,
      oneLineTakeaway: s.oneLineTakeaway,
      whyItMatters: s.whyItMatters,
      whatsNext: s.whatsNext,
      signalTags: s.signalTags ?? [],
      entities: s.entities ?? [],
      evidenceItemIds: s.evidenceItemIds ?? [],
      evidenceSources: (s.evidenceItemIds ?? [])
        .map((id) => sourceMap.get(id))
        .filter((x): x is NonNullable<typeof x> => x != null)
        .map((x) => ({
          name: x.name,
          url: x.url ?? undefined,
          publishedAt: x.publishedAt,
        })),
      narrativeId: s.narrativeId,
    }));
  }
}

function parseDate(s: string): Date {
  // 'YYYY-MM-DD' → UTC 00:00 Date（Prisma @db.Date 不带时间）
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`invalid date: ${s}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/**
 * R14 2026-05-19: 4 bucket → [from, to] UTC 闭区间。
 *
 * 设计：
 *  - 周用 ISO week（周一开始 ~ 今天结束）
 *  - 月用日历月初 ~ 今天
 *  - 年用日历年初 ~ 今天
 *  - 今天单点
 */
function computeBucketRange(
  bucket: BriefingBucket,
  now: Date,
): { from: Date; to: Date } {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  switch (bucket) {
    case "today":
      return { from: today, to: today };
    case "week": {
      // dow: 0=Sun, 1=Mon, ..., 6=Sat → ISO 周一 0
      const dow = today.getUTCDay();
      const daysFromMonday = dow === 0 ? 6 : dow - 1;
      const monday = new Date(today);
      monday.setUTCDate(monday.getUTCDate() - daysFromMonday);
      return { from: monday, to: today };
    }
    case "month": {
      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      return { from: monthStart, to: today };
    }
    case "year": {
      const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { from: yearStart, to: today };
    }
  }
}
