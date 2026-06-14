/**
 * 维度工具矩阵 —— 契约测试（2026-05-22 矩阵配置）
 *
 * 锁住矩阵的结构不变量：facet 全覆盖 + 每条非空 + 都含 web-search 兜底 + 缺省回退。
 * 工具 id（arxiv-search / industry-report-search / federal-register …）已于 2026-05-22
 * 对照 information 类目下真实 readonly id 逐一核对。
 */

import {
  DIMENSION_FACETS,
  FACET_PREFERRED_TOOLS,
  resolveFacetPreferredTools,
} from "../dimension-tool-matrix";

describe("dimension-tool-matrix 契约", () => {
  it("FACET_PREFERRED_TOOLS 的 key 与 DIMENSION_FACETS 完全一致（无遗漏/多余）", () => {
    expect(Object.keys(FACET_PREFERRED_TOOLS).sort()).toEqual(
      [...DIMENSION_FACETS].sort(),
    );
  });

  it("每个 facet 都映射到非空推荐工具", () => {
    for (const f of DIMENSION_FACETS) {
      expect(FACET_PREFERRED_TOOLS[f].length).toBeGreaterThan(0);
    }
  });

  it("每个 facet 都含 web-search 兜底（避免专用源全空时无源可采）", () => {
    for (const f of DIMENSION_FACETS) {
      expect(FACET_PREFERRED_TOOLS[f]).toContain("web-search");
    }
  });

  it("每个 facet 的工具 id 无重复", () => {
    for (const f of DIMENSION_FACETS) {
      const ids = FACET_PREFERRED_TOOLS[f];
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("缺省 / 非法 facet 回退到 general", () => {
    expect(resolveFacetPreferredTools(undefined)).toEqual(
      FACET_PREFERRED_TOOLS.general,
    );
    expect(resolveFacetPreferredTools("nonsense")).toEqual(
      FACET_PREFERRED_TOOLS.general,
    );
  });

  it("合法 facet 返回其专用工具集", () => {
    expect(resolveFacetPreferredTools("scientific")).toContain("arxiv-search");
    expect(resolveFacetPreferredTools("market")).toContain(
      "industry-report-search",
    );
    expect(resolveFacetPreferredTools("policy")).toContain("federal-register");
  });
});
