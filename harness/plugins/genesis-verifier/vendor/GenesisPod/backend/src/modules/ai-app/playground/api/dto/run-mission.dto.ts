import { z } from "zod";
import {
  DEFAULT_SEARCH_TIME_RANGE,
  SEARCH_TIME_RANGE_VALUES,
  type SearchTimeRange,
} from "@/common/search/search-time-range";
import { CREDITS_TO_USD } from "@/modules/ai-harness/facade";

/**
 * 预算档位 —— 给前端 UI 选档用的语义标签。
 * ★ 2026-05-06 (P0-K): backend 不再有 BUDGET_PROFILE_CREDITS / _MULTIPLIER 映射。
 *   用户侧（前端 RunMissionDialog）按选档计算 maxCredits + budgetMultiplierOverride
 *   传给 backend；backend 只看 input.maxCredits / input.budgetMultiplierOverride，
 *   不再有任何"内部硬编码默认值"。
 */
export const BUDGET_PROFILE = ["low", "medium", "high", "unlimited"] as const;
export type BudgetProfile = (typeof BUDGET_PROFILE)[number];
export { SEARCH_TIME_RANGE_VALUES };
export type { SearchTimeRange };

export const RunMissionInputSchema = z
  .object({
    topic: z.string().min(2).max(200),
    /**
     * 选填长文本"研究描述"——给 Leader 更完整的用户意图上下文。
     * topic 是简短标题（≤200），description 用于详述背景 / 约束 / 关注角度 / 排除项等，
     * 进 leader plan/assess/foreword/signoff 4 个 phase 的 prompt（plan 阶段尤其影响维度拆分质量）。
     */
    description: z.string().max(10000).optional(),
    // ★ Phase P0-8 用户档位（mission-pipeline-user-profiles.md / D20）
    // 默认值：深度 + 图文 + 中等其他
    depth: z.enum(["quick", "standard", "deep"]).default("deep"),
    language: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
    /** UI 档位语义（前端可视化用）；backend 不再据此推导任何数值 */
    budgetProfile: z.enum(BUDGET_PROFILE).default("medium"),
    styleProfile: z
      .enum(["academic", "executive", "journalistic", "technical"])
      .default("executive"),
    lengthProfile: z
      .enum(["brief", "standard", "deep", "extended", "epic", "mega"])
      .default("standard"),
    audienceProfile: z
      .enum(["executive", "domain-expert", "general-public"])
      .default("domain-expert"),
    withFigures: z.boolean().default(true),
    auditLayers: z
      .enum(["minimal", "default", "thorough", "thorough+"])
      .default("default"),
    concurrency: z.number().int().min(1).max(10).default(3),
    viewMode: z.enum(["continuous", "chapter", "quick"]).default("continuous"),
    searchTimeRange: z
      .enum(SEARCH_TIME_RANGE_VALUES)
      .default(DEFAULT_SEARCH_TIME_RANGE),
    /**
     * ★ 2026-05-22 单一数据源：mission 级 maxCredits 上限改为**可选覆盖**。
     * 缺省时由 depth（调研规模档位）经 DEPTH_BUDGET_TIERS 解析（见 resolveMissionCredits）；
     * 仅当用户在「高级」里显式自定义时才传。1 credit ≈ 1k tokens。
     *
     * ★ 2026-06-10 BYOK 放宽：硬上限提到 500000（≈ cost cap $1000）。BYOK（personal key）
     *   用户花自己 provider 的钱，不该被平台 100k 档位卡死。此处只放宽**输入上限**——
     *   它本质是"防 mission bug 失控烧爆"的 backstop，500k 仍保留该保护（不是取消）。
     *   平台 credit 用户的真实约束仍是余额（S1 estimateAffordable 余额不足即 abort），
     *   故放宽输入上限对平台用户无副作用（余额不够照样挡）。BYOK 走 estimateAffordable
     *   豁免分支，可用满 500k 头寸。
     */
    maxCredits: z.number().int().min(10).max(500_000).optional(),
    /**
     * 用户自定义 wall-time cap（毫秒）覆盖。不传则按 depth 档位（DEPTH_BUDGET_TIERS）解析。
     * 范围 60s ~ 24h（2026-05-27 上调以应对本地模型深度分析时长需求）。
     */
    wallTimeCapMs: z
      .number()
      .int()
      .min(60_000)
      .max(24 * 60 * 60 * 1000)
      .optional(),
    /**
     * ★ 2026-05-22 单一数据源：agent budget 倍率改为**可选覆盖**（scale agent 的
     * maxTokens / maxIterations）。缺省按 depth 档位解析。范围 0.3 ~ 10。
     */
    budgetMultiplierOverride: z.number().min(0.3).max(10).optional(),
    /**
     * 本地知识库 ID 列表 —— researcher 调 rag-search 时会限定在这些 KB 内做语义召回。
     * 不传 / 空数组 → researcher 跳过 rag-search 走纯 web-search。
     * 上限 10（与 ai-ask / open-api 一致）。
     */
    knowledgeBaseIds: z.array(z.string().uuid()).max(10).optional(),
    /**
     * ★ 2026-05-05 增量更新（"更新"按钮 mode='incremental'）：源 mission ID。
     * Dispatcher 启动时载入 source.dimensions + themeSummary 作为本次 plan 跳过 S2 Leader
     * LLM 调用；下游 stage（researcher / writer）按 input.inheritFromMissionId 决定要不
     * 要把上次 reportArtifact 喂进 prompt 做 "在上一次基础上更新" 语义。
     */
    inheritFromMissionId: z.string().uuid().optional(),
  })
  // ★ P2 (2026-05-06): 矛盾组合校验 —— quick 档只跑 1 round，不可能生成 epic/mega
  //   体量的报告；前端应禁止此组合，后端加 refine 兜底防误传。
  .refine(
    (d) =>
      !(
        d.depth === "quick" &&
        (d.lengthProfile === "epic" || d.lengthProfile === "mega")
      ),
    {
      message:
        "depth=quick 与 lengthProfile=epic/mega 矛盾，请换用 standard/deep 档",
    },
  );

