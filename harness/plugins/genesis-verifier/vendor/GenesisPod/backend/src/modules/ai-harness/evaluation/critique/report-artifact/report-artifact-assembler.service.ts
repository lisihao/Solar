/**
 * ReportArtifactAssembler —— Writer W4：纯代码组装 ReportArtifact
 *
 * 上游：mission-pipeline-baseline.md §3.7 W4 / mission-pipeline-writer-artifact.md §3.4
 *
 * 职责（不调 LLM）：
 *   - sections 树构建（由 fullMarkdown 按 ## 切分推导，对齐 TI 但后端做不让前端拆）
 *   - citations 编号原子分配 + occurrences[] 反向定位
 *   - figures 强校验（baseline §7.4 五项硬规则）
 *   - quickView 派生（topHighlights / topTrends / keyRisks / topRecommendations）
 *   - readingTimeMinutes / wordCount 计算
 *   - 50+ 项格式自动修复（暂作 stub，后续从 TI report-assembler.service.ts 移植）
 *
 * 输入：plan + researcherResults + analyst + writer (markdown) + reconciliationReport
 * 输出：ReportArtifact (v2)
 */

import { Injectable, Logger } from "@nestjs/common";
import type {
  ArtifactCitation,
  ArtifactFactTriple,
  ArtifactFigure,
  ArtifactHighlight,
  ArtifactMetadata,
  ArtifactQualityVerdicts,
  ArtifactQuickView,
  ArtifactSection,
  ReportArtifact,
} from "./report-artifact.dto";
import {
  dedupeFigureCandidates,
  isGarbageFigureUrl,
} from "./figure-filter.utils";
// ★ 沉淀消费（2026-04-29）：harness quality-gate 标杆实现
import { ReportQualityGateService } from "../../../facade";
// ★ 沉淀消费（2026-04-30 REPORT QUALITY OVERHAUL）：
//   consumer 报告格式化全量复用 TI 沉淀的 `postProcessFinalReport`
//   （TI ReportAssembler.postProcessFinalReport 类方法已晋升到 ai-engine 层）。
//   原 27-step bespoke 管线下线 —— consumer / TI 共用同一份后处理逻辑，
//   保证两条产品线的报告格式行为完全一致，且 mission 4fd5efa1 暴露的
//   `mid-line glued ##` 由 detectAndPromoteHeadings 启发式修复。
import { postProcessFinalReport } from "../../../../ai-engine/content/report-template/pipeline/final-report-post-processing.util";
import { formatDimensionContent } from "../../../../ai-engine/content/report-template/pipeline/dimension-content-formatting.util";
import { stripChartJsonFromContent } from "../../../../ai-engine/llm/output/sanitization/strip-chart-json.utils";
import {
  filterJunkReferences,
  deduplicateReferencesByUrl,
  upgradeHttpToHttps,
  decodeUrlEntities,
  remapCitationIndices,
} from "../../../../ai-engine/content/report-template/pipeline/report-formatting.util";
import { normalizeMarkdownSlug } from "../../../../ai-engine/content/markdown/slug-normalize.util";

export interface AssembleInput {
  topic: string;
  language: "zh-CN" | "en-US";
  styleProfile: ArtifactMetadata["styleProfile"];
  lengthProfile: ArtifactMetadata["lengthProfile"];
  audienceProfile: ArtifactMetadata["audienceProfile"];
  searchTimeRange?: ArtifactMetadata["searchTimeRange"];
  plan: {
    themeSummary: string;
    dimensions: { id: string; name: string; rationale: string }[];
  };
  researcherResults: {
    dimension: string;
    findings: {
      claim: string;
      evidence: string;
      source: string;
      // ★ 2026-04-30 (PR-C): 引用元数据补全，researcher 直接从 web-search /
      //   web-scraper 结果里捎带，避免 buildCitations fallback 到 domain 占位。
      sourceTitle?: string;
      sourceSnippet?: string;
      sourcePublishedAt?: string;
    }[];
    summary: string;
    /** ★ per-dim chapter pipeline 产出 —— 装配时优先用，避免 81K 字章节被压成 3K 字摘要 */
    fullMarkdown?: string;
    chapters?: {
      index: number;
      heading: string;
      body: string;
      wordCount: number;
      /**
       * ★ 2026-05-07 P1 图文匹配闭环（学 TI section.figureReferences）：
       * chapter-writer LLM 决定本章引用的图（按 figureId）+ 段落锚点。
       * buildFigures 优先用此字段（精确按 LLM 决定关联 sectionId），
       * 无此字段时 fallback 到 researcher.figureCandidates 自动追加（兼容路径）。
       */
      figureReferences?: {
        figureId: string;
        anchorParagraph?: number;
        caption?: string;
      }[];
    }[];
    figureCandidates?: {
      sourceUrl: string;
      imageUrl?: string;
      caption: string;
      sourcePageOrSection?: string;
      relevanceHint?: "high" | "medium" | "low";
    }[];
  }[];
  analyst?: {
    themeSummary?: string;
    keyInsights?: { title?: string; oneLine?: string }[];
    contradictions?: unknown[];
    gaps?: unknown[];
    // ★ F-alignment (2026-05-06): 4 report-structure fields from analyst output
    preface?: string;
    crossDimAnalysis?: string;
    riskAssessment?: string;
    strategicRecommendations?: string;
  };
  writerReport: {
    title: string;
    summary: string;
    sections: { heading: string; body: string; sources?: string[] }[];
    conclusion: string;
    citations?: string[];
  };
  reconciliationReport?: {
    factTable: {
      id: string;
      entity: string;
      attribute: string;
      value: string;
      sources: string[];
    }[];
    conflicts: {
      factIds: string[];
      resolutionType: "kept-both" | "preferred-one" | "flagged-unresolved";
      preferredFactId?: string;
      rationale: string;
    }[];
    figureCandidates?: ArtifactFigure[];
  };
  generationTimeMs: number;
  totalTokens: { prompt: number; completion: number; total: number };
  costCents: number;
  modelTrail: string[];
}

@Injectable()
export class ReportArtifactAssembler {
  private readonly logger = new Logger(ReportArtifactAssembler.name);

  constructor(private readonly qualityGate: ReportQualityGateService) {}

  /**
   * 主入口：组装 ReportArtifact
   */
  assemble(input: AssembleInput): ReportArtifact {
    // 0) Writer 经常用 markdown 链接 [text](url) 而非 [N] 编号；做一次预归一化，
    //    把 [anchor](url) 全部替换为 [N]，并把发现的 url 同步进 writer.citations 头部，
    //    保证 buildCitations 编号与 body 中的 [N] 对齐。
    input = this.normalizeInlineCitations(input);
    // 1) 构建主 markdown（无图占位符）+ TI 同源 full-report 后处理（含 quality-gate）
    //    applyFormatFixes 内部会自动跑 ReportQualityGateService.validateFullReport，
    //    无需在此重复调用。warnings 留待 buildQualityStub 后通过单次再调一次 gate
    //    （只取 violations 不再 fix）注入到 quality.warnings。
    let fullMarkdown = this.applyFormatFixes(this.buildFullMarkdown(input));

    // ★ 2026-04-30: H2 滥用治理 —— buildSectionTree 之前 sanitize keyPoint 编号 H2 为 H3
    //   chapter-writer LLM 经常违反 prompt 把 "1./2./（一）/其一" 写成 ## H2 切分论点，
    //   导致 sections 数量爆炸（实测 8 章变 54 张卡）。这里启发式降级：
    //     ## "1." / "（一）" / "其一" / "第一" / 数字+点 开头的 H2 → ### H3
    //   降级仅在已经存在过至少一个 H2（即真章节）后生效，避免误降首章。
    fullMarkdown = this.sanitizeKeyPointH2(fullMarkdown);

    // 2) sections 树（按 ## 标题切分 + 类型推断）
    let sections = this.buildSectionTree(fullMarkdown, input);

    // 3) citations 编号原子分配 + occurrences（★ Phase 2: indexMapping 可能改写 fullMarkdown）
    const citationsResult = this.buildCitations(fullMarkdown, sections, input);
    const citations = citationsResult.citations;
    if (citationsResult.fullMarkdown !== fullMarkdown) {
      // citation 重映射后正文已变，需重建 sections 以对齐
      fullMarkdown = citationsResult.fullMarkdown;
      sections = this.buildSectionTree(fullMarkdown, input);
      this.recomputeCitationOccurrences(citations, sections, fullMarkdown);
    }

    // 4) figures 强校验 + 关联 sectionId（依赖 sections + citations）
    const figures = this.buildFigures(input, citations, sections);

    // 4'. 把 figures 的 markdown 占位符注入到 fullMarkdown 对应章节末尾
    //     再重新 buildSectionTree（offset 漂移）+ 重新计算 citation.occurrences
    if (figures.length > 0) {
      fullMarkdown = this.injectFigurePlaceholders(
        fullMarkdown,
        sections,
        figures,
      );
      sections = this.buildSectionTree(fullMarkdown, input);
      // citation.occurrences 需要重算（offset 漂移），最简就是清掉再扫一遍
      this.recomputeCitationOccurrences(citations, sections, fullMarkdown);
      // section.figureIds 关联
      for (const f of figures) {
        const sec = sections.find((s) => s.id === f.sectionId);
        if (sec && !sec.figureIds.includes(f.id)) sec.figureIds.push(f.id);
      }
    }

    // 4.5) ★ P0-LIVE-REPORT-FORMAT (2026-04-30): TI 风格 — 把"## 参考文献"段落
    //   追加到 fullMarkdown 末尾，让前端 ChapterReader / ContinuousReader 都能
    //   作为标准 section 渲染（之前 references 仅在 citations[] 里，markdown 末尾
    //   缺最后一个 section, 用户复制 markdown 时参考文献也会跟着丢）。
    if (citations.length > 0) {
      const refSection = this.buildReferencesSection(citations, input.language);
      if (refSection) {
        fullMarkdown = fullMarkdown.trimEnd() + "\n\n" + refSection + "\n";
        sections = this.buildSectionTree(fullMarkdown, input);
        this.recomputeCitationOccurrences(citations, sections, fullMarkdown);
        for (const f of figures) {
          const sec = sections.find((s) => s.id === f.sectionId);
          if (sec && !sec.figureIds.includes(f.id)) sec.figureIds.push(f.id);
        }
      }
    }

    // 5) factTable
    const factTable = this.buildFactTable(input, citations);

    // 6) quickView 派生
    const quickView = this.buildQuickView(input, sections, citations, figures);

    // 7) metadata
    const metadata = this.buildMetadata(
      input,
      fullMarkdown,
      sections,
      citations,
      figures,
    );

    // 8) quality 真实评分（10 维启发式）
    const quality = this.buildQualityStub(
      sections,
      citations,
      figures,
      input,
      fullMarkdown,
    );

    // 8.5) ★ 把最终 quality-gate violations 注入 quality.warnings（前端可见）
    //    再跑一次 validateFullReport（only violations, not fix）拿最终违规列表。
    const gateLang = input.language?.startsWith("en") ? "en" : "zh";
    const finalGate = this.qualityGate.validateFullReport(
      fullMarkdown,
      gateLang,
    );
    for (const v of finalGate.violations) {
      quality.warnings.push({
        dimension: `quality_gate.${v.rule}`,
        message: v.message,
      });
    }

    return {
      content: {
        fullMarkdown,
        fullReportSize: Buffer.byteLength(fullMarkdown, "utf8"),
      },
      sections,
      citations,
      figures,
      quickView,
      factTable,
      metadata,
      quality,
    };
  }

  /**
   * ★ 2026-05-08 PR-1: 同 recomputeCitationOccurrencesPublic 模式暴露 public —
   * v1.6 切主线后 structural assembler 覆盖 fullMarkdown，原 line 189 legacy
   * 路径的 inject 输出被丢弃，导致 figures 数组有 12 张图但 markdown 0 个 #fig
   * 占位（mission 843f6958 实证）。s8 stage 在 structural 接管后必须调一次
   * 才能让 figure 真正落到 markdown。
   */
  injectFigurePlaceholdersPublic(
    fullMarkdown: string,
    sections: ArtifactSection[],
    figures: ArtifactFigure[],
  ): string {
    return this.injectFigurePlaceholders(fullMarkdown, sections, figures);
  }

