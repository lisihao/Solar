/**
 * 维度工具矩阵 —— 维度类型(facet) → 推荐工具集 的声明式单一源
 * （2026-05-22：把"用哪些工具调研"从 prompt 软引导/LLM 心情，改为确定性配置）
 *
 * 背景（系统审视）：researcher 能看到 ~20 个 information 工具，却只用 web-search。
 * 真因不是系统过滤（无 entitlements 门槛、专用工具无 tags 故不被收窄、无 maxTools
 * 截断），而是"用哪些工具"全靠 LLM 自选 + Leader 瞎填 toolHint → 退化成只用 web。
 *
 * 机制（而非 prompt）：Leader 只对维度做**业务分类**（选一个 facet 枚举），本矩阵
 * 把 facet 确定性映射到该 ★ 推荐的专用工具 id；recall 据此设 toolHint.preferIds →
 * 这些工具在 <available_tools> 里标 ★ recommended。"选哪些工具"由矩阵说了算，
 * 不靠 LLM。改一处全生效，契约测试锁（每 facet 非空 + 含 web 兜底 + id 真实存在）。
 *
 * 注：采用"★ 推荐"而非"硬收窄"——所有工具仍可用（不误删 niche 工具），但正确的
 * 专用工具被确定性推荐，配合 researcher prompt 的"≥2 种工具类型"要求拉开来源多样性。
 */

export const DIMENSION_FACETS = [
  "market", // 市场 / 竞品 / 赛道 / 商业战略
  "scientific", // 科研 / 学术 / 技术原理
  "policy", // 政策 / 法规 / 监管
  "technical", // 工程 / 开源 / 开发者生态
  "financial", // 财经 / 估值 / 宏观 / 财报
  "social", // 舆情 / 人才 / 社媒
  "general", // 通用 / 兜底
] as const;

export type DimensionFacet = (typeof DIMENSION_FACETS)[number];

/**
 * facet → ★ 推荐工具 id（有序，首选在前；每条都含 web-search 兜底）。
 * id 必须是 information 类目下真实注册的工具 id（契约测试 assertMatrixIdsExist 校验）。
 */
export const FACET_PREFERRED_TOOLS: Record<DimensionFacet, readonly string[]> =
  {
    market: ["industry-report-search", "finance-api", "web-search"],
    scientific: [
      "arxiv-search",
      "openalex-search",
      "semantic-scholar",
      "web-search",
    ],
    policy: [
      "federal-register",
      "congress-gov",
      "whitehouse-news",
      "web-search",
    ],
    technical: [
      "github-search",
      "hackernews-search",
      "arxiv-search",
      "web-search",
    ],
    financial: ["finance-api", "industry-report-search", "web-search"],
    social: ["social-x-search", "youtube-search", "web-search"],
    general: ["web-search", "industry-report-search", "knowledge-graph"],
  };

/** 永远兜底 web-search 的 fallback（facet 缺省/非法时）。 */
export function resolveFacetPreferredTools(
  facet: string | undefined,
): readonly string[] {
  if (facet && facet in FACET_PREFERRED_TOOLS) {
    return FACET_PREFERRED_TOOLS[facet as DimensionFacet];
  }
  return FACET_PREFERRED_TOOLS.general;
}
