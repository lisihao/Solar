/**
 * RadarBusinessOrchestrator —— stage runner 表 + skill prompt 预加载
 *
 * 9 个 step 全部走 persist primitive（hook name=persist，返回 void）。业务输出
 * 副作用写到 SessionEntry.ctx.state；dispatcher 在 mission 结束时从 ctx.state
 * 读 metrics + insightPayload / discoveryCandidates。
 *
 * SystemPrompt 加载：通过 SkillLoaderService.getSkillById('ai-radar.xxx') 拿
 * SKILL.md content（systemPrompt）。在 dispatcher.onModuleInit 时预加载 + cache
 * 到 stepId→prompt map。
 *
 * 2026-05-24 (Wave-1 P7) 继承 BusinessTeamOrchestratorFramework：把
 * bindSessionLookup / getEntry / hooks dispatch / abort 保护下沉到 framework；
 * 业务侧只填 resolveStageRunner switch + override adaptRunnerToHooks 注入
 * systemPrompt（radar 特有的 hook payload）。
 */
import { Injectable, Logger } from "@nestjs/common";
import {
  BusinessTeamOrchestratorFramework,
  type BusinessTeamStageRunner,
  type ResolvedStageHooks,
  type StageRunArgs,
} from "@/modules/ai-harness/facade";
import { SkillLoaderService } from "@/modules/ai-engine/facade";
import type {
  RadarMissionContext,
  RadarStageRunner,
} from "./stages/radar-stage-types";
import { RadarS1SourceResolveStage } from "./stages/s1-source-resolve.stage";
import { RadarS2CollectStage } from "./stages/s2-collect.stage";
import { RadarS3DedupeStage } from "./stages/s3-dedupe.stage";
import { RadarS4RelevanceStage } from "./stages/s4-relevance.stage";
import { RadarS5QualityStage } from "./stages/s5-quality.stage";
import { RadarS6EntityStage } from "./stages/s6-entity.stage";
import { RadarS7InsightStage } from "./stages/s7-insight.stage";
import { RadarS8PersistStage } from "./stages/s8-persist.stage";
import { RadarDiscoveryStage } from "./stages/radar-discovery.stage";

export type SessionLookup = (missionId: string) => RadarMissionContext;

/** stepId → SKILL.md skill id（必须与 SKILL.md frontmatter.id 完全一致） */
const STEP_TO_SKILL_ID: Record<string, string | null> = {
  "s1-source-resolve": null, // 无 LLM
  "s2-collect": null, // 无 LLM
  "s3-dedupe": null, // 无 LLM
  "s4-relevance": "ai-radar.relevance-judge",
  "s5-quality": "ai-radar.quality-rater",
  "s6-entity": "ai-radar.entity-extractor",
  "s7-insight": "ai-radar.signal-analyst",
  "s8-persist": null, // 无 LLM
  "s1-discover": "ai-radar.source-curator",
};

@Injectable()
export class RadarBusinessOrchestrator extends BusinessTeamOrchestratorFramework<RadarMissionContext> {
  protected readonly log = new Logger(RadarBusinessOrchestrator.name);
  private readonly promptCache = new Map<string, string>();
  /** 已告警过缺失的 skillId，避免每次 mission 重复刷 WARN */
  private readonly warnedMissingSkill = new Set<string>();

  constructor(
    private readonly skillLoader: SkillLoaderService,
    private readonly s1: RadarS1SourceResolveStage,
    private readonly s2: RadarS2CollectStage,
    private readonly s3: RadarS3DedupeStage,
    private readonly s4: RadarS4RelevanceStage,
    private readonly s5: RadarS5QualityStage,
    private readonly s6: RadarS6EntityStage,
    private readonly s7: RadarS7InsightStage,
    private readonly s8: RadarS8PersistStage,
    private readonly discovery: RadarDiscoveryStage,
  ) {
    super({ namespace: "radar" });
  }

