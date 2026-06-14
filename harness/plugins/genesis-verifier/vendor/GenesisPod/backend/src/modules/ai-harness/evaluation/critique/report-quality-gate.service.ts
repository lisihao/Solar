/**
 * Report Quality Gate Service —— 沉淀自 {app}, 2026-04-29
 *
 * v4: 代码强制执行质量标准，替代部分 LLM 审阅循环。
 * 硬性规则通过代码检查，可自动修复的项自动修复，不可自动修复的标记为需要 AI 重写。
 *
 * 标杆参考实现，consumer 等新模块从 `@/modules/ai-harness/facade` 消费。
 * TI 是商用基线，保留独立的本地副本不切换到本实现。
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  detectForeignLanguageBlocks,
  limitBlockquotes,
  limitBoldFormatting,
  removeHorizontalRules,
  sanitizeHeadingLevels,
  deduplicateHeadings,
  stripLLMMetaNotes,
  stripInternalFigureNotation,
} from "@/modules/ai-engine/content/report-template/pipeline/report-formatting.util";
import { getQualityChecklist } from "@/modules/ai-engine/content/report-template/constants/report-writing-standards.constants";
import { stripChartJsonFromContent } from "@/modules/ai-engine/llm/output/sanitization/strip-chart-json.utils";

/**
 * 质量违规项
 */
export interface QualityViolation {
  /** 规则名称 */
  rule: string;
  /** 严重度 */
  severity: "error" | "warning";
  /** 人可读描述 */
  message: string;
  /** 当前值 */
  currentValue?: number;
  /** 阈值 */
  threshold?: number;
}

/**
 * 质量检查结果
 */
export interface QualityCheckResult {
  /** 是否通过所有 error 级别检查 */
  passed: boolean;
  /** 所有违规项 */
  violations: QualityViolation[];
  /** 自动修复后的内容（如果有修复） */
  fixedContent: string;
  /** 是否进行了自动修复 */
  wasAutoFixed: boolean;
  /** 需要 AI 重写的问题描述（传给 AI 做修改指导） */
  rewriteGuidance: string[];
}

@Injectable()
export class ReportQualityGateService {
  private readonly logger = new Logger(ReportQualityGateService.name);

