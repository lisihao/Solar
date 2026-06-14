/**
 * Stage S2 — World Build
 *
 * 世界观构建阶段：从用户输入中提炼并落库故事圣经设定（角色、世界观等），
 * 经 BibleKeeperAgent (get_snapshot) 做语义校验和快照，产出 worldSettings +
 * bibleSnapshot 写入 ctx。
 *
 * 对应 FullStoryExecutor Phase 1 逻辑：
 *   worldBuildingEnhancer.enhanceWorldBuildingPrompt(userPrompt)
 *   → BibleKeeperAgent(get_snapshot) 补全/校验世界观
 *   → worldSetting.create() 落库新增设定
 *   → storyBible.getByProject() 刷新得到最终 worldSettings
 *
 *   reads  ctx: input, budgetEval
 *   writes ctx: worldSettings, bibleSnapshot
 *   checkpoint: 是（产物落盘后 markIntermediateState）
 *
 * Failure modes:
 *   - bibleKeeperSvc.run() state === "failed" → throw（关键路径：无 bibleSnapshot
 *     后续 s3/s4 无法构建有一致性保证的章节）
 *   - 世界观落库失败 → warn + 软降级（不阻断，agent 已产出快照）
 *   - outline 类任务同样走此 stage（世界观是大纲的前提条件）
 */

import type { WritingMissionContext } from "../../context/mission-context";
import type { WorldDeps } from "../../context/mission-deps";
import { narrate as harnessNarrate } from "@/modules/ai-harness/facade";
import type { NarrativeEvent } from "@/modules/ai-harness/facade";
import type { BibleKeeperInput } from "../../agents/bible-keeper.agent";
import type { StoryBibleExtensions } from "../../../interfaces/writing-context.interface";

const WRITING_NARRATIVE_EVENT_TYPE = "writing.agent:narrative";

/** Thin narrate wrapper — binds writing event type prefix. */
async function narrate(
  emit: WorldDeps["emit"],
  missionId: string,
  userId: string,
  ev: NarrativeEvent,
): Promise<void> {
  return harnessNarrate(
    emit,
    missionId,
    userId,
    WRITING_NARRATIVE_EVENT_TYPE,
    ev,
  );
}

