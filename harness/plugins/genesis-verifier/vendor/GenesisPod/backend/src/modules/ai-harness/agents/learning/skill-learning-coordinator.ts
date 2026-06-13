/**
 * SkillLearningCoordinator — SkillLearner 闭环编排
 *
 * SkillLearner 只产出候选；本协调器把候选 → 解析 → 评分 → 注册 SkillRegistry，
 * 让"自我改进"真正闭环：成功的 agent 立即把模式沉淀为可复用 skill，
 * 同 role 的下一个 agent 自动获益。
 *
 * 闭环流程：
 *   1. SkillLearner.learn(trace) → SkillCandidate (raw markdown)
 *   2. parseSkillMarkdown(candidate.markdown) → ISkill
 *   3. JudgeService.judgeWithConsensus → score
 *   4. score >= autoRegisterThreshold → SkillRegistry.register; 返回 'auto-registered'
 *      score >= stagingThreshold       → 暂存到 in-memory staging（供 UI 审核）；'staged'
 *      其它                             → 'rejected'
 *
 * 与 PR-D 的 worktree 沙箱回放正交：本协调器只用 LLM judge，避免 N 次回放成本。
 * 想接真实回放，扩展 evaluateBySandbox(spec, candidate) 钩子即可。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  SkillLearner,
  type LearnFromTraceOptions,
  type SkillCandidate,
} from "./skill-learner";
import { BuiltinSkillCatalog } from "../skill-runtime/skill-registry";
import {
  parseSkillMarkdown,
  SkillParseError,
} from "../skill-runtime/skill-parser";
import { JudgeService } from "../../evaluation/verify/judge.service";
import type { BuiltInVerifierId } from "../../evaluation/verify/judge.service";
import type { ISkill } from "../abstractions";

export interface CloseLoopOptions extends LearnFromTraceOptions {
  /** Auto-register 阈值，默认 80 */
  autoRegisterThreshold?: number;
  /** Staging 阈值（≤ auto, > stage 进 staging），默认 60 */
  stagingThreshold?: number;
  /** 评估用的 verifier id 列表，默认 ['self', 'critical'] */
  verifierIds?: readonly BuiltInVerifierId[];
  /**
   * PR-I 修复 #10: 沙箱回放器。
   * 提供时，candidate 在 N 个相似历史 task 上回放；通过率纳入综合分。
   * 无 replayer 时退回纯 LLM judge 评分（兼容旧行为）。
   */
  sandboxReplayer?: SandboxReplayer;
}

/**
 * SandboxReplayer —— Skill 候选的沙箱验证器。
 *
 * 业务方实现（业务模块 / 任何 App 都可写一个）：
 *   - sample(): 拿出 N 个相似历史 task
 *   - replay(skill, task): 用候选 skill 跑一遍，返回 score
 *
 * Voyager 论文的核心做法：每个新 skill 必须在原 distribution 上重现成功才入库。
 */
export interface SandboxReplayer {
  /** 准备测试样本（通常从 EventStore / TaskStore 拉历史成功 task） */
  sample(
    roleId: string,
    n: number,
  ): Promise<readonly { id: string; input: unknown }[]>;
  /** 用 candidate 跑一个 task，返回 0..100 分（越高越好） */
  replay(
    candidateMarkdown: string,
    sample: { id: string; input: unknown },
  ): Promise<{ score: number; note?: string }>;
}

export interface CloseLoopResult {
  decision: "auto-registered" | "staged" | "rejected" | "skipped";
  candidate: SkillCandidate | null;
  parsedSkill: ISkill | null;
  score: number | null;
  reason?: string;
}

@Injectable()
export class SkillLearningCoordinator {
  private readonly log = new Logger(SkillLearningCoordinator.name);
  private readonly staging = new Map<string, ISkill & { score: number }>();

  constructor(
    private readonly learner: SkillLearner,
    private readonly registry: BuiltinSkillCatalog,
    @Optional() private readonly judge?: JudgeService,
  ) {}

