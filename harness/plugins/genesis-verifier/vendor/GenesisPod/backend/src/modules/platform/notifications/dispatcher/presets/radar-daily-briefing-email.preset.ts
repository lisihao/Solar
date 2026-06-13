/**
 * RadarDailyBriefingEmailPreset —— FU2-B
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §4.2 + §7.2 + §7.3.3 邮件 footer
 *
 * 职责：
 *   - 签发 1 个 multi-scope token（scopes=['topic','radar_all','global']）
 *   - 拼装 4 个 url（topic / radar_all / global / topic 详情页 / 设置页）
 *   - 调 HandlebarsRendererService.render → HTML
 *   - 拼 DispatchPayload.emailContext.html 给 NotificationDispatcher
 *
 * 复用：
 *   - UnsubscribeTokenService.issueMultiScope（FU2-A）
 *   - HandlebarsRendererService.render（FU2 共享渲染）
 *   - NotificationDispatcher.dispatch（B11 路径）
 */
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HandlebarsRendererService } from "../../../email/rendering/handlebars-renderer.service";
import { NotificationDispatcher } from "../notification-dispatcher.service";
import { UnsubscribeTokenService } from "../preferences/unsubscribe-token.service";

interface DailySignalEmailInput {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  oneLineTakeaway: string;
  whyItMatters: string;
  whatsNext: string;
  signalTags: string[];
  entities: string[];
  /** 证据 item id 列表（来自 DailySignal.evidenceItemIds，模板用 length 显示数量） */
  evidenceItemIds: string[];
  /** 可选：富化后的来源名单（preset 不强制 join；为空时模板不渲染 "from" 段） */
  evidenceSources?: Array<{ name: string; url?: string }>;
  narrativeId?: string | null;
}

export interface RadarDailyBriefingEmailInput {
  userId: string;
  locale: "zh-CN" | "en-US";
  topicId: string;
  topicName: string;
  briefingDate: string; // YYYY-MM-DD
  briefingTime: string; // HH:MM
  candidatesCount: number;
  signals: DailySignalEmailInput[];
  /**
   * narrativeId → 延续叙事元信息（设计 §4.3 daily 邮件含 narrativeMap）。
   * 模板用 `{{lookup ../narrativeMap signal.narrativeId "label/episode/timelineUrl"}}`
   * 渲染 "📰 narrative · 第 N 集 · 查看前情 →" 卡片。
   * caller 不传 / 为空 → 模板 silent skip 不渲染 narrative 区。
   */
  narrativeMap?: Record<
    string,
    { label: string; episode: number; timelineUrl: string }
  >;
}

@Injectable()
export class RadarDailyBriefingEmailPreset {
  private readonly log = new Logger(RadarDailyBriefingEmailPreset.name);

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly tokens: UnsubscribeTokenService,
    private readonly renderer: HandlebarsRendererService,
    private readonly config: ConfigService,
  ) {}

  async notify(input: RadarDailyBriefingEmailInput) {
    const base = this.frontendUrl();
    // FU2-A: 1 token 覆盖 3 scope（前端按 ?scope=URL 参数选用）
    const token = await this.tokens.issueMultiScope(
      input.userId,
      ["topic", "radar_all", "global"],
      input.topicId,
    );
    const ctx = {
      topic: { id: input.topicId, name: input.topicName },
      briefingDateFull: input.briefingDate,
      briefingTime: input.briefingTime,
      candidatesCount: input.candidatesCount,
      signals: input.signals.map((s) => ({
        ...s,
        // 模板用 detailUrl helper 时签名为 (signalId, topicId, base)
        baseUrl: base,
      })),
      narrativeMap: input.narrativeMap ?? {},
      topicUrl: `${base}/ai-radar/topic/${input.topicId}?date=${input.briefingDate}`,
      settingsUrl: `${base}/settings/notifications`,
      unsubscribeTopicUrl: buildUnsubUrl(base, token, "topic"),
      unsubscribeRadarUrl: buildUnsubUrl(base, token, "radar_all"),
      unsubscribeAllUrl: buildUnsubUrl(base, token, "global"),
    };
    let html: string;
    try {
      html = await this.renderer.render(
        "radar-daily-briefing",
        input.locale,
        ctx,
      );
    } catch (err) {
      this.log.warn(
        `radar daily email template render failed user=${input.userId} topic=${input.topicId}: ${(err as Error).message}`,
      );
      // fallback：纯文本邮件（用 dispatcher payload.message）
      html = "";
    }

    const tier3Count = input.signals.filter((s) => s.tier === 3).length;
    const title = `${input.topicName} · 今日精选 ${input.signals.length} 条（⭐⭐⭐ ${tier3Count}）`;
    const summary =
      input.signals[0]?.oneLineTakeaway ?? "今日 0 条 · 持续监控中";

    return this.dispatcher.dispatch(input.userId, {
      type: "RADAR_DAILY",
      title,
      message: summary,
      link: `/ai-radar/topic/${input.topicId}?date=${input.briefingDate}`,
      metadata: {
        topicId: input.topicId,
        briefingDate: input.briefingDate,
        selectedCount: input.signals.length,
        tier3Count,
      },
      ...(html ? { emailContext: { html } } : {}),
    });
  }

  private frontendUrl(): string {
    // 与 auth.controller / EmailService 一致
    return this.config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";
  }
}

/**
 * 用 URLSearchParams 构造退订 URL（security P1：避免拼接 token 时漏 encode 或注入额外参数）
 */
export function buildUnsubUrl(
  base: string,
  token: string,
  scope: "topic" | "weekly" | "radar_all" | "global",
): string {
  const qs = new URLSearchParams();
  qs.set("token", token);
  qs.set("scope", scope);
  return `${base}/unsubscribed?${qs.toString()}`;
}