  /**
   * 对维度内容执行质量门控检查
   *
   * @param content Markdown 内容
   * @param targetLanguage 目标语言
   * @returns 质量检查结果（含自动修复后的内容）
   */
  validateDimensionContent(
    content: string,
    targetLanguage: string = "zh",
    topicType?: string,
  ): QualityCheckResult {
    const violations: QualityViolation[] = [];
    const rewriteGuidance: string[] = [];
    let fixedContent = content ?? "";
    let wasAutoFixed = false;

    // ★ Pre-compute subjective expression count BEFORE auto-fix strips them
    const preFixSubjectivePatterns =
      targetLanguage === "zh" ||
      targetLanguage === "zh-CN" ||
      targetLanguage === "zh-TW"
        ? /我们(认为|判断|看到|发现|相信|预测|观察到|注意到)/g
        : /\b(we believe|we think|we find|we observe|we predict|in our view|in our opinion)\b/gi;
    const preFixSubjectiveCount = (
      fixedContent.match(preFixSubjectivePatterns) || []
    ).length;

    // ========== 可自动修复的规则 ==========

    // 1. 标题层级检查 + 自动修复
    if (/^#{1,2}\s+/m.test(fixedContent)) {
      violations.push({
        rule: "heading_hierarchy",
        severity: "warning",
        message: "检测到 # 或 ## 标题（应仅使用 ### 和 ####），已自动修复",
      });
      fixedContent = sanitizeHeadingLevels(fixedContent);
      wasAutoFixed = true;
    }

    // 2. 分割线检查 + 自动移除
    const hrCount = (fixedContent.match(/^\s*[-*]{3,}\s*$/gm) || []).length;
    if (hrCount > 0) {
      violations.push({
        rule: "horizontal_rules",
        severity: "warning",
        message: `检测到 ${hrCount} 条分割线，已自动移除`,
        currentValue: hrCount,
        threshold: 0,
      });
      fixedContent = removeHorizontalRules(fixedContent);
      wasAutoFixed = true;
    }

    // 3. 加粗密度检查 + 极端情况自动限制
    // ★ 极端情况（>30）自动限制每子章节 2 处 + 引导 AI 收敛
    const boldCount = (fixedContent.match(/\*\*[^*]+\*\*/g) || []).length;
    if (boldCount > 30) {
      violations.push({
        rule: "bold_density",
        severity: "warning",
        message: `加粗处数量 ${boldCount} 严重超标（建议 ≤12/维度），已自动限制`,
        currentValue: boldCount,
        threshold: 12,
      });
      fixedContent = limitBoldFormatting(fixedContent, 2);
      wasAutoFixed = true;
      rewriteGuidance.push(
        `加粗过度：当前 ${boldCount} 处加粗，远超建议阈值 12 处/维度。` +
          `请仅对核心结论和关键数据加粗，每个子章节不超过 2 处加粗。`,
      );
    } else if (boldCount > 12) {
      violations.push({
        rule: "bold_density",
        severity: "warning",
        message: `加粗处数量 ${boldCount} 超过建议阈值 12/维度（已放宽，不强制）`,
        currentValue: boldCount,
        threshold: 12,
      });
    }

    // 4. 引用块密度检查 + 自动限制（规范：每维度最多 1 个）
    const blockquoteLines = fixedContent.match(/^>\s*.+$/gm) || [];
    const blockquoteCount = blockquoteLines.length;
    if (blockquoteCount > 1) {
      violations.push({
        rule: "blockquote_density",
        severity: "warning",
        message: `引用块数量 ${blockquoteCount} 超过阈值 1/维度，已自动限制`,
        currentValue: blockquoteCount,
        threshold: 1,
      });
      fixedContent = limitBlockquotes(fixedContent, 1);
      wasAutoFixed = true;
    }

    // 4.5 LLM meta-notes 清理（字数统计、角色名泄露、内部标注等）
    const beforeMetaNotes = fixedContent;
    fixedContent = stripLLMMetaNotes(fixedContent);
    // ★ 去除 LLM 自我身份声明
    fixedContent = fixedContent
      .replace(
        /作为(?:一个)?(?:AI|人工智能|语言模型|算法|机器学习模型)[，,。.：:…]*\s*/g,
        "",
      )
      .replace(
        /\bas an? (?:AI|artificial intelligence|language model|algorithm|machine learning model)[,.\s]*/gi,
        "",
      );
    if (fixedContent !== beforeMetaNotes) {
      violations.push({
        rule: "llm_meta_notes",
        severity: "warning",
        message:
          "检测到 LLM 泄露的内部标注（字数统计/角色名/编辑指令），已自动清理",
      });
      wasAutoFixed = true;
    }

    // 4.6 内部图表/证据标注清理（[证据[N] 图M] 等）
    const beforeFigNotation = fixedContent;
    fixedContent = stripInternalFigureNotation(fixedContent);
    if (fixedContent !== beforeFigNotation) {
      violations.push({
        rule: "internal_figure_notation",
        severity: "warning",
        message: "检测到泄露的内部图表/证据标注，已自动清理",
      });
      wasAutoFixed = true;
    }

    // 4.7 公式/LaTeX 完整性检查 + 自动修复
    const latexIssues = this.validateAndFixLatex(fixedContent);
    if (latexIssues.fixedContent !== fixedContent) {
      fixedContent = latexIssues.fixedContent;
      wasAutoFixed = true;
    }
    if (latexIssues.violations.length > 0) {
      violations.push(...latexIssues.violations);
    }
    if (latexIssues.rewriteGuidance.length > 0) {
      rewriteGuidance.push(...latexIssues.rewriteGuidance);
    }

    // 4.8 重复标题清理（AI 有时生成 "### 1. Title" 后又生成 "### Title"）
    const beforeDedup = fixedContent;
    fixedContent = deduplicateHeadings(fixedContent);
    if (fixedContent !== beforeDedup) {
      violations.push({
        rule: "duplicate_headings",
        severity: "warning",
        message: "检测到重复标题，已自动去重",
      });
      wasAutoFixed = true;
    }

    // 4.8 图表 JSON 残留清理（parseChartOutput 未正确分离的残留）
    const beforeChartJson = fixedContent;
    fixedContent = stripChartJsonFromContent(fixedContent);
    if (fixedContent !== beforeChartJson) {
      violations.push({
        rule: "chart_json_residue",
        severity: "warning",
        message: "检测到图表 JSON 残留数据，已自动清理",
      });
      wasAutoFixed = true;
    }

    // 4.9 内联 Markdown 图片清理（AI 生成的外部 URL 通常 404）
    // ★ Also handle reference-style images: ![alt][figure:N] / ![alt][ref]
    const beforeImages = fixedContent;
    fixedContent = fixedContent
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
      .replace(/!\[([^\]]*)\]\[[^\]]+\]/g, "")
      // LLM 有时输出 !(url) 格式（缺少 alt 文本括号）
      .replace(/^!\(https?:\/\/[^)]+\)\s*$/gm, "");
    if (fixedContent !== beforeImages) {
      violations.push({
        rule: "inline_images",
        severity: "warning",
        message:
          "检测到内联 Markdown 图片引用（AI 生成 URL 通常 404），已自动移除",
      });
      wasAutoFixed = true;
    }

    // 4.92 ★ 数量声明与列表项不一致检测 → 触发 AI 重写
    {
      const numMap: Record<string, number> = {
        两: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        七: 7,
        八: 8,
        九: 9,
        十: 10,
      };
      const contentLines = fixedContent.split("\n");
      for (let i = 0; i < contentLines.length; i++) {
        const m = contentLines[i].match(
          /(?:有|出|为|含|分为|呈现|体现出?|包括|涵盖)\s*([两三四五六七八九十])\s*(?:个|项|点|条|类|层|种|方面|维度|阶段|特[点征]|原因|改[进善]|趋势|挑战|优势)/,
        );
        if (!m) continue;
        const declared = numMap[m[1]] || 0;
        if (declared === 0) continue;
        let listItems = 0;
        for (let j = i + 1; j < contentLines.length && j < i + 30; j++) {
          const lt = contentLines[j].trim();
          if (
            /^[-*•]\s/.test(lt) ||
            /^\d+[.)]\s/.test(lt) ||
            /^其[一二三四五六七八九十]/.test(lt)
          ) {
            listItems++;
          } else if (lt === "") {
            continue;
          } else if (listItems > 0) {
            break;
          }
        }
        if (listItems > 0 && listItems !== declared) {
          violations.push({
            rule: "number_claim_mismatch",
            severity: "warning",
            message: `声明"${m[0]}"但实际列出 ${listItems} 条，内容维度可能不一致`,
          });
          rewriteGuidance.push(
            `逻辑一致性问题：文中声明"${m[0]}"但后续列出了 ${listItems} 个条目。` +
              `问题不只是数字不匹配 — 多出的条目可能与声明的主题（如"改进"）不在同一维度。` +
              `请重写该段落：要么调整声明与列表严格对应，要么将不同维度的内容拆分为独立段落，不要混在同一个列表中。`,
          );
        }
      }
    }

    // 4.93 ★ 引用堆积自动拆分（单句 3+ 引用 → 保留前 2 个）
    const beforeCitationFix = fixedContent;
    fixedContent = fixedContent.replace(
      /(\[\d+\]\s*\[\d+\])(\s*\[\d+\])+/g,
      "$1",
    );
    if (fixedContent !== beforeCitationFix) {
      violations.push({
        rule: "citation_stacking",
        severity: "warning",
        message: "检测到引用堆积（单句 3+ 引用），已保留前 2 个",
      });
      wasAutoFixed = true;
    }

    // 4.94 ★ 裸 keyPoints 自动删除（标题后紧跟 3+ bullets → 直接移除）
    {
      const cLines = fixedContent.split("\n");
      const cleanedLines: string[] = [];
      let i = 0;
      let stripped = false;
      while (i < cLines.length) {
        if (/^### /.test(cLines[i].trim())) {
          // 检查后续是否是裸 bullet list
          let bulletStart = -1;
          let bulletEnd = -1;
          let bullets = 0;
          for (let j = i + 1; j < cLines.length && j < i + 12; j++) {
            const t = cLines[j].trim();
            if (t === "") continue;
            if (/^[-*•]\s/.test(t)) {
              if (bulletStart === -1) bulletStart = j;
              bulletEnd = j;
              bullets++;
            } else break;
          }
          if (bullets >= 3 && bulletStart > -1) {
            // 保留标题，跳过 bullet list
            cleanedLines.push(cLines[i]);
            i = bulletEnd + 1;
            stripped = true;
            continue;
          }
        }
        cleanedLines.push(cLines[i]);
        i++;
      }
      if (stripped) {
        fixedContent = cleanedLines.join("\n");
        violations.push({
          rule: "bare_keypoints",
          severity: "warning",
          message: "检测到标题后直接列出的裸要点列表，已自动删除",
        });
        wasAutoFixed = true;
      }
    }

    // 4.945 ★ 结论性语句混入 bullet list → 触发 rewrite
    {
      const cLines2 = fixedContent.split("\n");
      for (const line of cLines2) {
        if (
          /^[-*•]\s*(?:据此|由此|因此|综上|总之|整体来看|总体而言|可以[看认判]为)/.test(
            line.trim(),
          )
        ) {
          rewriteGuidance.push(
            `逻辑层次混乱：bullet list 中出现了结论性语句（"${line.trim().substring(2, 30)}..."）。` +
              `列表中每条应在同一逻辑维度，结论应独立成段落。`,
          );
          break;
        }
      }
    }

    // 4.95 ★ H3 子节数量上限检查（防止粒度过细）
    const h3Count = (fixedContent.match(/^### /gm) || []).length;
    if (h3Count > 10) {
      violations.push({
        rule: "h3_count_exceeded",
        severity: "warning",
        message: `### 子节数量 ${h3Count} 超过上限 10，粒度过细，请合并相关主题`,
        currentValue: h3Count,
        threshold: 10,
      });
      rewriteGuidance.push(
        `子节过多：当前 ${h3Count} 个 ### 子节，严格上限为 10 个。` +
          `请将相关主题合并到同一个 ### 子节下，用段落分隔而非创建新子节。每个维度 6-8 个 ### 子节为宜。`,
      );
    }

    // ========== 检测但不自动修复的规则（需要 AI 重写） ==========

    // 4.96 ★ 营销话术检测 + 自动清理
    const marketingPatterns = [
      /将?(?:势必|必将|注定|必然)(?:引发|带来|改写|颠覆|重塑)/g,
      /(?:不可忽视|不容忽视|值得高度关注)的(?:机遇|趋势|方向|变革)/g,
      /(?:关键|核心|重要)(?:投资|布局|战略)(?:方向|机会|窗口)/g,
      /(?:将|势必)(?:改写|颠覆|重塑)(?:行业|产业|市场)格局/g,
    ];
    const beforeMarketing = fixedContent;
    for (const pattern of marketingPatterns) {
      fixedContent = fixedContent.replace(pattern, (matched) => {
        // 替换为中性表述
        return matched
          .replace(/势必|必将|注定|必然/, "可能")
          .replace(/不可忽视|不容忽视|值得高度关注/, "值得关注")
          .replace(/改写|颠覆|重塑/, "影响");
      });
    }
    if (fixedContent !== beforeMarketing) {
      violations.push({
        rule: "marketing_language",
        severity: "warning",
        message: "检测到营销/咨询话术，已替换为中性研究语气",
      });
      wasAutoFixed = true;
    }

    // 5. 语言一致性检查
    const langCheck = detectForeignLanguageBlocks(fixedContent, targetLanguage);
    if (!langCheck.passed) {
      const pct = (langCheck.foreignRatio * 100).toFixed(1);
      violations.push({
        rule: "language_consistency",
        severity: "warning",
        message: `外语内容占比 ${pct}% 超过 5% 阈值，检测到 ${langCheck.blocks.length} 个外语段落`,
        currentValue: langCheck.foreignRatio,
        threshold: 0.05,
      });
      rewriteGuidance.push(
        `语言一致性不合格：报告目标语言为 ${targetLanguage === "zh" ? "中文" : "English"}，` +
          `但检测到 ${langCheck.blocks.length} 个外语段落（占比 ${pct}%）。` +
          `请将所有外语段落翻译为目标语言，专有名词首次出现时可标注原文。`,
      );
    }

    // 6. 内容长度检查
    const charCount = fixedContent.replace(/\s/g, "").length;
    if (charCount < 800) {
      violations.push({
        rule: "min_content_length",
        severity: "error",
        message: `内容长度 ${charCount} 字符不足最低要求 800 字符`,
        currentValue: charCount,
        threshold: 800,
      });
      rewriteGuidance.push(
        `内容过短：当前仅 ${charCount} 字符，需要至少 800 字符的深度分析。请增加更多证据支持的分析内容。`,
      );
    }

    // 6.5 ★ v4.3: 空小节检查 — 检测有标题但没有实际内容的小节
    const sections = fixedContent.split(/^(#{2,4}\s+.+)$/gm);
    for (let i = 1; i < sections.length; i += 2) {
      const heading = sections[i]?.trim();
      const body = sections[i + 1] || "";
      const bodyText = body.replace(/\s/g, "");
      if (heading && bodyText.length < 50) {
        violations.push({
          rule: "empty_section",
          severity: "error",
          message: `小节 "${heading.replace(/^#+\s*/, "")}" 内容为空或过短（${bodyText.length} 字符），需要补充`,
          currentValue: bodyText.length,
          threshold: 50,
        });
        rewriteGuidance.push(
          `空小节：「${heading.replace(/^#+\s*/, "")}」仅有 ${bodyText.length} 字符，请补充至少 50 字符的实质内容。`,
        );
      }
    }

    // 7. 引用覆盖检查
    const citations = fixedContent.match(/\[\d+\](?![:(\[])/g) || [];
    const uniqueCitations = new Set(citations.map((c) => c));
    if (uniqueCitations.size < 3) {
      violations.push({
        rule: "citation_coverage",
        severity: "warning",
        message: `仅引用了 ${uniqueCitations.size} 个不同来源，建议至少引用 3 个`,
        currentValue: uniqueCitations.size,
        threshold: 3,
      });
      rewriteGuidance.push(
        `引用不足：当前仅引用了 ${uniqueCitations.size} 个来源，至少需要 3 个不同来源。请确保每个关键观点都有证据引用 [n]，广泛引用不同来源。`,
      );
    }

    // 8. "我们认为" 类主观表达过多
    // ★ Use pre-computed count (before stripLLMMetaNotes auto-removed them)
    // This ensures detection still works even though the expressions are auto-cleaned
    const subjectiveCount = preFixSubjectiveCount;
    if (subjectiveCount > 3) {
      violations.push({
        rule: "subjective_expression",
        severity: "warning",
        message: `主观表达 ${subjectiveCount} 次超过阈值 3 次/维度`,
        currentValue: subjectiveCount,
        threshold: 3,
      });
      rewriteGuidance.push(
        `主观表达过多：检测到 ${subjectiveCount} 处"我们认为/判断/预测"等第一人称表达，超过 3 次/维度阈值。` +
          `请改用客观表述，如"研究表明"、"数据显示"、"分析结果指出"。`,
      );
    }

    // 9. 引用集中度检查（单个引用出现 >5 次 warning，>8 次 warning）
    // NOTE: 降级为 warning 而非 error，因为引用集中度取决于证据池丰富程度，
    // AI 重写无法改变证据池，error 级别会导致无限重写循环。
    const citationCounts = new Map<string, number>();
    for (const c of citations) {
      citationCounts.set(c, (citationCounts.get(c) ?? 0) + 1);
    }
    for (const [cite, count] of citationCounts) {
      if (count > 8) {
        violations.push({
          rule: "citation_concentration",
          severity: "warning",
          message: `引用 ${cite} 在维度内出现 ${count} 次，超过阈值 8 次，建议分散引用来源`,
          currentValue: count,
          threshold: 8,
        });
        rewriteGuidance.push(
          `引用集中：${cite} 在维度内出现 ${count} 次，严重超过建议阈值 5 次。` +
            `请分散引用来源，尝试寻找同类观点的其他来源，或减少对该来源的重复引用。`,
        );
      } else if (count > 5) {
        violations.push({
          rule: "citation_concentration",
          severity: "warning",
          message: `引用 ${cite} 在维度内出现 ${count} 次，超过建议阈值 5 次，建议分散引用来源`,
          currentValue: count,
          threshold: 5,
        });
        rewriteGuidance.push(
          `引用集中：${cite} 在维度内出现 ${count} 次，请分散引用来源。` +
            `尝试寻找同类观点的其他来源，或减少对该来源的重复引用。`,
        );
      }
    }

    // 9.5 ★ v4.3: 来源多样性 — 维度内引用来源过少
    // NOTE: 仅记录 warning，不加入 rewriteGuidance（AI 无法改变证据池）
    if (uniqueCitations.size >= 3) {
      const topCiteCount = Math.max(...citationCounts.values(), 0);
      const topCiteRatio = topCiteCount / citations.length;
      if (topCiteRatio > 0.4) {
        violations.push({
          rule: "source_diversity",
          severity: "warning",
          message: `最高频引用占全部引用的 ${(topCiteRatio * 100).toFixed(0)}%，超过 40% 阈值，来源多样性不足`,
          currentValue: topCiteRatio,
          threshold: 0.4,
        });
      }
    }

    // ========== 类型感知检查（soft warning） ==========

    if (topicType) {
      const typeWarnings = this.validateTypeSpecificContent(
        fixedContent,
        topicType,
      );
      if (typeWarnings.length > 0) {
        violations.push(...typeWarnings);
        rewriteGuidance.push(...typeWarnings.map((w) => w.message));
      }
    }

    // ========== 汇总 ==========

    // 当有需要 AI 重写的问题时，附加质量自检清单作为重写指引
    if (rewriteGuidance.length > 0) {
      rewriteGuidance.push(getQualityChecklist(targetLanguage));
    }

    const hasErrors = violations.some((v) => v.severity === "error");
    const passed = !hasErrors;

    if (violations.length > 0) {
      this.logger.log(
        `[QualityGate] ${violations.length} violations (${hasErrors ? "FAILED" : "PASSED with warnings"}): ${violations.map((v) => v.rule).join(", ")}`,
      );
    }

    return {
      passed,
      violations,
      fixedContent,
      wasAutoFixed,
      rewriteGuidance,
    };
  }

  /**
   * 对完整报告执行质量门控检查
   */
  validateFullReport(
    content: string,
    targetLanguage: string = "zh",
  ): QualityCheckResult {
    const violations: QualityViolation[] = [];
    const rewriteGuidance: string[] = [];
    let fixedContent = content ?? "";
    let wasAutoFixed = false;

    // 1. 分割线移除
    const hrCount = (fixedContent.match(/^\s*[-*]{3,}\s*$/gm) || []).length;
    if (hrCount > 0) {
      fixedContent = removeHorizontalRules(fixedContent);
      wasAutoFixed = true;
      violations.push({
        rule: "horizontal_rules",
        severity: "warning",
        message: `移除了 ${hrCount} 条分割线`,
      });
    }

    // 2. 全文加粗密度（仅记录，不强制限制 — 用户指示放宽）
    const boldCount = (fixedContent.match(/\*\*[^*]+\*\*/g) || []).length;
    if (boldCount > 60) {
      violations.push({
        rule: "bold_density_report",
        severity: "warning",
        message: `全文加粗 ${boldCount} 处超过建议阈值 60（已放宽，不强制）`,
        currentValue: boldCount,
        threshold: 60,
      });
    }

    // 3. 全文引用块密度（规范：全文最多 8 个，不含章节要点）
    const blockquoteCount = (fixedContent.match(/^>\s*.+$/gm) || []).length;
    if (blockquoteCount > 8) {
      violations.push({
        rule: "blockquote_density_report",
        severity: "warning",
        message: `全文引用块 ${blockquoteCount} 个超过阈值 8`,
        currentValue: blockquoteCount,
        threshold: 8,
      });
      fixedContent = limitBlockquotes(fixedContent, 8);
      wasAutoFixed = true;
    }

    // 4. 语言一致性
    const langCheck = detectForeignLanguageBlocks(fixedContent, targetLanguage);
    if (!langCheck.passed) {
      const pct = (langCheck.foreignRatio * 100).toFixed(1);
      violations.push({
        rule: "language_consistency",
        severity: "warning",
        message: `外语内容占比 ${pct}%，检测到 ${langCheck.blocks.length} 个外语段落`,
      });
    }

    // 5. 主观表达
    const subjectivePatterns =
      targetLanguage === "zh" ||
      targetLanguage === "zh-CN" ||
      targetLanguage === "zh-TW"
        ? /我们(认为|判断|看到|发现|相信|预测|观察到|注意到)/g
        : /\b(we believe|we think|we find|we observe|we predict|in our view|in our opinion)\b/gi;
    const subjectiveCount = (fixedContent.match(subjectivePatterns) || [])
      .length;
    if (subjectiveCount > 10) {
      violations.push({
        rule: "subjective_expression_report",
        severity: "warning",
        message: `全文主观表达 ${subjectiveCount} 次超过阈值 10`,
        currentValue: subjectiveCount,
        threshold: 10,
      });
    }

    // 6. 引用孤儿检查：正文中引用了但参考文献区没有对应条目
    // 参考文献区通常以 "## 参考文献" / "## References" / "## 参考资料" 开头
    const refSectionMatch = fixedContent.match(
      /^#{1,3}\s*(?:参考文献|参考资料|References|Bibliography)\s*$/im,
    );
    const bodyText = refSectionMatch
      ? fixedContent.substring(0, fixedContent.indexOf(refSectionMatch[0]))
      : fixedContent;
    const refText = refSectionMatch
      ? fixedContent.substring(fixedContent.indexOf(refSectionMatch[0]))
      : "";

    // Citation markers in body: [N] not followed by : or [ (exclude reference entries)
    const bodyCitations =
      bodyText
        .match(/\[(\d+)\](?![\s]*[:(\[])/g)
        ?.map((m) => m.match(/\d+/)?.[0] ?? "") ?? [];
    const bodyCitationSet = new Set(bodyCitations.filter(Boolean));

    // Reference entries: lines starting with [N] followed by title text
    const refEntries =
      refText
        .match(/^\[(\d+)\]\s+\S/gm)
        ?.map((m) => m.match(/\d+/)?.[0] ?? "") ?? [];
    const refEntrySet = new Set(refEntries.filter(Boolean));

    const orphanCitations = [...bodyCitationSet].filter(
      (n) => !refEntrySet.has(n),
    );
    if (orphanCitations.length > 0) {
      violations.push({
        rule: "citation_orphans",
        severity: "warning",
        message: `正文引用 [${orphanCitations.join("], [")}] 在参考文献区无对应条目`,
        currentValue: orphanCitations.length,
        threshold: 0,
      });
    }

    // 7. 低权威来源占比检查（#19）
    // Citation numbers in body → count how many unique sources exist
    // We cannot access DB credibility scores here, but we can warn when
    // the reference section contains too few entries relative to citations used.
    // This is a proxy for source diversity.
    if (bodyCitationSet.size > 0 && refEntrySet.size > 0) {
      const coverageRatio = refEntrySet.size / bodyCitationSet.size;
      if (coverageRatio < 0.5) {
        violations.push({
          rule: "low_source_diversity",
          severity: "warning",
          message: `正文引用了 ${bodyCitationSet.size} 个编号，但参考文献仅 ${refEntrySet.size} 条，来源多样性不足`,
          currentValue: refEntrySet.size,
          threshold: bodyCitationSet.size,
        });
      }
    }

    // 8. 单源声明检测（#49）
    // Detect bold claims (bold text) that cite only a single source
    const singleSourceClaims: string[] = [];
    const boldClaimPattern = /\*\*([^*]{15,})\*\*\s*\[(\d+)\](?!\s*\[)/g;
    let claimMatch: RegExpExecArray | null;
    while ((claimMatch = boldClaimPattern.exec(bodyText)) !== null) {
      singleSourceClaims.push(claimMatch[1].substring(0, 60));
    }
    if (singleSourceClaims.length > 5) {
      violations.push({
        rule: "single_source_claims",
        severity: "warning",
        message: `检测到 ${singleSourceClaims.length} 个重要论断仅引用单一来源，建议多源交叉验证`,
        currentValue: singleSourceClaims.length,
        threshold: 5,
      });
    }

    // 9. 引用集中度检查：单个引用在正文某节出现 >8 次
    const fullCitations = fixedContent.match(/\[(\d+)\](?![\s]*[:(\[])/g) ?? [];
    const fullCitationCounts = new Map<string, number>();
    for (const c of fullCitations) {
      const n = c.match(/\d+/)?.[0] ?? "";
      if (n) fullCitationCounts.set(n, (fullCitationCounts.get(n) ?? 0) + 1);
    }
    // Check per-section concentration by splitting on ## headings
    const reportSections = fixedContent.split(/^#{2,3}\s+/m);
    for (const sec of reportSections) {
      const secCitations = sec.match(/\[(\d+)\](?![\s]*[:(\[])/g) ?? [];
      const secCounts = new Map<string, number>();
      for (const c of secCitations) {
        const n = c.match(/\d+/)?.[0] ?? "";
        if (n) secCounts.set(n, (secCounts.get(n) ?? 0) + 1);
      }
      for (const [cite, count] of secCounts) {
        if (count > 8) {
          violations.push({
            rule: "citation_concentration",
            severity: "warning",
            message: `引用 [${cite}] 在某节内出现 ${count} 次，超过阈值 8 次，建议分散引用来源`,
            currentValue: count,
            threshold: 8,
          });
          break; // one violation per section is enough
        }
      }
    }

    const hasErrors = violations.some((v) => v.severity === "error");

    return {
      passed: !hasErrors,
      violations,
      fixedContent,
      wasAutoFixed,
      rewriteGuidance,
    };
  }

  /**
   * 类型感知的质量检查（soft warning，不阻塞）
   * 检查内容是否体现了该类型应有的分析深度特征
   */
  private validateTypeSpecificContent(
    content: string,
    topicType: string,
  ): QualityViolation[] {
    const warnings: QualityViolation[] = [];

    switch (topicType) {
      case "COMPANY":
        // 企业分析应有竞争对比表格
        if ((content.match(/\|/g) || []).length < 10) {
          warnings.push({
            rule: "type_specific",
            severity: "warning",
            message: "企业分析建议包含竞争对比表格（Porter 五力或 SWOT 矩阵）",
          });
        }
        break;

      case "TECHNOLOGY":
        // 技术分析应有成熟度/采用阶段定位
        if (
          !/成熟度|hype.?cycle|TRL|adoption|采用曲线|技术就绪/i.test(content)
        ) {
          warnings.push({
            rule: "type_specific",
            severity: "warning",
            message: "技术分析建议包含技术成熟度或采用阶段定位",
          });
        }
        break;

      case "MACRO":
        // 宏观分析应有跨国/跨行业对比
        if (!/对比|对标|compared|benchmark|vs\b/i.test(content)) {
          warnings.push({
            rule: "type_specific",
            severity: "warning",
            message: "宏观分析建议包含跨国或跨行业对比视角",
          });
        }
        break;

      case "EVENT": {
        // 事件分析应有因果分层
        if (
          !/远因|近因|导火索|structural.?cause|proximate.?cause|trigger/i.test(
            content,
          )
        ) {
          warnings.push({
            rule: "type_specific",
            severity: "warning",
            message: "事件分析建议包含三层因果分析（远因/近因/导火索）",
          });
        }
        // ★ 事件分析应有对比表格
        const eventTableRows = (content.match(/^\s*\|.+\|.+\|/gm) || []).length;
        if (eventTableRows === 0) {
          warnings.push({
            rule: "type_specific",
            severity: "warning" as const,
            message:
              "事件分析建议包含对比表格（时间线、参与方角色、结果对比等）",
          });
        }
        break;
      }
    }

    return warnings;
  }

  /**
   * 公式/LaTeX 完整性检查 + 自动修复
   *
   * 检查项：
   * 1. 拆分公式自动合并：$A$ $\in$ $B$ → $A \in B$
   * 2. 不平衡的 $ 定界符检测
   * 3. 缺参数的 LaTeX 命令检测（\frac 需要 2 个参数）
   */
  private validateAndFixLatex(content: string): {
    fixedContent: string;
    violations: QualityViolation[];
    rewriteGuidance: string[];
  } {
    const violations: QualityViolation[] = [];
    const rewriteGuidance: string[] = [];
    let fixed = content;

    // 1. 自动合并拆分公式：$A$ $\in$ $B$ → $A \in B$
    // Pattern: $...$<whitespace>$...$  (adjacent math spans)
    const beforeMerge = fixed;
    fixed = fixed.replace(
      /\$([^$]+)\$(\s+)\$([^$]+)\$/g,
      (_match, a: string, _ws: string, b: string) => `$${a} ${b}$`,
    );
    // Run twice to catch chains of 3+ fragments: $A$ $\in$ $B$
    fixed = fixed.replace(
      /\$([^$]+)\$(\s+)\$([^$]+)\$/g,
      (_match, a: string, _ws: string, b: string) => `$${a} ${b}$`,
    );
    if (fixed !== beforeMerge) {
      violations.push({
        rule: "latex_split_expressions",
        severity: "warning",
        message: `检测到拆分公式（$A$ $\\in$ $B$ 格式），已自动合并`,
      });
    }

    // 2. 不平衡 $ 定界符检测（逐行，排除 $$ 和代码块）
    let inCodeBlock = false;
    let unbalancedCount = 0;
    for (const line of fixed.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;
      if (trimmed.startsWith("$$") || trimmed.endsWith("$$")) continue;

      // Remove $$ pairs, then count remaining $
      const withoutDisplay = line.replace(/\$\$/g, "");
      const dollarCount = (withoutDisplay.match(/\$/g) || []).length;
      if (dollarCount % 2 !== 0) {
        unbalancedCount++;
      }
    }
    if (unbalancedCount > 0) {
      violations.push({
        rule: "latex_unbalanced_delimiters",
        severity: "warning",
        message: `检测到 ${unbalancedCount} 行含有不平衡的 $ 定界符，公式可能渲染异常`,
        currentValue: unbalancedCount,
        threshold: 0,
      });
      if (unbalancedCount > 3) {
        rewriteGuidance.push(
          `公式定界符不平衡：${unbalancedCount} 行的 $ 符号未配对。` +
            `请确保每个数学表达式的 $...$ 成对出现，一个完整表达式放在同一对 $ 中。`,
        );
      }
    }

    // 3. 缺参数的 LaTeX 命令检测
    // \frac 需要 2 个 {...}，\sqrt 需要至少 1 个 {...}
    const fracMissing = (fixed.match(/\\frac\s*\{[^}]*\}(?!\s*\{)/g) || [])
      .length;
    const sqrtMissing = (fixed.match(/\\sqrt(?!\s*[\[{])/g) || []).length;
    if (fracMissing > 0 || sqrtMissing > 0) {
      const details: string[] = [];
      if (fracMissing > 0)
        details.push(`\\frac 缺少第二参数 ${fracMissing} 处`);
      if (sqrtMissing > 0) details.push(`\\sqrt 缺少参数 ${sqrtMissing} 处`);
      violations.push({
        rule: "latex_incomplete_commands",
        severity: "warning",
        message: `检测到不完整的 LaTeX 命令：${details.join("、")}`,
        currentValue: fracMissing + sqrtMissing,
        threshold: 0,
      });
      rewriteGuidance.push(
        `LaTeX 命令不完整：${details.join("、")}。` +
          `\\frac 需要两个参数 \\frac{分子}{分母}，\\sqrt 需要参数 \\sqrt{表达式}。`,
      );
    }

    return { fixedContent: fixed, violations, rewriteGuidance };
  }
}
