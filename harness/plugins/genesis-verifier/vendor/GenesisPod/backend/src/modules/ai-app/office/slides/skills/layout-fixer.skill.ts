/**
 * Slides Engine v5.0 - Layout Fixer Skill
 *
 * 布局修复技能：自动检测并修复幻灯片 HTML 中的布局问题
 * - 检测内容溢出 (overflow)
 * - 检测元素重叠 (overlap)
 * - 检测对齐问题 (alignment)
 * - 检测间距不一致 (spacing)
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
  ChatMessage,
} from "@/modules/ai-harness/facade";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

// ============================================================================
// Types
// ============================================================================

/**
 * 布局问题类型
 */
export type LayoutIssueType = "overflow" | "overlap" | "alignment" | "spacing";

/**
 * 问题严重程度
 */
export type IssueSeverity = "critical" | "warning" | "info";

/**
 * 布局问题
 */
export interface LayoutIssue {
  /** 问题类型 */
  type: LayoutIssueType;
  /** 严重程度 */
  severity: IssueSeverity;
  /** 问题元素选择器或描述 */
  element: string;
  /** 问题描述 */
  description: string;
  /** 修复建议 */
  suggestion: string;
}

/**
 * 布局修复
 */
export interface LayoutFix {
  /** 问题索引 */
  issueIndex: number;
  /** 修复类型 */
  fixType: "css" | "structure" | "content";
  /** 修复描述 */
  description: string;
  /** 原始值 */
  originalValue?: string;
  /** 修复后的值 */
  fixedValue?: string;
  /** CSS 属性修改 */
  cssChanges?: Record<string, string>;
}

/**
 * 输入参数
 */
export interface LayoutFixerInput {
  /** 需要分析的 HTML */
  html: string;
  /** 页面索引 (可选) */
  pageIndex?: number;
  /** 幻灯片容器尺寸 */
  containerSize?: {
    width: number;
    height: number;
  };
}

/**
 * 输出结果
 */
export interface LayoutFixerResult {
  /** 原始 HTML */
  originalHtml: string;
  /** 修复后的 HTML */
  fixedHtml: string;
  /** 检测到的问题列表 */
  issues: LayoutIssue[];
  /** 应用的修复列表 */
  fixes: LayoutFix[];
  /** 页面索引 */
  pageIndex?: number;
  /** 修复统计 */
  stats: {
    totalIssues: number;
    fixedIssues: number;
    criticalIssues: number;
  };
}

// ============================================================================
// Layout Fixer Skill
// ============================================================================

@Injectable()
export class LayoutFixerSkill implements ISkill<
  LayoutFixerInput,
  LayoutFixerResult
