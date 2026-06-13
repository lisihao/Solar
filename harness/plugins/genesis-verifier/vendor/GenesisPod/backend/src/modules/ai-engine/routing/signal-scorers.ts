/**
 * 默认信号打分器工厂
 *
 * 直接移植 ModelElectionService 的打分常量（health / cost / diversity / priority），
 * 让三个 router 共用同一套"血泪调过"的权重，而不是各自重发明。
 * 新增 latency scorer（election 缺、SOTA 有），供 LLM router P2 接入。
 *
 * relevance 不在此——它需要 embedding，由 ScoredRouterService 内置计算。
 */

import type {
  RoutableCandidate,
  RouteQuery,
  SignalScorer,
} from "./abstractions/routing.types";
import {
  scoreDiversity,
  scoreHealthRate,
  scorePriority,
} from "./scoring-formulas";

/**
 * 健康：recentErrorRate 0 → +20；0.1 → +10；0.3 → 0；更高 → -20。
 * 移植 election.scoreHealth（含 undefined → 中位 15）。
 */
export function healthScorer<T extends RoutableCandidate>(): SignalScorer<T> {
  return {
    key: "health",
    score(cand) {
      return scoreHealthRate(cand.signals?.recentErrorRate);
    },
  };
}

/**
 * 成本：按 costBias × costTier。移植 election.scoreCost。
 */
export function costScorer<T extends RoutableCandidate>(): SignalScorer<T> {
  return {
    key: "cost",
    score(cand, query: RouteQuery) {
      const bias = query.costBias ?? "balanced";
      const tier = cand.signals?.costTier;
      const effective = tier && tier !== "unknown" ? tier : "standard";
      if (bias === "cheap") {
        return effective === "basic" ? 15 : effective === "standard" ? 5 : 0;
      }
      if (bias === "quality") {
        return effective === "strong" ? 15 : effective === "standard" ? 5 : 0;
      }
      return effective === "standard" ? 10 : 5; // balanced
    },
  };
}

/**
 * 多样性反坍缩：被选过 N 次 → -10×N。移植 election.scoreDiversity。
 */
export function diversityScorer<
  T extends RoutableCandidate,
>(): SignalScorer<T> {
  return {
    key: "diversity",
    score(cand, query: RouteQuery) {
      return scoreDiversity(cand.id, query.previouslyChosen);
    },
  };
}

/**
 * 运营优先级：(priority ?? 50) / 10 → 0~10。移植 election.priorityScore。
 */
export function priorityScorer<T extends RoutableCandidate>(): SignalScorer<T> {
  return {
    key: "priority",
    score(cand) {
      return scorePriority(cand.signals?.priority);
    },
  };
}

/**
 * 延迟（SOTA 新信号，election 缺）：p95 越低越好。
 *   <=500ms → +10；<=1500ms → +5；<=4000ms → 0；更高 → -10；未知 → 中位 5。
 * LLM router P2 接入；Tools/Skills 通常无 latency 数据 → 默认不挂此 scorer。
 */
export function latencyScorer<T extends RoutableCandidate>(): SignalScorer<T> {
  return {
    key: "latency",
    score(cand) {
      const ms = cand.signals?.p95LatencyMs;
      if (ms === undefined) return 5;
      if (ms <= 500) return 10;
      if (ms <= 1500) return 5;
      if (ms <= 4000) return 0;
      return -10;
    },
  };
}

/**
 * 默认信号组合（不含 latency）——Tools / Skills router 用。
 */
export function defaultScorers<
  T extends RoutableCandidate,
>(): SignalScorer<T>[] {
  return [
    healthScorer<T>(),
    costScorer<T>(),
    diversityScorer<T>(),
    priorityScorer<T>(),
  ];
}
