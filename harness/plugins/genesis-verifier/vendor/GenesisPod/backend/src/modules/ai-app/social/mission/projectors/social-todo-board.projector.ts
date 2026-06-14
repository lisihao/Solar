/**
 * social-todo-board.projector.ts — Canonical TodoBoardState for social.
 *
 * Phase-B lifted: plumbing 走
 * `BusinessTeamTodoBoardProjectorFramework`，本文件只剩 social 自己的：
 *   - 13 stage preset 表（含 desc, social 比 radar 多）
 *   - preAllocateExtras: per-platform placeholder (锚 s8.5)
 *   - sortKeyForExtra: platform → 8.5
 *   - handleBusinessEvent: publish:executed / publish:verified per-platform 处理
 *   - mapTerminalStatus: aborted → failed（与 framework 默认一致）
 */

import {
  BusinessTeamTodoBoardProjectorFramework,
  type BaseProjectorEvent,
  type BaseStagePreset,
  type BuilderState,
} from "@/modules/ai-harness/facade";
import type {
  SocialPlatform,
  SocialTodoBoardEntry,
  SocialTodoBoardSentinel,
} from "../../api/contracts/view-state.contract";

// ============================================================================
// Types
// ============================================================================

interface SocialMissionRowLike {
  id: string;
  status: string;
  startedAt: Date | string;
  completedAt?: Date | string | null;
  platforms?: unknown;
  contentId?: string | null;
}

interface SocialStagePreset extends BaseStagePreset {
  desc: string;
}

// ============================================================================
// Stage presets (13)
// ============================================================================

const SYSTEM_STAGE_PRESETS: ReadonlyArray<SocialStagePreset> = [
  {
    id: "s1-mission-budget-eval",
    title: "预算评估",
    desc: "估算 token 预算并校验余额",
  },
  {
    id: "s2-platform-probe",
    title: "平台探测",
    desc: "探测目标平台的限制与可发布能力",
  },
  {
    id: "s3-content-transform",
    title: "内容转换",
    desc: "将原文转化为平台适配草稿",
  },
  {
    id: "s4-leader-assess-transform",
    title: "Leader 评审转换",
    desc: "Leader 评审平台适配草稿质量",
  },
  { id: "s5-cover-craft", title: "封面制作", desc: "生成 / 选择平台封面" },
  { id: "s6-body-compose", title: "正文组装", desc: "正文拼装 + 平台格式化" },
  { id: "s7-polish-review", title: "润色复审", desc: "润色 + Leader 终审" },
  { id: "s8-publish-execute", title: "发布执行", desc: "调用各平台 API 发布" },
  { id: "s8b-publish-retry", title: "发布重试", desc: "失败平台自动重试" },
  {
    id: "s9-publish-verify",
    title: "发布核验",
    desc: "拉取已发布内容核验展现",
  },
  { id: "s10-leader-signoff", title: "Leader 签字", desc: "Leader 综合签字" },
  { id: "s11-mission-persist", title: "持久化", desc: "落库归档 trajectory" },
  {
    id: "s12-self-evolution",
    title: "自我进化",
    desc: "复盘 + FailureLearner",
  },
];

// ============================================================================
// Projector subclass
// ============================================================================

class SocialTodoBoardProjector extends BusinessTeamTodoBoardProjectorFramework<
  SocialTodoBoardEntry,
  SocialMissionRowLike,
  SocialTodoBoardSentinel,
  SocialStagePreset
> {
  protected systemStagePresets(): ReadonlyArray<SocialStagePreset> {
    return SYSTEM_STAGE_PRESETS;
  }

  protected makeSystemStageTodo(
    preset: SocialStagePreset,
    ts: number,
  ): SocialTodoBoardEntry {
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

  protected emptySentinel(): SocialTodoBoardSentinel {
    return { kind: "empty-todo-board" };
  }

  protected loadedSentinel(
    items: SocialTodoBoardEntry[],
  ): SocialTodoBoardSentinel {
    return { kind: "todo-board", items, isFirstCutTruncated: false };
  }

  protected preAllocateExtras(
    row: SocialMissionRowLike,
    missionCreatedAt: number,
    state: BuilderState<SocialTodoBoardEntry>,
  ): void {
    const platforms = extractPlatforms(row.platforms);
    for (const platform of platforms) {
      this.upsert(state, `platform:${platform}`, () => ({
        id: `platform:${platform}`,
        origin: "platform-publish",
        scope: "platform",
        status: "pending",
        title: `发布到 ${platform}`,
        platform,
        createdAt: missionCreatedAt,
      }));
    }
  }

  protected sortKeyForExtra(todo: SocialTodoBoardEntry): number | undefined {
    if (todo.scope === "platform") {
      // platforms appear between s8-publish-execute (8) and s8b-publish-retry (9)
      return 8.5;
    }
    return undefined;
  }

  protected handleBusinessEvent(
    state: BuilderState<SocialTodoBoardEntry>,
    ev: BaseProjectorEvent,
  ): void {
    const suffix = this.evSuffix(ev.type);
    const ts = ev.timestamp;
    const payload = ev.payload as Record<string, unknown> | null;

    if (suffix === "publish:executed") {
      const platform = this.getString(payload, "platform") as
        | SocialPlatform
        | undefined;
      const status = this.getString(payload, "status"); // PUBLISHED / FAILED / SKIPPED
      if (!platform) return;
      this.upsert(
        state,
        `platform:${platform}`,
        () => ({
          id: `platform:${platform}`,
          origin: "platform-publish",
          scope: "platform",
          status: "in_progress",
          title: `发布到 ${platform}`,
          platform,
          createdAt: ts,
          startedAt: ts,
        }),
        (t) => {
          if (!t.startedAt) t.startedAt = ts;
          if (status === "PUBLISHED") t.status = "done";
          else if (status === "FAILED") t.status = "failed";
          else if (status === "SKIPPED") t.status = "done";
          else t.status = "in_progress";
          t.endedAt = ts;
        },
      );
      return;
    }

    if (suffix === "publish:verified") {
      const platform = this.getString(payload, "platform") as
        | SocialPlatform
        | undefined;
      if (!platform) return;
      this.upsert(
        state,
        `platform:${platform}`,
        () => ({
          id: `platform:${platform}`,
          origin: "platform-publish",
          scope: "platform",
          status: "done",
          title: `发布到 ${platform}`,
          platform,
          createdAt: ts,
          startedAt: ts,
          endedAt: ts,
        }),
        (t) => {
          // 核验通过保持 done
          if (t.status !== "failed") t.status = "done";
        },
      );
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function extractPlatforms(raw: unknown): SocialPlatform[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is SocialPlatform => typeof p === "string");
}

// ============================================================================
// Public entry
// ============================================================================

const projector = new SocialTodoBoardProjector();

export function projectSocialTodoBoard(
  row: SocialMissionRowLike | null,
  events: ReadonlyArray<BaseProjectorEvent>,
): SocialTodoBoardSentinel {
  // BaseProjectorRow shape requires startedAt: Date | string | null, but social row
  // declares Date | string (non-null). Adapt at boundary.
  if (!row) return projector.project(null, events);
  return projector.project(
    row as unknown as Parameters<typeof projector.project>[0],
    events,
  );
}
