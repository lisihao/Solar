/**
 * DailyBriefingGeneratorService — PR-DR2 P0-8 (X8 PM 评审整改)
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §8.3 K3 + §11.2
 *
 * 职责：
 * - 独立于 ai-harness mission pipeline，从 DB 直接读已采集 + 已评分的 RadarItem
 * - 运行 Stage A 评分 + signal-editor LLM + repo.upsert + event emit
 * - 由 BullMQ Processor 调用（radar-briefing queue 'daily' job）
 *
 * 复用：SignalEditorService / RadarDailyBriefingRepo / scoring.ts
 *      不复用 S9 pipeline stage（避免拖整 mission framework；
 *      S9 stage 仍在 refresh mission 路径 reuse 同样的 service-level 逻辑）
 */
import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RADAR_PIPELINE_DEFAULTS } from "../../../runtime/radar.constants";
import {
  RadarDailyBriefingRepo,
  type DailySignal,
} from "./radar-daily-briefing.repo";
import {
  SignalEditorService,
  type SignalEditorInput,
} from "./signal-editor.service";
import {
  selectCandidatePool,
  type StageAInput,
} from "../../pipeline/stages/scoring";
import {
  RADAR_BRIEFING_GENERATED_METRIC,
  RADAR_BRIEFING_SIGNAL_CREATED_EVENT,
  type RadarBriefingGeneratedMetric,
  type RadarBriefingSignalCreatedEvent,
} from "../../pipeline/stages/s9-daily-top-n.stage";
import { loadSkill } from "../skill-md-loader";

export interface GenerateInput {
  topicId: string;
  userId: string;
  /** 用户本地日 'YYYY-MM-DD' */
  briefingDate: string;
  /** 从 BullMQ jobId 派生的 mission id（observability） */
  missionId: string;
  /**
   * R13 2026-05-19：手动 rerun 时 force=true 跳过幂等检查。
   * BullMQ 自动调度时不传（默认 false）保留幂等防重复跑。
   */
  force?: boolean;
}

export interface GenerateOutput {
  status: "completed" | "no_signals";
  selectedCount: number;
  candidatesCount: number;
}

