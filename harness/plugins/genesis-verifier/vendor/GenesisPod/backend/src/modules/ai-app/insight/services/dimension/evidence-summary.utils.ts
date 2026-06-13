import { isValidFigureUrl } from "../../utils/sanitize-image-url.utils";
import type {
  EvidenceData,
  EnrichedEvidenceData,
} from "../../types/research.types";

const MAX_EVIDENCE_ITEMS = 10;
/** ★ v2: 由 20 提升至 40，确保更多高价值图表对 Leader 可见（参考文献图表不再因截断而消失） */
const MAX_FIGURES_FOR_LEADER = 40;

const FIGURE_ALLOCATION_GUIDANCE = `【重要】图表分配原则（优先使用参考文献中的高价值图表）：
1. **参考文献图表优先**：来自已引用证据的数据图表（chart/table/diagram）必须优先分配给引用该证据的章节。这些图表直接支撑报告的数据论点，必须展示
2. 优先选择：数据图表 > 趋势图 > 对比图 > 架构图 > 产品截图 > 技术演示图。纯装饰性新闻配图不分配
3. 每个章节目标分配 **1-4 张图表**。如果有相关的 chart/table/diagram 类图表，必须分配至少 1 张。仅当确实没有任何相关图表时才分配 0 张
4. 分配前请自问：这张图表是否能为该章节的读者提供超越文字的信息增量？数据图表和信息图通常应该分配
5. figureId 必须从下方图片资源列表中选择（如 FIG-1、FIG-2），禁止编造 figureId
6. relevanceReason 必须具体说明图表与章节**哪个论点/数据**相关，禁止泛泛的"与主题相关"`;

/**
 * 图表注册表条目
 * 保存每个图表的唯一 ID 和原始元数据，用于系统回填而非 LLM 输出
 */
export interface FigureRegistryEntry {
  figureId: string;
  imageUrl: string;
  caption: string;
  type: string;
  alt?: string;
  /** 原始证据索引 (1-based)，用于最终报告的引用标注 [N] */
  evidenceIndex: number;
  /** 原始 figure 在 extractedFigures 数组中的位置 */
  figureIndex: number;
  /** 证据标题，用于 source 文本 */
  evidenceTitle: string;
  /** 证据域名 */
  evidenceDomain?: string;
}

/**
 * 创建证据摘要（取前 10 条的标题列表）
 * 统一实现，替代 dimension-mission 和 dimension-search 中的两份副本
 */
export function createEvidenceSummary(evidenceData: EvidenceData[]): string {
  const summary = evidenceData
    .slice(0, MAX_EVIDENCE_ITEMS)
    .map(
      (e, i) =>
        `${i + 1}. [${e.sourceType || "web"}] ${e.title} (${e.domain || "未知来源"})`,
    )
    .join("\n");

  return `共收集到 ${evidenceData.length} 条证据，摘要如下：\n${summary}\n${evidenceData.length > MAX_EVIDENCE_ITEMS ? `...还有 ${evidenceData.length - MAX_EVIDENCE_ITEMS} 条` : ""}`;
}

/**
 * 构建图表摘要（用于 Leader 规划时分配图表）
 * 统一实现，替代 dimension-mission 和 dimension-search 中的两份副本
 *
 * 返回摘要字符串和图表注册表 Map。注册表以 figureId 为 key，保存图表的完整元数据。
 * LLM 在分配图表时只需输出 figureId，系统通过注册表回填 imageUrl 等字段。
 *
 * @param includeGuidance - 是否包含分配指引（dimension-mission 需要，dimension-search 不需要）
 */