> {
  private readonly logger = new Logger(LayoutFixerSkill.name);

  // ============================================================================
  // ISkill Implementation - Required Properties
  // ============================================================================

  readonly id = "slides-layout-fixer";
  readonly name = "布局修复";
  readonly description = "自动检测并修复幻灯片布局问题";
  readonly layer: SkillLayer = SKILL_LAYERS.OPTIMIZATION;
  readonly domain = "slides";
  readonly tags = ["slides", "layout", "fix", "html", "css"];
  readonly version = "5.0.0";

  constructor(@Optional() private readonly chatFacade: ChatFacade) {}

  // ============================================================================
  // ISkill Methods
  // ============================================================================

  /**
   * 执行布局修复
   */
  async execute(
    input: LayoutFixerInput,
    context: SkillContext,
  ): Promise<SkillResult<LayoutFixerResult>> {
    const startTime = new Date();

    if (!input.html || input.html.trim().length === 0) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "HTML content is required",
          retryable: false,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }

    try {
      this.logger.debug(
        `[execute] Starting layout fix analysis (executionId: ${context.executionId})`,
      );

      // 1. 分析布局问题
      const issues = this.analyzeLayoutIssues(input.html);
      this.logger.debug(`[execute] Found ${issues.length} layout issues`);

      // 2. 如果有问题，使用 AI 生成修复方案
      let fixes: LayoutFix[] = [];
      let fixedHtml = input.html;

      if (issues.length > 0) {
        fixes = await this.generateFixes(input.html, issues);
        this.logger.debug(`[execute] Generated ${fixes.length} fixes`);

        // 3. 应用修复
        fixedHtml = this.applyFixes(input.html, fixes);
      }

      const result: LayoutFixerResult = {
        originalHtml: input.html,
        fixedHtml,
        issues,
        fixes,
        pageIndex: input.pageIndex,
        stats: {
          totalIssues: issues.length,
          fixedIssues: fixes.length,
          criticalIssues: issues.filter((i) => i.severity === "critical")
            .length,
        },
      };

      const endTime = new Date();

      return {
        success: true,
        data: result,
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    } catch (error) {
      const endTime = new Date();
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      this.logger.error(`[execute] Layout fix failed: ${errorMessage}`);

      return {
        success: false,
        error: {
          code: "LAYOUT_FIX_FAILED",
          message: errorMessage,
          retryable: true,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    }
  }

  // ============================================================================
  // Private Methods - Issue Detection
  // ============================================================================

  /**
   * 分析 HTML 中的布局问题
   */
  private analyzeLayoutIssues(html: string): LayoutIssue[] {
    const issues: LayoutIssue[] = [];

    // 检测内容溢出问题
    issues.push(...this.detectOverflowIssues(html));

    // 检测对齐问题
    issues.push(...this.detectAlignmentIssues(html));

    // 检测间距问题
    issues.push(...this.detectSpacingIssues(html));

    // 检测重叠问题
    issues.push(...this.detectOverlapIssues(html));

    return issues;
  }

  /**
   * 检测内容溢出问题
   */
  private detectOverflowIssues(html: string): LayoutIssue[] {
    const issues: LayoutIssue[] = [];

    // 检测可能导致溢出的长文本
    const longTextPattern =
      /<(?:p|div|span)[^>]*>([^<]{300,})<\/(?:p|div|span)>/gi;
    let match;
    while ((match = longTextPattern.exec(html)) !== null) {
      issues.push({
        type: "overflow",
        severity: "warning",
        element: `Long text block (${match[1].length} chars)`,
        description: "文本内容过长，可能导致溢出",
        suggestion: "考虑截断文本或使用更小的字体",
      });
    }

    // 检测没有 overflow 控制的容器
    if (!html.includes("overflow:") && !html.includes("overflow-")) {
      if (
        html.includes("position: absolute") ||
        html.includes("position:absolute")
      ) {
        issues.push({
          type: "overflow",
          severity: "info",
          element: "Container with absolute positioning",
          description: "使用绝对定位但没有溢出控制",
          suggestion: "添加 overflow: hidden 防止内容溢出",
        });
      }
    }

    // 检测固定宽度容器内的长内容
    const fixedWidthPattern = /width:\s*(\d+)px/gi;
    while ((match = fixedWidthPattern.exec(html)) !== null) {
      const width = parseInt(match[1], 10);
      if (width < 200) {
        issues.push({
          type: "overflow",
          severity: "info",
          element: `Fixed width container (${width}px)`,
          description: "固定宽度容器可能导致文本溢出",
          suggestion: "使用 text-overflow: ellipsis 或增加容器宽度",
        });
      }
    }

    return issues;
  }

  /**
   * 检测对齐问题
   */
  private detectAlignmentIssues(html: string): LayoutIssue[] {
    const issues: LayoutIssue[] = [];

    // 检测混合对齐方式
    const alignments = new Set<string>();
    const alignPattern = /text-align:\s*(left|center|right|justify)/gi;
    let match;
    while ((match = alignPattern.exec(html)) !== null) {
      alignments.add(match[1].toLowerCase());
    }

    if (alignments.size > 2) {
      issues.push({
        type: "alignment",
        severity: "warning",
        element: "Multiple alignment styles",
        description: `检测到 ${alignments.size} 种不同的对齐方式`,
        suggestion: "统一对齐方式以提升视觉一致性",
      });
    }

    // 检测 flexbox 对齐问题
    if (html.includes("display: flex") || html.includes("display:flex")) {
      if (!html.includes("align-items") && !html.includes("justify-content")) {
        issues.push({
          type: "alignment",
          severity: "info",
          element: "Flexbox container",
          description: "Flex 容器没有明确的对齐设置",
          suggestion: "添加 align-items 和 justify-content 属性",
        });
      }
    }

    return issues;
  }

  /**
   * 检测间距问题
   */
  private detectSpacingIssues(html: string): LayoutIssue[] {
    const issues: LayoutIssue[] = [];

    // 检测间距不一致
    const marginPattern = /margin(?:-(?:top|right|bottom|left))?:\s*(\d+)px/gi;
    const paddingPattern =
      /padding(?:-(?:top|right|bottom|left))?:\s*(\d+)px/gi;

    const margins = new Set<number>();
    const paddings = new Set<number>();

    let match;
    while ((match = marginPattern.exec(html)) !== null) {
      margins.add(parseInt(match[1], 10));
    }
    while ((match = paddingPattern.exec(html)) !== null) {
      paddings.add(parseInt(match[1], 10));
    }

    // 如果有太多不同的间距值，可能不一致
    if (margins.size > 5) {
      issues.push({
        type: "spacing",
        severity: "warning",
        element: "Margin values",
        description: `检测到 ${margins.size} 种不同的 margin 值`,
        suggestion: "使用一致的间距系统（如 8px 基准）",
      });
    }

    if (paddings.size > 5) {
      issues.push({
        type: "spacing",
        severity: "warning",
        element: "Padding values",
        description: `检测到 ${paddings.size} 种不同的 padding 值`,
        suggestion: "使用一致的间距系统（如 8px 基准）",
      });
    }

    // 检测零间距的元素
    const zeroSpacingPattern = /(margin|padding):\s*0[^px]/gi;
    if (zeroSpacingPattern.test(html)) {
      issues.push({
        type: "spacing",
        severity: "info",
        element: "Zero spacing elements",
        description: "存在零间距的元素",
        suggestion: "考虑添加适当的间距提升可读性",
      });
    }

    return issues;
  }

  /**
   * 检测重叠问题
   */
  private detectOverlapIssues(html: string): LayoutIssue[] {
    const issues: LayoutIssue[] = [];

    // 检测多个绝对定位元素可能重叠
    const absolutePattern = /position:\s*absolute/gi;
    const absoluteCount = (html.match(absolutePattern) || []).length;

    if (absoluteCount > 3) {
      issues.push({
        type: "overlap",
        severity: "warning",
        element: `${absoluteCount} absolute positioned elements`,
        description: "多个绝对定位元素可能导致重叠",
        suggestion: "检查 z-index 层级和定位坐标",
      });
    }

    // 检测负 margin 可能导致的重叠
    const negativeMarginPattern =
      /margin(?:-(?:top|right|bottom|left))?:\s*-\d+px/gi;
    if (negativeMarginPattern.test(html)) {
      issues.push({
        type: "overlap",
        severity: "info",
        element: "Negative margin",
        description: "使用负 margin 可能导致元素重叠",
        suggestion: "确认重叠是否符合设计预期",
      });
    }

    return issues;
  }

  // ============================================================================
  // Private Methods - Fix Generation
  // ============================================================================

  /**
   * 使用 AI 生成修复方案
   */
  private async generateFixes(
    html: string,
    issues: LayoutIssue[],
  ): Promise<LayoutFix[]> {
    if (issues.length === 0) {
      return [];
    }

    // 只处理 critical 和 warning 级别的问题
    const significantIssues = issues.filter(
      (i) => i.severity === "critical" || i.severity === "warning",
    );

    if (significantIssues.length === 0) {
      return [];
    }

    const prompt = `你是一个专业的前端布局专家。分析以下 HTML 中的布局问题并提供具体的 CSS 修复方案。

## 检测到的问题
${significantIssues.map((issue, index) => `${index + 1}. [${issue.severity}] ${issue.type}: ${issue.description} - ${issue.suggestion}`).join("\n")}

## HTML 内容
\`\`\`html
${html.substring(0, 2000)}${html.length > 2000 ? "... (truncated)" : ""}
\`\`\`

## 要求
针对每个问题，提供具体的 CSS 修复。返回 JSON 数组格式：

\`\`\`json
[
  {
    "issueIndex": 0,
    "fixType": "css",
    "description": "修复描述",
    "cssChanges": {
      "property": "value"
    }
  }
]
\`\`\`

只返回 JSON 数组，不要其他内容。`;

    try {
      if (!this.chatFacade) {
        this.logger.warn(
          "[generateFixes] AIFacade not available, using rule-based fixes",
        );
        return this.generateRuleBasedFixes(issues);
      }

      const messages: ChatMessage[] = [{ role: "user", content: prompt }];
      const response = await this.chatFacade.chat({
        messages,
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "deterministic", outputLength: "short" },
      });

      // 解析 AI 响应
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const fixes = JSON.parse(jsonMatch[0]) as LayoutFix[];
        return fixes;
      }

      return [];
    } catch (error) {
      this.logger.warn(
        `[generateFixes] AI fix generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      // 回退到基于规则的修复
      return this.generateRuleBasedFixes(issues);
    }
  }

  /**
   * 基于规则生成修复方案（AI 失败时的回退）
   */
  private generateRuleBasedFixes(issues: LayoutIssue[]): LayoutFix[] {
    const fixes: LayoutFix[] = [];

    issues.forEach((issue, index) => {
      if (issue.severity === "info") return;

      switch (issue.type) {
        case "overflow":
          fixes.push({
            issueIndex: index,
            fixType: "css",
            description: "添加溢出控制",
            cssChanges: {
              overflow: "hidden",
              "text-overflow": "ellipsis",
            },
          });
          break;

        case "alignment":
          fixes.push({
            issueIndex: index,
            fixType: "css",
            description: "统一对齐方式",
            cssChanges: {
              "text-align": "left",
            },
          });
          break;

        case "spacing":
          fixes.push({
            issueIndex: index,
            fixType: "css",
            description: "使用一致的间距",
            cssChanges: {
              margin: "8px",
              padding: "8px",
            },
          });
          break;

        case "overlap":
          fixes.push({
            issueIndex: index,
            fixType: "css",
            description: "调整层级",
            cssChanges: {
              "z-index": "1",
            },
          });
          break;
      }
    });

    return fixes;
  }

  // ============================================================================
  // Private Methods - Apply Fixes
  // ============================================================================

  /**
   * 应用修复到 HTML
   */
  private applyFixes(html: string, fixes: LayoutFix[]): string {
    let fixedHtml = html;

    for (const fix of fixes) {
      if (fix.fixType === "css" && fix.cssChanges) {
        fixedHtml = this.applyCssFixes(fixedHtml, fix.cssChanges);
      }
    }

    return fixedHtml;
  }

  /**
   * 应用 CSS 修复
   */
  private applyCssFixes(
    html: string,
    cssChanges: Record<string, string>,
  ): string {
    // 检查是否已有 style 标签
    if (html.includes("</style>")) {
      // 在现有 style 标签中添加修复
      const cssRules = Object.entries(cssChanges)
        .map(([prop, value]) => `${prop}: ${value} !important;`)
        .join(" ");

      return html.replace(
        "</style>",
        `.slide-content { ${cssRules} }\n</style>`,
      );
    } else {
      // 添加新的 style 标签
      const cssRules = Object.entries(cssChanges)
        .map(([prop, value]) => `${prop}: ${value};`)
        .join(" ");

      const styleTag = `<style>.slide-content { ${cssRules} }</style>`;

      // 尝试在 head 或 body 开始处插入
      if (html.includes("<head>")) {
        return html.replace("<head>", `<head>${styleTag}`);
      } else if (html.includes("<body>")) {
        return html.replace("<body>", `<body>${styleTag}`);
      } else {
        return styleTag + html;
      }
    }
  }
}