export type RunMissionInput = z.infer<typeof RunMissionInputSchema>;

/**
 * ★ 2026-05-22 单一数据源：调研规模档位表（快速 / 标准 / 深度 = depth）。
 *
 * depth 即"调研规模"档位。一处定义 budget / 倍率 / 时长，前后端、首跑、重跑、
 * Mission 设置全部从这里解析，消除"多处重复定义 + 配置/使用不同源"。
 * 用户可在「高级」里显式覆盖 maxCredits / budgetMultiplierOverride / wallTimeCapMs，
 * 覆盖值优先（resolveX 里 input.X ?? tier.X）。
 *
 * cap 标定：cap ≈ 典型花费 2–3×，留足余量。实测 11 维度深度典型 ~$15，
 * 深度档 cap = 20000 credits ≈ $40（maxCredits×0.002），杜绝"$2 预算秒爆"。
 * （1 credit ≈ 1k tokens；cost cap = maxCredits × 0.002 USD。）
 */
export const DEPTH_BUDGET_TIERS: Record<
  RunMissionInput["depth"],
  {
    maxCredits: number;
    budgetMultiplier: number;
    wallTimeCapMs: number;
    /** 展示元数据(前端不再手写镜像,GET /budget-tiers 返回此处) */
    label: string;
    desc: string;
    dimensionsHint: string;
  }
> = {
  quick: {
    maxCredits: 3000,
    budgetMultiplier: 1.0,
    // ★ 2026-05-27：本地模型深度分析时长需求大幅放宽
    //   quick 20min → 3h（180min），standard 1h → 10h（600min），deep 3h → 24h（1440min）
    wallTimeCapMs: 180 * 60_000,
    label: "快速",
    desc: "快速概览 / 试探",
    dimensionsHint: "~4 维度",
  },
  standard: {
    maxCredits: 8000,
    budgetMultiplier: 2.0,
    wallTimeCapMs: 600 * 60_000,
    label: "标准",
    desc: "多数调研场景",
    dimensionsHint: "~7 维度",
  },
  deep: {
    maxCredits: 20000,
    budgetMultiplier: 4.0,
    wallTimeCapMs: 1440 * 60_000,
    label: "深度",
    desc: "全面深度报告",
    dimensionsHint: "~11 维度",
  },
};

