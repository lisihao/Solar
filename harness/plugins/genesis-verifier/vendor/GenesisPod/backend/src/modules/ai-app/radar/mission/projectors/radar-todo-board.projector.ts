/**
 * radar-todo-board.projector.ts — Canonical TodoBoardState for radar.
 *
 * Phase-A lifted: 所有 plumbing（pre-allocate / stage:started/completed/failed
 * 转换 / terminal cleanup / anchor sort）落入
 * `ai-harness/teams/business-team/projectors/BusinessTeamTodoBoardProjectorFramework`，
 * 本文件只剩 radar 自己的 stage preset 表 + sentinel + entry shape。
 *
 * radar 无 fanout（content-based + topic-fixed），所以无 platform / dim sub-todo
 * → 不实现 preAllocateExtras / sortKeyForExtra / handleBusinessEvent。
 */

import type {
  RadarTodoBoardEntry,
  RadarTodoBoardSentinel,
} from "../../api/contracts/view-state.contract";
import {
  BusinessTeamTodoBoardProjectorFramework,
  type BaseProjectorEvent,
  type BaseStagePreset,
} from "@/modules/ai-harness/facade";

interface RadarRunRowLike {
  id: string;
  status: string;
  startedAt: Date | string | null;
}

const RADAR_STAGE_PRESETS: ReadonlyArray<BaseStagePreset> = [
  { id: "s1-source-resolve", title: "信息源解析" },
  { id: "s2-collect", title: "信源采集" },
  { id: "s3-dedupe", title: "去重清洗" },
  { id: "s4-relevance", title: "相关性筛选" },
  { id: "s5-quality", title: "质量评估" },
  { id: "s6-entity", title: "实体抽取" },
  { id: "s7-insight", title: "洞察生成" },
  { id: "s8-persist", title: "持久化" },
  { id: "s9-daily-top-n", title: "Daily Top-N" },
];

class RadarTodoBoardProjector extends BusinessTeamTodoBoardProjectorFramework<
  RadarTodoBoardEntry,
  RadarRunRowLike,
  RadarTodoBoardSentinel,
  BaseStagePreset
> {
  protected systemStagePresets(): ReadonlyArray<BaseStagePreset> {
    return RADAR_STAGE_PRESETS;
  }

  protected makeSystemStageTodo(
    preset: BaseStagePreset,
    ts: number,
  ): RadarTodoBoardEntry {
    return {
      id: `system:${preset.id}`,
      origin: "system-stage",
      scope: "system",
      status: "pending",
      title: preset.title,
      systemStageId: preset.id,
      createdAt: ts,
    };
  }

  protected emptySentinel(): RadarTodoBoardSentinel {
    return { kind: "empty-todo-board" };
  }

  protected loadedSentinel(
    items: RadarTodoBoardEntry[],
  ): RadarTodoBoardSentinel {
    return { kind: "todo-board", items, isFirstCutTruncated: false };
  }
}

const projector = new RadarTodoBoardProjector();

export function projectRadarTodoBoard(
  row: RadarRunRowLike | null,
  events: ReadonlyArray<BaseProjectorEvent>,
): RadarTodoBoardSentinel {
  return projector.project(row, events);
}