  /**
   * 把 ![alt](#fig-id "caption") 占位符注入对应章节内合适位置。
   *
   * Phase P3-12: 智能定位 — 优先用 referencedBy 第一处 phrase 做 anchor，
   * 找不到时回退到章末。
   *
   * 倒序处理避免 offset 漂移。
   */
  private injectFigurePlaceholders(
    fullMarkdown: string,
    sections: ArtifactSection[],
    figures: ArtifactFigure[],
  ): string {
    const figsBySection = new Map<string, ArtifactFigure[]>();
    for (const f of figures) {
      const arr = figsBySection.get(f.sectionId) ?? [];
      arr.push(f);
      figsBySection.set(f.sectionId, arr);
    }
    // 收集所有插入点（offset, block）然后倒序应用
    type Insert = { offset: number; block: string };
    const inserts: Insert[] = [];
    for (const sec of sections) {
      const figs = figsBySection.get(sec.id);
      if (!figs || figs.length === 0) continue;
      for (const f of figs) {
        // P56-2: alt text + caption 内 ] / [ / ( / ) 转义防 markdown 解析破坏
        const safeAlt = f.altText
          .replace(/[\[\]]/g, " ")
          .replace(/[()]/g, " ")
          .slice(0, 200);
        const safeCaption = f.caption.replace(/"/g, "'").slice(0, 300);
        const block = `\n\n![${safeAlt}](#${f.id} "${safeCaption}")\n`;
        let insertOffset = sec.endOffset;
        // 尝试用 referencedBy[0].phrase 做 anchor
        if (f.referencedBy.length > 0) {
          const phrase = f.referencedBy[0].phrase.slice(0, 40);
          const phrasePos = fullMarkdown.indexOf(phrase, sec.startOffset);
          if (phrasePos > 0 && phrasePos < sec.endOffset) {
            // P10-3: 从 phrasePos 之后开始找下一个句子结束符（修 P3-12 全局 search bug）
            const tail = fullMarkdown.slice(phrasePos, sec.endOffset);
            const localEnd = tail.search(/[。！？.!?]\s/);
            if (localEnd >= 0) {
              insertOffset = phrasePos + localEnd + 2;
            }
          }
        }
        inserts.push({ offset: insertOffset, block });
      }
    }
    // 倒序应用避免 offset 漂移
    inserts.sort((a, b) => b.offset - a.offset);
    let result = fullMarkdown;
    for (const ins of inserts) {
      result =
        result.slice(0, ins.offset) + ins.block + result.slice(ins.offset);
    }
    return result;
  }

  /**
   * ★ 2026-05-08 PR-7 (Round 2 第 4 路指出 inject 后 sectionTree offset 漂移):
   *   注入 ![](#fig-N) 占位后 fullMarkdown 字符流增长，sections.startOffset/endOffset
   *   仍是 inject 前的位置，下游 binary-search / slice 会取错段。s8 二次 inject
   *   后必须调一次 rebuildSectionTreePublic 让 offset 与新 markdown 对齐。
   *
   *   接 narrow 参数（plan.dimensions + language）而非整个 AssembleInput，因为
   *   buildSectionTree 实际只用这两个字段。
   */
  rebuildSectionTreePublic(
    fullMarkdown: string,
    dimensions: { id: string; name: string; rationale: string }[],
    language: "zh-CN" | "en-US",
  ): ArtifactSection[] {
    // 构造 narrow AssembleInput shape 以复用 buildSectionTree 逻辑
    const narrowInput: AssembleInput = {
      topic: "",
      language,
      styleProfile: "academic",
      lengthProfile: "standard",
      audienceProfile: "general-public",
      plan: { themeSummary: "", dimensions },
      researcherResults: [],
      writerReport: {
        title: "",
        summary: "",
        sections: [],
        conclusion: "",
      },
      generationTimeMs: 0,
      totalTokens: { prompt: 0, completion: 0, total: 0 },
      costCents: 0,
      modelTrail: [],
    };
    return this.buildSectionTree(fullMarkdown, narrowInput);
  }

  /**
   * 重新扫描 fullMarkdown 计算 citation.occurrences + section.citations
   *
   * ★ v1.6 切主线 (2026-05-06): 改 public — StructuralReportAssembler 主路径
   *   也需要按 fullMarkdown 内的 [N] 编号回填 section.citations / citation.occurrences，
   *   避免 quality.citationDensity = 0 的关联断链（v1.5 二轮架构师 hard miss）。
   *   同步暴露 figures.sectionId 重建逻辑（recomputeSectionFigureIds）。
   */
  recomputeCitationOccurrencesPublic(
    citations: ArtifactCitation[],
    sections: ArtifactSection[],
    fullMarkdown: string,
  ): void {
    return this.recomputeCitationOccurrences(citations, sections, fullMarkdown);
  }

  /**
   * 把 figures.sectionId 重新映射到 sections（按 sourceDimensionId 优先 +
   * paragraph 落点 fallback），让 structural 重拼后 figures 仍指向正确章节。
   */
  recomputeSectionFigureIdsPublic(
    figures: ArtifactFigure[],
    sections: ArtifactSection[],
    legacySections: ArtifactSection[],
  ): void {
    for (const sec of sections) sec.figureIds = [];
    // ★ 2026-05-08 PR-9-A (R4 第 4 路指出 referencedBy 悬挂):
    //   构造 legacy.id → newSec 映射表 + 第一维度 dim fallback，让 fig.sectionId
    //   和 fig.referencedBy[].sectionId 一并重映射。
    const legacyIdToNew = new Map<string, ArtifactSection>();
    for (const oldSec of legacySections) {
      const newSec = oldSec.sourceDimensionId
        ? sections.find((s) => s.sourceDimensionId === oldSec.sourceDimensionId)
        : sections.find((s) => s.title === oldSec.title);
      if (newSec) legacyIdToNew.set(oldSec.id, newSec);
    }
    const firstDim = sections.find((s) => s.type === "dimension");
    const remap = (oldSecId: string): string => {
      const newSec = legacyIdToNew.get(oldSecId);
      if (newSec) return newSec.id;
      return firstDim ? firstDim.id : oldSecId;
    };
    for (const fig of figures) {
      // 1. fig.sectionId 重映射
      const oldSec = legacySections.find((s) => s.id === fig.sectionId);
      const newSec = oldSec
        ? legacyIdToNew.get(oldSec.id)
        : sections.find((s) => s.id === fig.sectionId);
      if (newSec) {
        fig.sectionId = newSec.id;
        if (!newSec.figureIds.includes(fig.id)) {
          newSec.figureIds.push(fig.id);
        }
      } else if (firstDim) {
        // fallback: 挂第一个 dimension section
        fig.sectionId = firstDim.id;
        if (!firstDim.figureIds.includes(fig.id)) {
          firstDim.figureIds.push(fig.id);
        }
      }
      // 2. fig.referencedBy[].sectionId 也重映射（R4 第 4 路指出此前悬挂）
      if (fig.referencedBy && fig.referencedBy.length > 0) {
        for (const ref of fig.referencedBy) {
          ref.sectionId = remap(ref.sectionId);
        }
      }
    }
  }

  /** 重新扫描 fullMarkdown 计算 citation.occurrences */
  private recomputeCitationOccurrences(
    citations: ArtifactCitation[],
    sections: ArtifactSection[],
    fullMarkdown: string,
  ): void {
    for (const c of citations) c.occurrences.length = 0;
    // sections 是 buildSectionTree 重建出来的（figure inject 后），需要把 sec.citations
    // 也一并重算 —— 否则 quality scorer 读到 sec.citations=[] → citationDensity=0。
    for (const s of sections) s.citations = [];
    const re = /\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fullMarkdown)) !== null) {
      const num = parseInt(m[1], 10);
      const cite = citations.find((c) => c.index === num);
      if (!cite) continue;
      const offset = m.index;
      const sec = sections.find(
        (s) => offset >= s.startOffset && offset < s.endOffset,
      );
      if (!sec) continue;
      const localOffset = offset - sec.startOffset;
      const secMd = fullMarkdown.slice(sec.startOffset, sec.endOffset);
      const paragraphIndex = countParagraphsBefore(secMd, localOffset);
      cite.occurrences.push({
        sectionId: sec.id,
        paragraphIndex,
        characterOffset: localOffset,
      });
      if (!sec.citations.includes(num)) sec.citations.push(num);
    }
  }

  /**
   * ★ Phase P1-9: 关键格式修复（对齐 TI report-assembler.service.ts 子集）
   *
   * 移植 10 项最常见的修复：
   *   1. 多余空行（>2 个连续 \n\n）压缩为 2 个
   *   2. 折断的 markdown 表格（行末缺 |）修复
   *   3. heading 层级跳跃（h1 → h3）补 h2
   *   4. 列表项错乱缩进（tab 与空格混用）规范化
   *   5. 末尾孤儿引用 [N] 但 references 列表缺失 → 标 [unresolved]
   *   6. LaTeX `$$ ... $$` 跨段落断裂修复
   *   7. 单元格内换行 → <br>
   *   8. 多级引用嵌套 `>>>` 规范化
   *   9. 重复连续标题（## X\n\n## X）去重
   *  10. 文末多余空白 trim
   */
  /**
   * 归一化 inline 引用：把 `[anchor](https://...)` → `[N]`，把首次出现的 URL
   * 推进 writer.citations 头部，保证 buildCitations 后续编号与 body 中的 [N] 对齐。
   *
   * Writer 经常忽略 prompt 中的 [N] 要求，直接产出 markdown 超链接。这一步把两种
   * 风格统一到 [N] 编号，让 traceability / citationDensity 评分能正确计算。
   */
  private normalizeInlineCitations(input: AssembleInput): AssembleInput {
    const sectionsCopy = input.writerReport.sections.map((s) => ({ ...s }));
    const urlOrder: string[] = [];
    const urlIdx = new Map<string, number>();
    const assignIdx = (rawUrl: string): number => {
      const url = rawUrl.trim();
      // ★ P1-R4-G (round 4): 空 URL 不进 citations，防 LLM 输出 [text]() 等污染
      if (!url) return -1;
      if (urlIdx.has(url)) return urlIdx.get(url)!;
      urlOrder.push(url);
      const n = urlOrder.length;
      urlIdx.set(url, n);
      return n;
    };
    // 三种 LLM 常见的引用形式 —— 用一个跨形式正则扫"document 顺序"统一映射：
    //   A. markdown 链接：[anchor text](https://...)
    //   B. 裸 URL 装括号：[https://...]
    //   C. 已经是 [N] 数字编号 —— 保留不动（Writer 自己就用对了）
    // 顺序统一编号：document 中第一个出现的 URL 就是 [1]，第二个是 [2]，依此类推。
    const unifiedRe =
      /(\[\d+\])|\[([^\]\n]+?)\]\((https?:\/\/[^\s)]+)\)|\[(https?:\/\/[^\]\s]+)\]/g;
    const transform = (body: string | undefined): string => {
      if (!body) return body ?? "";
      return body.replace(unifiedRe, (m, alreadyN, _anchor, mdUrl, bareUrl) => {
        if (alreadyN) return alreadyN as string; // [N] 已是数字编号，原样保留
        const url: string = mdUrl ?? bareUrl;
        const n = assignIdx(url);
        // ★ P1-R4-G (round 4): 空 URL 时保留原文不替换为 [-1]
        if (n < 0) return m;
        return `[${n}]`;
      });
    };
    const summaryT = transform(input.writerReport.summary);
    for (const sec of sectionsCopy) {
      sec.body = transform(sec.body);
    }
    const conclusionT = transform(input.writerReport.conclusion);
    if (urlOrder.length === 0) return input;
    // writer.citations[]：保证 [N] 顺序对应的 url 排在最前（去重）
    const writerCites = (input.writerReport.citations ?? []).slice();
    const merged: string[] = [];
    const mergedSet = new Set<string>();
    for (const u of urlOrder) {
      if (!mergedSet.has(u)) {
        merged.push(u);
        mergedSet.add(u);
      }
    }
    for (const u of writerCites) {
      const t = u.trim();
      if (t && !mergedSet.has(t)) {
        merged.push(t);
        mergedSet.add(t);
      }
    }
    return {
      ...input,
      writerReport: {
        ...input.writerReport,
        summary: summaryT,
        conclusion: conclusionT,
        sections: sectionsCopy,
        citations: merged,
      },
    };
  }

  /**
   * ★ 2026-04-30 (REPORT QUALITY OVERHAUL): 委托给 TI 沉淀的 `postProcessFinalReport`
   *
   * 原 27-step bespoke 管线下线 — 现在直接调用 ai-engine 层的 pure function
   * `postProcessFinalReport(content, { language, qualityGate, logger })`，
   * 与 TI ReportAssembler.postProcessFinalReport 同源。共 60+ 规则覆盖：
   *   - quality-gate 自动修复（excessive bold / horizontal rule / 主观语 等）
   *   - mid-line glued `## ` 启发式提升（detectAndPromoteHeadings —— 修
   *     mission 4fd5efa1 暴露的 §2 startOffset=-1 顽疾）
   *   - 表格 / 列表 / 章节合并 / 全局 renumber / 第三道铁墙白名单
   *
   * consumer 专属仅保留 4 项 assembly 后处理：
   *   ① stripChartJsonFromContent（图表 JSON 残留，仅 consumer writer 输出会有）
   *   ② markOrphanCitations（孤儿 [N] 标注，依赖 mission ctx）
   *   ③ 表格行尾缺 |（consumer LLM 高频）
   *   ④ LaTeX 跨段落 $$ 修复（consumer LLM 高频）
   */
  private applyFormatFixes(md: string): string {
    // 0) consumer 专属预处理（TI 不需要）：图表 JSON 残留剥离
    let content = stripChartJsonFromContent(md);

    // 1) 委托给 TI 同源 full-report 后处理管线
    const { content: processed, warnings } = postProcessFinalReport(content, {
      language: "zh", // consumer 当前仅支持中文 mission
      qualityGate: this.qualityGate,
      logger: {
        warn: (msg) => this.logger.warn(msg),
        error: (msg) => this.logger.error(msg),
      },
    });
    content = processed;
    if (warnings.length > 0) {
      this.logger.log(
        `[applyFormatFixes] postProcessFinalReport: ${warnings.length} warnings`,
      );
    }

    // 2) consumer assembly 专属补丁：
    //    ② 孤儿 [N] 标注（需要 mission ctx 中的 references，TI 在 synthesize 阶段已补）
    content = this.markOrphanCitations(content);
    //    ③ 表格行尾缺 |
    content = content.replace(
      /^(\|[^\n]+[^|\s])(\n|$)/gm,
      (_, p1: string, p2: string) => `${p1}|${p2}`,
    );
    //    ④ LaTeX 跨段落 $$ 修复
    const dollarCount = (content.match(/\$\$/g) ?? []).length;
    if (dollarCount % 2 !== 0) {
      content += "\n$$";
    }
    return content.replace(/[ \t]+$/gm, "").trimEnd();
  }

  private markOrphanCitations(md: string): string {
    const re = /\[(\d+)\]/g;
    const referenced = new Set<number>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(md)) !== null) referenced.add(parseInt(m[1], 10));
    if (referenced.size === 0) return md;
    // 简化判断：找 "## 参考" 或 "## References" 后是否有对应 [N]
    const refSection = md.match(
      /##\s*(参考文献|参考资料|References)[\s\S]*$/,
    )?.[0];
    if (!refSection) return md; // 无 references 段，不做处理
    const declared = new Set<number>();
    const declRe = /\[(\d+)\]/g;
    let dm: RegExpExecArray | null;
    while ((dm = declRe.exec(refSection)) !== null)
      declared.add(parseInt(dm[1], 10));
    const orphans = Array.from(referenced).filter((n) => !declared.has(n));
    if (orphans.length === 0) return md;
    // 在文末追加 unresolved 标注
    return (
      md +
      "\n\n<!-- unresolved citations: " +
      orphans.map((n) => `[${n}]`).join(", ") +
      " -->"
    );
  }

  /**
   * ★ P0-LIVE-REPORT-FORMAT (2026-04-30): TI 风格 references section 构造
   * 对齐 {app}/services/report/report-assembler.ts:1000 buildReferencesSection。
   * 输入：去重后的 citations[]；输出：以 "## 参考文献" 开头的完整 markdown 段。
   */
  private buildReferencesSection(
    citations: ArtifactCitation[],
    language?: string,
  ): string {
    if (!citations.length) return "";
    const isEn = (language ?? "").toLowerCase().startsWith("en");
    const heading = isEn ? "References" : "参考文献";
    const lines = citations
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((c) => {
        const safeTitle = (c.title || c.domain || c.url)
          .replace(/\[/g, "\\[")
          .replace(/\]/g, "\\]");
        const domainSuffix =
          c.domain && c.domain !== "unknown" ? `. ${c.domain}` : "";
        return `[${c.index}] [${safeTitle}](${c.url})${domainSuffix}`;
      });
    return `## ${heading}\n\n${lines.join("\n\n")}`;
  }

  // ─── 1. fullMarkdown ────────────────────────────────────────────
  // ★ F-alignment (2026-05-06): 重写为对齐 Topic Insight buildFullReportFromDimensions 的
  //   10-section 模板（参考 TI report-assembler.service.ts:assembleFullReport）。
  //
  // Section 顺序:
  //   1. # title + > summary
  //   2. ## 执行摘要       (analyst.themeSummary, 400-600 字; fallback: plan.themeSummary)
  //   3. ## 前言           (analyst.preface; fallback: themeSummary 前 200 字)
  //   4. ## 目录           (auto-generated H2 list)
  //   5. ## {dim N 内容}   (按 plan dim 序，优先 fullMarkdown，fallback writerReport.sections)
  //   6. ## 跨维度分析     (analyst.crossDimAnalysis; fallback: dim keyFindings 摘编)
  //   7. ## 风险评估       (analyst.riskAssessment; fallback: dim challenges 列表)
  //   8. ## 战略建议       (analyst.strategicRecommendations; fallback: dim opportunities)
  //   9. ## 结论           (writerReport.conclusion)
  //  (10. ## 参考文献 由 buildReferencesSection 在 assemble() 步骤 4.5 追加)
  private buildFullMarkdown(input: AssembleInput): string {
    const isEn = (input.language ?? "").toLowerCase().startsWith("en");
    const labels = {
      execSummary: isEn ? "Executive Summary" : "执行摘要",
      preface: isEn ? "Preface" : "前言",
      toc: isEn ? "Table of Contents" : "目录",
      crossDim: isEn ? "Cross-Dimension Analysis" : "跨维度分析",
      risk: isEn ? "Risk Assessment" : "风险评估",
      strategy: isEn ? "Strategic Recommendations" : "战略建议",
      conclusion: isEn ? "Conclusion" : "结论",
    };

    const parts: string[] = [];

    // ── Section 1: title + summary blockquote ───────────────────────────────
    parts.push(`# ${input.writerReport.title}`);
    parts.push("");
    parts.push(`> ${input.writerReport.summary}`);
    parts.push("");

    // ── Section 2: 执行摘要 ──────────────────────────────────────────────────
    // Always present: use analyst.themeSummary if available, else plan.themeSummary
    const execSummaryText =
      input.analyst?.themeSummary?.trim() ||
      input.plan.themeSummary?.trim() ||
      "";
    if (execSummaryText) {
      parts.push(`## ${labels.execSummary}`);
      parts.push("");
      parts.push(execSummaryText);
      parts.push("");
    }

    // ── Section 3: 前言 ───────────────────────────────────────────────────────
    // analyst.preface if present; fallback: first 200 chars of themeSummary
    const prefaceText =
      input.analyst?.preface?.trim() ||
      (execSummaryText ? execSummaryText.slice(0, 200) + "…" : "");
    if (prefaceText) {
      parts.push(`## ${labels.preface}`);
      parts.push("");
      parts.push(prefaceText);
      parts.push("");
    }

    // ── Shared helpers for per-dim header/footer ────────────────────────────
    const matchInsightsFor = (dim: string): string[] => {
      const insights = input.analyst?.keyInsights ?? [];
      const byMatch = insights
        .filter((ins) => {
          const blob = `${ins.title ?? ""} ${ins.oneLine ?? ""}`.toLowerCase();
          return blob.includes(dim.toLowerCase());
        })
        .map((ins) => ins.oneLine ?? ins.title ?? "")
        .filter(Boolean);
      if (byMatch.length > 0) return byMatch.slice(0, 5);
      const planDim = input.plan.dimensions.find((d) => d.name === dim);
      if (planDim?.rationale) return [planDim.rationale];
      return [];
    };
    const matchKeyFactsFor = (dim: string): string[] => {
      const r = input.researcherResults.find((rr) => rr.dimension === dim);
      if (!r) return [];
      return r.findings
        .filter((f) => f.evidence && f.evidence.trim().length > 5)
        .slice(0, 5)
        .map((f) => {
          const domain = (() => {
            try {
              return new URL(f.source).hostname.replace(/^www\./, "");
            } catch {
              return "";
            }
          })();
          return domain ? `${f.evidence} (来源: ${domain})` : f.evidence;
        });
    };
    const buildDimSectionHeader = (dim: string): string[] => {
      const block: string[] = [];
      const points = matchInsightsFor(dim);
      if (points.length > 0) {
        block.push("**核心观点：**");
        block.push("");
        for (const p of points) block.push(`- ${p}`);
        block.push("");
      }
      return block;
    };
    const buildDimSectionFooter = (dim: string): string[] => {
      const block: string[] = [];
      const facts = matchKeyFactsFor(dim);
      if (facts.length > 0) {
        block.push("");
        block.push("**关键数据：**");
        block.push("");
        for (const f of facts) block.push(`- ${f}`);
        block.push("");
      }
      return block;
    };

    // ── Section 5: dimension sections (建 TOC 前先确定哪些 dim 非空) ──────────
    const globalSeenParagraphs = new Set<string>();
    const dimNameToIndex = new Map<string, number>();
    input.plan.dimensions.forEach((d, i) => dimNameToIndex.set(d.name, i));
    const formatDim = (rawDimMd: string, dimName: string) => {
      const idx = dimNameToIndex.get(dimName);
      return formatDimensionContent(rawDimMd, {
        dimIndex: idx,
        globalSeenParagraphs,
        dimensionName: dimName,
        logger: { warn: (m: string) => this.logger.warn(m) },
      });
    };

    // Collect dimension sections in plan order
    const dimSections: { heading: string; content: string }[] = [];
    const dimWithMarkdown = new Set<string>();
    for (const r of input.researcherResults) {
      if (r.fullMarkdown && r.fullMarkdown.trim().length > 200) {
        const cleaned = r.fullMarkdown.replace(/^#\s+[^\n]+\n+/, "");
        const formatted = formatDim(cleaned, r.dimension);
        dimSections.push({ heading: r.dimension, content: formatted });
        dimWithMarkdown.add(r.dimension);
      }
    }
    // fallback: writerReport.sections for dims not covered by fullMarkdown
    for (const sec of input.writerReport.sections) {
      if (dimWithMarkdown.has(sec.heading)) continue;
      // Skip sections that look like supplementary (conclusion / references / etc.)
      const isSupplementary = [
        "结论",
        "conclusion",
        "参考文献",
        "references",
        labels.execSummary.toLowerCase(),
        labels.preface.toLowerCase(),
        labels.crossDim.toLowerCase(),
        labels.risk.toLowerCase(),
        labels.strategy.toLowerCase(),
      ].some((s) => sec.heading.toLowerCase().trim() === s);
      if (isSupplementary) continue;
      const formatted = formatDim(sec.body, sec.heading);
      dimSections.push({ heading: sec.heading, content: formatted });
    }

    // ── Section 4: 目录 ───────────────────────────────────────────────────────
    // Build TOC now that we know which sections will be present
    const tocLines: string[] = [`## ${labels.toc}`, ""];
    let tocIdx = 0;
    for (const ds of dimSections) {
      tocIdx++;
      tocLines.push(
        `${tocIdx}. [${ds.heading}](#${normalizeMarkdownSlug(ds.heading)})`,
      );
    }
    // Supplementary sections always appear in TOC
    tocIdx++;
    tocLines.push(
      `${tocIdx}. [${labels.crossDim}](#${normalizeMarkdownSlug(labels.crossDim)})`,
    );
    tocIdx++;
    tocLines.push(
      `${tocIdx}. [${labels.risk}](#${normalizeMarkdownSlug(labels.risk)})`,
    );
    tocIdx++;
    tocLines.push(
      `${tocIdx}. [${labels.strategy}](#${normalizeMarkdownSlug(labels.strategy)})`,
    );
    tocLines.push("");
    for (const l of tocLines) parts.push(l);

    // ── Emit dimension sections ──────────────────────────────────────────────
    // ★ 不加序号前缀 "N. " —— buildSectionTree 用 d.name 匹配 section 标题；
    //   维度编号由前端 ArtifactMarkdown 用 CSS counter / React 渲染时自动加上
    //   （H2 显式索引），后端 markdown 保持纯净，不破坏 dimMatch / formatDim。
    //   章节级编号（### N.M. {chapter}）由 formatDimensionContent.numberSubHeadings
    //   自动注入，无需在这里处理。
    for (const ds of dimSections) {
      parts.push(`## ${ds.heading}`);
      parts.push("");
      for (const line of buildDimSectionHeader(ds.heading)) parts.push(line);
      parts.push(ds.content);
      for (const line of buildDimSectionFooter(ds.heading)) parts.push(line);
      parts.push("");
    }

    // ── Section 6: 跨维度分析 ─────────────────────────────────────────────────
    // analyst.crossDimAnalysis with fallback from dim keyFindings
    const crossDimText =
      input.analyst?.crossDimAnalysis?.trim() ||
      (() => {
        const lines = input.researcherResults
          .filter((r) => r.findings.length > 0)
          .map((r) => {
            const top2 = r.findings
              .slice(0, 2)
              .map((f) => f.claim)
              .join("；");
            return `**${r.dimension}**：${top2}`;
          });
        return lines.length > 0
          ? lines.join("\n\n") +
              "\n\n以上各维度研究发现相互印证并存在内在关联，详见各维度章节。"
          : "";
      })();
    parts.push(`## ${labels.crossDim}`);
    parts.push("");
    if (crossDimText) {
      parts.push(crossDimText);
    } else {
      parts.push(
        isEn
          ? "Cross-dimension analysis pending further research."
          : "跨维度综合分析待后续研究补充。",
      );
    }
    parts.push("");

    // ── Section 7: 风险评估 ──────────────────────────────────────────────────
    // analyst.riskAssessment with fallback from dim findings (first challenge-like claim)
    const riskText =
      input.analyst?.riskAssessment?.trim() ||
      (() => {
        const items = input.researcherResults.flatMap((r) =>
          r.findings.slice(0, 1).map((f) => `- **${r.dimension}**：${f.claim}`),
        );
        return items.length > 0
          ? `### 主要风险\n\n${items.join("\n")}\n\n| 风险级别 | 描述 | 应对建议 |\n|---|---|---|\n| 高 | 详见各维度分析 | 持续跟踪 |\n| 中 | 关注趋势变化 | 定期评估 |`
          : "";
      })();
    parts.push(`## ${labels.risk}`);
    parts.push("");
    if (riskText) {
      parts.push(riskText);
    } else {
      parts.push(
        isEn
          ? "Risk assessment pending further analysis."
          : "风险评估待进一步分析。",
      );
    }
    parts.push("");

    // ── Section 8: 战略建议 ──────────────────────────────────────────────────
    // analyst.strategicRecommendations with fallback from dim findings
    const stratText =
      input.analyst?.strategicRecommendations?.trim() ||
      (() => {
        const items = input.researcherResults.flatMap((r) =>
          r.findings.slice(1, 2).map((f) => `- **${r.dimension}**：${f.claim}`),
        );
        return items.length > 0 ? `### 决策者建议\n\n${items.join("\n")}` : "";
      })();
    parts.push(`## ${labels.strategy}`);
    parts.push("");
    if (stratText) {
      parts.push(stratText);
    } else {
      parts.push(
        isEn
          ? "Strategic recommendations pending further analysis."
          : "战略建议待进一步分析。",
      );
    }
    parts.push("");

    // ── Section 9: 结论 ──────────────────────────────────────────────────────
    parts.push(`## ${labels.conclusion}`);
    parts.push("");
    parts.push(input.writerReport.conclusion);
    parts.push("");

    return parts.join("\n");
  }

  // ─── 2. sections 树 ─────────────────────────────────────────────
  /**
   * ★ 2026-04-30: 把 chapter writer 写错的"keyPoint 编号 H2"降级为 H3。
   *
   * 真因：LLM 经常把分论点 "1. xxx / 2. xxx / （一） xxx / 其一：xxx" 写成 `## ` H2
   * 而不是 prompt 要求的 `### ` H3 或正文段落，导致 buildSectionTree 把每个 keyPoint
   * 切成独立 section（实测一份 8 章报告变 54 张章节卡）。
   *
   * 启发式：H2 标题以下列模式开头视为伪 H2，降级为 H3：
   *   - 阿拉伯数字+点 (1. 2. 10.)
   *   - 中文数字+顿/点 (一、二、三. )
   *   - 括号编号 (一)（一）(1)（1）
   *   - "其一/其二" / "第一章/第二节"
   *
   * 仅在前面已经至少有过一个真 H2 后才降级，避免误降首章。
   */
  private sanitizeKeyPointH2(markdown: string): string {
    const PSEUDO_H2 =
      /^##\s+(\d+[.、]|[一二三四五六七八九十]+[.、]|（[一二三四五六七八九十]+）|[（(][1-9]\d*[）)]|其[一二三四五六七八九十]|第[一二三四五六七八九十]+[、章节])/u;
    const lines = markdown.split("\n");
    let h2Count = 0;
    let inCodeBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(```|~~~)/.test(line.trim())) inCodeBlock = !inCodeBlock;
      if (inCodeBlock) continue;
      if (line.startsWith(">") || line.startsWith("    ")) continue;
      if (line.startsWith("## ") && !line.startsWith("### ")) {
        if (h2Count > 0 && PSEUDO_H2.test(line)) {
          lines[i] = "###" + line.slice(2);
          continue;
        }
        h2Count++;
      }
    }
    return lines.join("\n");
  }

  private buildSectionTree(
    fullMarkdown: string,
    input: AssembleInput,
  ): ArtifactSection[] {
    const sections: ArtifactSection[] = [];
    const lines = fullMarkdown.split("\n");
    let currentSection: ArtifactSection | null = null;
    let bodyStart = 0;
    let charOffset = 0;
    const flush = (endOffset: number, bodyText: string) => {
      if (!currentSection) return;
      currentSection.endOffset = endOffset;
      currentSection.wordCount = countWords(bodyText, input.language);
      currentSection.readingTimeMinutes = Math.ceil(
        currentSection.wordCount / (input.language === "zh-CN" ? 400 : 250),
      );
    };
    // ★ P0-R4-2 (round 4): 跟踪代码块 / 引用块上下文，避免误识别块内 ## 为 section
    let inCodeBlock = false;
    for (const line of lines) {
      const lineWithNL = line + "\n";
      // 围栏代码块翻转（``` 或 ~~~）
      if (/^(```|~~~)/.test(line.trim())) {
        inCodeBlock = !inCodeBlock;
      } else if (
        !inCodeBlock &&
        // 排除引用块（> ##）和缩进代码块（4 空格起）
        !line.startsWith(">") &&
        !line.startsWith("    ") &&
        line.startsWith("## ") &&
        !line.startsWith("### ")
      ) {
        // close previous
        if (currentSection) {
          const bodyText = fullMarkdown.slice(bodyStart, charOffset);
          flush(charOffset, bodyText);
          sections.push(currentSection);
        }
        const title = line.slice(3).trim();
        const type = this.inferSectionType(title);
        // ★ PR-A7 (2026-05-07): legacy invariant fallback —— 加 fuzzy match
        //   原 exact match (d.name === title) 在 LLM 改写章节标题（加 emoji /
        //   微调名 / 加序号"1. 维度 X"）时静默失败，sourceDimensionId=undefined →
        //   现网 mission 章节 vs 维度对不上。fuzzy match 阈值 0.7 + 8 字前缀
        //   includes 启发式（具体阈值与 design v1.3 §5 PR-A7 一致）。
        const dimMatch = this.fuzzyMatchDimension(title, input.plan.dimensions);
        const id = dimMatch
          ? dimMatch.id
          : `sec-${normalizeMarkdownSlug(title)}-${sections.length + 1}`;
        currentSection = {
          id,
          type,
          level: 2,
          title,
          anchor: normalizeMarkdownSlug(title),
          startOffset: charOffset,
          endOffset: charOffset,
          wordCount: 0,
          readingTimeMinutes: 0,
          citations: [],
          figureIds: [],
          factIds: [],
          sourceDimensionId: dimMatch?.id,
        };
        bodyStart = charOffset + lineWithNL.length;
      }
      charOffset += lineWithNL.length;
    }
    if (currentSection) {
      const bodyText = fullMarkdown.slice(bodyStart, charOffset);
      flush(charOffset, bodyText);
      sections.push(currentSection);
    }
    // ★ Phase 2 (TI report-assembler:268-387 模式): 两遍处理 —— 过滤纯标题无内容的空 section
    // 防止"维度 N 没产出但占位"导致下游 quality.coverage 错误归零
    const filteredSections = sections.filter((s) => {
      const body = fullMarkdown.slice(s.startOffset, s.endOffset);
      // 纯标题（剥离所有 #...）后非空才保留
      const stripped = body.replace(/^#+\s+.*\n?/gm, "").trim();
      return stripped.length > 0;
    });

    // ★ PR-A7 (2026-05-07): missing-dim 显式标签 —— plan.dimensions 中
    //   没有任何 section 命中的维度，加占位 section 让 quality.coverage 不漏报。
    //   不修改 fullMarkdown（offset 一致性），仅追加 zero-width section
    //   （startOffset === endOffset === fullMarkdown.length）+ title 加显式标签。
    const matchedDimIds = new Set(
      filteredSections
        .map((s) => s.sourceDimensionId)
        .filter((id): id is string => !!id),
    );
    const missingDims = input.plan.dimensions.filter(
      (d) => !matchedDimIds.has(d.id),
    );
    if (missingDims.length > 0) {
      this.logger.warn(
        `[buildSectionTree] missing-dim 显式标签: ${missingDims.length} 维度无对应 section`,
      );
      // ★ R2 共识 P0 (architect P0-3, 2026-05-07): missing-dim 占位 section
      //   必须保证 offset 严格单调递增，否则下游 sort by offset / binary search
      //   会得到不稳定排序。把每个 missing dim 放到 EOF 之后的虚拟 offset
      //   (eofOffset + i)；虚拟 offset 超出 fullMarkdown.length 是显式语义：
      //   slice(start, end) 返回空字符串（zero-width 占位本来就无内容），
      //   下游消费方用 sourceDimensionId 关联，offset 仅作排序用。
      const eofOffset = fullMarkdown.length;
      for (let i = 0; i < missingDims.length; i++) {
        const d = missingDims[i];
        const virtualOffset = eofOffset + i + 1;
        filteredSections.push({
          id: d.id,
          type: "dimension",
          level: 2,
          title: `${d.name}（本维度内容缺失）`,
          anchor: normalizeMarkdownSlug(d.name),
          startOffset: virtualOffset,
          endOffset: virtualOffset,
          wordCount: 0,
          readingTimeMinutes: 0,
          citations: [],
          figureIds: [],
          factIds: [],
          sourceDimensionId: d.id,
        });
      }
    }

    return filteredSections;
  }

  /**
   * ★ PR-A7 (2026-05-07): 维度名 fuzzy match
   *
   * 优先级：
   *   1. exact match (d.name === title) — 旧行为
   *   2. case-insensitive includes — title 是否包含 dim.name 前 8 字 / dim.name 是否包含 title
   *   3. 简单字符相似度 ≥ 0.7（基于 LCS 长度比例）
   *
   * 阈值 0.7 来自 design v1.3 §5 PR-A7：spec 锁 dim 名 90% 能正确对齐（5+ 数据点）。
   */
  private fuzzyMatchDimension(
    title: string,
    dimensions: AssembleInput["plan"]["dimensions"],
  ): AssembleInput["plan"]["dimensions"][number] | undefined {
    // 1. exact match 优先
    const exact = dimensions.find((d) => d.name === title);
    if (exact) return exact;

    const t = title.toLowerCase().trim();
    if (!t) return undefined;

    // 2. includes 启发式（dim 名前 8 字符）
    for (const d of dimensions) {
      const n = d.name.toLowerCase().trim();
      if (!n) continue;
      const prefix = n.slice(0, 8);
      if (t.includes(prefix) || n.includes(t.slice(0, 8))) {
        return d;
      }
    }

    // 3. LCS 相似度（O(n*m)，n/m ≤ 200 通常合理）
    let best: {
      dim: AssembleInput["plan"]["dimensions"][number];
      score: number;
    } | null = null;
    for (const d of dimensions) {
      const n = d.name.toLowerCase().trim();
      if (!n) continue;
      const score = lcsSimilarity(t, n);
      if (score >= 0.7 && (!best || score > best.score)) {
        best = { dim: d, score };
      }
    }
    return best?.dim;
  }

  /**
   * ★ 2026-05-13 #59 修图片稀少：URL 正规化用于 citation 匹配
   *
   * researcher 的 figure sourceUrl 常带 utm/gclid 等 tracking query，citation 表
   * 是 buildCitations 在不同上下文存的版本，两者字符串不等价 → buildFigures 精确
   * 匹配挂掉 → dropped.noEv++ → 图片被丢。
   *
   * 正规化策略（保守、可回放）：
   *   - 去 fragment（#section）
   *   - 去 utm_*, gclid, fbclid, mc_*, ref / referrer, share, _ga, _gl, igshid 等 tracker params
   *   - 末尾 `/` 归一
   *   - URL 解析失败 → 退化到原串（不 throw）
   */
  private normalizeUrlForMatch(url: string): string {
    if (!url) return "";
    try {
      const u = new URL(url);
      u.hash = "";
      const TRACKER_RE =
        /^(utm_|gclid|fbclid|mc_|ref$|referrer$|share$|_ga$|_gl$|igshid$|yclid$|msclkid$|dclid$)/i;
      const keep: [string, string][] = [];
      u.searchParams.forEach((v, k) => {
        if (!TRACKER_RE.test(k)) keep.push([k, v]);
      });
      // 重写 search（保持非 tracker param 顺序）
      const newSearch = new URLSearchParams(keep).toString();
      u.search = newSearch ? `?${newSearch}` : "";
      // 末尾 / 归一（pathname 非根时）
      if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
        u.pathname = u.pathname.slice(0, -1);
      }
      return u.toString();
    } catch {
      return url;
    }
  }

  private inferSectionType(title: string): ArtifactSection["type"] {
    const t = title.toLowerCase();
    if (t.includes("摘要") || t.includes("summary")) return "executive_summary";
    if (t.includes("跨维度") || t.includes("cross")) return "cross_dimension";
    if (t.includes("风险") || t.includes("risk")) return "risk_assessment";
    if (t.includes("建议") || t.includes("recommend")) return "recommendations";
    if (t.includes("结论") || t.includes("conclusion")) return "conclusion";
    if (t.includes("附录") || t.includes("appendix")) return "appendix";
    if (t.includes("前言") || t.includes("preface")) return "preface";
    return "dimension";
  }

  // ─── 3. citations + occurrences ────────────────────────────────
  /**
   * ★ Phase 2 (2026-04-29): 改为返回 { citations, fullMarkdown }，
   * 因 indexMapping 重映射可能改写正文 [N] 编号，调用方需用更新后版本继续 buildSectionTree。
   */
  private buildCitations(
    fullMarkdown: string,
    sections: ArtifactSection[],
    input: AssembleInput,
  ): { citations: ArtifactCitation[]; fullMarkdown: string } {
    // ★ Phase 2 接入 TI 沉淀: filterJunk → decodeEntities → upgradeHttps → dedupe
    // 收集所有 source URL（writer.citations + writer.sections[].sources + researcher findings）
    const seen = new Map<string, number>();
    const ordered: string[] = [];
    const collectUrl = (url: string) => {
      if (!url) return;
      const u = url.trim();
      if (!u) return;
      if (!seen.has(u)) {
        seen.set(u, ordered.length + 1);
        ordered.push(u);
      }
    };
    for (const c of input.writerReport.citations ?? []) collectUrl(c);
    for (const s of input.writerReport.sections) {
      for (const url of s.sources ?? []) collectUrl(url);
    }
    // ★ 2026-04-30 (PR-C): finding 携带的 sourceTitle / sourceSnippet /
    //   sourcePublishedAt 在这里收集成 url → metadata 字典，下面 buildCitation
    //   时优先用这些字段填 title/snippet/publishedAt，避免 86% citation
    //   title=domain 的占位现象。
    const urlMetadata = new Map<
      string,
      { title?: string; snippet?: string; publishedAt?: string }
    >();
    for (const r of input.researcherResults) {
      for (const f of r.findings) {
        collectUrl(f.source);
        const existing = urlMetadata.get(f.source) ?? {};
        const enriched = {
          title: existing.title || f.sourceTitle,
          snippet: existing.snippet || f.sourceSnippet,
          publishedAt: existing.publishedAt || f.sourcePublishedAt,
        };
        // 只在至少有一个字段时存（节省内存）
        if (enriched.title || enriched.snippet || enriched.publishedAt) {
          urlMetadata.set(f.source, enriched);
        }
      }
    }

    // ★ Phase 2 移植 TI 沉淀工具：3 步链路
    //   1) filterJunkReferences: 滤掉 example.com / placeholder / # 等垃圾 URL
    //   2) decodeUrlEntities: 修复 &amp; / &#x2F; 等 HTML 实体腐蚀
    //   3) upgradeHttpToHttps: HTTP → HTTPS（防混合内容警告 + SEO 友好）
    let refEntries: { url: string; index: number }[] = ordered.map(
      (url, i) => ({
        url,
        index: i + 1,
      }),
    );
    refEntries = filterJunkReferences(refEntries);
    refEntries = decodeUrlEntities(refEntries);
    refEntries = upgradeHttpToHttps(refEntries);
    // 4) deduplicateReferencesByUrl: 同 URL 不同大小写 / trailing slash 归并
    const { deduplicated, indexMapping } =
      deduplicateReferencesByUrl(refEntries);
    // 应用 indexMapping 到正文，让 [N] 编号与最终 citations 对齐
    if (Object.keys(indexMapping).length > 0) {
      fullMarkdown = remapCitationIndices(fullMarkdown, indexMapping);
    }
    const finalUrls = deduplicated.map((e) => e.url);

    const citations: ArtifactCitation[] = finalUrls.map((url, idx) => {
      const num = idx + 1;
      const domain = extractDomain(url);
      // ★ 2026-04-30 (PR-C): 优先用 finding 携带的真实 title/snippet/publishedAt，
      //   找不到才回落到 domain 占位（之前 86% 引用都走占位）。
      const meta = urlMetadata.get(url);
      const richTitle = meta?.title?.trim();
      const richSnippet = meta?.snippet?.trim();
      const richPublishedAt = meta?.publishedAt?.trim();
      return {
        index: num,
        uuid: `cite-${num}`,
        title: richTitle && richTitle.length > 0 ? richTitle : (domain ?? url),
        url,
        domain: domain ?? "unknown",
        snippet:
          richSnippet && richSnippet.length > 0
            ? richSnippet.slice(0, 300)
            : undefined,
        publishedAt:
          richPublishedAt && richPublishedAt.length > 0
            ? richPublishedAt
            : undefined,
        accessedAt: new Date().toISOString(),
        sourceType: this.inferSourceType(domain, url),
        credibilityScore: this.scoreCredibility(domain, url),
        occurrences: [],
      };
    });

    // 扫 fullMarkdown 找 [N] 模式 → 算每个出现位置的 sectionId / paragraphIndex / charOffset
    const citePattern = /\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = citePattern.exec(fullMarkdown)) !== null) {
      const num = parseInt(m[1], 10);
      const cite = citations.find((c) => c.index === num);
      if (!cite) continue;
      const offset = m.index;
      const sec = sections.find(
        (s) => offset >= s.startOffset && offset < s.endOffset,
      );
      if (!sec) continue;
      const sectionLocalOffset = offset - sec.startOffset;
      const sectionMarkdown = fullMarkdown.slice(
        sec.startOffset,
        sec.endOffset,
      );
      const paragraphIndex = countParagraphsBefore(
        sectionMarkdown,
        sectionLocalOffset,
      );
      cite.occurrences.push({
        sectionId: sec.id,
        paragraphIndex,
        characterOffset: sectionLocalOffset,
      });
      if (!sec.citations.includes(num)) sec.citations.push(num);
    }

    return { citations, fullMarkdown };
  }

  /**
   * ★ 2026-04-30 (PR-C): 同时看 domain + URL path
   * 之前只看 TLD，平台型站点（platform.claude.com / docs.anthropic.com 等）
   * 全部命中 default 分支 industry/65，导致 mission 4fd5efa1 24/29 引用 sourceType 单一、
   * credibility 全打 65 → 可信度徽章颜色全统一、过滤毫无意义。
   * 现在看 URL path 段：/docs/ /api/ /blog/ /research/ /press/ /paper/ 等。
   */
  private inferSourceType(
    domain: string | null,
    url?: string,
  ): ArtifactCitation["sourceType"] {
    if (!domain) return "other";
    const path = (() => {
      if (!url) return "";
      try {
        return new URL(url).pathname.toLowerCase();
      } catch {
        return "";
      }
    })();
    // 1) TLD 强信号优先
    if (/\.gov(\.|$)/.test(domain)) return "gov";
    if (/\.edu(\.|$)/.test(domain)) return "academic";
    if (
      /(arxiv|nature|science|nih|pubmed|scholar|openalex|ssrn|biorxiv)\./.test(
        domain,
      )
    )
      return "academic";
    if (
      /(reuters|bloomberg|economist|wsj|nytimes|ft\.com|theguardian|bbc|wired)\./.test(
        domain,
      )
    )
      return "news";
    if (/(github|stackoverflow|hackernews|reddit)\./.test(domain))
      return "community";
    if (/(medium|substack|wordpress|blogspot)\./.test(domain)) return "blog";
    // 2) Path 信号（mission 4fd5efa1 解决 platform.claude.com 全归 industry 占位的问题）
    if (/(^|\/)(paper|research|publication|journal|preprint)(\/|$)/.test(path))
      return "academic";
    if (/(^|\/)(blog|posts?|article)(\/|$)/.test(path)) return "blog";
    if (/(^|\/)(news|press|announcement)(\/|$)/.test(path)) return "news";
    if (/(^|\/)(forum|community|discuss)(\/|$)/.test(path)) return "community";
    return "industry";
  }

  /**
   * ★ 2026-04-30 (PR-C): 同时看 domain + URL path
   * 之前所有 platform.* / docs.* / api.* 都打 default 65；现在让 path 段
   * /docs/ /research/ /paper/ 提分，/blog/ /forum/ 降分。
   */
  private scoreCredibility(domain: string | null, url?: string): number {
    if (!domain) return 50;
    const path = (() => {
      if (!url) return "";
      try {
        return new URL(url).pathname.toLowerCase();
      } catch {
        return "";
      }
    })();
    // TLD 强信号
    if (/\.gov(\.|$)/.test(domain)) return 95;
    if (/\.edu(\.|$)/.test(domain)) return 90;
    if (/(arxiv|nature|science|nih|pubmed|biorxiv|ssrn)\./.test(domain))
      return 92;
    if (/(reuters|bloomberg|economist|wsj|nytimes|ft\.com|bbc)\./.test(domain))
      return 85;
    if (/(github|wikipedia)\./.test(domain)) return 80;
    if (/(medium|substack|wordpress|blogspot)\./.test(domain)) return 50;
    // Path 信号
    if (/(^|\/)(paper|research|publication|journal|preprint)(\/|$)/.test(path))
      return 85;
    // 厂商官方 docs / api 视为相对可信（提至 75，比 default 65 高）
    if (/(^|\/)(docs?|api|reference|spec|whitepaper)(\/|$)/.test(path))
      return 75;
    if (/(^|\/)(news|press|announcement)(\/|$)/.test(path)) return 70;
    if (/(^|\/)(blog|posts?|article)(\/|$)/.test(path)) return 55;
    if (/(^|\/)(forum|community|discuss)(\/|$)/.test(path)) return 50;
    return 65;
  }

  // ─── 4. figures 五项强校验 + 自动关联 evidenceCitationIndex ────────
  // 数据流（mission-pipeline-baseline.md §7.4 / Phase P1-1）：
  //   Researcher.figureCandidates （含 sourceUrl/imageUrl/caption）
  //     → 黑名单过滤 (isGarbageFigureUrl)
  //     → 去重 (dedupeFigureCandidates)
  //     → 映射 sourceUrl → citation.index (evidenceCitationIndex)
  //     → 关联 sectionId（按 fromDimensionId）
  //     → 输出 ArtifactFigure[]
  //
  // ★ 2026-05-07 P1 图文匹配闭环（学 TI section.figureReferences）：
  //   优先路径：扫描 chapter.figureReferences → 按 figureId 解析到
  //   researcher.figureCandidates[idx] → 关联到该 chapter 所属 dim 的 section。
  //   这条路径是 LLM 决定的精确匹配（"如图 1 所示" + figureId="FIG-1"）。
  //   兜底路径：chapter 没有 figureReferences 时，回退到 researcher.figureCandidates
  //   全量自动追加章节末尾（兼容旧行为）。
  private buildFigures(
    input: AssembleInput,
    citations: ArtifactCitation[],
    sections: ArtifactSection[],
  ): ArtifactFigure[] {
    // 收集所有 raw figureCandidates，附带 fromDimensionId / fromChapterIndex / paragraphIndex
    type Raw = {
      sourceUrl: string;
      imageUrl?: string;
      caption: string;
      sourcePageOrSection?: string;
      relevanceHint?: "high" | "medium" | "low";
      fromDimensionId: string;
      /** 当从 chapter.figureReferences 来时，记录章节 index 用于精确关联 */
      fromChapterHeading?: string;
      /** 0-based paragraph index（来自 LLM anchorParagraph - 1） */
      paragraphIndex?: number;
    };
    const rawAll: Raw[] = [];

    for (const r of input.researcherResults) {
      const dim = input.plan.dimensions.find((d) => d.name === r.dimension);
      const dimId = dim?.id ?? `dim-${r.dimension.slice(0, 20)}`;
      const candidates = r.figureCandidates ?? [];

      // 优先路径：从 chapter.figureReferences 反查 figureId → candidates[N-1]
      // figureId 命名约定：FIG-1..N，N 对应 candidates 数组 1-based 下标
      // （per-dim-pipeline 调 chapter-writer 时正是这样映射的）
      const chaptersWithFigRefs = (r.chapters ?? []).filter(
        (ch) => ch.figureReferences && ch.figureReferences.length > 0,
      );
      const chapterRefUsed = new Set<number>(); // 已被 chapter ref 使用过的 candidate idx

      for (const ch of chaptersWithFigRefs) {
        for (const ref of ch.figureReferences ?? []) {
          // 解析 FIG-N → candidates[N-1]
          const m = ref.figureId.match(/^FIG-(\d+)$/i);
          if (!m) continue;
          const idx = parseInt(m[1], 10) - 1;
          if (idx < 0 || idx >= candidates.length) continue;
          const f = candidates[idx];
          chapterRefUsed.add(idx);
          rawAll.push({
            sourceUrl: f.sourceUrl,
            imageUrl: f.imageUrl,
            caption: ref.caption || f.caption,
            sourcePageOrSection: f.sourcePageOrSection,
            relevanceHint: f.relevanceHint,
            fromDimensionId: dimId,
            fromChapterHeading: ch.heading,
            paragraphIndex: ref.anchorParagraph
              ? Math.max(0, ref.anchorParagraph - 1)
              : 0,
          });
        }
      }

      // 兜底路径：未被 chapter.figureReferences 选中的 candidates 仍按 dim 追加章节末尾
      // （兼容 chapter-writer 不输出 figureReferences 时的旧行为，及 LLM 漏选时的兜底）
      for (let i = 0; i < candidates.length; i++) {
        if (chapterRefUsed.has(i)) continue;
        const f = candidates[i];
        rawAll.push({
          sourceUrl: f.sourceUrl,
          imageUrl: f.imageUrl,
          caption: f.caption,
          sourcePageOrSection: f.sourcePageOrSection,
          relevanceHint: f.relevanceHint,
          fromDimensionId: dimId,
        });
      }
    }
    // 黑名单过滤（垃圾图 URL）
    const filtered = rawAll.filter((f) => {
      if (isGarbageFigureUrl(f.imageUrl)) return false;
      if (!f.imageUrl && isGarbageFigureUrl(f.sourceUrl)) return false;
      return true;
    });
    // 去重
    const deduped = dedupeFigureCandidates(filtered);
    // 映射到 citationIndex（sourceUrl → 已收录的 [N]）
    const urlToIndex = new Map<string, number>();
    for (const c of citations) urlToIndex.set(c.url, c.index);

    const figures: ArtifactFigure[] = [];
    // ★ 2026-05-13 #59 修图片稀少（升级 2026-05-02 五项校验）：
    //   - 加 normalized URL 匹配（去 utm/gclid/末尾 slash 等），治 figure sourceUrl
    //     与 citation URL 字符串不等价但语义相同的情况；
    //   - host 匹配作为兜底（旧逻辑保留）；
    //   - 全部失败时不再 continue 丢弃，而是 push 一个 synthetic citation
    //     （sourceType=other, credibility=0.5），让 figure 入仓但不污染高可信引用池。
    const dropped = {
      noEvFallbackSynth: 0,
      noEvHost: 0,
      noEvNorm: 0,
      noImageUrl: 0,
      noSec: 0,
    };
    // host → citation index 表（fuzzy 匹配兜底）
    const hostToIndex = new Map<string, number>();
    // normalizedUrl → citation index 表（去 utm / trailing slash）
    const normalizedUrlToIndex = new Map<string, number>();
    for (const c of citations) {
      try {
        const host = new URL(c.url).hostname.replace(/^www\./, "");
        if (!hostToIndex.has(host)) hostToIndex.set(host, c.index);
      } catch {
        /* ignore parse error */
      }
      const norm = this.normalizeUrlForMatch(c.url);
      if (norm && !normalizedUrlToIndex.has(norm)) {
        normalizedUrlToIndex.set(norm, c.index);
      }
    }
    for (let i = 0; i < deduped.length; i++) {
      const f = deduped[i];
      let evIdx = urlToIndex.get(f.sourceUrl);
      // ★ 1. normalized URL 匹配（去 utm/gclid/末尾 slash）
      if (!evIdx && f.sourceUrl) {
        const norm = this.normalizeUrlForMatch(f.sourceUrl);
        if (norm) {
          evIdx = normalizedUrlToIndex.get(norm);
          if (evIdx) dropped.noEvNorm++;
        }
      }
      // ★ 2. host 匹配兜底
      if (!evIdx && f.sourceUrl) {
        try {
          const host = new URL(f.sourceUrl).hostname.replace(/^www\./, "");
          evIdx = hostToIndex.get(host);
          if (evIdx) dropped.noEvHost++;
        } catch {
          /* ignore */
        }
      }
      if (!f.imageUrl) {
        dropped.noImageUrl++;
        continue;
      }
      // ★ 3. 全部失败：push synthetic citation 而非丢图
      //   （ArtifactFigure.evidenceCitationIndex 是必填字段，没有 citation 就没法落地）
      //   sourceType=other + credibility=0.5 让 quality scorer 区分这类"补丁来源"。
      if (!evIdx && f.sourceUrl) {
        try {
          const u = new URL(f.sourceUrl);
          const domain = u.hostname.replace(/^www\./, "");
          const synthIdx = citations.length + 1;
          citations.push({
            index: synthIdx,
            uuid: `synth-${synthIdx}-${Date.now()}`,
            title: f.caption.slice(0, 100) || domain,
            url: f.sourceUrl,
            domain,
            accessedAt: new Date().toISOString(),
            sourceType: "other",
            credibilityScore: 0.5,
            occurrences: [],
          });
          // 更新 lookup 表，让同 URL 后续 figure 复用
          urlToIndex.set(f.sourceUrl, synthIdx);
          const norm = this.normalizeUrlForMatch(f.sourceUrl);
          if (norm) normalizedUrlToIndex.set(norm, synthIdx);
          if (!hostToIndex.has(domain)) hostToIndex.set(domain, synthIdx);
          evIdx = synthIdx;
          dropped.noEvFallbackSynth++;
        } catch {
          /* URL parse 失败 → 真正没法救，跳过 */
        }
      }
      if (!evIdx) {
        // sourceUrl 缺失或解析失败：真的丢
        continue;
      }
      // 找 section（按 dim → section.sourceDimensionId）+ fallback 第一个 dim section
      const sec =
        sections.find((s) => s.sourceDimensionId === f.fromDimensionId) ??
        sections.find((s) => s.type === "dimension");
      if (!sec) {
        dropped.noSec++;
        continue;
      }
      // ★ Phase P1-6: referencedBy 反向定位 — 在 section 文本中找包含图主题词的句子
      // ★ 2026-05-07 P1：chapter.figureReferences 来源的图额外加 chapter heading 锚点，
      //   让 referencedBy 包含 chapter 段落，前端能更精准滚到对应章节。
      const referencedBy = this.findReferencingSentences(f.caption, sec, input);
      const rawFromRef = deduped[i].fromChapterHeading;
      if (rawFromRef) {
        referencedBy.unshift({
          sectionId: sec.id,
          phrase: rawFromRef.slice(0, 60),
        });
      }
      figures.push({
        id: `fig-${sec.id}-${i}`,
        type: "reference",
        evidenceCitationIndex: evIdx,
        sourceUrl: f.sourceUrl,
        sourcePageOrSection: f.sourcePageOrSection,
        imageUrl: f.imageUrl,
        title: f.caption.slice(0, 100),
        caption: f.caption,
        altText: f.caption,
        sectionId: sec.id,
        paragraphIndex: deduped[i].paragraphIndex ?? 0,
        anchorMode: "after_paragraph",
        referencedBy,
      });
    }
    if (
      dropped.noEvNorm + dropped.noEvHost + dropped.noEvFallbackSynth > 0 ||
      dropped.noImageUrl + dropped.noSec > 0
    ) {
      this.logger?.warn?.(
        `[buildFigures] kept ${figures.length}/${deduped.length} | norm-rescued ${dropped.noEvNorm} | host-rescued ${dropped.noEvHost} | synth-rescued ${dropped.noEvFallbackSynth} | dropped noImageUrl=${dropped.noImageUrl} noSec=${dropped.noSec}`,
      );
    }
    return figures;
  }

  /**
   * 反向定位：从 caption 提关键词，在 section markdown 中找包含这些词的句子。
   * 简化版（无 NLP）：分词 → 去停用词 → 取前 3 个 ≥2 字符的词 → grep 句子。
   */
  private findReferencingSentences(
    caption: string,
    sec: ArtifactSection,
    input: AssembleInput,
  ): { sectionId: string; phrase: string }[] {
    const text = this.extractSectionText(input, sec);
    if (!text) return [];
    const stopwords = new Set([
      "the",
      "and",
      "for",
      "with",
      "from",
      "this",
      "that",
      "图",
      "的",
      "了",
      "是",
      "和",
      "及",
      "等",
    ]);
    const tokens = caption
      .replace(/[，。、,.!?:;""'']/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !stopwords.has(t.toLowerCase()))
      .slice(0, 5);
    if (tokens.length === 0) return [];
    // 在 section text 找含至少一个 token 的句子
    const sentences = text.split(/(?<=[。！？.!?])\s+/).slice(0, 30);
    const matched: { sectionId: string; phrase: string }[] = [];
    for (const s of sentences) {
      if (tokens.some((t) => s.includes(t))) {
        matched.push({ sectionId: sec.id, phrase: s.trim().slice(0, 120) });
        if (matched.length >= 3) break;
      }
    }
    return matched;
  }

  private extractSectionText(
    input: AssembleInput,
    sec: ArtifactSection,
  ): string {
    const md = this.buildFullMarkdown(input);
    return md.slice(sec.startOffset, sec.endOffset);
  }

  // ─── 5. factTable ───────────────────────────────────────────────
  private buildFactTable(
    input: AssembleInput,
    citations: ArtifactCitation[],
  ): ArtifactFactTriple[] {
    if (!input.reconciliationReport?.factTable) return [];
    const urlToIndex = new Map<string, number>();
    for (const c of citations) urlToIndex.set(c.url, c.index);
    // ★ P1-R4-F (round 4): 单次 find + 缓存，避免每个 fact 调 4 次同样的 find（O(n²)）
    const conflicts = input.reconciliationReport.conflicts ?? [];
    return input.reconciliationReport.factTable.map((f) => {
      const conflict = conflicts.find((c) => c.factIds.includes(f.id));
      return {
        id: f.id,
        entity: f.entity,
        attribute: f.attribute,
        value: f.value,
        sources: f.sources
          .map((s) => urlToIndex.get(s) ?? -1)
          .filter((n) => n > 0),
        conflict: conflict
          ? {
              factIds: conflict.factIds,
              resolutionType: conflict.resolutionType,
              rationale: conflict.rationale,
            }
          : undefined,
      };
    });
  }

  // ─── 6. quickView 派生 ─────────────────────────────────────────
  private buildQuickView(
    input: AssembleInput,
    sections: ArtifactSection[],
    citations: ArtifactCitation[],
    figures: ArtifactFigure[],
  ): ArtifactQuickView {
    const execSection = sections.find((s) => s.type === "executive_summary");
    const execMarkdown = execSection
      ? (input.analyst?.themeSummary ?? input.writerReport.summary)
      : input.writerReport.summary;
    const execWordCount = countWords(execMarkdown, input.language);

    // topHighlights：从 analyst.keyInsights 派生（不存在则从每 dim 第一个 finding 派生）
    const highlights: ArtifactHighlight[] = [];
    const insights = input.analyst?.keyInsights ?? [];
    for (const ins of insights.slice(0, 7)) {
      highlights.push({
        type: "finding",
        title: ins.title ?? "Insight",
        oneLineSummary: ins.oneLine ?? "",
        sourceDimensionId: input.plan.dimensions[0]?.id ?? "dim-0",
        citations: [],
      });
    }
    if (highlights.length === 0) {
      // fallback：每 dim 第一个 finding
      for (const r of input.researcherResults.slice(0, 5)) {
        const f = r.findings[0];
        if (!f) continue;
        const dimId =
          input.plan.dimensions.find((d) => d.name === r.dimension)?.id ??
          "dim-?";
        highlights.push({
          type: "finding",
          title: f.claim.slice(0, 80),
          oneLineSummary: f.evidence,
          sourceDimensionId: dimId,
          citations: [],
        });
      }
    }

    // 关键引用：取 credibilityScore Top 5-8
    const keyCitations = [...citations]
      .sort((a, b) => b.credibilityScore - a.credibilityScore)
      .slice(0, 8)
      .map((c) => c.index);

    // 关键图：前 3-5 张
    const keyFigures = figures.slice(0, 5).map((f) => f.id);

    return {
      executiveSummary: { markdown: execMarkdown, wordCount: execWordCount },
      topHighlights: highlights,
      topTrends: [],
      keyRisks: [],
      topRecommendations: [],
      keyCitations,
      keyFigures,
      estimatedReadingTime: 3 + Math.ceil(execWordCount / 400),
      whatYouWillLearn: input.plan.dimensions.slice(0, 5).map((d) => d.name),
      // ★ PR-quickview-parity (2026-05-09): 老 v1 assembler 不消费 analyst 结构化 quickView 字段，
      //   保留空兜底以满足 ArtifactQuickView 类型契约。新 mission 走 StructuralReportAssembler。
      riskMatrix: [],
      keyFindingsByDimension: [],
    };
  }

  // ─── 7. metadata ────────────────────────────────────────────────
  private buildMetadata(
    input: AssembleInput,
    fullMarkdown: string,
    _sections: ArtifactSection[],
    citations: ArtifactCitation[],
    figures: ArtifactFigure[],
  ): ArtifactMetadata {
    const wordCount = countWords(fullMarkdown, input.language);
    return {
      topic: input.topic,
      generatedAt: new Date().toISOString(),
      generationTimeMs: input.generationTimeMs,
      version: 1,
      isIncremental: false,
      dimensionCount: input.plan.dimensions.length,
      sourceCount: citations.length,
      factCount: input.reconciliationReport?.factTable?.length ?? 0,
      figureCount: figures.length,
      wordCount,
      readingTimeMinutes: Math.ceil(
        wordCount / (input.language === "zh-CN" ? 400 : 250),
      ),
      styleProfile: input.styleProfile,
      lengthProfile: input.lengthProfile,
      audienceProfile: input.audienceProfile,
      language: input.language,
      searchTimeRange: input.searchTimeRange,
      totalTokens: input.totalTokens,
      costCents: input.costCents,
      modelTrail: input.modelTrail,
    };
  }

  // ─── 8. quality 真实评分（mission-pipeline-baseline.md §7.8 / Phase P0-9）──
  // 从实际数据派生 10 维评分，hardGateViolations 触发条件：
  //   - traceability: 每个 dim 章节都至少 1 个 [N] 引用
  //   - factualConsistency: factTable.conflict 全部 properly handled (非 flagged-unresolved)
  //   - coverage: plan.dimensions 全部对应 chapter
  //   - redundancy: 章节间相似度估算（用字数差异作启发）
  //   - formatCorrectness: 不含畸形 markdown
  //   - lengthAccuracy: ±20% lengthProfile target
  //   - chapterBalance: 章节字数标准差 < 平均 50%
  //   - citationDensity: 加粗 ≤ 60 / 引用块 ≤ 8
  //   - novelty / styleConformance: 需 LLM 评分（P1 接通），先给中性 70
  private buildQualityStub(
    sections: ArtifactSection[],
    _citations: ArtifactCitation[],
    _figures: ArtifactFigure[],
    input?: AssembleInput,
    fullMarkdown?: string,
  ): ArtifactQualityVerdicts {
    const violations: ArtifactQualityVerdicts["hardGateViolations"] = [];
    const warnings: ArtifactQualityVerdicts["warnings"] = [];

    // ─── coverage：plan 维度 vs 实际 dim 章节 ──
    //   旧逻辑用 dimSections × 20 是绝对值，quick depth 只生成 3 dim 永远封顶 60。
    //   改成相对覆盖率：实际 dim 章节 / plan 计划维度 * 100，深度档自然达 100。
    const dimSections = sections.filter((s) => s.type === "dimension");
    const plannedDims = input?.plan?.dimensions?.length ?? 0;
    const coverageScore =
      plannedDims > 0
        ? Math.min(100, Math.round((dimSections.length / plannedDims) * 100))
        : Math.min(100, dimSections.length * 20);

    // ─── citationDensity：每个 dim section 至少 1 个 [N] ──
    const dimsWithCitations = dimSections.filter((s) => s.citations.length > 0);
    const citationDensityScore =
      dimSections.length > 0
        ? Math.round((dimsWithCitations.length / dimSections.length) * 100)
        : 0;
    if (citationDensityScore < 80) {
      warnings.push({
        dimension: "citationDensity",
        message: `仅 ${dimsWithCitations.length}/${dimSections.length} 章节含引用`,
      });
    }

    // ─── traceability：每个 dim section.citations 至少 1 ──
    const traceabilityScore = citationDensityScore; // 简化：与 citationDensity 一致

    // ─── chapterBalance：字数标准差 ──
    // ★ P1-R4-H (round 4): 全部 wordCount=0（中文 countWords 失效或空报告）时
    // 不应显示"非常均衡 90 分"，应给低分 + warning，与 lengthAccuracy 信号一致
    const wordCounts = sections.map((s) => s.wordCount).filter((n) => n > 0);
    let balanceScore: number;
    let balanceRatio = 0;
    if (wordCounts.length === 0) {
      balanceScore = 35;
      warnings.push({
        dimension: "chapterBalance",
        message: "所有章节字数为 0（可能 wordCount 计算失败或报告为空）",
      });
    } else {
      const avgWords =
        wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
      const stdDev = Math.sqrt(
        wordCounts.reduce((a, n) => a + Math.pow(n - avgWords, 2), 0) /
          wordCounts.length,
      );
      balanceRatio = avgWords > 0 ? stdDev / avgWords : 1;
      balanceScore = balanceRatio < 0.5 ? 90 : balanceRatio < 0.8 ? 70 : 50;
      if (balanceScore < 70) {
        warnings.push({
          dimension: "chapterBalance",
          message: `章节字数标准差 ${(balanceRatio * 100).toFixed(0)}% > 50%`,
        });
      }
    }

    // ─── overall：加权平均 ──
    // ─── lengthAccuracy: 实际字数 vs lengthProfile target ±20% ──
    let lengthAccuracyScore = 75;
    if (input) {
      const target = lengthTargetFor(input.lengthProfile);
      const totalWords = sections.reduce((a, s) => a + s.wordCount, 0);
      const ratio = target > 0 ? totalWords / target : 1;
      if (ratio >= 0.8 && ratio <= 1.2) lengthAccuracyScore = 95;
      else if (ratio >= 0.6 && ratio <= 1.4) lengthAccuracyScore = 75;
      else if (ratio >= 0.4 && ratio <= 1.6) lengthAccuracyScore = 55;
      else lengthAccuracyScore = 35;
      if (lengthAccuracyScore < 60) {
        warnings.push({
          dimension: "lengthAccuracy",
          message: `实际 ${totalWords} 字，目标 ${target} 字（偏差 ${Math.round((ratio - 1) * 100)}%）`,
        });
      }
    }

    // ─── factualConsistency: 从 factTable.conflict 派生 ──
    let factualConsistencyScore = 80;
    if (input?.reconciliationReport?.factTable) {
      const facts = input.reconciliationReport.factTable;
      const factWithConflict = input.reconciliationReport.conflicts ?? [];
      const unresolved = factWithConflict.filter(
        (c) => c.resolutionType === "flagged-unresolved",
      ).length;
      if (factWithConflict.length === 0) factualConsistencyScore = 90;
      else if (unresolved === 0) factualConsistencyScore = 80;
      else if (unresolved / Math.max(1, factWithConflict.length) < 0.3)
        factualConsistencyScore = 65;
      else factualConsistencyScore = 45;
      if (unresolved > 0) {
        warnings.push({
          dimension: "factualConsistency",
          message: `${unresolved} 个事实冲突未裁决（共 ${facts.length} 项事实）`,
        });
      }
    }

    // ─── redundancy: 章节间 4-gram Jaccard 启发 ──
    let redundancyScore = 80;
    if (sections.length >= 2 && input) {
      const md = this.buildFullMarkdown(input);
      const sectionTexts = sections.map((s) =>
        md.slice(s.startOffset, s.endOffset),
      );
      let maxOverlap = 0;
      for (let i = 0; i < sectionTexts.length; i++) {
        for (let j = i + 1; j < sectionTexts.length; j++) {
          const j4 = jaccard4Gram(sectionTexts[i], sectionTexts[j]);
          if (j4 > maxOverlap) maxOverlap = j4;
        }
      }
      if (maxOverlap > 0.3) redundancyScore = 50;
      else if (maxOverlap > 0.2) redundancyScore = 65;
      else if (maxOverlap > 0.15) redundancyScore = 75;
      else redundancyScore = 85;
      if (maxOverlap > 0.15) {
        warnings.push({
          dimension: "redundancy",
          message: `章节最大相似度 ${(maxOverlap * 100).toFixed(0)}% > 15%`,
        });
      }
    }

    // ─── novelty：内容驱动启发式 ───
    //   1. factTable 实体多样性（独立 entity 数量）
    //   2. 引用源域名多样性（独立 domain 数量）
    //   3. 套话扣分（"在当今"/"随着...的发展"/"根据 XX 报告"）
    let noveltyScore = 50;
    const factEntities = new Set<string>();
    if (input?.reconciliationReport?.factTable) {
      for (const f of input.reconciliationReport.factTable)
        factEntities.add(f.entity);
    }
    // 实体≥6 给 +20，≥3 给 +10
    if (factEntities.size >= 6) noveltyScore += 20;
    else if (factEntities.size >= 3) noveltyScore += 10;
    // 域名多样性
    const domains = new Set(_citations.map((c) => c.domain));
    if (domains.size >= 6) noveltyScore += 15;
    else if (domains.size >= 3) noveltyScore += 8;
    // 套话扣分：每出现一次扣 5（用 fullMarkdown 覆盖 body 内容，title 太短）
    const fullText = fullMarkdown ?? sections.map((s) => s.title).join(" ");
    const clichePatterns = [
      /随着.{0,4}的发展/g,
      /在当今/g,
      /众所周知/g,
      /不可忽视/g,
      /显而易见/g,
    ];
    let clicheCount = 0;
    for (const re of clichePatterns) {
      const matches = fullText.match(re);
      if (matches) clicheCount += matches.length;
    }
    noveltyScore = Math.max(20, noveltyScore - clicheCount * 5);
    // 至少有 highlights/keyInsights 给 +5
    const highlightCount = (input?.analyst?.keyInsights ?? []).length;
    if (highlightCount >= 3) noveltyScore += 5;
    noveltyScore = Math.min(100, noveltyScore);

    // ─── styleConformance：profile 匹配启发式 ───
    //   各 profile 期望的关键词频率（基于 fullMarkdown 全文，不只是 title）
    let styleScore = 60;
    const allBody = fullMarkdown ?? sections.map((s) => s.title).join(" ");
    const styleProfile = input?.styleProfile;
    if (styleProfile === "executive") {
      // 期望：Implications / 战略 / 决策 / 风险 / 建议
      const execKw = [/Implications?/gi, /战略|决策|风险|建议|要点|核心/g];
      let execHits = 0;
      for (const re of execKw) {
        const m = allBody.match(re);
        if (m) execHits += m.length;
      }
      styleScore = Math.min(100, 60 + execHits * 6);
    } else if (styleProfile === "academic") {
      // 期望：方法/结果/讨论/局限/参考文献 + 高 citation density
      const academicKw =
        /方法|结果|讨论|局限|参考文献|methodology|conclusion/gi;
      const m = allBody.match(academicKw);
      const acaHits = m ? m.length : 0;
      styleScore = Math.min(
        100,
        50 + acaHits * 5 + Math.round(citationDensityScore * 0.3),
      );
    } else if (styleProfile === "journalistic") {
      // 期望：故事/现场/案例/亲历
      const jKw = /案例|现场|访谈|实地|实例|事件/g;
      const m = allBody.match(jKw);
      styleScore = Math.min(100, 60 + (m ? m.length : 0) * 6);
    } else if (styleProfile === "technical") {
      // 期望：代码/接口/参数/配置/性能 数字密度
      const techKw = /代码|接口|参数|配置|性能|架构|实现|算法/g;
      const m = allBody.match(techKw);
      styleScore = Math.min(100, 55 + (m ? m.length : 0) * 5);
    }

    // ─── formatCorrectness：派生分（mission 843f6958 实证修，2026-05-08 PR-5）──
    //   原硬编码 80 让 quality 系统看不见明显的 LLM 乱写格式（4 类垃圾 + 35 条
    //   unused citations + 77 个空 H3 全过 hardGate）。改为扫 fullMarkdown 检测：
    //     - LLM inline 图标记 ![FIG-N](url) 残留
    //     - <figureReferences> / <figure> 标签残留
    //     - JSON 片段被错写为 H3（### "key": ...）
    //     - 空 H3（标题后立即下一 heading 无正文）
    //   每发现 1 处扣分，> N 处加 hardGateViolation。
    let formatCorrectnessScore = 95;
    let formatDefectCount = 0;
    if (fullMarkdown) {
      const inlineFig = (
        fullMarkdown.match(/!\[FIG-\d+[^\]]*\]\([^)]+\)/gi) ?? []
      ).length;
      const figRefTag = (fullMarkdown.match(/<\/?figureReferences?>/gi) ?? [])
        .length;
      const figureTag = (fullMarkdown.match(/<\/?figure[^>]*>/gi) ?? []).length;
      const jsonH3 = (fullMarkdown.match(/^###\s+["{[][^\n]*$/gm) ?? []).length;
      // 空 H3：标题后直接是另一个 heading（中间只有空行）
      const emptyH3 = (
        fullMarkdown.match(/^###\s+[^\n]+\n\s*\n(?=#{2,4}\s)/gm) ?? []
      ).length;
      formatDefectCount = inlineFig + figRefTag + figureTag + jsonH3 + emptyH3;
      // 每处扣 1.5 分，下限 30
      formatCorrectnessScore = Math.max(
        30,
        95 - Math.round(formatDefectCount * 1.5),
      );
      if (formatDefectCount > 5) {
        violations.push({
          dimension: "formatCorrectness",
          severity: formatDefectCount > 20 ? "error" : "warning",
          message: `markdown 格式缺陷 ${formatDefectCount} 处（inline-fig=${inlineFig} / figRefTag=${figRefTag} / figureTag=${figureTag} / jsonH3=${jsonH3} / emptyH3=${emptyH3}）`,
        });
      } else if (formatDefectCount > 0) {
        warnings.push({
          dimension: "formatCorrectness",
          message: `markdown 格式缺陷 ${formatDefectCount} 处（轻微）`,
        });
      }
    }

    const dimensionScores = {
      traceability: traceabilityScore,
      factualConsistency: factualConsistencyScore,
      novelty: noveltyScore,
      coverage: coverageScore,
      redundancy: redundancyScore,
      formatCorrectness: formatCorrectnessScore,
      citationDensity: citationDensityScore,
      styleConformance: styleScore,
      lengthAccuracy: lengthAccuracyScore,
      chapterBalance: balanceScore,
    };

    // Phase P6-10: hardGateViolations 触发条件
    if (coverageScore < 50) {
      violations.push({
        dimension: "coverage",
        severity: "error",
        message: `覆盖度仅 ${coverageScore}/100（< 50 阈值）`,
      });
    }
    if (citationDensityScore < 30) {
      violations.push({
        dimension: "citationDensity",
        severity: "error",
        message: `引用密度仅 ${citationDensityScore}/100（< 30 阈值）`,
      });
    }
    if (lengthAccuracyScore < 35) {
      violations.push({
        dimension: "lengthAccuracy",
        severity: "warning",
        message: `字数严重偏离 lengthProfile`,
      });
    }
    if (factualConsistencyScore < 50) {
      violations.push({
        dimension: "factualConsistency",
        severity: "error",
        message: `事实一致性仅 ${factualConsistencyScore}/100（unresolved 冲突过多）`,
      });
    }
    // ★ P2-1 (2026-04-29): NaN 兜底 + 0-100 clamp，避免 sections=0 等极端场景污染 overall
    const safeScores = Object.values(dimensionScores).map((s) =>
      isNaN(s) ? 50 : Math.min(100, Math.max(0, s)),
    );
    const overallRaw =
      safeScores.length > 0
        ? safeScores.reduce((a, b) => a + b, 0) / safeScores.length
        : 50;
    const overall = isNaN(overallRaw) ? 50 : Math.round(overallRaw);

    // P100-1: finalVerdict 汇总
    const hasErrors = violations.some((v) => v.severity === "error");
    const hasWarnings = violations.some((v) => v.severity === "warning");
    const finalVerdict: ArtifactQualityVerdicts["finalVerdict"] = hasErrors
      ? "poor"
      : overall >= 85 && !hasWarnings
        ? "excellent"
        : overall >= 70 && !hasWarnings
          ? "good"
          : overall >= 50 || hasWarnings
            ? "acceptable"
            : "poor";

    return {
      overall,
      dimensions: dimensionScores,
      hardGateViolations: violations,
      warnings,
      qualityTrace: [
        {
          stage: "assembler",
          check: "10-dimension-baseline",
          passed: violations.length === 0,
          timestamp: Date.now(),
        },
      ],
      finalVerdict,
    };
  }
}

// ─── helpers ─────────────────────────────────────────────────────

function countWords(s: string, lang: "zh-CN" | "en-US"): number {
  if (lang === "zh-CN") {
    // 简单近似：中文字符数（不含标点 / 空白）
    return (s.match(/[一-龥]/g) ?? []).length;
  }
  return (s.match(/\b[\w-]+\b/g) ?? []).length;
}

function countParagraphsBefore(text: string, offset: number): number {
  // 段落 = 由空行隔开。查找 offset 之前的 \n\n 数量。
  let count = 0;
  let i = 0;
  while (i < offset && i < text.length - 1) {
    if (text[i] === "\n" && text[i + 1] === "\n") count++;
    i++;
  }
  return count;
}

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * lengthProfile 字数 target（mission-pipeline-user-profiles.md §4.3）
 *
 * 也被 s10 leader signoff stage 调用，用于把 target 注入 leader.finalQuality，
 * 让 Lead 看到"承诺 vs 实际"。
 */
export function lengthTargetFor(
  profile: "brief" | "standard" | "deep" | "extended" | "epic" | "mega",
): number {
  switch (profile) {
    case "brief":
      return 3000;
    case "standard":
      return 8000;
    case "deep":
      return 15000;
    case "extended":
      return 25000;
    case "epic":
      return 80000;
    case "mega":
      return 200000;
    default:
      return 8000;
  }
}

/**
 * ★ PR-A7 (2026-05-07): LCS-based 字符串相似度（buildSectionTree fuzzy match）
 *
 * 返回 [0, 1] 区间值：LCS(a, b) * 2 / (a.length + b.length)。
 * 阈值 ≥ 0.7 用于 dim 名 fuzzy 对齐（design v1.3 §5 PR-A7 阈值锁定）。
 *
 * 复杂度 O(n*m)；caller 应限制输入长度（dim.name 当前 200 字符上限，安全）。
 */
function lcsSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const n = a.length;
  const m = b.length;
  // DP 表用滚动数组：prev / curr 各长 m+1
  let prev = new Array<number>(m + 1).fill(0);
  let curr = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  const lcs = prev[m];
  return (lcs * 2) / (n + m);
}

/** 4-gram Jaccard 相似度（章节间冗余检测） */
function jaccard4Gram(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const norm = s.replace(/\s+/g, " ").trim();
    const set = new Set<string>();
    for (let i = 0; i + 4 <= norm.length; i++) {
      set.add(norm.slice(i, i + 4));
    }
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const union = A.size + B.size - inter;
  return union > 0 ? inter / union : 0;
}