  /**
   * 预加载所有 LLM step 的 systemPrompt（dispatcher 在 onModuleInit register
   * pipeline 之前调用）。SKILL.md 加载是 fs 同步，但 SkillLoaderService 自己
   * 是 OnApplicationBootstrap，所以等 module init 后再调用最安全。
   */
  async preloadSystemPrompts(): Promise<void> {
    for (const [stepId, skillId] of Object.entries(STEP_TO_SKILL_ID)) {
      if (!skillId) continue;
      const skill = await this.skillLoader.getSkillById(skillId);
      // best-effort 预热：dispatcher 在 onModuleInit 调本方法，而 SkillLoaderService
      // 是 OnApplicationBootstrap（晚于 module init），启动早期可能尚未加载完。
      // 此处不告警——运行时 getSystemPrompt 会懒加载兜底，仅在 mission 真正运行
      // 且 skill 仍缺失时告警一次。
      if (skill) this.promptCache.set(stepId, skill.content);
    }
    this.log.log(
      `[radar-business-orch] preloaded ${this.promptCache.size} skill prompts (lazy fallback active)`,
    );
  }

  /**
   * 运行时取 step 的 systemPrompt：优先缓存，未命中则懒加载并缓存。
   * 修复启动顺序坑——preload 若在 SkillLoader bootstrap 之前跑会得到空缓存，
   * 没有这层兜底就会让 radar 的 LLM stage 拿空 prompt 运行（静默劣化）。
   */
  private async getSystemPrompt(stepId: string): Promise<string> {
    const cached = this.promptCache.get(stepId);
    if (cached !== undefined) return cached;
    const skillId = STEP_TO_SKILL_ID[stepId];
    if (!skillId) return ""; // 非 LLM step
    const skill = await this.skillLoader.getSkillById(skillId);
    if (!skill) {
      if (!this.warnedMissingSkill.has(skillId)) {
        this.warnedMissingSkill.add(skillId);
        this.log.warn(
          `[radar-business-orch] skill "${skillId}" still missing at run time (stepId=${stepId})`,
        );
      }
      return "";
    }
    this.promptCache.set(stepId, skill.content);
    return skill.content;
  }

  /**
   * radar 9 个 stage 全 persist primitive；business runner 直接调 stage class。
   * 找不到 runner 时返回 null（与历史 behaviour 一致：framework 抛 "no runner"）。
   */
  protected resolveStageRunner(
    stepId: string,
  ): BusinessTeamStageRunner<RadarMissionContext> | null {
    const stage = this.resolveStageClass(stepId);
    if (!stage) return null;
    return async (ctx, args) => {
      const systemPrompt = await this.getSystemPrompt(stepId);
      const stageArgs = args as {
        ctx: StageRunArgs["ctx"];
        previousOutputs: StageRunArgs["previousOutputs"];
        crossStageState: StageRunArgs["crossStageState"];
      };
      await stage.run(
        {
          ctx: stageArgs.ctx,
          previousOutputs: stageArgs.previousOutputs,
          crossStageState: stageArgs.crossStageState,
          systemPrompt,
        },
        ctx,
      );
      return undefined;
    };
  }

  /**
   * Override default adapter —— radar 历史行为：未注册的 stepId 返回 no-op
   * hooks（persist 直接 return undefined），不像 framework 默认抛 "no runner"。
   * 保留此向后兼容，避免破坏 pipeline registry 已注册但 runner 未实装的 step。
   */
  buildHooksForStep(stepId: string, primitive = "persist"): ResolvedStageHooks {
    const runner = this.resolveStageRunner(stepId);
    if (!runner) {
      const noop: ResolvedStageHooks = {
        persist: async (): Promise<void> => undefined,
      };
      this.log.warn(`No stage runner for step "${stepId}"`);
      return noop;
    }
    return this.adaptRunnerToHooks(runner, stepId, primitive);
  }

  private resolveStageClass(stepId: string): RadarStageRunner | null {
    switch (stepId) {
      case "s1-source-resolve":
        return this.s1;
      case "s2-collect":
        return this.s2;
      case "s3-dedupe":
        return this.s3;
      case "s4-relevance":
        return this.s4;
      case "s5-quality":
        return this.s5;
      case "s6-entity":
        return this.s6;
      case "s7-insight":
        return this.s7;
      case "s8-persist":
        return this.s8;
      case "s1-discover":
        return this.discovery;
      default:
        return null;
    }
  }
}
