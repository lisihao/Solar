/**
 * mission-view.projector.ts — Top-level projector composing canonical view（B2-2）
 *
 * 落地依据：thinning plan §6.2 / §6.4.1 / §6.4.1.a / §6.7 / §6.7.1
 *
 * 输入：MissionQueryInputs（已 ownership-checked + 已含 resume/rerun 决策）。
 * 输出：PlaygroundDomainView（顶层 view）。
 *
 * §6.4.1.a 持久化-投影映射顺序在 resolvePublicStatus 内严格执行。
 * §6.7.1 timelineVersion / snapshotVersion 来源为已持久化的事件 / row revision，
 * 严禁使用 in-memory 序号 / wall-clock。
 *
 * §B2-2 第 5 条：未实现的 todoBoard / reportArtifact 必须返回 stable sentinel，禁 undefined。
 */

import type { MissionDetail } from "../lifecycle/mission-store.service";
import type { MissionQueryInputs } from "../query/mission-query.service";
import { projectStages } from "./stage-view.projector";
import { projectAgents } from "./agent-view.projector";
import { projectTodoBoard } from "./todo-board.projector";
import {
  buildMissionCostView,
  deriveSnapshotVersionFromRow,
} from "@/modules/ai-harness/facade";
// projectArtifact 现由 ArtifactComposerService 调用（含 R2 fetch），projector 模块
// 仅保留 normalizeV1ToV2 作为 service 内 helper。本文件无需直接 import 它。
import type {
  DimensionPipelineView,
  DimensionView,
  EmptyArtifactSentinel,
  MemoryIndexView,
  MissionCostView,
  MissionMemorySentinel,
  MissionReferenceView,
  MissionStatus,
  PlaygroundDomainView,
  ReportVersionView,
  TodoBoardSentinel,
  VerifierVerdictView,
} from "../../api/contracts/view-state.contract";
import type { ReportArtifactV2 } from "../../api/contracts/artifact.contract";

// ============================================================================
// Public entry
// ============================================================================

export function projectMissionView(
  inputs: MissionQueryInputs,
): PlaygroundDomainView {
  if (inputs.mode === "starting-placeholder") {
    return buildStartingView(inputs.missionId, inputs.rerunnableStages);
  }
  return buildRowLoadedView(inputs);
}

// ============================================================================
// starting placeholder（§6.4.1.a rule 1）
// ============================================================================

function buildStartingView(
  missionId: string,
  rerunnableStages: PlaygroundDomainView["mission"]["rerunnableStages"],
): PlaygroundDomainView {
  return {
    mission: {
      id: missionId,
      status: "starting",
      startedAt: new Date().toISOString(),
      resumable: false,
      canCancel: false,
      rerunnableStages,
    },
    stages: projectStages([]),
    agents: [],
    reportArtifact: buildEmptyArtifactSentinel("not-yet-materialized"),
    todoBoard: buildEmptyTodoBoardSentinel(),
    cost: buildZeroCost(),
    memory: buildEmptyMemorySentinel(),
    timelineVersion: 0,
    snapshotVersion: 0,
    refreshHints: [],
    references: [],
    reportVersions: [],
    verdicts: [],
    memoryIndex: null,
    dimensionPipelines: {},
  };
}

// ============================================================================
// row-loaded（主路径）
// ============================================================================