/**
 * 预算字段的硬上下限（DTO clamp 单一源，GET /budget-tiers 一并返回给前端）。
 * ★ 2026-06-10 maxCredits 硬上限 100k → 500k（BYOK 放宽，见 RunMissionInputSchema.maxCredits
 *   注释）。前端「高级」滑块上限随此值；平台用户实际仍受余额约束。
 */
export const BUDGET_FIELD_LIMITS = {
  maxCredits: { min: 10, max: 500_000 },
  budgetMultiplier: { min: 0.3, max: 10 },
  // ★ 2026-05-27：本地模型深度分析需要更长时间窗
  wallTimeMinutes: { min: 1, max: 1440 },
} as const;

export interface BudgetTierView {
  depth: RunMissionInput["depth"];
  label: string;
  desc: string;
  dimensionsHint: string;
  maxCredits: number;
  budgetMultiplier: number;
  wallTimeMinutes: number;
  /** 成本上限 = maxCredits × 0.002 USD（与 MissionBudgetPool cap 同公式） */
  capUsd: number;
}

/**
 * ★ 2026-05-22 ③J/K 单一源：前端不再手写 SCALE_TIERS 镜像后端。
 * 后端 GET /budget-tiers 返回此数组 + BUDGET_FIELD_LIMITS,前端 fetch 渲染。
 */
export function listBudgetTiers(): BudgetTierView[] {
  return (["quick", "standard", "deep"] as const).map((depth) => {
    const t = DEPTH_BUDGET_TIERS[depth];
    return {
      depth,
      label: t.label,
      desc: t.desc,
      dimensionsHint: t.dimensionsHint,
      maxCredits: t.maxCredits,
      budgetMultiplier: t.budgetMultiplier,
      wallTimeMinutes: Math.round(t.wallTimeCapMs / 60_000),
      // ★ C3a/G4：换算走 canonical 常量(额度代理值,非真实成本),删散落 0.002 字面量。
      capUsd: Math.round(t.maxCredits * CREDITS_TO_USD),
    };
  });
}

/**
 * ★ 2026-05-22 单一源：maxCredits 为可选覆盖，缺省按 depth 档位解析。
 * 修复历史"重跑读不到列里 maxCredits → 兜底 1000 → $2 秒爆"：现在缺省也有
 * 合理档位值兜底，且 cloneInputFromMission 改读权威列值。
 */
export function resolveMissionCredits(input: RunMissionInput): number {
  return input.maxCredits ?? DEPTH_BUDGET_TIERS[input.depth].maxCredits;
}

/**
 * ★ 2026-05-22 单一源：budgetMultiplier 为可选覆盖，缺省按 depth 档位解析。
 */
export function resolveBudgetMultiplier(input: RunMissionInput): number {
  return (
    input.budgetMultiplierOverride ??
    DEPTH_BUDGET_TIERS[input.depth].budgetMultiplier
  );
}

/**
 * Mission 级 wall-time 上限（ms）—— 单一源：缺省按 depth 档位，「高级」可覆盖。
 * ★ 2026-05-22: 去掉原 depth×audit×budget 三维矩阵（多源 + 与前端预设冲突），
 *   统一从 DEPTH_BUDGET_TIERS 取（DTO 已 cap 60s~3h）。
 */
export function resolveMissionWallTimeMs(input: RunMissionInput): number {
  if (input.wallTimeCapMs != null) return input.wallTimeCapMs;
  return DEPTH_BUDGET_TIERS[input.depth].wallTimeCapMs;
}

export const ResearchReportSchema = z.object({
  title: z.string().min(2),
  summary: z.string().min(20),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        body: z.string(),
        sources: z.array(z.string().url()).optional(),
      }),
    )
    .min(1),
  conclusion: z.string().min(20),
  citations: z.array(z.string().url()).optional(),
});
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
