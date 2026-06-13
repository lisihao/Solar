/**
 * P4 (2026-05-24) — shared facade mock 实现
 *
 * 抽到 fixture 避免 per-dim-pipeline.util.spec.ts 被 god-class guard 拒推
 * (spec 2728 行,P4 净增 93 行 mock 超 50 行容差)。
 *
 * 6 个 mock fn 对应 P4 下沉到 ai-harness/teams/business-team/helpers/ 的
 * symbols: computeSupplyBudget / extractGroupFromUrlOrText /
 * deriveMaxDemandSlots / deriveMinPerSlot / executeBusinessTeamBatch /
 * groundMultiAxisGrade
 *
 * 调用方式: 在 spec 顶部 jest.mock factory 内 require 本文件
 *   jest.mock("@/modules/ai-harness/facade", () => {
 *     const { createP4FacadeMocks } = require("./__fixtures__/p4-facade-mocks");
 *     return { ...createP4FacadeMocks() };
 *   });
 */

export interface P4FacadeMocks {
  computeSupplyBudget: jest.Mock;
  extractGroupFromUrlOrText: jest.Mock;
  deriveMaxDemandSlots: jest.Mock;
  deriveMinPerSlot: jest.Mock;
  executeBusinessTeamBatch: jest.Mock;
  groundMultiAxisGrade: jest.Mock;
}

export function createP4FacadeMocks(): P4FacadeMocks {
  return {
    computeSupplyBudget: jest.fn(
      (
        items: ReadonlyArray<{ source: string }>,
        keyOf: (i: { source: string }) => string,
        groupOf: (i: { source: string }) => string,
      ) => {
        const keys = new Set<string>();
        const groups = new Set<string>();
        for (const it of items) {
          const k = (keyOf(it) ?? "").trim().toLowerCase();
          if (!k) continue;
          keys.add(k);
          const g = (groupOf(it) ?? "").trim();
          if (g) groups.add(g);
        }
        return {
          uniqueKeys: keys.size,
          uniqueGroups: groups.size,
          totalItems: items.length,
        };
      },
    ),
    extractGroupFromUrlOrText: jest.fn((s: string) => (s ?? "").toLowerCase()),
    deriveMaxDemandSlots: jest.fn(
      (budget: { uniqueKeys: number }, ideal: number, min = 1) => {
        const byKeys = Math.floor(budget.uniqueKeys / 2);
        const natural = Math.max(1, Math.min(ideal, byKeys));
        const floor = Math.min(
          Math.max(1, min),
          ideal,
          Math.max(1, budget.uniqueKeys),
        );
        return Math.max(natural, floor);
      },
    ),
    deriveMinPerSlot: jest.fn((n: number) =>
      Math.min(2, Math.max(0, Math.floor(n))),
    ),
    executeBusinessTeamBatch: jest.fn(
      async <T extends { index: number }, S, R>(
        items: T[],
        _concurrency: number,
        snapshot: S,
        runOne: (item: T, s: S) => Promise<R | null>,
        onItemThrow: (item: T, err: unknown) => Promise<void>,
      ) => {
        const results: PromiseSettledResult<R | null>[] = [];
        for (const it of items) {
          try {
            const v = await runOne(it, snapshot);
            results.push({ status: "fulfilled", value: v });
          } catch (err) {
            await onItemThrow(it, err);
            results.push({ status: "fulfilled", value: null });
          }
        }
        return results;
      },
    ),
    groundMultiAxisGrade: jest.fn(
      (
        grade: { overall: number; grade: string; axes: unknown },
        uniqueSources: number,
      ) => {
        const axes = grade.axes as Record<
          string,
          { score: number; comment: string }
        >;
        const ceil = Math.min(100, Math.max(0, uniqueSources) * 20);
        if (axes["sources_sufficiency"]) {
          axes["sources_sufficiency"].score = Math.min(
            axes["sources_sufficiency"].score,
            ceil,
          );
        }
        const vals = Object.values(axes).map((a) => a.score);
        if (vals.length > 0) {
          grade.overall = Math.round(
            vals.reduce((a, b) => a + b, 0) / vals.length,
          );
          grade.grade =
            grade.overall >= 80
              ? "excellent"
              : grade.overall >= 65
                ? "good"
                : grade.overall >= 50
                  ? "fair"
                  : "poor";
        }
      },
    ),
  };
}