export async function runWorldBuildStage(
  ctx: WritingMissionContext,
  deps: WorldDeps,
): Promise<void> {
  const { missionId, userId, input, pool, billing, budgetMultiplier } = ctx;
  const projectId = input.projectId;
  // deps.bibleKeeper is now typed as BibleKeeperService (real class, no cast needed)
  const bibleKeeperSvc = deps.bibleKeeper;

  // ── 四件套 step 1: lifecycle started ─────────────────────────────────────
  await deps.lifecycle(
    missionId,
    userId,
    "s2-world-build",
    "bible-keeper",
    "started",
  );
  await narrate(deps.emit, missionId, userId, {
    stage: "s2-world-build",
    role: "bible-keeper",
    tag: "analyzing",
    text: "世界观构建开始 · 分析故事背景、注入时代知识、构建故事圣经设定",
  });

  // ── emit world:building_started ───────────────────────────────────────────
  void deps.emit({
    type: "writing.world:building_started",
    missionId,
    userId,
    payload: {},
  });

  // ── Step A: WorldBuildingEnhancer — 注入领域知识（时代/专业背景）──────────
  const enhancement = deps.worldBuildingEnhancer.enhanceWorldBuildingPrompt(
    input.userPrompt,
  );
  deps.log.log(
    `[${missionId}] world-build: era=${enhancement.detectedEra ?? "none"}, ` +
      `profession=${enhancement.professionalKnowledge?.modernTitle ?? "none"}`,
  );

  // ── Step B: 读取现有 StoryBible，构造 contextPackage ─────────────────────
  const existingBible = await deps.storyBible
    .getByProject(projectId, userId)
    .catch(() => null);

  // StoryBibleExtensions：传给 BibleKeeperAgent 的完整 story bible 快照
  const storyBibleSnap: StoryBibleExtensions = existingBible
    ? {
        projectId,
        bibleId: existingBible.id,
        bibleVersion: existingBible.version ?? 1,
        snapshotAt: new Date().toISOString(),
        premise: existingBible.premise ?? input.userPrompt,
        characters:
          existingBible.characters?.map((c) => ({
            id: c.id,
            name: c.name,
            definition: c.background ?? "",
            type: "character" as const,
            role:
              (c.role?.toLowerCase() as
                | "protagonist"
                | "antagonist"
                | "supporting"
                | "minor") ?? "supporting",
            aliases: c.aliases,
            personality: c.personality as Record<string, unknown>,
            background: c.background ?? "",
            abilities: c.abilities,
            currentState: undefined,
          })) ?? [],
        worldSettings:
          existingBible.worldSettings?.map((ws) => ({
            category: ws.category,
            name: ws.name,
            description: ws.description,
            rules: ws.rules,
          })) ?? [],
        terminologies:
          existingBible.terminologies?.map((t) => ({
            term: t.term ?? "",
            definition: t.definition ?? "",
            category: t.category ?? "general",
          })) ?? [],
        timelineEvents: [],
        factions: [],
      }
    : {
        projectId,
        bibleId: "",
        bibleVersion: 1,
        snapshotAt: new Date().toISOString(),
        premise: input.userPrompt,
        characters: [],
        worldSettings: [],
        terminologies: [],
        timelineEvents: [],
        factions: [],
      };

  // ── Step C: BibleKeeperAgent — get_snapshot（补全/校验世界观）──────────
  // 把时代知识注入到 premise，供 BibleKeeperAgent buildSystemPrompt 消费
  const snapPremise = storyBibleSnap.premise ?? input.userPrompt;
  const premiseWithEnhancement =
    enhancement.enhancedPrompt.length > snapPremise.length
      ? enhancement.enhancedPrompt
      : snapPremise;

  const bibleKeeperInput: BibleKeeperInput = {
    operation: "get_snapshot",
    projectId,
    contextPackage: {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      generatedBy: userId,
      understanding: {
        summary: premiseWithEnhancement,
        scope: "世界观构建",
        expectedOutput: "完整的故事圣经快照",
      },
      hardConstraints: [],
      entities: [],
      prohibitions: [],
      qualityStandards: [],
      glossary: {},
      establishedFacts: [],
      extensions: {
        storyBible: {
          ...storyBibleSnap,
          premise: premiseWithEnhancement,
        },
      },
    },
    params: {},
  };

  const bibleRes = await bibleKeeperSvc.run({
    input: bibleKeeperInput,
    ctx: {
      missionId,
      userId,
      agentId: `bible-keeper-snapshot-${missionId}`,
      role: "bible-keeper",
      envAdapter: billing,
      budgetMultiplier,
    },
    pool,
  });

  // ── 四件套 step 4: lifecycle completed/failed ────────────────────────────
  const succeeded =
    (bibleRes.state === "completed" || bibleRes.state === "degraded") &&
    !!bibleRes.output;

  await deps.lifecycle(
    missionId,
    userId,
    "s2-world-build",
    "bible-keeper",
    succeeded ? "completed" : "failed",
    {
      wallTimeMs: bibleRes.wallTimeMs,
      iterations: bibleRes.iterations,
      degraded: bibleRes.state === "degraded" || undefined,
    },
  );

  if (!succeeded) {
    throw new Error(
      `[s2] BibleKeeperAgent failed for mission ${missionId} ` +
        `(state=${bibleRes.state}): 世界观快照生成失败，s3/s4 依赖此快照保证设定一致性`,
    );
  }

  const bibleOutput = bibleRes.output!;

  // ── Step D: 世界观落库（WorldSetting upsert，非阻断）─────────────────────
  // Agent 输出的 snapshot 中可能包含新世界观条目，合并写入 DB
  const agentWorldSettings = bibleOutput.result.snapshot?.worldSettings ?? [];

  if (agentWorldSettings.length > 0) {
    const latestBible = await deps.storyBible
      .getByProject(projectId, userId)
      .catch(() => null);

    if (latestBible) {
      const existingKeys = new Set(
        (latestBible.worldSettings ?? []).map(
          (ws) => `${ws.category}:${ws.name}`,
        ),
      );
      let created = 0;
      for (const ws of agentWorldSettings) {
        if (!existingKeys.has(`${ws.category}:${ws.name}`)) {
          await deps.worldSetting
            .create(latestBible.id, {
              category: ws.category,
              name: ws.name,
              description: ws.description,
              rules: ws.rules ?? [],
            })
            .catch((err: unknown) => {
              deps.log.warn(
                `[${missionId}] worldSetting.create "${ws.name}" failed (non-fatal): ` +
                  `${err instanceof Error ? err.message : String(err)}`,
              );
            });
          created++;
        }
      }
      if (created > 0) {
        deps.log.log(
          `[${missionId}] world-build: created ${created} new worldSetting records`,
        );
      }
    } else {
      deps.log.warn(
        `[${missionId}] StoryBible not found for project ${projectId}; ` +
          `worldSetting 落库跳过`,
      );
    }
  }

  // ── Step E: 写 ctx（四件套 step 2）+ checkpoint ──────────────────────────
  // worldSettings：刷新 DB 读取，保证与落库状态一致
  const refreshedBible = await deps.storyBible
    .getByProject(projectId, userId)
    .catch(() => null);

  const worldSettings: NonNullable<WritingMissionContext["worldSettings"]> =
    refreshedBible?.worldSettings?.map((ws) => ({
      category: ws.category,
      name: ws.name,
      description: ws.description,
      rules: ws.rules,
    })) ?? agentWorldSettings;

  // bibleSnapshot：来自 BibleKeeperAgent get_snapshot 输出
  const bibleSnapshot = bibleOutput.result.snapshot ?? storyBibleSnap;

  ctx.worldSettings = worldSettings;
  ctx.bibleSnapshot = bibleSnapshot;

  // checkpoint：关键产物落盘（markIntermediateState 内部 catch + log，失败不阻塞主流程）
  await deps.store.markIntermediateState(
    missionId,
    { worldSettings, bibleSnapshot },
    userId,
  );

  await narrate(deps.emit, missionId, userId, {
    stage: "s2-world-build",
    role: "bible-keeper",
    tag: "success",
    text:
      `世界观构建完成 · ${worldSettings.length} 条设定` +
      `${enhancement.detectedEra ? ` · 时代: ${enhancement.detectedEra}` : ""}` +
      (bibleOutput.warnings?.length
        ? ` · ${bibleOutput.warnings.length} 条警告`
        : ""),
  });

  // ── emit world:building_completed ─────────────────────────────────────────
  void deps.emit({
    type: "writing.world:building_completed",
    missionId,
    userId,
    payload: {
      settings:
        worldSettings.length > 0
          ? { count: worldSettings.length, items: worldSettings }
          : undefined,
    },
  });
}
