/**
 * Stage S7 — Writer outline: Mission-level chapter planner
 *
 * thorough+ 档位下跑 MissionOutlinePlannerAgent，先列出 mission 级 chapter 大纲
 * （sectionId/heading/thesis + targetWordsPerChapter + factAllocation），让下游
 * Writer 起草时按 outline 走，不必边写边规划。
 *
 *   reads  ctx: plan (PlanPhaseCtx), reconciliationReport (SynthesisPhaseCtx), input.auditLayers
 *   writes ctx: outlinePlan (WriterPhaseCtx) ★ P1-E 2026-04-29: 真消费 — S8 SingleShotWriter 按此 outline 起草
 *   deps:       WriterDeps —— writer.planMissionOutline, invoker (tickCost), emit, log
 *
 * Skip 条件: auditLayers ∉ {thorough, paranoid} → 直接 return
 * Failure modes: 任何抛错 → log warn + 继续（不阻塞，Writer 走无 outline 路径）
 *
 * ★ PR-7b 标杆 stage (2026-05-04): 此 stage 已迁到窄签名（ctx 只暴露真实消费的
 *   phase 子集，deps 只暴露 WriterDeps），让 reader 看签名就知道上下游依赖。
 *   其余 12 个 stage 维持 MissionContext + MissionDeps 完整签名，待 W22 主线波次
 *   逐个迁。trunk 仍传完整 ctx + deps，子类型兼容自动满足。
 */

import type {
  MissionInvariants,
  PlanPhaseCtx,
  SynthesisPhaseCtx,
  WriterPhaseCtx,
} from "../../context/mission-context";
import type { MissionDeps } from "../../context/mission-deps";
import { extractTokenSpend } from "@/modules/ai-harness/facade";
import { narrate } from "../../artifacts/narrative.util";
import { normalizeTargetWords } from "../../artifacts/word-count-normalizer.util";