@Injectable()
export class DailyBriefingGeneratorService {
  private readonly log = new Logger(DailyBriefingGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dailyRepo: RadarDailyBriefingRepo,
    private readonly signalEditor: SignalEditorService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async generateForTopic(input: GenerateInput): Promise<GenerateOutput> {
    const briefingDate = parseUtcDate(input.briefingDate);

    // 1. 幂等：今日已有 briefing → 直接返回（onDailyBriefingGenerated 不会重复 dispatch）
    //
    // R13 2026-05-19：手动 rerun 路径（radar-run.controller "重新精选" 完成
    // 后 fire-and-forget 调用 generateForTopic）必须强制重生 —— 否则用户
    // 点完按钮永远看到原来的 no_signals 结果，无法验证修复。BullMQ 自动调度
    // 仍传 force=false 保留幂等。
    if (!input.force) {
      const existing = await this.dailyRepo.findByTopicAndDate(
        input.topicId,
        briefingDate,
      );
      if (existing && existing.status !== "generating") {
        this.log.debug(
          `[${input.missionId}] briefing already exists topic=${input.topicId} date=${input.briefingDate} status=${existing.status} — skip`,
        );
        const signals = (existing.signals as unknown as DailySignal[]) ?? [];
        return {
          status: existing.status as "completed" | "no_signals",
          selectedCount: signals.length,
          candidatesCount: 0,
        };
      }
    }

    // 2. 加载 topic + 已采集已评分的 accepted item（昨日 + 今日，跨日延续 entity 用昨日）
    const topic = await this.prisma.radarTopic.findUnique({
      where: { id: input.topicId },
    });
    if (!topic) throw new Error(`topic not found: ${input.topicId}`);

    // 读今日采集窗口内的 accepted item（fetchedAt 在 briefingDate 当日 UTC 内）
    const dayStart = new Date(briefingDate);
    const dayEnd = new Date(briefingDate);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const items = await this.prisma.radarItem.findMany({
      where: {
        topicId: input.topicId,
        accepted: true,
        publishedAt: { gte: dayStart, lt: dayEnd },
      },
      include: { source: true },
      orderBy: { publishedAt: "desc" },
    });

    // 3. Stage A 评分（B1）
    //
    // R13 2026-05-19 P0 BUG 修复 —— 双除 100 永远 0 信号
    // scoring.computeStageAScore 内部已经把 0-100 归一到 0-1（见
    // scoring.ts:65）。这里之前先 `(item.relevanceScore ?? 0) / 100` 再传
    // 进去 → scoring 又 /100 → 实际 score ≈ 0.001 → 全部低于
    // STAGE_A_SCORE_THRESHOLD=0.55 → candidatePool 永远空 → no_signals。
    // 修：传原始 0-100，让 scoring 内部一次归一即可。
    const relevanceMin = RADAR_PIPELINE_DEFAULTS.relevanceThreshold;
    const stageAInputs: StageAInput[] = [];
    for (const item of items) {
      if ((item.relevanceScore ?? 0) < relevanceMin) continue;
      stageAInputs.push({
        item: {
          id: item.id,
          publishedAt: item.publishedAt,
          metrics: (item.metrics as Record<string, unknown> | null) ?? null,
        },
        source: {
          id: item.sourceId,
          authorityWeight: item.source.authorityWeight,
        },
        relevanceScore: item.relevanceScore ?? 0,
        qualityScore: item.qualityScore ?? undefined,
      });
    }
    const candidatePool = selectCandidatePool(stageAInputs);
    this.log.log(
      `[${input.missionId}] Stage A: ${stageAInputs.length} scored → ${candidatePool.length} candidates`,
    );

    if (candidatePool.length === 0) {
      await this.persistAndEmit({
        topicId: input.topicId,
        userId: input.userId,
        briefingDate,
        signals: [],
        missionId: input.missionId,
        candidatesCount: 0,
      });
      return { status: "no_signals", selectedCount: 0, candidatesCount: 0 };
    }

    // 4. signal-editor LLM（B2 + B3 跨日延续 boost）
    const yesterdayTopEntities = await this.dailyRepo.getYesterdayEntities(
      input.topicId,
      briefingDate,
    );
    const itemById = new Map(items.map((i) => [i.id, i]));
    const keywords = Array.isArray(topic.keywords)
      ? (topic.keywords as unknown[]).filter(
          (k): k is string => typeof k === "string",
        )
      : [];

    const editorInput: SignalEditorInput = {
      topic: {
        id: topic.id,
        name: topic.name,
        description: topic.description,
        keywords,
        signalTypes: parseSignalTypes(topic.signalTypes) ?? [],
        outputLanguage: (topic.outputLanguage as "zh-CN" | "en-US") ?? "zh-CN",
      },
      candidates: candidatePool.map((c) => {
        const item = itemById.get(c.itemId);
        return {
          itemId: c.itemId,
          title: item?.title ?? "",
          content: item?.content ?? "",
          source: item?.source.label ?? item?.source.identifier ?? "",
          publishedAt: item?.publishedAt ?? new Date(),
          score: c.score,
          relevance: c.components.relevance,
          quality: c.components.quality,
        };
      }),
      yesterdayTopEntities,
      targetN: 5,
    };

    const signals = await this.signalEditor.edit(
      editorInput,
      loadSignalEditorPrompt(),
    );

    // 5. 回填 Stage A score（observability）
    const scoreById = new Map(candidatePool.map((c) => [c.itemId, c.score]));
    for (const s of signals) {
      if (s.evidenceItemIds.length > 0) {
        s.score = scoreById.get(s.evidenceItemIds[0]);
      }
    }

    await this.persistAndEmit({
      topicId: input.topicId,
      userId: input.userId,
      briefingDate,
      signals,
      missionId: input.missionId,
      candidatesCount: candidatePool.length,
    });

    return {
      status: signals.length === 0 ? "no_signals" : "completed",
      selectedCount: signals.length,
      candidatesCount: candidatePool.length,
    };
  }

  private async persistAndEmit(input: {
    topicId: string;
    userId: string;
    briefingDate: Date;
    signals: DailySignal[];
    missionId: string;
    candidatesCount: number;
  }): Promise<void> {
    const status = input.signals.length === 0 ? "no_signals" : "completed";

    await this.dailyRepo.upsert({
      topicId: input.topicId,
      userId: input.userId,
      briefingDate: input.briefingDate,
      signals: input.signals,
      status,
      generationRunId: input.missionId,
    });

    // B10: 每条 tier=3 emit
    for (const signal of input.signals) {
      if (signal.tier === 3) {
        const event: RadarBriefingSignalCreatedEvent = {
          userId: input.userId,
          topicId: input.topicId,
          signal,
        };
        this.eventEmitter.emit(RADAR_BRIEFING_SIGNAL_CREATED_EVENT, event);
      }
    }

    // B20: metric emit（onDailyBriefingGenerated 接力做 RADAR_DAILY dispatch）
    const tier3 = input.signals.filter((s) => s.tier === 3).length;
    const tier2 = input.signals.filter((s) => s.tier === 2).length;
    const tier1 = input.signals.filter((s) => s.tier === 1).length;
    const avgWhyLen =
      input.signals.length === 0
        ? 0
        : Math.round(
            input.signals.reduce(
              (sum, s) => sum + (s.whyItMatters?.length ?? 0),
              0,
            ) / input.signals.length,
          );
    const metric: RadarBriefingGeneratedMetric = {
      topicId: input.topicId,
      userId: input.userId,
      missionId: input.missionId,
      candidatesCount: input.candidatesCount,
      selectedCount: input.signals.length,
      tier3Count: tier3,
      tier2Count: tier2,
      tier1Count: tier1,
      avgWhyItMattersLen: avgWhyLen,
      briefingDate: input.briefingDate.toISOString().slice(0, 10),
    };
    this.eventEmitter.emit(RADAR_BRIEFING_GENERATED_METRIC, metric);

    this.log.log(
      `[${input.missionId}] briefing persisted: status=${status} selected=${input.signals.length} tier3=${tier3}`,
    );
  }
}

function parseUtcDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`invalid date: ${s}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

let cachedSignalEditorPrompt: string | null = null;
function loadSignalEditorPrompt(): string {
  if (cachedSignalEditorPrompt) return cachedSignalEditorPrompt;
  const skill = loadSkill("signal-editor");
  const sections: string[] = [];
  if (skill.soul) sections.push(skill.soul);
  for (const dutyName of skill.frontmatter.duties) {
    sections.push(skill.duties[dutyName]);
  }
  cachedSignalEditorPrompt = sections.join("\n\n---\n\n");
  return cachedSignalEditorPrompt;
}

function parseSignalTypes(
  raw: unknown,
):
  | Array<
      | "turning_point"
      | "trend_acceleration"
      | "new_entity"
      | "anomaly"
      | "key_event"
    >
  | undefined {
  if (!Array.isArray(raw)) return undefined;
  const allowed = new Set([
    "turning_point",
    "trend_acceleration",
    "new_entity",
    "anomaly",
    "key_event",
  ] as const);
  return raw.filter(
    (
      v,
    ): v is
      | "turning_point"
      | "trend_acceleration"
      | "new_entity"
      | "anomaly"
      | "key_event" => typeof v === "string" && allowed.has(v as never),
  );
}
