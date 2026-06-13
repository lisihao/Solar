/**
 * dimension-grade.helper —— dimension:graded 事件的 overall/grade/summary 纯计算。
 *
 * 从 DeepInsightStageBindings 抽出（god-class size guard：stage-bindings 已 >2500 行，
 * 新增认知逻辑下沉 helper）。纯函数无副作用，emit 仍由 bindings 负责（保持 wiring 在内核）。
 *
 * 背景（2026-06-10 回归审计）：deep-insight 是启发式打分（findingsCount 归一化），
 *   非 LLM grader——故不产 5 轴 axes（DimensionGradedSchema.axes optional 缺省合法），
 *   grade/summary 由状态 + finding 数 + leader 逐维 critique 合成。
 */

/** researcher 维度产出最小投影（emitAssessGraded 输入）。 */
export interface DimensionOutcomeLite {
  readonly dimensionName: string;
  readonly dimensionId: string;
  readonly state: "completed" | "degraded" | "failed";
  readonly findingsCount: number;
}

/** leader assess 逐维决策最小投影（perDimension 元素）。 */
interface LeaderPerDimLite {
  dimensionName?: string;
  dimensionId?: string;
  action?: string;
  critique?: string;
}

/**
 * dimension:graded 事件 payload 形状（DimensionGradedSchema 对齐）。
 * index signature 让其可直接作为 emitDomain 的 Record<string, unknown> payload。
 */
export interface DimensionGrade {
  readonly dimension: string;
  readonly overall: number;
  readonly grade: string;
  readonly summary: string;
  readonly state: string;
  readonly action: string;
  readonly [k: string]: unknown;
}

/** overall(0-100) → 等级字符串（A/B/C/D/F），供 dimension:graded.grade。 */
function scoreToGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

/**
 * 从 researcher 产出 + leader assess output 计算逐维 grade。
 *
 * @param output leader assess 原始产出（含 perDimension[]）；S3 失败路径传 undefined。
 */
export function computeDimensionGrades(
  researcherOutcomes: ReadonlyArray<DimensionOutcomeLite>,
  output: unknown,
): DimensionGrade[] {
  const perDimensionArr: LeaderPerDimLite[] =
    output != null && typeof output === "object"
      ? (((output as { perDimension?: unknown }).perDimension as
          | LeaderPerDimLite[]
          | undefined) ?? [])
      : [];

  return researcherOutcomes.map((o) => {
    const perDim = perDimensionArr.find(
      (d) =>
        d.dimensionName === o.dimensionName || d.dimensionId === o.dimensionId,
    );
    const action =
      perDim?.action ??
      (o.state === "completed" ? "accept" : "retry-with-critique");
    // findingsCount 归一化为 0-100 分（accept=≥70, degraded=50, failed=30）。
    const overall =
      o.state === "completed" && action === "accept"
        ? Math.min(100, 60 + Math.min(o.findingsCount * 5, 40))
        : o.state === "degraded"
          ? 50
          : 30;
    // summary：优先 leader 逐维 critique，缺则用状态 + finding 数合成。
    const summary =
      typeof perDim?.critique === "string" && perDim.critique.trim()
        ? perDim.critique.slice(0, 200)
        : o.state === "completed"
          ? `采集完成，共 ${o.findingsCount} 条 findings，决策 ${action}`
          : o.state === "degraded"
            ? `产出退化（${o.findingsCount} 条 findings），需关注`
            : "采集失败，无有效 findings";
    return {
      dimension: o.dimensionName,
      overall,
      grade: scoreToGrade(overall),
      summary,
      state: o.state,
      action,
    };
  });
}
