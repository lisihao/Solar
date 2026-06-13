/**
 * Image Matching Types
 * AI Engine 核心能力 - 图文匹配类型定义
 *
 * 从 ai-app/office/common/template-selection.types.ts 提取图像相关类型
 */

import { ContentCategory } from "./content-features.types";

// ============================================================================
// 图片类型定义
// ============================================================================

/**
 * 图片类型
 */
export enum ImageType {
  // 信息图
  INFOGRAPHIC = "infographic", // 信息图表
  DIAGRAM = "diagram", // 流程图/架构图
  CHART = "chart", // 数据图表
  ICON = "icon", // 图标

  // 照片类
  PHOTO_BUSINESS = "photo_business", // 商务照片
  PHOTO_TECHNOLOGY = "photo_technology", // 科技照片
  PHOTO_PEOPLE = "photo_people", // 人物照片
  PHOTO_ABSTRACT = "photo_abstract", // 抽象照片

  // 插画类
  ILLUSTRATION_FLAT = "illustration_flat", // 扁平插画
  ILLUSTRATION_3D = "illustration_3d", // 3D插画
  ILLUSTRATION_ISOMETRIC = "illustration_isometric", // 等距插画

  // 装饰类
  BACKGROUND = "background", // 背景图
  PATTERN = "pattern", // 图案
  DECORATION = "decoration", // 装饰元素
}

/**
 * 图片位置
 */
export enum ImagePlacement {
  HERO = "hero", // 主图（大图）
  INLINE = "inline", // 行内图
  SIDE = "side", // 侧边图
  BACKGROUND = "background", // 背景
  ICON = "icon", // 图标位置
  THUMBNAIL = "thumbnail", // 缩略图
}

/**
 * 图文匹配规则
 */
export interface ImageMatchingRule {
  id: string;
  name: string;
  description: string;

  // 内容特征条件
  conditions: {
    contentCategory?: ContentCategory[];
    hasData?: boolean;
    hasTimeline?: boolean;
    hasComparison?: boolean;
    hasCaseStudy?: boolean;
    keywords?: string[];
  };

  // 推荐的图片类型
  recommendedImageTypes: ImageType[];

  // 推荐的图片位置
  recommendedPlacement: ImagePlacement;

  // 图片密度建议
  imageDensity: "sparse" | "balanced" | "rich";

  // 优先级
  priority: number;
}

/**
 * 图片需求
 */
export interface ImageRequirement {
  type: ImageType;
  placement: ImagePlacement;
  description: string;
  keywords: string[];
  aspectRatio?: "16:9" | "4:3" | "1:1" | "3:2" | "2:1";
  style?: string;
  mood?: "professional" | "creative" | "technical" | "warm" | "neutral";
  priority: "required" | "recommended" | "optional";
}

/**
 * 图片匹配规则集
 */
export const IMAGE_MATCHING_RULES: ImageMatchingRule[] = [
  {
    id: "data-visualization",
    name: "数据可视化",
    description: "数据密集内容需要图表",
    conditions: { hasData: true },
    recommendedImageTypes: [ImageType.CHART, ImageType.INFOGRAPHIC],
    recommendedPlacement: ImagePlacement.HERO,
    imageDensity: "balanced",
    priority: 95,
  },
  {
    id: "timeline-visual",
    name: "时间线可视化",
    description: "时间线内容需要流程图",
    conditions: { hasTimeline: true },
    recommendedImageTypes: [ImageType.DIAGRAM, ImageType.INFOGRAPHIC],
    recommendedPlacement: ImagePlacement.HERO,
    imageDensity: "balanced",
    priority: 90,
  },
  {
    id: "comparison-visual",
    name: "对比可视化",
    description: "对比内容需要对比图表",
    conditions: { hasComparison: true },
    recommendedImageTypes: [ImageType.INFOGRAPHIC, ImageType.CHART],
    recommendedPlacement: ImagePlacement.HERO,
    imageDensity: "balanced",
    priority: 88,
  },
  {
    id: "case-study-photo",
    name: "案例照片",
    description: "案例研究需要真实照片",
    conditions: { hasCaseStudy: true },
    recommendedImageTypes: [ImageType.PHOTO_BUSINESS, ImageType.PHOTO_PEOPLE],
    recommendedPlacement: ImagePlacement.SIDE,
    imageDensity: "sparse",
    priority: 75,
  },
  {
    id: "technology-content",
    name: "技术内容",
    description: "技术类内容使用科技图片",
    conditions: { keywords: ["技术", "系统", "架构", "平台", "AI", "云"] },
    recommendedImageTypes: [
      ImageType.ILLUSTRATION_ISOMETRIC,
      ImageType.PHOTO_TECHNOLOGY,
      ImageType.DIAGRAM,
    ],
    recommendedPlacement: ImagePlacement.HERO,
    imageDensity: "balanced",
    priority: 70,
  },
  {
    id: "business-content",
    name: "商务内容",
    description: "商务类内容使用商务图片",
    conditions: {
      keywords: ["市场", "战略", "增长", "客户", "业务", "销售"],
      contentCategory: [ContentCategory.PERSUASIVE, ContentCategory.ANALYTICAL],
    },
    recommendedImageTypes: [
      ImageType.PHOTO_BUSINESS,
      ImageType.ILLUSTRATION_FLAT,
    ],
    recommendedPlacement: ImagePlacement.SIDE,
    imageDensity: "sparse",
    priority: 65,
  },
  {
    id: "abstract-concept",
    name: "抽象概念",
    description: "抽象概念使用抽象图片",
    conditions: { contentCategory: [ContentCategory.INFORMATIONAL] },
    recommendedImageTypes: [
      ImageType.ILLUSTRATION_FLAT,
      ImageType.PHOTO_ABSTRACT,
    ],
    recommendedPlacement: ImagePlacement.HERO,
    imageDensity: "balanced",
    priority: 50,
  },
];
