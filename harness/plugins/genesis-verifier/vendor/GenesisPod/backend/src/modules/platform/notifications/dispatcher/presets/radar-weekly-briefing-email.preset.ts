/**
 * RadarWeeklyBriefingEmailPreset —— FU2-C
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §4.3 + §7.2 + §7.3.3
 *
 * 与 RadarDailyBriefingEmailPreset 同模式，差异：
 *   - scopes = ['weekly', 'radar_all', 'global']（无 topic 退订）
 *   - 模板 = radar-weekly-briefing
 *   - 上下文：topSignals + narrativeCount + candidatesTotal + weekRangeFull
 */
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HandlebarsRendererService } from "../../../email/rendering/handlebars-renderer.service";
import { NotificationDispatcher } from "../notification-dispatcher.service";
import { UnsubscribeTokenService } from "../preferences/unsubscribe-token.service";
import { buildUnsubUrl } from "./radar-daily-briefing-email.preset";

interface TopSignalEmailInput {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  oneLineTakeaway: string;
  whyItMatters: string;
  sourceBriefingDate: string;
  /** 模板 length 显示证据数量 */
  evidenceItemIds?: string[];
}

export interface RadarWeeklyBriefingEmailInput {
  userId: string;
  locale: "zh-CN" | "en-US";
  topicId: string;
  topicName: string;
  weekStart: string; // YYYY-MM-DD (Monday UTC)
  weekEnd: string; // YYYY-MM-DD (Sunday UTC)
  topSignals: TopSignalEmailInput[];
  candidatesTotal: number;
  narrativeCount: number;
  newEntityCount: number;
}

@Injectable()
export class RadarWeeklyBriefingEmailPreset {
  private readonly log = new Logger(RadarWeeklyBriefingEmailPreset.name);

  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly tokens: UnsubscribeTokenService,
    private readonly renderer: HandlebarsRendererService,
    private readonly config: ConfigService,
  ) {}

  async notify(input: RadarWeeklyBriefingEmailInput) {
    const base = this.frontendUrl();
    const token = await this.tokens.issueMultiScope(input.userId, [
      "weekly",
      "radar_all",
      "global",
    ]);
    const ctx = {
      topic: { id: input.topicId, name: input.topicName },
      weekRangeFull: `${input.weekStart} — ${input.weekEnd}`,
      candidatesTotal: input.candidatesTotal,
      narrativeCount: input.narrativeCount,
      newEntityCount: input.newEntityCount,
      topSignals: input.topSignals.map((s) => ({
        ...s,
        evidenceItemIds: s.evidenceItemIds ?? [],
        baseUrl: base,
      })),
      topicUrl: `${base}/ai-radar/topic/${input.topicId}/weekly?week=${input.weekStart}`,
      settingsUrl: `${base}/settings/notifications`,
      unsubscribeWeeklyUrl: buildUnsubUrl(base, token, "weekly"),
      unsubscribeAllUrl: buildUnsubUrl(base, token, "global"),
    };
    let html: string;
    try {
      html = await this.renderer.render(
        "radar-weekly-briefing",
        input.locale,
        ctx,
      );
    } catch (err) {
      this.log.warn(
        `radar weekly email template render failed user=${input.userId} topic=${input.topicId}: ${(err as Error).message}`,
      );
      html = "";
    }

    const tier3Count = input.topSignals.filter((s) => s.tier === 3).length;
    const title = `${input.topicName} · 本周精选（⭐⭐⭐ ${tier3Count}）`;
    const summary = `本周 ${input.candidatesTotal} 条候选 · ${tier3Count} 条最高评级`;

    return this.dispatcher.dispatch(input.userId, {
      type: "RADAR_WEEKLY",
      title,
      message: summary,
      link: `/ai-radar/topic/${input.topicId}/weekly?week=${input.weekStart}`,
      metadata: {
        topicId: input.topicId,
        weekStart: input.weekStart,
        tier3Count,
      },
      ...(html ? { emailContext: { html } } : {}),
    });
  }

  private frontendUrl(): string {
    return this.config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";
  }
}