function buildRowLoadedView(inputs: MissionQueryInputs): PlaygroundDomainView {
  const row = inputs.row!;
  const stages = projectStages(inputs.events);
  const agents = projectAgents(inputs.events);

  // ★ 2026-05-27 (Screenshot_17 状态不一致修复)：mission row 已 terminal 时，
  //   sweep 所有滞留 phase='running' 的 agent → 'completed'（completed mission）
  //   或 'failed'（failed mission）。chapter-writer / quality-judge 等 sub-agent
  //   可能因为 explicit agent:lifecycle 'completed' 事件被 buffer evict / 网络
  //   race 而永远卡 running，导致 "23 个 Agent 正在工作" 假象。这是已知的
  //   "事件缺失" 容灾：mission 已盖章 terminal，下游展示必须一致。
  const isTerminal =
    row.status === "completed" ||
    row.status === "failed" ||
    row.status === "cancelled" ||
    row.status === "quality-failed";
  if (isTerminal) {
    for (const a of agents) {
      if (a.phase === "running" || a.phase === "pending") {
        a.phase =
          row.status === "completed" || row.status === "quality-failed"
            ? "completed"
            : "failed";
      }
    }
  }

  const todoBoard = projectTodoBoard(row, inputs.events);
  // P0-2：artifact 来自 ArtifactComposerService（含 R2 off-load fetch），
  //   不再 inline 调用 pure projectArtifact —— query service 已 await 异步组合。
  const reportArtifact: ReportArtifactV2 | EmptyArtifactSentinel =
    inputs.composedArtifact;

  // P0-1：真实投影 references + reportVersions（取代 first-cut 的 []）
  const references = extractReferences(reportArtifact);
  const reportVersions: ReportVersionView[] = inputs.reportVersions.map(
    (r) => ({
      version: r.version,
      versionLabel: r.versionLabel,
      reportTitle: r.reportTitle,
      reportSummary: r.reportSummary,
      finalScore: r.finalScore,
      leaderSigned: r.leaderSigned,
      triggerType: r.triggerType,
      generatedAt: r.generatedAt.toISOString(),
    }),
  );

  const publicStatus = resolvePublicStatus(row);

  return {
    mission: {
      id: row.id,
      // §6.3 field-name compatibility：persisted topic → outward title
      title: row.topic,
      topic: row.topic, // 兼容 baggage（§6.3 rule 4）
      depth: row.depth,
      language: row.language,
      maxCredits: row.maxCredits ?? undefined,
      // §6.3 frozen extension fields
      themeSummary: row.themeSummary ?? undefined,
      dimensions: extractDimensions(row.dimensions),
      leaderOverallScore: row.leaderOverallScore ?? null,
      leaderSigned: row.leaderSigned ?? null,
      leaderVerdict: row.leaderVerdict ?? null,
      terminalOutcome: row.terminalOutcome ?? null,
      failureCode: row.failureCode ?? null,
      reportArtifactVersion: row.reportArtifactVersion ?? null,
      // W1 cutover：userProfile / reconciliationReport 暴露给前端，page.tsx
      // 不再走旧 getMissionDetail / listResumableMissions。
      userProfile: row.userProfile,
      reconciliationReport: row.reconciliationReport,
      status: publicStatus,
      startedAt: isoOrUndef(row.startedAt),
      finishedAt: isoOrUndef(row.completedAt),
      finalScore: row.finalScore ?? undefined,
      failureMessage: row.errorMessage ?? undefined,
      resumable: inputs.resume.resumable,
      canCancel: publicStatus === "running" || publicStatus === "starting",
      rerunnableStages: inputs.rerunnableStages,
    },
    stages,
    agents,
    // B3-2 / B3-1 接入：artifact.projector + todo-board.projector
    reportArtifact,
    todoBoard,
    cost: buildCostView(row),
    memory: buildEmptyMemorySentinel(),
    // §6.7.1 timelineVersion = persisted event count（events 已含 buffer + persisted fallback）
    timelineVersion: inputs.events.length,
    // §6.7.1 snapshotVersion = persisted view-relevant revision；first cut 用
    // lastCompletedStage + finalScore presence 组合的轻量 reducer。任何变更触发 +1。
    snapshotVersion: deriveSnapshotVersion(row),
    refreshHints: [], // projector 不产生 hint；hint 在 §6.7.3 stream emit 时由 dispatcher 注入
    references,
    reportVersions,
    // P0-A 新暴露：取代 shim 内 events 派生
    verdicts: extractVerdicts(row, inputs.events),
    memoryIndex: extractMemoryIndex(inputs.events),
    dimensionPipelines: extractDimensionPipelines(inputs.events, row),
  };
}

// ============================================================================
// P0-A 派生（从 events / row 投影，取代 shim 内派生）
// ============================================================================

function extractVerdicts(
  row: MissionDetail,
  events: ReadonlyArray<{ type: string; payload: unknown; timestamp: number }>,
): VerifierVerdictView[] {
  // 优先用 mission row 上持久化的 verdicts（最终态）
  if (Array.isArray(row.verdicts) && row.verdicts.length > 0) {
    return (row.verdicts as Array<Record<string, unknown>>)
      .filter(
        (v) => typeof v.verifierId === "string" && typeof v.score === "number",
      )
      .map((v) => ({
        verifierId: v.verifierId as string,
        score: v.score as number,
        critique: typeof v.critique === "string" ? v.critique : undefined,
        criteria:
          v.criteria && typeof v.criteria === "object"
            ? (v.criteria as Record<string, number>)
            : undefined,
        modelId: typeof v.modelId === "string" ? v.modelId : undefined,
        attempt: typeof v.attempt === "number" ? v.attempt : undefined,
      }));
  }
  // 否则从 events 派生（mission 进行中或老数据无 row verdicts）
  const out: VerifierVerdictView[] = [];
  for (const ev of events) {
    const suffix = ev.type.includes(".")
      ? ev.type.slice(ev.type.indexOf(".") + 1)
      : ev.type;
    if (suffix !== "verifier:verdict") continue;
    const p = ev.payload as Record<string, unknown> | null;
    if (!p) continue;
    if (typeof p.verifierId === "string" && typeof p.score === "number") {
      out.push({
        verifierId: p.verifierId,
        score: p.score,
        critique: typeof p.critique === "string" ? p.critique : undefined,
        criteria:
          p.criteria && typeof p.criteria === "object"
            ? (p.criteria as Record<string, number>)
            : undefined,
        modelId: typeof p.modelId === "string" ? p.modelId : undefined,
        attempt: typeof p.attempt === "number" ? p.attempt : undefined,
      });
    }
  }
  return out;
}

