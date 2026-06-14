/**
 * SemanticSkillRouter —— 给定任务文本，语义匹配最合适的 skill
 *
 * 补齐 SkillRegistry.matchByTrigger 的字面短板（keyword/intent/regex → 无语义）：
 *   - selectSkill()：**规则优先、语义兜底**——先用 trigger 关键词匹配（确定性、零成本），
 *     命中即返回；无命中再走语义检索（ScoredRouter）。
 *   - routeByTask()：纯语义排序，供调用方直接拿 top-k。
 *
 * embedding 不可用时 ScoredRouter 自动降级为纯信号打分（仍按 priority 给出确定结果），
 * 不抛错。归 engine（agent 无关）。
 */

import { Injectable } from "@nestjs/common";
import { SkillRegistry } from "../registry/skill.registry";
import { ScoredRouterService } from "../../routing/scored-router.service";
import { defaultScorers } from "../../routing/signal-scorers";
import type {
  RoutableCandidate,
  RouteResult,
} from "../../routing/abstractions/routing.types";
import type { ISkill, SkillLayer } from "../abstractions/skill.interface";

export interface SkillRouteOptions {
  /** 限定领域（不传 = 全部） */
  readonly domain?: string;
  /** 限定层次（不传 = 全部） */
  readonly layer?: SkillLayer;
  /** 语义裁剪上限 */
  readonly topK?: number;
}

export interface SkillRouteResult {
  readonly skill: ISkill | null;
  readonly ranked: ReadonlyArray<{ skill: ISkill; total: number }>;
  readonly reason: string;
  /** "trigger" = 规则命中；"semantic" = 语义；"degraded" = embedding 不可用降级 */
  readonly via: "trigger" | "semantic" | "degraded";
}

@Injectable()
export class SemanticSkillRouter {
  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly scoredRouter: ScoredRouterService,
  ) {}

  /**
   * 规则优先、语义兜底。
   */
  async selectSkill(
    taskText: string,
    opts: SkillRouteOptions = {},
  ): Promise<SkillRouteResult> {
    // 1) 规则优先：keyword trigger 命中即用（确定性、零 embedding 成本）
    const triggerHits = this.skillRegistry.matchByTrigger("keyword", taskText);
    const scopedHit = triggerHits.find((s) => this.inScope(s, opts));
    if (scopedHit) {
      return {
        skill: scopedHit,
        ranked: [{ skill: scopedHit, total: Number.POSITIVE_INFINITY }],
        reason: `trigger keyword hit: ${scopedHit.id}`,
        via: "trigger",
      };
    }

    // 2) 语义兜底
    return this.routeByTask(taskText, opts);
  }

  /**
   * 纯语义排序。
   */
  async routeByTask(
    taskText: string,
    opts: SkillRouteOptions = {},
  ): Promise<SkillRouteResult> {
    const skills = this.skillRegistry
      .getAll()
      .filter((s) => this.inScope(s, opts));

    if (skills.length === 0) {
      return {
        skill: null,
        ranked: [],
        reason: "no skills in scope",
        via: "semantic",
      };
    }

    const byId = new Map(skills.map((s) => [s.id, s]));
    const candidates: RoutableCandidate[] = skills.map((s) => ({
      id: s.id,
      description: this.toEmbeddingText(s),
    }));

    const result: RouteResult<RoutableCandidate> =
      await this.scoredRouter.route(
        candidates,
        { goal: taskText, topK: opts.topK },
        defaultScorers(),
      );

    const ranked = result.ranked
      .map((r) => {
        const skill = byId.get(r.candidate.id);
        return skill ? { skill, total: r.score.total } : null;
      })
      .filter((x): x is { skill: ISkill; total: number } => x !== null);

    return {
      skill: ranked[0]?.skill ?? null,
      ranked,
      reason: result.reason,
      via: result.semanticApplied ? "semantic" : "degraded",
    };
  }

  private inScope(skill: ISkill, opts: SkillRouteOptions): boolean {
    if (opts.domain && skill.domain !== opts.domain) return false;
    if (opts.layer && skill.layer !== opts.layer) return false;
    return true;
  }

  /** name + description + tags 拼成 embedding 文本（描述越全语义越准） */
  private toEmbeddingText(skill: ISkill): string {
    const tags = skill.tags?.length ? ` tags: ${skill.tags.join(", ")}` : "";
    return `${skill.name}. ${skill.description}${tags}`;
  }
}