  async closeLoop(options: CloseLoopOptions): Promise<CloseLoopResult> {
    const autoThreshold = options.autoRegisterThreshold ?? 80;
    const stageThreshold = options.stagingThreshold ?? 60;
    const verifierIds = options.verifierIds ?? ["self", "critical"];

    // 1. Generate candidate
    const candidate = await this.learner.learn(options);
    if (!candidate) {
      return {
        decision: "skipped",
        candidate: null,
        parsedSkill: null,
        score: null,
        reason: "learner produced no candidate (no actions or LLM unavailable)",
      };
    }

    // 2. Parse SKILL.md
    let parsed: ISkill;
    try {
      parsed = parseSkillMarkdown(candidate.markdown, candidate.suggestedId);
    } catch (err) {
      const msg = err instanceof SkillParseError ? err.message : String(err);
      this.log.warn(`[closeLoop] candidate parse failed: ${msg}`);
      return {
        decision: "rejected",
        candidate,
        parsedSkill: null,
        score: null,
        reason: `parse-failed: ${msg}`,
      };
    }

    // 3a. Sandbox replay (PR-I 修复 #10) —— Voyager 风格
    let replayScore: number | null = null;
    if (options.sandboxReplayer) {
      try {
        const samples = await options.sandboxReplayer.sample(
          options.identity.role.id,
          3,
        );
        if (samples.length > 0) {
          const replays = await Promise.all(
            samples.map((s) =>
              options.sandboxReplayer!.replay(candidate.markdown, s),
            ),
          );
          replayScore =
            replays.reduce((a, b) => a + b.score, 0) / replays.length;
          this.log.log(
            `[closeLoop] sandbox replay over ${samples.length} samples → avg ${replayScore.toFixed(1)}`,
          );
        }
      } catch (err) {
        this.log.warn(
          `[closeLoop] sandbox replay failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 3b. Score (judge + replay 融合：60% judge + 40% replay)
    let score = 0;
    if (this.judge) {
      try {
        const result = await this.judge.judgeWithConsensus({
          output: parsed.instructions,
          envelope: {
            id: "skill-learning",
            system: "",
            messages: [],
            reminders: [],
            tools: [],
            memory: { sessionId: "skill-learning" },
            budget: {
              tokensUsed: 0,
              tokensRemaining: 0,
              iterationsUsed: 0,
              iterationsRemaining: 0,
              wallTimeStartMs: Date.now(),
            },
          },
          verifierIds,
          passThreshold: stageThreshold,
        });
        score = result.decision.score;
      } catch (err) {
        this.log.warn(
          `[closeLoop] judging failed, treating as low confidence: ${err instanceof Error ? err.message : String(err)}`,
        );
        score = 0;
      }
    } else {
      // No judge wired — use trace stats heuristic (action count + tool diversity)
      score = Math.min(
        100,
        candidate.stats.actionCount * 8 + candidate.stats.toolsUsed.length * 10,
      );
    }

    // PR-I 融合：有 sandbox 则 60% judge + 40% replay；无 sandbox 用纯 judge
    if (replayScore !== null) {
      score = Math.round(score * 0.6 + replayScore * 0.4);
    }

    // 4. Decide
    if (score >= autoThreshold) {
      this.registry.register(parsed);
      this.log.log(
        `[closeLoop] auto-registered skill '${parsed.frontmatter.name}' (score=${score})`,
      );
      return {
        decision: "auto-registered",
        candidate,
        parsedSkill: parsed,
        score,
      };
    }
    if (score >= stageThreshold) {
      this.staging.set(parsed.frontmatter.name, { ...parsed, score });
      this.log.log(
        `[closeLoop] staged skill '${parsed.frontmatter.name}' (score=${score}, awaiting human review)`,
      );
      return {
        decision: "staged",
        candidate,
        parsedSkill: parsed,
        score,
      };
    }
    return {
      decision: "rejected",
      candidate,
      parsedSkill: parsed,
      score,
      reason: `score ${score} < staging threshold ${stageThreshold}`,
    };
  }

  /** 列出所有暂存的 skill 候选（人工 UI 审核用） */
  listStaged(): readonly (ISkill & { score: number })[] {
    return [...this.staging.values()];
  }

  /** 人工批准暂存：从 staging 升级到 SkillRegistry */
  approveStaged(name: string): boolean {
    const skill = this.staging.get(name);
    if (!skill) return false;
    this.registry.register(skill);
    this.staging.delete(name);
    return true;
  }

  /** 人工驳回暂存 */
  rejectStaged(name: string): boolean {
    return this.staging.delete(name);
  }
}