function extractMemoryIndex(
  events: ReadonlyArray<{ type: string; payload: unknown }>,
): MemoryIndexView | null {
  // 取最近一条 memory.index 事件
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const suffix = ev.type.includes(".")
      ? ev.type.slice(ev.type.indexOf(".") + 1)
      : ev.type;
    if (suffix !== "memory.index" && suffix !== "memory:index") continue;
    const p = ev.payload as Record<string, unknown> | null;
    if (p && typeof p.chunks === "number") {
      return {
        chunks: p.chunks,
        namespace: typeof p.namespace === "string" ? p.namespace : undefined,
        tags: Array.isArray(p.tags)
          ? (p.tags as unknown[]).filter(
              (t): t is string => typeof t === "string",
            )
          : undefined,
      };
    }
  }
  return null;
}

function extractDimensionPipelines(
  events: ReadonlyArray<{ type: string; payload: unknown; timestamp: number }>,
  row: MissionDetail,
): Record<string, DimensionPipelineView> {
  // First-cut：每个 dimension 一个 entry，含 chapter list（从 chapter:writing:* 事件聚合）。
  // 完整 ChapterState 等价化（含 score/critique/wordCount）排 follow-up。
  const out: Record<string, DimensionPipelineView> = {};
  const dimNames = extractDimensionsFromRow(row.dimensions);
  for (const dim of dimNames) {
    out[dim] = { dimension: dim, chapters: [] };
  }
  for (const ev of events) {
    const suffix = ev.type.includes(".")
      ? ev.type.slice(ev.type.indexOf(".") + 1)
      : ev.type;
    const p = ev.payload as Record<string, unknown> | null;
    if (!p) continue;
    const dim = typeof p.dimension === "string" ? p.dimension : undefined;
    if (!dim) continue;
    const pipe = out[dim] ?? { dimension: dim, chapters: [] };
    out[dim] = pipe;

    // ★ 2026-05-27 彻底重写（恢复 baseline 15d2e93ab derive.ts 的完整章节状态机）：
    //   原 projector 只读 heading/wordCount + 用 "done" 笼统盖一切，丢失了
    //   thesis (章节副标题) / score / critique / qualified (兜底落地) /
    //   writing→reviewing→passed/revising→done 真实状态机。
    //   Drawer / ChapterReader 想显示丰富信息但 view 里没数据 = 全部空白。

    if (suffix === "dimension:outline:planned") {
      // outline 阶段填 chapter.heading + thesis
      const chapters = Array.isArray(p.chapters)
        ? (p.chapters as Array<{
            index: number;
            heading: string;
            thesis?: string;
          }>)
        : [];
      for (const c of chapters) {
        const existing = pipe.chapters.find((x) => x.index === c.index);
        if (existing) {
          if (c.heading) existing.heading = c.heading;
          if (c.thesis) existing.thesis = c.thesis;
        } else {
          pipe.chapters.push({
            index: c.index,
            heading: c.heading,
            thesis: c.thesis,
            status: "pending",
            attempts: 0,
          });
        }
      }
      pipe.chapters.sort((a, b) => a.index - b.index);
    } else if (
      suffix === "chapter:writing:started" ||
      suffix === "chapter:writing:completed" ||
      suffix === "chapter:writing:failed"
    ) {
      const heading =
        typeof p.heading === "string"
          ? p.heading
          : typeof p.chapterTitle === "string"
            ? p.chapterTitle
            : "";
      const index =
        typeof p.chapterIndex === "number"
          ? p.chapterIndex
          : typeof p.index === "number"
            ? p.index
            : pipe.chapters.length + 1;
      let chapter = pipe.chapters.find((c) => c.index === index);
      if (!chapter) {
        chapter = { index, heading, status: "pending", attempts: 0 };
        pipe.chapters.push(chapter);
      } else if (heading && !chapter.heading) {
        chapter.heading = heading;
      }
      if (suffix === "chapter:writing:started") {
        const attempt = typeof p.attempt === "number" ? p.attempt : undefined;
        // attempt > 1 表示这是重写，状态 'revising'；首次 'writing'
        chapter.status = attempt && attempt > 1 ? "revising" : "writing";
        chapter.attempts = attempt ?? chapter.attempts + 1;
      } else if (suffix === "chapter:writing:completed") {
        // 写完进 review，不是 done
        chapter.status = "reviewing";
        if (typeof p.wordCount === "number") chapter.wordCount = p.wordCount;
      } else if (suffix === "chapter:writing:failed") {
        chapter.status = "failed";
      }
    } else if (suffix === "chapter:review:completed") {
      // review 给出 score + critique，决定 passed 还是 revising
      const index =
        typeof p.chapterIndex === "number"
          ? p.chapterIndex
          : typeof p.index === "number"
            ? p.index
            : undefined;
      if (index != null) {
        let chapter = pipe.chapters.find((c) => c.index === index);
        if (!chapter) {
          chapter = { index, heading: "", status: "pending", attempts: 0 };
          pipe.chapters.push(chapter);
        }
        chapter.score = typeof p.score === "number" ? p.score : chapter.score;
        chapter.critique =
          typeof p.critique === "string" ? p.critique : chapter.critique;
        const decision =
          typeof p.decision === "string" ? p.decision : undefined;
        const score = typeof p.score === "number" ? p.score : 0;
        chapter.status =
          decision === "pass" || score >= 75 ? "passed" : "revising";
      }
    } else if (suffix === "chapter:done") {
      // 终态：qualified=true → done，false → failed-finalized（兜底落地）
      const index =
        typeof p.chapterIndex === "number"
          ? p.chapterIndex
          : typeof p.index === "number"
            ? p.index
            : pipe.chapters.length + 1;
      const heading =
        typeof p.heading === "string"
          ? p.heading
          : typeof p.chapterTitle === "string"
            ? p.chapterTitle
            : "";
      let chapter = pipe.chapters.find((c) => c.index === index);
      if (!chapter) {
        chapter = { index, heading, status: "pending", attempts: 0 };
        pipe.chapters.push(chapter);
      } else if (heading && !chapter.heading) {
        chapter.heading = heading;
      }
      const qualified = p.qualified === true;
      chapter.status = qualified ? "done" : "failed-finalized";
      if (typeof p.wordCount === "number") chapter.wordCount = p.wordCount;
      if (typeof p.finalScore === "number" && chapter.score == null) {
        chapter.score = p.finalScore;
      }
    } else if (
      suffix === "chapter:revision" ||
      suffix === "chapter:rewritten"
    ) {
      const index =
        typeof p.chapterIndex === "number"
          ? p.chapterIndex
          : typeof p.index === "number"
            ? p.index
            : 0;
      const chapter = pipe.chapters.find((c) => c.index === index);
      if (chapter) chapter.status = "revising";
    } else if (suffix === "dimension:integrating:completed") {
      const totalWordCount =
        typeof p.totalWordCount === "number" ? p.totalWordCount : undefined;
      if (totalWordCount != null) pipe.totalWordCount = totalWordCount;
    } else if (suffix === "dimension:integrating:failed") {
      pipe.integrationDegraded = true;
    } else if (suffix === "dimension:graded") {
      // ★ 2026-05-27 修复：emitter (per-dim-pipeline.util.ts:216) + schema
      //   (DimensionGradedSchema.overall) 都用 `overall`，projector 之前误读
      //   `overallScore` → 所有 graded dim 的 overall 全是 0/100。
      // 同时把 failed / skipped / phase 三个失败兜底字段也接出来（之前 projector
      //   drop 掉 → 失败的 dim 误显示"已完成 · 0/100"而不是"采集失败"等）。
      const overall = typeof p.overall === "number" ? p.overall : 0;
      const grade = typeof p.grade === "string" ? p.grade : "—";
      const summary = typeof p.summary === "string" ? p.summary : "";
      const failed = typeof p.failed === "boolean" ? p.failed : undefined;
      const skipped = typeof p.skipped === "boolean" ? p.skipped : undefined;
      const phase = typeof p.phase === "string" ? p.phase : undefined;
      pipe.grade = {
        overall,
        grade,
        summary,
        ...(failed !== undefined && { failed }),
        ...(skipped !== undefined && { skipped }),
        ...(phase !== undefined && { phase }),
      };
    }
  }

  // mission terminal cleanup：mission row 已 terminal 但 events 没收到
  // chapter:done 的 chapter（事件 buffer 过期或漏 emit），统一标 'done'
  // 让前端 ArtifactReader 不会显示 "Revising N chapters" 假象。
  const isTerminal =
    row.status === "completed" ||
    row.status === "failed" ||
    row.status === "cancelled" ||
    row.status === "rejected";
  if (isTerminal) {
    for (const dim of Object.values(out)) {
      for (const ch of dim.chapters) {
        if (
          ch.status === "pending" ||
          ch.status === "writing" ||
          ch.status === "reviewing" ||
          ch.status === "revising"
        ) {
          ch.status = row.status === "completed" ? "done" : "failed";
        }
      }
    }
  }

  return out;
}