export async function runWriterOutlineStage(
  ctx: MissionInvariants & PlanPhaseCtx & SynthesisPhaseCtx & WriterPhaseCtx,
  deps: MissionDeps,
): Promise<void> {
  const {
    missionId,
    userId,
    input,
    billing,
    pool,
    budgetMultiplier,
    plan,
    reconciliationReport,
  } = ctx;
  if (!plan) return;
  // ★ 2026-04-30 fix: AuditLayers 类型已从 "thorough+" 改名为 "thorough+"（与前端对齐）
  if (input.auditLayers !== "thorough" && input.auditLayers !== "thorough+") {
    return;
  }
  // ★ 2026-05-06 单轨化: stage:lifecycle 由 orchestrator 必发，stage 文件不再 emit
  try {
    await narrate(deps.emit, missionId, userId, {
      stage: "s7-writer-outline",
      role: "writer",
      tag: "planning",
      text: "Writer 开始规划报告 mission-level 章节大纲",
      agentId: "outline-planner",
    });
    const outlineRes = await deps.writer.planMissionOutline(
      {
        topic: input.topic,
        language: input.language,
        depth: input.depth,
        audienceProfile: input.audienceProfile,
        styleProfile: input.styleProfile,
        lengthProfile: input.lengthProfile,
        withFigures: input.withFigures,
        plan: {
          themeSummary: plan.themeSummary,
          dimensions: plan.dimensions.map((d) => ({
            id: d.id,
            name: d.name,
            rationale: d.rationale,
          })),
        },
        factTable:
          (
            reconciliationReport as unknown as {
              factTable?: {
                id: string;
                entity: string;
                attribute: string;
                value: string;
              }[];
            } | null
          )?.factTable ?? [],
        figureCandidates: [],
      },
      {
        missionId,
        userId,
        agentId: "outline-planner",
        role: "outline-planner",
        envAdapter: billing,
        budgetMultiplier,
      },
    );
    await deps.invoker.tickCost(
      missionId,
      userId,
      "writer",
      pool,
      extractTokenSpend(outlineRes.events),
      outlineRes.events,
    );
    if (outlineRes.state === "completed" && outlineRes.output) {
      const outlinePlan = outlineRes.output as {
        chapterOutlines?: {
          sectionId: string;
          heading: string;
          subheadings?: string[];
          thesis: string;
          keyPointsToCover: string[];
        }[];
        targetWordsPerChapter?: Record<string, number>;
        factAllocation?: Record<string, string[]>;
      };
      // ★ P1-E (2026-04-29): 真消费 — 写入 ctx.outlinePlan，S8 SingleShotWriter 严格按此 outline 起草
      // ★ P1-F (2026-04-29): outline 节数边界 [1, 20] —— 0 节走无 outline 路径，>20 节截断为前 20 章
      // ★ P1-NEW-D (round 2): sectionId 去重 + targetWords/factAllocation 修剪到合法集合
      const MAX_OUTLINE_CHAPTERS = 20;
      const rawChapters = outlinePlan.chapterOutlines ?? [];
      // 1) sectionId 去重：保留首个出现的（防御 LLM 重复 id）
      const seenIds = new Set<string>();
      const chapters = rawChapters.filter((c) => {
        if (seenIds.has(c.sectionId)) return false;
        seenIds.add(c.sectionId);
        return true;
      });
      if (chapters.length !== rawChapters.length) {
        deps.log.warn(
          `[${missionId}] outline-planner returned ${rawChapters.length - chapters.length} duplicate sectionId, deduplicated`,
        );
      }
      // 2) 截断到上限
      const finalChapters = chapters.slice(0, MAX_OUTLINE_CHAPTERS);
      if (chapters.length > MAX_OUTLINE_CHAPTERS) {
        deps.log.warn(
          `[${missionId}] outline-planner returned ${chapters.length} chapters > ${MAX_OUTLINE_CHAPTERS} cap, truncating`,
        );
      }
      // 3) 修剪 targetWords / factAllocation 只保留有效 sectionId 的 key
      const validIds = new Set(finalChapters.map((c) => c.sectionId));
      const trimRecord = <T>(
        rec: Record<string, T> | undefined,
      ): Record<string, T> => {
        const out: Record<string, T> = {};
        for (const [k, v] of Object.entries(rec ?? {})) {
          if (validIds.has(k)) out[k] = v;
        }
        return out;
      };
      if (finalChapters.length > 0) {
        const trimmedTargetWords = trimRecord(
          outlinePlan.targetWordsPerChapter,
        );
        // ★ Phase 1 移植 (TI leader-planning.service.ts:859-880): 中位数归一化
        // 防止 LLM 返回极度不均的字数分配（500/500/500/7000）—— 极小章节凑空话、
        // 极大章节超 ChapterWriter budget 触发死循环。
        const normalized = normalizeTargetWords(trimmedTargetWords);
        if (normalized.normalized) {
          deps.log.log(
            `[${missionId}] outline targetWords normalized: median=${normalized.stats.median}, ` +
              `allowed=[${normalized.stats.minAllowed}, ${normalized.stats.maxAllowed}], ` +
              `clamped down=${normalized.stats.countClampedDown} up=${normalized.stats.countClampedUp}`,
          );
        }
        ctx.outlinePlan = {
          chapterOutlines: finalChapters.map((c) => ({
            sectionId: c.sectionId,
            heading: c.heading,
            subheadings: c.subheadings ?? [],
            thesis: c.thesis,
            keyPointsToCover: c.keyPointsToCover,
          })),
          targetWordsPerChapter: normalized.targetWords,
          factAllocation: trimRecord(outlinePlan.factAllocation),
        };
        // ★ PR-R4 (2026-05-07): stage 主动持久化 outlinePlan 到 mission 行，
        //   让 cdHydrate 在 S8/S9/S11 等下游 stage 重跑时读到最新 outline。
        // ★ 收尾评审第三轮 P0-S (2026-05-07): 传 userId 走严格隔离
        await deps.store.markIntermediateState(
          missionId,
          { outlinePlan: ctx.outlinePlan },
          userId,
        );
      }
      await deps
        .emit({
          type: "playground.dimension:outline:planned",
          missionId,
          userId,
          payload: {
            chapterCount: outlinePlan.chapterOutlines?.length ?? 0,
          },
        })
        .catch((err: unknown) => {
          deps.log.warn(
            `[${missionId}] emit dimension:outline:planned failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      await narrate(deps.emit, missionId, userId, {
        stage: "s7-writer-outline",
        role: "writer",
        tag: "success",
        text: `章节大纲规划完成 · ${outlinePlan.chapterOutlines?.length ?? 0} 章`,
        agentId: "outline-planner",
      });
    }
    // ★ 2026-04-30 (#62): emit stage:completed 让前端 todo 卡标 done
  } catch (err) {
    deps.log.warn(
      `[${missionId}] outline-planner failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
    // ★ 失败也 emit completed status=failed 避免前端 todo 卡永远 in_progress
  }
}