export function buildFiguresSummary(
  evidenceData: EnrichedEvidenceData[],
  includeGuidance = true,
): { summary: string; figureRegistry: Map<string, FigureRegistryEntry> } {
  const entries: string[] = [];
  const figureRegistry = new Map<string, FigureRegistryEntry>();
  // ★ 按 imageUrl 去重：同一张图可能被多个证据引用，只保留首次出现
  // 避免 LLM 以为是不同图表而分配给不同 section，导致 validateAllocatedFigures 全部拒绝
  const seenUrls = new Set<string>();
  for (let i = 0; i < evidenceData.length; i++) {
    const evidence = evidenceData[i];
    if (evidence.extractedFigures && evidence.extractedFigures.length > 0) {
      for (let j = 0; j < evidence.extractedFigures.length; j++) {
        const fig = evidence.extractedFigures[j];
        const rawUrl = fig.imageUrl || "";
        // ★ 跳过无效 URL（base64、placeholder、PDF 等）— 不应呈现给 LLM
        if (!isValidFigureUrl(rawUrl)) {
          continue;
        }
        // 跳过已见过的 imageUrl（去重）
        if (seenUrls.has(rawUrl)) {
          continue;
        }
        seenUrls.add(rawUrl);
        // 生成唯一 figureId（基于全局递增序号）
        const figureId = `FIG-${entries.length + 1}`;
        // ★ v10→v11: caption fallback — photo 类型不生成虚假标题（防止 Leader 误分配装饰图）
        const figCaption =
          fig.caption ||
          fig.alt ||
          (fig.type !== "photo" && evidence.title
            ? `${evidence.title} — 图表`
            : "");
        // ★ v12: 附加证据摘要片段（150字），帮助 Leader 判断图表与章节的相关性
        const snippetHint = evidence.snippet
          ? ` | 内容摘要: "${evidence.snippet.slice(0, 150)}"`
          : "";
        // ★ 图片搜索补充图片不继承宿主证据的来源索引（避免图片与来源错误匹配）
        const isSearchSupplement = fig.isImageSearchSupplement === true;
        entries.push(
          isSearchSupplement
            ? `图表 ${figureId}: ${fig.type} - "${figCaption || "无标题"}" (来源: 图片搜索) (URL: ${rawUrl})`
            : `图表 ${figureId}: ${fig.type} - "${figCaption || "无标题"}" (来源: 证据[${i + 1}] ${evidence.title}${snippetHint}) (URL: ${rawUrl})`,
        );
        figureRegistry.set(figureId, {
          figureId,
          imageUrl: rawUrl,
          caption: figCaption,
          type: fig.type,
          alt: fig.alt,
          // evidenceIndex=0 表示无文本证据来源（图片搜索补充），前端不显示来源引用链接
          evidenceIndex: isSearchSupplement ? 0 : i + 1,
          figureIndex: j,
          evidenceTitle: isSearchSupplement ? "" : evidence.title || "",
          evidenceDomain: isSearchSupplement
            ? undefined
            : evidence.domain || undefined,
        });
      }
    }
  }
  if (entries.length === 0) {
    return { summary: "", figureRegistry };
  }

  // ★ v7: 三维度排序 — 证据可信度（统一权重源） + 图表类型 + caption 质量
  // 图片从证据中提取，证据的 credibilityScore 已包含来源域名的可信度评估，
  // 不需要单独再做域名权重，保持与证据权重体系统一。
  const CHART_TYPES = new Set(["chart", "table", "diagram"]);

  // ★ v7: 检测 caption 是否为文章标题的 fallback（非真实图表说明）
  // 如果 caption 与 evidenceTitle 完全相同，或 evidenceTitle 以 caption 开头
  // （说明 caption 是文章标题或其前缀，而非真实图表说明），很可能是博客头图/装饰图，应降级。
  function isFallbackCaption(caption: string, evidenceTitle: string): boolean {
    if (!caption || !evidenceTitle) return false;
    const c = caption.replace(/\s*—\s*图表$/, "").trim();
    return c === evidenceTitle.trim() || evidenceTitle.trim().startsWith(c);
  }

  const entryIds = Array.from(figureRegistry.keys()); // entries 与 figureRegistry 插入顺序一致
  const sortedIndices = Array.from(
    { length: entries.length },
    (_, i) => i,
  ).sort((a, b) => {
    const regA = figureRegistry.get(entryIds[a]);
    const regB = figureRegistry.get(entryIds[b]);
    const typeA = regA?.type ?? "";
    const typeB = regB?.type ?? "";

    // ★ Tier 1: 证据可信度分数（高分优先）— 统一使用证据权重体系
    // credibilityScore 已包含来源域名、内容质量等综合评估
    const credA =
      regA && regA.evidenceIndex > 0
        ? (evidenceData[regA.evidenceIndex - 1]?.credibilityScore ?? 0)
        : 0;
    const credB =
      regB && regB.evidenceIndex > 0
        ? (evidenceData[regB.evidenceIndex - 1]?.credibilityScore ?? 0)
        : 0;
    if (credA !== credB) return credB - credA;

    // ★ Tier 2: 图表类型（chart/table/diagram > photo）
    const typeScoreA = CHART_TYPES.has(typeA) ? 0 : 1;
    const typeScoreB = CHART_TYPES.has(typeB) ? 0 : 1;
    if (typeScoreA !== typeScoreB) return typeScoreA - typeScoreB;

    // ★ Tier 3: caption 质量（真实 figure caption > 文章标题 fallback）
    const fallbackA = isFallbackCaption(
      regA?.caption ?? "",
      regA?.evidenceTitle ?? "",
    )
      ? 1
      : 0;
    const fallbackB = isFallbackCaption(
      regB?.caption ?? "",
      regB?.evidenceTitle ?? "",
    )
      ? 1
      : 0;
    return fallbackA - fallbackB;
  });
  const sortedEntries = sortedIndices.map((i) => entries[i]);

  const displayEntries = sortedEntries.slice(0, MAX_FIGURES_FOR_LEADER);
  const suffix =
    sortedEntries.length > MAX_FIGURES_FOR_LEADER
      ? `\n...还有 ${sortedEntries.length - MAX_FIGURES_FOR_LEADER} 个图表未列出`
      : "";
  const prefix = includeGuidance ? `${FIGURE_ALLOCATION_GUIDANCE}\n\n` : "";
  const summary = `${prefix}共 ${sortedEntries.length} 个可用图表（展示前 ${displayEntries.length} 个，数据图表优先）：\n${displayEntries.join("\n")}${suffix}`;
  return { summary, figureRegistry };
}
