/**
 * Slides Engine v4.0 - Layout Optimizer Skill
 *
 * 布局优化技能：根据内容特征选择/生成最优布局
 * 取代硬编码的 TEMPLATE_CAPACITY 和 getMinSectionsForTemplate()
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  ContentAnalysisResult,
  RecommendedLayout,
  ContentAnalyzerSkill,
} from "./content-analyzer.skill";
import { PageContent, ContentSection } from "../checkpoint/checkpoint.types";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
} from "@/modules/ai-harness/facade";

// ============================================================================
// Layout Decision Types
// ============================================================================

/**
 * 网格配置
 */
export interface GridConfig {
  /** 列数 (1-4) */
  columns: number;
  /** 行数 (1-3) */
  rows: number;
  /** 每列宽度比例 (总和为 1) */
  columnWidths: number[];
  /** 每行高度比例 (总和为 1) */
  rowHeights: number[];
  /** 网格间距 (inches) */
  gap: number;
}

/**
 * Section 放置位置
 */
export interface SectionPlacement {
  /** Section 索引 */
  sectionIndex: number;
  /** 网格区域 */
  gridArea: {
    col: number;
    row: number;
    colSpan: number;
    rowSpan: number;
  };
  /** 渲染样式 */
  renderStyle: "card" | "inline" | "highlight" | "compact" | "full-bleed";
  /** 优先级 (用于溢出时的裁剪) */
  priority: number;
}

/**
 * 视觉层次
 */
export interface VisualHierarchy {
  /** 主焦点 section 索引 */
  primaryFocus: number | null;
  /** 次要项索引 */
  secondaryItems: number[];
  /** 支撑项索引 */
  supportingItems: number[];
}

/**
 * 布局决策（LayoutOptimizer 的输出）
 */
export interface LayoutDecision {
  /** 布局类型 */
  layoutType: RecommendedLayout;

  /** 网格配置 */
  gridConfig: GridConfig;

  /** 内容分配 */
  sectionPlacements: SectionPlacement[];

  /** 视觉层次 */
  hierarchy: VisualHierarchy;

  /** 标题区配置 */
  titleArea: {
    /** 是否显示标题 */
    show: boolean;
    /** 标题高度比例 */
    heightRatio: number;
    /** 对齐方式 */
    alignment: "left" | "center" | "right";
  };

  /** 页脚配置 */
  footerArea: {
    show: boolean;
    heightRatio: number;
  };

  /** 是否需要拆分页面 */
  needsSplit: boolean;

  /** 拆分建议 */
  splitSuggestion?: {
    pageCount: number;
    sectionsPerPage: number[];
  };

  /** 决策理由 */
  reasoning: string;

  /** 决策时间 */
  decidedAt: Date;
}

/**
 * 布局反馈（用于渲染层向内容层的反馈）
 */
export interface LayoutFeedback {
  success: boolean;

  /** 约束信息 */
  constraints?: {
    maxSections: number;
    maxCharactersPerSection: number;
    suggestedSplit?: number;
  };

  /** 调整建议 */
  suggestions?: {
    mergeSections?: number[];
    removeSections?: number[];
    compressSections?: number[];
  };

  /** 实际渲染结果 */
  actualLayout?: {
    usedCells: number;
    overflowCells: number;
    truncatedSections: number[];
  };
}

/**
 * MissionOrchestrator 传递的输入格式
 */
interface OrchestratorInput {
  task?: string;
  context?: {
    input?: PageContent;
    [key: string]: unknown;
  };
  previousOutputs?: Record<string, unknown>;
}

// ============================================================================
// Layout Optimizer Service
// ============================================================================

@Injectable()
export class LayoutOptimizerSkill implements ISkill<
  PageContent,
  LayoutDecision
