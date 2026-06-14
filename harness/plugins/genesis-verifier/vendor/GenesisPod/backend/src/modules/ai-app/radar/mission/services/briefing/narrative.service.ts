import { Injectable } from "@nestjs/common";
import {
  RadarDailyBriefingRepo,
  DailySignal,
} from "./radar-daily-briefing.repo";

export interface NarrativeEpisode {
  date: string; // YYYY-MM-DD
  signalId: string;
  title: string;
  tier: 1 | 2 | 3;
}

export interface NarrativeThread {
  narrativeId: string;
  /** 用最新 episode 的 title 降级（schema 无独立 label 字段） */
  label: string;
  episodes: NarrativeEpisode[];
}

@Injectable()
export class NarrativeService {
  constructor(private readonly dailyRepo: RadarDailyBriefingRepo) {}

  /**
   * 拉指定 topic 内 narrativeId 命中的所有 episode（最近 90 天）。
   *
   * 返回 null 表示 narrativeId 在最近 90 天 daily briefings 里命中 < 2 条
   * （前端按 episodes.length < 2 时不渲染 thread）。
   */
  async getNarrativeThread(
    topicId: string,
    narrativeId: string,
  ): Promise<NarrativeThread | null> {
    const briefings = await this.dailyRepo.findRecentByTopic(topicId, 90);
    const episodes: NarrativeEpisode[] = [];

    for (const b of briefings) {
      const signals = (b.signals as unknown as DailySignal[]) ?? [];
      for (const s of signals) {
        if (s.narrativeId === narrativeId) {
          episodes.push({
            date: b.briefingDate.toISOString().slice(0, 10),
            signalId: s.id,
            title: s.title,
            tier: s.tier,
          });
        }
      }
    }

    if (episodes.length < 2) return null;

    // 按 date asc 排序（前端时间线按时间从早到晚显示）
    episodes.sort((a, b) => a.date.localeCompare(b.date));
    const latest = episodes[episodes.length - 1];

    return {
      narrativeId,
      label: latest.title,
      episodes,
    };
  }
}