function extractDimensionsFromRow(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (d): d is Record<string, unknown> => d != null && typeof d === "object",
    )
    .map((d) => (typeof d.name === "string" ? d.name : ""))
    .filter((n) => n.length > 0);
}

/**
 * 从 canonical reportArtifact 提取 references（plan §6.3 MissionReferenceView shape）。
 * v2 reportArtifact 已有结构化 citations[]；空态 sentinel 时返回 []。
 */
function extractReferences(
  artifact: ReportArtifactV2 | EmptyArtifactSentinel,
): MissionReferenceView[] {
  if ("kind" in artifact) return []; // sentinel
  return artifact.citations.map((c) => ({
    index: c.index,
    title: c.title,
    url: c.url,
    domain: c.domain,
    publishedAt: c.publishedAt,
  }));
}

// ============================================================================
// §6.4.1.a Persistence-to-view mapping（严格优先级）
// ============================================================================

function resolvePublicStatus(row: MissionDetail): MissionStatus {
  // rule 2：cancelled lifecycle 信号目前未在 MissionDetail.status 暴露；预留 cancelled enum 透传
  if (row.status === "cancelled") return "cancelled";
  // rule 3
  if (row.status === "completed") return "completed";
  // rule 4：persisted "rejected" → public "quality-failed"（playground 专属）
  if (row.status === "rejected") return "quality-failed";
  // rule 5
  if (row.status === "failed") return "failed";
  // rule 6
  if (row.status === "running") return "running";
  // rule 1：no durable row → starting；row 已存在但 status 未匹配任何枚举的边界
  return "running";
}

