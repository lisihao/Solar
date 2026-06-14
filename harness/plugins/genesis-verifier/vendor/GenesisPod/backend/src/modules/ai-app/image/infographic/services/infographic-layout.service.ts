import { Injectable } from "@nestjs/common";
import { InfographicSection } from "../types";

/**
 * 布局计算服务
 * 负责：布局策略、尺寸计算、样式配置
 */
@Injectable()
export class InfographicLayoutService {
  /**
   * 计算卡片列数
   */
  calculateColumns(totalItems: number, width: number, height: number): number {
    const isVertical = height > width;

    if (isVertical) {
      return Math.min(totalItems, 2);
    } else if (totalItems <= 2) {
      return totalItems;
    } else if (totalItems === 4) {
      return 2;
    } else if (totalItems <= 6) {
      return 3;
    } else if (totalItems <= 8) {
      return 4;
    } else if (totalItems <= 10) {
      return 5;
    } else {
      return 5;
    }
  }

  /**
   * 分配主卡片和总结卡片
   */
  allocateSections(
    sections: InfographicSection[],
    width: number,
    height: number,
  ): {
    mainSections: InfographicSection[];
    summarySection: InfographicSection | null;
  } {
    const isVertical = height > width;
    const maxMainCards = isVertical ? 12 : 15;

    const aiMainSections = sections.filter((s) => s.sectionType !== "summary");
    const aiSummarySections = sections.filter(
      (s) => s.sectionType === "summary",
    );

    const mainSections =
      aiMainSections.length > 0
        ? aiMainSections.slice(0, maxMainCards)
        : sections
            .filter((s) => s.sectionType !== "summary")
            .slice(0, maxMainCards);

    const summarySection =
      aiSummarySections.length > 0 ? aiSummarySections[0] : null;

    return { mainSections, summarySection };
  }

  /**
   * 计算缩放比例和尺寸参数
   */
  calculateDimensions(
    width: number,
    height: number,
    mainSectionsCount: number,
  ): {
    scale: number;
    compactScale: number;
    padding: number;
    titleSize: number;
    subtitleSize: number;
    sectionTitleSize: number;
    bulletSize: number;
    isCompactCards: boolean;
    isVeryCompactCards: boolean;
  } {
    const aspectRatio = width / height;
    const isWideScreen = aspectRatio >= 1.5;
    const scale = width / 1200;
    const compactScale = isWideScreen ? 0.85 : 1;

    const isCompactCards = mainSectionsCount > 8;
    const isVeryCompactCards = mainSectionsCount > 12;

    return {
      scale,
      compactScale,
      padding: Math.round(32 * scale * (isWideScreen ? 0.6 : 0.85)),
      titleSize: Math.round(32 * scale * (isWideScreen ? 0.9 : 1)),
      subtitleSize: Math.round(16 * scale * (isWideScreen ? 0.9 : 1)),
      sectionTitleSize: Math.round(18 * scale * compactScale),
      bulletSize: Math.round(14 * scale * compactScale),
      isCompactCards,
      isVeryCompactCards,
    };
  }

  /**
   * 计算内容截断参数
   */
  calculateTruncation(
    width: number,
    height: number,
    isCompactCards: boolean,
    isVeryCompactCards: boolean,
  ): {
    summaryMaxLen: number;
    bulletMaxLen: number;
    bulletsToShow: number;
    metricsToShow: number;
  } {
    const aspectRatio = width / height;
    const isWideScreen = aspectRatio >= 1.5;

    const summaryMaxLen = isVeryCompactCards
      ? 30
      : isCompactCards
        ? 40
        : isWideScreen
          ? 45
          : 60;

    const bulletMaxLen = isVeryCompactCards
      ? 25
      : isCompactCards
        ? 30
        : isWideScreen
          ? 35
          : 50;

    const bulletsToShow = isVeryCompactCards
      ? 1
      : isCompactCards
        ? 2
        : isWideScreen
          ? 2
          : 3;

    const metricsToShow = isVeryCompactCards
      ? 2
      : isCompactCards
        ? 3
        : isWideScreen
          ? 2
          : 3;

    return {
      summaryMaxLen,
      bulletMaxLen,
      bulletsToShow,
      metricsToShow,
    };
  }

  /**
   * 获取圆角尺寸
   */
  getBorderRadius(
    borderRadius: "none" | "small" | "medium" | "large" | undefined,
    baseBorderRadius: number,
    scale: number,
    isWideScreen: boolean,
  ): number {
    const borderRadiusMap = { none: 0, small: 4, medium: 12, large: 24 };
    const base = borderRadiusMap[borderRadius || "medium"] || baseBorderRadius;
    return Math.round(base * scale * (isWideScreen ? 0.7 : 1));
  }
}
