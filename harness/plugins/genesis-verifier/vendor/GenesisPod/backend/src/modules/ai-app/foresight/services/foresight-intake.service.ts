import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  AiChatService,
  ContentSourceRegistry,
} from "@/modules/ai-engine/facade";

interface TopicLayerDef {
  id: string;
  name: string;
}

export interface DraftCard {
  layer: string;
  title: string;
  claim: string;
  conf: number;
  sens: "high" | "mid" | "low";
  horizon: number;
  stage: "current" | "evolving" | "exploring" | "research";
  evidence: string[];
  falsifiers: string[];
  sources: Array<{ org: string; title: string; type: string; url: string }>;
}

/**
 * ForesightIntakeService —— 雷达/洞察 → 前瞻的供料通道（P2/P3，2026-06-12）。
 *
 * 两条线都走 engine ContentSourceRegistry（AI_RADAR / AI_PLAYGROUND），
 * 不直接 import 兄弟 app —— 与 CLAUDE.md「App 间经 registry 中转」红线一致。
 *
 * P2 scanRadar：拉用户雷达近期高分信号 → 与本主题全部 falsifier 做 LLM 匹配
 *   （deterministic）→ 命中的生成候选 ForesightSignal（强信号可注入/弱信号仅关注）。
 *   匹配判定是初筛，注入仍要人过依据档案 —— 人是信号确认的守门员。
 *
 * P3 extractFromMission：取一份已完成洞察 mission 报告 → LLM 按主题层级本体
 *   抽取 3-6 张草稿假设卡（falsifier 缺失的直接丢弃 —— 入库门槛）→ 返回给前端
 *   人工审核，逐张经 createCard 入库（originType=insight-mission）。
 */
@Injectable()
export class ForesightIntakeService {
  private readonly logger = new Logger(ForesightIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ContentSourceRegistry,
    private readonly aiChat: AiChatService,
  ) {}

  // ── P2: 雷达信号扫描 ──────────────────────────────────────────────────