// ============================================================================
// sentinels（§B2-2 第 5 条）
// ============================================================================

function buildEmptyArtifactSentinel(
  reason: EmptyArtifactSentinel["reason"],
): EmptyArtifactSentinel {
  return { kind: "empty-artifact", reason };
}

function buildEmptyTodoBoardSentinel(): TodoBoardSentinel {
  return { kind: "empty-todo-board" };
}

function buildEmptyMemorySentinel(): MissionMemorySentinel {
  return { kind: "empty-memory" };
}

// ============================================================================
// cost view / snapshot version
// ============================================================================
// 共享 helper 在 harness 抽象层（Phase D lift）：
// `ai-harness/teams/business-team/abstractions/mission-view-helpers.ts`

function buildCostView(row: MissionDetail): MissionCostView {
  return buildMissionCostView({
    tokensUsed: row.tokensUsed,
    costUsd: row.costUsd,
    elapsedWallTimeMs: row.elapsedWallTimeMs,
    trajectoryStored: row.trajectoryStored,
  });
}

function buildZeroCost(): MissionCostView {
  return buildMissionCostView({
    tokensUsed: null,
    costUsd: null,
    elapsedWallTimeMs: null,
  });
}

function deriveSnapshotVersion(row: MissionDetail): number {
  return deriveSnapshotVersionFromRow(row, {
    extraInts: [row.reportArtifactVersion],
    extraFlags: [row.finalScore, row.leaderSigned],
  });
}

// ============================================================================
// misc helpers
// ============================================================================

function isoOrUndef(dt: Date | null | undefined): string | undefined {
  if (!dt) return undefined;
  return dt.toISOString();
}

function extractDimensions(raw: unknown): DimensionView[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter(
      (d): d is Record<string, unknown> => d != null && typeof d === "object",
    )
    .map((d) => ({
      id: typeof d.id === "string" ? d.id : "",
      name: typeof d.name === "string" ? d.name : "",
      rationale: typeof d.rationale === "string" ? d.rationale : undefined,
    }));
}

// Re-exports to make sibling routes / fixtures know the placeholder type aliases
export type { PlaygroundDomainView, MissionReferenceView, ReportVersionView };