> {
  private readonly logger = new Logger(LayoutOptimizerSkill.name);

  // ============================================================================
  // ISkill Implementation - Required Properties
  // ============================================================================

  readonly id = "slides-layout-optimizer";
  readonly name = "布局优化";
  readonly description = "优化幻灯片布局以提升视觉效果";
  readonly layer: SkillLayer = SKILL_LAYERS.OPTIMIZATION;
  readonly domain = "slides";
  readonly tags = ["slides", "layout", "optimization", "design"];
  readonly version = "4.0.0";

  // ============================================================================
  // Configuration
  // ============================================================================

  // 画布尺寸 (inches, 16:9)
  private readonly CANVAS = {
    width: 13.33,
    height: 7.5,
    margin: {
      top: 0.5,
      right: 0.5,
      bottom: 0.6,
      left: 0.5,
    },
  };

  // 标题区默认高度比例
  private readonly DEFAULT_TITLE_HEIGHT = 0.15;
  // 页脚区默认高度比例
  private readonly DEFAULT_FOOTER_HEIGHT = 0.05;

  constructor(private readonly contentAnalyzer: ContentAnalyzerSkill) {}

  // ============================================================================
  // ISkill Methods
  // ============================================================================

  /**
   * 执行技能 - ISkill interface implementation
   * Optimize page layout based on content analysis
   *
   * 支持两种输入格式：
   * 1. 直接调用: PageContent { title, sections, ... }
   * 2. MissionOrchestrator 格式: { task, context, previousOutputs }
   */
  async execute(
    input: PageContent | OrchestratorInput,
    context: SkillContext,
  ): Promise<SkillResult<LayoutDecision>> {
    const startTime = new Date();

    // 处理 Orchestrator 输入格式
    const content = this.normalizeInput(input);
    if (!content?.title) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "Missing page content or title in input",
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
        `[execute] Starting layout optimization for: "${content.title}" (executionId: ${context.executionId})`,
      );

      // 执行布局优化
      const result = this.optimize(content);

      const endTime = new Date();

      this.logger.log(
        `[execute] Layout optimization completed successfully (duration: ${endTime.getTime() - startTime.getTime()}ms)`,
      );

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

      this.logger.error(
        `[execute] Layout optimization failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      const details =
        error instanceof Error && error.stack
          ? { stack: error.stack }
          : undefined;

      return {
        success: false,
        error: {
          code: "LAYOUT_OPTIMIZATION_FAILED",
          message: errorMessage,
          details,
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
  // Public Methods - Backward Compatibility
  // ============================================================================

  /**
   * 根据页面内容生成最优布局决策
   * @deprecated Use execute() method with ISkill interface
   */
  optimize(content: PageContent): LayoutDecision {
    this.logger.debug(`[optimize] Optimizing layout for: "${content.title}"`);

    // 1. 分析内容特征
    const features = this.contentAnalyzer.analyze(content);

    // 2. 使用特征生成布局
    return this.optimizeFromFeatures(features, content);
  }

  /**
   * 根据内容特征生成布局决策
   */
  optimizeFromFeatures(
    features: ContentAnalysisResult,
    content: PageContent,
  ): LayoutDecision {
    const sections = content.sections || [];

    // 1. 确定布局类型
    const layoutType = features.recommendedLayout;

    // 2. 计算网格配置
    const gridConfig = this.calculateGridConfig(features, layoutType);

    // 3. 分配 sections 到网格
    const sectionPlacements = this.placeSections(
      sections,
      gridConfig,
      features,
    );

    // 4. 确定视觉层次
    const hierarchy = this.determineHierarchy(sections, features);

    // 5. 配置标题和页脚区
    const titleArea = this.configureTitleArea(layoutType, features);
    const footerArea = this.configureFooterArea(layoutType);

    // 6. 检查是否需要拆分
    const needsSplit = !features.estimatedCapacity.fitsOnOnePage;
    const splitSuggestion = needsSplit
      ? this.calculateSplitSuggestion(features)
      : undefined;

    // 7. 生成决策理由
    const reasoning = this.generateReasoning(layoutType, gridConfig, features);

    const decision: LayoutDecision = {
      layoutType,
      gridConfig,
      sectionPlacements,
      hierarchy,
      titleArea,
      footerArea,
      needsSplit,
      splitSuggestion,
      reasoning,
      decidedAt: new Date(),
    };

    this.logger.log(
      `[optimize] Layout decision: ${layoutType}, ${gridConfig.columns}x${gridConfig.rows}, ${sectionPlacements.length} placements`,
    );

    return decision;
  }

  /**
   * 计算网格配置
   */
  private calculateGridConfig(
    features: ContentAnalysisResult,
    layoutType: RecommendedLayout,
  ): GridConfig {
    const suggested = features.suggestedGrid;

    switch (layoutType) {
      case "comparison-grid":
        return this.createComparisonGrid(features.comparison.count);

      case "pillar-showcase":
        return this.createPillarGrid(features.pillars.count);

      case "data-dashboard":
        return this.createDashboardGrid(features.totalSections);

      case "timeline-progress":
        return this.createTimelineGrid(features.timeline.nodeCount);

      case "content-flow":
        return this.createContentFlowGrid(features.totalSections);

      case "visual-story":
        return this.createVisualStoryGrid();

      case "insight-highlight":
        return this.createInsightGrid();

      case "single-focus":
        return this.createSingleFocusGrid();

      default:
        // 使用建议的网格
        return {
          columns: suggested.columns,
          rows: suggested.rows,
          columnWidths: this.equalWidths(suggested.columns),
          rowHeights: this.equalHeights(suggested.rows),
          gap: 0.2,
        };
    }
  }

  /**
   * 创建对比网格
   */
  private createComparisonGrid(itemCount: number): GridConfig {
    const columns = Math.min(itemCount, 4);
    return {
      columns,
      rows: 1,
      columnWidths: this.equalWidths(columns),
      rowHeights: [1],
      gap: 0.25,
    };
  }

  /**
   * 创建支柱网格
   */
  private createPillarGrid(pillarCount: number): GridConfig {
    if (pillarCount <= 3) {
      return {
        columns: pillarCount,
        rows: 1,
        columnWidths: this.equalWidths(pillarCount),
        rowHeights: [1],
        gap: 0.2,
      };
    } else if (pillarCount <= 6) {
      const cols = Math.ceil(pillarCount / 2);
      return {
        columns: cols,
        rows: 2,
        columnWidths: this.equalWidths(cols),
        rowHeights: [0.5, 0.5],
        gap: 0.2,
      };
    } else {
      // 超过 6 个，使用 3 列多行
      const rows = Math.ceil(pillarCount / 3);
      return {
        columns: 3,
        rows,
        columnWidths: [0.333, 0.334, 0.333],
        rowHeights: this.equalHeights(rows),
        gap: 0.15,
      };
    }
  }

  /**
   * 创建仪表盘网格
   */
  private createDashboardGrid(sectionCount: number): GridConfig {
    if (sectionCount <= 2) {
      return {
        columns: 2,
        rows: 1,
        columnWidths: [0.5, 0.5],
        rowHeights: [1],
        gap: 0.2,
      };
    } else if (sectionCount <= 4) {
      return {
        columns: 2,
        rows: 2,
        columnWidths: [0.5, 0.5],
        rowHeights: [0.5, 0.5],
        gap: 0.2,
      };
    } else {
      return {
        columns: 3,
        rows: 2,
        columnWidths: [0.333, 0.334, 0.333],
        rowHeights: [0.5, 0.5],
        gap: 0.15,
      };
    }
  }

  /**
   * 创建时间线网格
   */
  private createTimelineGrid(nodeCount: number): GridConfig {
    // 时间线通常是水平或垂直的单行/单列
    if (nodeCount <= 5) {
      return {
        columns: nodeCount,
        rows: 1,
        columnWidths: this.equalWidths(nodeCount),
        rowHeights: [1],
        gap: 0.1,
      };
    } else {
      // 超过 5 个节点，使用双行
      const cols = Math.ceil(nodeCount / 2);
      return {
        columns: cols,
        rows: 2,
        columnWidths: this.equalWidths(cols),
        rowHeights: [0.5, 0.5],
        gap: 0.1,
      };
    }
  }

  /**
   * 创建内容流网格
   */
  private createContentFlowGrid(sectionCount: number): GridConfig {
    if (sectionCount <= 1) {
      return {
        columns: 1,
        rows: 1,
        columnWidths: [1],
        rowHeights: [1],
        gap: 0,
      };
    } else if (sectionCount === 2) {
      return {
        columns: 2,
        rows: 1,
        columnWidths: [0.5, 0.5],
        rowHeights: [1],
        gap: 0.25,
      };
    } else {
      // 左侧主内容，右侧辅助
      return {
        columns: 2,
        rows: 1,
        columnWidths: [0.6, 0.4],
        rowHeights: [1],
        gap: 0.25,
      };
    }
  }

  /**
   * 创建图文混排网格
   */
  private createVisualStoryGrid(): GridConfig {
    return {
      columns: 2,
      rows: 1,
      columnWidths: [0.45, 0.55], // 图片稍小，文字稍大
      rowHeights: [1],
      gap: 0.3,
    };
  }

  /**
   * 创建洞察高亮网格
   */
  private createInsightGrid(): GridConfig {
    return {
      columns: 1,
      rows: 2,
      columnWidths: [1],
      rowHeights: [0.4, 0.6], // 上方高亮数字，下方详细内容
      gap: 0.2,
    };
  }

  /**
   * 创建单焦点网格
   */
  private createSingleFocusGrid(): GridConfig {
    return {
      columns: 1,
      rows: 1,
      columnWidths: [1],
      rowHeights: [1],
      gap: 0,
    };
  }

  /**
   * 生成等宽比例
   */
  private equalWidths(count: number): number[] {
    if (count <= 0) return [1];
    const width = 1 / count;
    return Array(count).fill(width);
  }

  /**
   * 生成等高比例
   */
  private equalHeights(count: number): number[] {
    if (count <= 0) return [1];
    const height = 1 / count;
    return Array(count).fill(height);
  }

  /**
   * 将 sections 放置到网格中
   */
  private placeSections(
    sections: ContentSection[],
    gridConfig: GridConfig,
    features: ContentAnalysisResult,
  ): SectionPlacement[] {
    const placements: SectionPlacement[] = [];
    const totalCells = gridConfig.columns * gridConfig.rows;

    // 根据布局类型决定放置策略
    const layoutType = features.recommendedLayout;

    for (let i = 0; i < sections.length && i < totalCells; i++) {
      const section = sections[i];

      // 计算网格位置
      const row = Math.floor(i / gridConfig.columns);
      const col = i % gridConfig.columns;

      // 决定渲染样式
      const renderStyle = this.determineRenderStyle(
        section,
        layoutType,
        i,
        features,
      );

      // 计算优先级（用于溢出裁剪）
      const priority = this.calculatePriority(section, i, features);

      placements.push({
        sectionIndex: i,
        gridArea: {
          col,
          row,
          colSpan: 1,
          rowSpan: 1,
        },
        renderStyle,
        priority,
      });
    }

    return placements;
  }

  /**
   * 决定渲染样式
   */
  private determineRenderStyle(
    section: ContentSection,
    layoutType: RecommendedLayout,
    index: number,
    features: ContentAnalysisResult,
  ): SectionPlacement["renderStyle"] {
    // stat 类型默认用 card 样式
    if (section.type === "stat") {
      return "card";
    }

    // 图表用 full-bleed 样式
    if (section.type === "chart") {
      return "full-bleed";
    }

    // 洞察高亮布局的第一个元素用 highlight
    if (layoutType === "insight-highlight" && index === 0) {
      return "highlight";
    }

    // 数据密集页面用 compact
    if (features.visualComplexity === "dense") {
      return "compact";
    }

    // 默认用 inline
    return "inline";
  }

  /**
   * 计算优先级
   */
  private calculatePriority(
    section: ContentSection,
    index: number,
    features: ContentAnalysisResult,
  ): number {
    let priority = 100 - index * 10; // 基础优先级，越靠前越高

    // stat 类型优先级更高
    if (section.type === "stat") {
      priority += 20;
    }

    // 图表优先级更高
    if (section.type === "chart") {
      priority += 15;
    }

    // 如果有关键洞察，提高优先级
    if (features.dataDensity.hasKeyInsight) {
      priority += 10;
    }

    return priority;
  }

  /**
   * 确定视觉层次
   */
  private determineHierarchy(
    sections: ContentSection[],
    _features: ContentAnalysisResult,
  ): VisualHierarchy {
    if (sections.length === 0) {
      return {
        primaryFocus: null,
        secondaryItems: [],
        supportingItems: [],
      };
    }

    // 找到主焦点（最重要的 section）
    let primaryFocus = 0;
    let maxScore = 0;

    sections.forEach((section, index) => {
      let score = 0;

      // stat 和 chart 优先
      if (section.type === "stat") score += 30;
      if (section.type === "chart") score += 25;

      // 位置在 center 或 full 的更重要
      if (section.position === "center" || section.position === "full") {
        score += 10;
      }

      // 第一个 section 通常更重要
      if (index === 0) score += 5;

      if (score > maxScore) {
        maxScore = score;
        primaryFocus = index;
      }
    });

    // 分配次要和支撑项
    const secondaryItems: number[] = [];
    const supportingItems: number[] = [];

    sections.forEach((section, index) => {
      if (index === primaryFocus) return;

      if (section.type === "stat" || section.type === "chart") {
        secondaryItems.push(index);
      } else {
        supportingItems.push(index);
      }
    });

    return {
      primaryFocus,
      secondaryItems,
      supportingItems,
    };
  }

  /**
   * 配置标题区
   */
  private configureTitleArea(
    layoutType: RecommendedLayout,
    _features: ContentAnalysisResult,
  ): LayoutDecision["titleArea"] {
    // 单焦点布局（封面等）标题居中
    if (layoutType === "single-focus") {
      return {
        show: true,
        heightRatio: 0.3,
        alignment: "center",
      };
    }

    // 数据仪表盘标题较小
    if (layoutType === "data-dashboard") {
      return {
        show: true,
        heightRatio: 0.12,
        alignment: "left",
      };
    }

    // 默认配置
    return {
      show: true,
      heightRatio: this.DEFAULT_TITLE_HEIGHT,
      alignment: "left",
    };
  }

  /**
   * 配置页脚区
   */
  private configureFooterArea(
    layoutType: RecommendedLayout,
  ): LayoutDecision["footerArea"] {
    // 封面页不显示页脚
    if (layoutType === "single-focus") {
      return { show: false, heightRatio: 0 };
    }

    return {
      show: true,
      heightRatio: this.DEFAULT_FOOTER_HEIGHT,
    };
  }

  /**
   * 计算拆分建议
   */
  private calculateSplitSuggestion(
    features: ContentAnalysisResult,
  ): LayoutDecision["splitSuggestion"] {
    const { suggestedPageCount } = features.estimatedCapacity;

    if (suggestedPageCount <= 1) {
      return undefined;
    }

    // 均匀分配 sections
    const totalSections = features.totalSections;
    const sectionsPerPage: number[] = [];
    const basePerPage = Math.floor(totalSections / suggestedPageCount);
    let remainder = totalSections % suggestedPageCount;

    for (let i = 0; i < suggestedPageCount; i++) {
      sectionsPerPage.push(basePerPage + (remainder > 0 ? 1 : 0));
      if (remainder > 0) remainder--;
    }

    return {
      pageCount: suggestedPageCount,
      sectionsPerPage,
    };
  }

  /**
   * 生成决策理由
   */
  private generateReasoning(
    layoutType: RecommendedLayout,
    gridConfig: GridConfig,
    features: ContentAnalysisResult,
  ): string {
    const parts: string[] = [];

    // 布局类型理由
    switch (layoutType) {
      case "comparison-grid":
        parts.push(`检测到 ${features.comparison.count} 个对比项`);
        break;
      case "pillar-showcase":
        parts.push(`检测到 ${features.pillars.count} 个支柱要素`);
        break;
      case "data-dashboard":
        parts.push(
          `数据密度高 (${features.dataDensity.dataPointCount} 个数据点)`,
        );
        break;
      case "timeline-progress":
        parts.push(`检测到时间线结构 (${features.timeline.nodeCount} 个节点)`);
        break;
      default:
        parts.push(`内容类型: ${layoutType}`);
    }

    // 网格配置理由
    parts.push(
      `使用 ${gridConfig.columns}x${gridConfig.rows} 网格 (${features.suggestedGrid.reason})`,
    );

    // 复杂度
    parts.push(`视觉复杂度: ${features.visualComplexity}`);

    return parts.join("；");
  }

  /**
   * 计算实际渲染位置（像素/inches）
   */
  calculateRenderPositions(
    decision: LayoutDecision,
  ): Map<number, { x: number; y: number; w: number; h: number }> {
    const positions = new Map<
      number,
      { x: number; y: number; w: number; h: number }
    >();

    const { gridConfig, titleArea, footerArea, sectionPlacements } = decision;

    // 计算可用内容区域
    const contentAreaTop =
      this.CANVAS.margin.top +
      (titleArea.show ? this.CANVAS.height * titleArea.heightRatio : 0);
    const contentAreaBottom =
      this.CANVAS.height -
      this.CANVAS.margin.bottom -
      (footerArea.show ? this.CANVAS.height * footerArea.heightRatio : 0);
    const contentAreaLeft = this.CANVAS.margin.left;
    const contentAreaRight = this.CANVAS.width - this.CANVAS.margin.right;

    const contentWidth = contentAreaRight - contentAreaLeft;
    const contentHeight = contentAreaBottom - contentAreaTop;

    // 计算每个 section 的位置
    for (const placement of sectionPlacements) {
      const { gridArea, sectionIndex } = placement;

      // 计算列位置
      let x = contentAreaLeft;
      for (let c = 0; c < gridArea.col; c++) {
        x += contentWidth * gridConfig.columnWidths[c] + gridConfig.gap;
      }

      // 计算行位置
      let y = contentAreaTop;
      for (let r = 0; r < gridArea.row; r++) {
        y += contentHeight * gridConfig.rowHeights[r] + gridConfig.gap;
      }

      // 计算宽度
      let w = 0;
      for (let c = 0; c < gridArea.colSpan; c++) {
        w +=
          contentWidth * gridConfig.columnWidths[gridArea.col + c] +
          (c < gridArea.colSpan - 1 ? gridConfig.gap : 0);
      }
      w -= gridConfig.gap; // 减去最后一个间距

      // 计算高度
      let h = 0;
      for (let r = 0; r < gridArea.rowSpan; r++) {
        h +=
          contentHeight * gridConfig.rowHeights[gridArea.row + r] +
          (r < gridArea.rowSpan - 1 ? gridConfig.gap : 0);
      }
      h -= gridConfig.gap;

      positions.set(sectionIndex, {
        x: Math.max(x, contentAreaLeft),
        y: Math.max(y, contentAreaTop),
        w: Math.max(w, 0.5),
        h: Math.max(h, 0.3),
      });
    }

    return positions;
  }

  /**
   * 生成布局反馈（用于渲染层回传）
   */
  createFeedback(
    decision: LayoutDecision,
    actualResult: {
      renderedSections: number;
      truncatedSections: number[];
      overflow: boolean;
    },
  ): LayoutFeedback {
    const totalPlacements = decision.sectionPlacements.length;
    const overflowCount = totalPlacements - actualResult.renderedSections;

    return {
      success: !actualResult.overflow,
      constraints: actualResult.overflow
        ? {
            maxSections: actualResult.renderedSections,
            maxCharactersPerSection: 150,
            suggestedSplit: decision.splitSuggestion?.pageCount,
          }
        : undefined,
      suggestions:
        actualResult.truncatedSections.length > 0
          ? {
              compressSections: actualResult.truncatedSections,
            }
          : undefined,
      actualLayout: {
        usedCells: actualResult.renderedSections,
        overflowCells: overflowCount,
        truncatedSections: actualResult.truncatedSections,
      },
    };
  }

  /**
   * 规范化输入格式
   * 支持直接调用格式和 MissionOrchestrator 格式
   */
  private normalizeInput(
    input: PageContent | OrchestratorInput,
  ): PageContent | null {
    // 检查是否是直接调用格式（有 title 属性）
    if ("title" in input && typeof input.title === "string") {
      return input;
    }

    // 处理 Orchestrator 格式
    const orchestratorInput = input as OrchestratorInput;
    const missionInput = orchestratorInput.context?.input;

    if (missionInput && typeof missionInput.title === "string") {
      return missionInput;
    }

    // 尝试从 context 的其他位置获取 PageContent
    const context = orchestratorInput.context;
    if (context) {
      // 检查 context 是否直接是 PageContent
      if (typeof (context as Record<string, unknown>).title === "string") {
        return context as unknown as PageContent;
      }
    }

    // 返回 null，让调用者处理错误
    this.logger.warn(
      `[normalizeInput] Could not extract PageContent from input: ${JSON.stringify(Object.keys(input))}`,
    );
    return null;
  }
}