  async scanRadar(
    userId: string,
    topicId: string,
  ): Promise<{ scanned: number; matched: number; created: number }> {
    const topic = await this.requireTopic(userId, topicId);
    const cards = await this.prisma.foresightCard.findMany({
      where: { topicId },
      select: {
        id: true,
        cardKey: true,
        title: true,
        conf: true,
        falsifiers: true,
      },
    });
    const withFals = cards
      .map((c) => ({
        ...c,
        falsifiers: (c.falsifiers as string[] | null) ?? [],
      }))
      .filter((c) => c.falsifiers.length > 0);
    if (withFals.length === 0) {
      throw new BadRequestException(
        "主题还没有带证伪信号（falsifier）的假设卡 —— 先录入假设，扫描才有匹配目标",
      );
    }

    const radar = this.registry.get("AI_RADAR");
    if (!radar) {
      throw new ServiceUnavailableException(
        "雷达内容源未注册（后端未启用 RadarModule）",
      );
    }
    const { items } = await radar.listItems(userId, { limit: 30 });
    if (items.length === 0) {
      return { scanned: 0, matched: 0, created: 0 };
    }

    const prompt = [
      `你是战略洞察系统的信号匹配器。下面是「${topic.name}」主题的假设卡证伪条件清单，以及用户雷达最近采集的资讯信号。`,
      `任务：判断每条资讯是否命中某条预登记的证伪/监测条件。只有语义上确实构成该条件的证据（或强烈迹象）才算命中——主题相关但不构成条件命中的不算。`,
      ``,
      `## 假设卡证伪条件`,
      ...withFals.map(
        (c) =>
          `- ${c.cardKey}「${c.title}」: ${c.falsifiers.map((f, i) => `[${i}] ${f}`).join("； ")}`,
      ),
      ``,
      `## 雷达信号（index 从 0 开始）`,
      ...items.map(
        (it, idx) =>
          `[${idx}] ${it.title}${it.preview ? ` — ${it.preview.slice(0, 160)}` : ""}`,
      ),
      ``,
      `输出严格 JSON（无其他文字）：`,
      `{"matches":[{"index":0,"cardKey":"A-L0-01","falsifier":"命中的条件原文","grade":"strong|weak","direction":"down|up","reason":"为何构成命中，一句话"}]}`,
      `grade 判定：单一来源/传闻=weak；明确事实/官方口径=strong。direction：证伪假设=down，强化约束类假设=up。无命中输出 {"matches":[]}。`,
    ].join("\n");

    const response = await this.aiChat.chat({
      messages: [{ role: "user", content: prompt }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "deterministic", outputLength: "medium" },
    });
    const parsed = this.parseJson<{
      matches?: Array<{
        index: number;
        cardKey: string;
        falsifier: string;
        grade: string;
        direction: string;
        reason: string;
      }>;
    }>(response.content ?? "");
    const matches = (parsed.matches ?? []).filter(
      (m) =>
        Number.isInteger(m.index) &&
        m.index >= 0 &&
        m.index < items.length &&
        withFals.some((c) => c.cardKey === m.cardKey),
    );

    /* 去重：同主题下同名信号不重复创建 */
    const existing = await this.prisma.foresightSignal.findMany({
      where: { topicId },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((s) => s.name));

    let created = 0;
    for (const m of matches) {
      const item = items[m.index];
      const card = withFals.find((c) => c.cardKey === m.cardKey)!;
      if (existingNames.has(item.title)) continue;
      const direction = m.direction === "up" ? "up" : "down";
      const grade = m.grade === "strong" ? "strong" : "weak";
      const targetConf =
        direction === "up"
          ? Math.min(0.95, +(card.conf + 0.15).toFixed(2))
          : Math.max(0.05, +(card.conf - 0.2).toFixed(2));
      await this.prisma.foresightSignal.create({
        data: {
          userId,
          topicId,
          name: item.title,
          targetCardId: card.id,
          direction,
          targetConf,
          grade,
          effect:
            direction === "up"
              ? `约束收紧信号命中 ${card.cardKey}「${card.title}」— 裁定后置信度 ${card.conf.toFixed(2)} → ${targetConf.toFixed(2)}。`
              : `证伪信号命中 ${card.cardKey}「${card.title}」— 裁定后置信度 ${card.conf.toFixed(2)} → ${targetConf.toFixed(2)}。`,
          basis: {
            falsifier: m.falsifier,
            dir:
              direction === "up"
                ? "约束收紧方向 — 命中后置信度上调"
                : "证伪方向 — 命中后置信度下调",
            gradeNote: m.reason,
            observed: item.preview?.slice(0, 200) ?? item.title,
            sources: [
              {
                org: "AI 雷达",
                title: item.title,
                type: "report",
                url: "",
              },
            ],
          } as Prisma.InputJsonValue,
        },
      });
      existingNames.add(item.title);
      created++;
    }

    this.logger.log(
      `foresight radar-scan: topic=${topicId} scanned=${items.length} matched=${matches.length} created=${created}`,
    );
    return { scanned: items.length, matched: matches.length, created };
  }

  // ── P3: 洞察 mission 抽取 ─────────────────────────────────────────────

  async listInsightMissions(userId: string) {
    const source = this.registry.get("AI_PLAYGROUND");
    if (!source) return [];
    const { items } = await source.listItems(userId, { limit: 20 });
    return items;
  }

  async extractFromMission(
    userId: string,
    topicId: string,
    sourceId: string,
  ): Promise<{ drafts: DraftCard[]; missionTitle: string }> {
    const topic = await this.requireTopic(userId, topicId);
    const layers = (topic.layers as TopicLayerDef[] | null) ?? [];
    if (layers.length === 0) {
      throw new BadRequestException("主题未定义层级本体");
    }
    const source = this.registry.get("AI_PLAYGROUND");
    if (!source) {
      throw new ServiceUnavailableException("洞察内容源未注册");
    }
    const bundles = await source.fetchBundle([sourceId], userId);
    const bundle = bundles[0];
    if (!bundle?.body) {
      throw new NotFoundException("mission 报告不存在或为空");
    }

    const prompt = [
      `你是战略前瞻系统的假设卡抽取器。从下面的深度洞察报告中，按「${topic.name}」主题的层级本体抽取 3-6 张可证伪的假设卡。`,
      ``,
      `## 层级本体（layer 字段只能取这些 id）`,
      ...layers.map((l) => `- ${l.id}: ${l.name}`),
      ``,
      `## 假设卡纪律`,
      `- claim 必须具体可检验，带量化指标和时间窗，不要"正确的废话"`,
      `- falsifiers 必填 ≥1 条：什么可观测信号出现说明该假设错了（写不出的不要输出这张卡）`,
      `- conf 0-1（基于报告证据强度），sens: high|mid|low（该假设翻了下游影响多大）`,
      `- stage: current(已落地)|evolving(演进中)|exploring(探索验证)|research(研究前沿)`,
      `- evidence 从报告中提炼 1-3 条要点；sources 引用报告里出现的真实来源（无则空数组）`,
      ``,
      `## 报告（截断）`,
      bundle.body.slice(0, 14000),
      ``,
      `输出严格 JSON（无其他文字）：`,
      `{"cards":[{"layer":"","title":"","claim":"","conf":0.6,"sens":"mid","horizon":2028,"stage":"exploring","evidence":[""],"falsifiers":[""],"sources":[{"org":"","title":"","type":"report","url":""}]}]}`,
    ].join("\n");

    const response = await this.aiChat.chat({
      messages: [{ role: "user", content: prompt }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "low", outputLength: "long" },
    });
    const parsed = this.parseJson<{ cards?: Array<Partial<DraftCard>> }>(
      response.content ?? "",
    );
    const layerIds = new Set(layers.map((l) => l.id));
    const drafts: DraftCard[] = (parsed.cards ?? [])
      .filter(
        (c) =>
          typeof c.title === "string" &&
          typeof c.claim === "string" &&
          Array.isArray(c.falsifiers) &&
          c.falsifiers.length > 0,
      )
      .slice(0, 8)
      .map((c) => ({
        layer: layerIds.has(c.layer ?? "") ? (c.layer as string) : layers[0].id,
        title: (c.title as string).slice(0, 200),
        claim: c.claim as string,
        conf: Math.min(0.95, Math.max(0.05, Number(c.conf) || 0.5)),
        sens: c.sens === "high" || c.sens === "low" ? c.sens : "mid",
        horizon:
          Number.isInteger(c.horizon) &&
          (c.horizon as number) >= 2024 &&
          (c.horizon as number) <= 2045
            ? (c.horizon as number)
            : 2028,
        stage:
          c.stage === "current" ||
          c.stage === "evolving" ||
          c.stage === "research"
            ? c.stage
            : "exploring",
        evidence: (c.evidence ?? []).filter((x) => typeof x === "string"),
        falsifiers: (c.falsifiers ?? []).filter((x) => typeof x === "string"),
        sources: (c.sources ?? []).filter(
          (s) => s && typeof s.org === "string" && typeof s.title === "string",
        ),
      }));

    this.logger.log(
      `foresight extract: topic=${topicId} mission=${sourceId} drafts=${drafts.length}`,
    );
    return { drafts, missionTitle: bundle.title };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private async requireTopic(userId: string, id: string) {
    const topic = await this.prisma.foresightTopic.findFirst({
      where: { id, userId },
    });
    if (!topic) throw new NotFoundException("topic not found");
    return topic;
  }

  /** 容错解析 LLM JSON 输出（剥 markdown 围栏 / 截取首个对象） */
  private parseJson<T>(raw: string): T {
    const stripped = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end <= start) return {} as T;
    try {
      return JSON.parse(stripped.slice(start, end + 1)) as T;
    } catch {
      this.logger.warn(
        `foresight intake: LLM JSON parse failed (len=${raw.length})`,
      );
      return {} as T;
    }
  }
}
