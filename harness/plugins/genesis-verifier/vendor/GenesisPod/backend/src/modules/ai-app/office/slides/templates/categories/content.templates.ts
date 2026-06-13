/**
 * Slides Engine v3.0 - Content Templates
 *
 * 内容型模板 (7个)：用于展示文本、图片和混合内容
 * C-001 ~ C-007
 */

import { SlideTemplate } from "../base/template-registry";
import {
  COMMON_CONTAINER,
  CARD_STYLE,
  FOOTER_STYLE,
  COLORS,
  FONT_STACK,
} from "../base/common-styles";

// ============================================================================
// C-001: Image-Left-Text-Right (左图右文) - v3.1 增强版
// ============================================================================

export const IMAGE_LEFT_TEXT_RIGHT_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "C-001",
    type: "splitLayout",
    name: "左图右文",
    description: "左侧图片，右侧文字说明",
    useCases: ["产品展示", "案例说明", "图文结合"],
    contentDensity: "medium",
    visualStyle: "professional",
    recommendedFor: ["产品介绍", "功能说明"],
    maxContentBlocks: 4,
    variables: ["{{TITLE}}", "{{IMAGE}}", "{{CONTENT}}"],
    keywords: ["图片", "产品", "展示", "介绍", "功能"],
    positionFit: { opening: 0.4, middle: 0.95, closing: 0.5 },
    compatibility: {
      goodBefore: ["C-002", "C-003"],
      goodAfter: ["S-002", "N-002"],
      avoidNear: [],
    },
    tone: "neutral",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <!-- 标题区域 + 金色装饰竖条 -->
  <div style="position: relative; margin-bottom: 28px;">
    <div style="position: absolute; left: -20px; top: 8px; width: 5px; height: 36px; background: linear-gradient(180deg, ${COLORS.primary}, #B8962E); border-radius: 3px;"></div>
    <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
    <p style="font-size: 16px; color: #94A3B8; margin: 0;">{{SUBTITLE}}</p>
  </div>

  <div style="display: flex; gap: 36px; height: calc(100% - 130px);">
    <!-- 左侧图片区域 -->
    <div style="flex: 0 0 44%; ${CARD_STYLE} display: flex; align-items: center; justify-content: center; overflow: hidden; border-left: 3px solid ${COLORS.primary};">
      <div style="width: 100%; height: 100%; background: linear-gradient(135deg, rgba(212, 175, 55, 0.15) 0%, rgba(59, 130, 246, 0.15) 50%, rgba(16, 185, 129, 0.1) 100%); display: flex; align-items: center; justify-content: center; border-radius: 8px;">
        <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="10" y="20" width="100" height="70" rx="8" stroke="#D4AF37" stroke-width="2" fill="rgba(212, 175, 55, 0.1)"/>
          <circle cx="35" cy="45" r="10" fill="#D4AF37" opacity="0.6"/>
          <path d="M20 75 L45 55 L65 70 L90 45 L100 55 L100 80 L20 80 Z" fill="#3B82F6" opacity="0.4"/>
          <text x="60" y="105" text-anchor="middle" fill="#64748B" font-size="12" font-family="sans-serif">配图区域</text>
        </svg>
      </div>
    </div>

    <!-- 右侧内容区域 -->
    <div style="flex: 1; display: flex; flex-direction: column; gap: 18px;">
      <div style="${CARD_STYLE} border-left: 4px solid ${COLORS.primary}; position: relative;">
        <h4 style="font-size: 16px; font-weight: 700; color: ${COLORS.primary}; margin: 0 0 8px 0;">{{POINT1_TITLE}}</h4>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{POINT1_DESC}}</p>
      </div>

      <div style="${CARD_STYLE} border-left: 4px solid ${COLORS.secondary}; position: relative;">
        <h4 style="font-size: 16px; font-weight: 700; color: ${COLORS.secondary}; margin: 0 0 8px 0;">{{POINT2_TITLE}}</h4>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{POINT2_DESC}}</p>
      </div>

      <div style="${CARD_STYLE} border-left: 4px solid ${COLORS.success}; position: relative;">
        <h4 style="font-size: 16px; font-weight: 700; color: ${COLORS.success}; margin: 0 0 8px 0;">{{POINT3_TITLE}}</h4>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{POINT3_DESC}}</p>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}"><span style="color: ${COLORS.primary};">◆</span> {{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// C-002: Text-Left-Image-Right (左文右图) - v3.1 增强版
// ============================================================================

export const TEXT_LEFT_IMAGE_RIGHT_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "C-002",
    type: "splitLayout",
    name: "左文右图",
    description: "左侧文字说明，右侧图片",
    useCases: ["功能说明", "产品特性", "图文结合"],
    contentDensity: "medium",
    visualStyle: "professional",
    recommendedFor: ["功能介绍", "特性说明"],
    maxContentBlocks: 4,
    variables: ["{{TITLE}}", "{{CONTENT}}", "{{IMAGE}}"],
    keywords: ["图片", "功能", "特性", "说明", "介绍"],
    positionFit: { opening: 0.4, middle: 0.95, closing: 0.5 },
    compatibility: {
      goodBefore: ["C-001", "C-003"],
      goodAfter: ["S-002", "N-002"],
      avoidNear: [],
    },
    tone: "neutral",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <!-- 标题区域 + 金色装饰竖条 -->
  <div style="position: relative; margin-bottom: 28px;">
    <div style="position: absolute; left: -20px; top: 8px; width: 5px; height: 36px; background: linear-gradient(180deg, ${COLORS.primary}, #B8962E); border-radius: 3px;"></div>
    <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
    <p style="font-size: 16px; color: #94A3B8; margin: 0;">{{SUBTITLE}}</p>
  </div>

  <div style="display: flex; gap: 36px; height: calc(100% - 130px);">
    <!-- 左侧内容区域 -->
    <div style="flex: 1; display: flex; flex-direction: column; gap: 18px;">
      <div style="${CARD_STYLE} border-left: 4px solid ${COLORS.primary}; position: relative;">
        <h4 style="font-size: 16px; font-weight: 700; color: ${COLORS.primary}; margin: 0 0 8px 0;">{{POINT1_TITLE}}</h4>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{POINT1_DESC}}</p>
      </div>

      <div style="${CARD_STYLE} border-left: 4px solid ${COLORS.secondary}; position: relative;">
        <h4 style="font-size: 16px; font-weight: 700; color: ${COLORS.secondary}; margin: 0 0 8px 0;">{{POINT2_TITLE}}</h4>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{POINT2_DESC}}</p>
      </div>

      <div style="${CARD_STYLE} border-left: 4px solid ${COLORS.success}; position: relative;">
        <h4 style="font-size: 16px; font-weight: 700; color: ${COLORS.success}; margin: 0 0 8px 0;">{{POINT3_TITLE}}</h4>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{POINT3_DESC}}</p>
      </div>
    </div>

    <!-- 右侧图片区域 -->
    <div style="flex: 0 0 44%; ${CARD_STYLE} display: flex; align-items: center; justify-content: center; overflow: hidden; border-left: 3px solid ${COLORS.secondary};">
      <div style="width: 100%; height: 100%; background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(16, 185, 129, 0.15) 50%, rgba(212, 175, 55, 0.1) 100%); display: flex; align-items: center; justify-content: center; border-radius: 8px;">
        <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="10" y="20" width="100" height="70" rx="8" stroke="#3B82F6" stroke-width="2" fill="rgba(59, 130, 246, 0.1)"/>
          <circle cx="35" cy="45" r="10" fill="#10B981" opacity="0.6"/>
          <path d="M20 75 L45 55 L65 70 L90 45 L100 55 L100 80 L20 80 Z" fill="#D4AF37" opacity="0.4"/>
          <text x="60" y="105" text-anchor="middle" fill="#64748B" font-size="12" font-family="sans-serif">配图区域</text>
        </svg>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}"><span style="color: ${COLORS.primary};">◆</span> {{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// C-003: Bullet-List (要点列表) - v3.1 增强版
// ============================================================================

export const BULLET_LIST_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "C-003",
    type: "multiColumn",
    name: "要点列表",
    description: "清晰的要点列表展示",
    useCases: ["要点总结", "清单列表", "核心观点"],
    contentDensity: "medium",
    visualStyle: "professional",
    recommendedFor: ["内容总结", "要点展示"],
    maxContentBlocks: 6,
    variables: ["{{TITLE}}", "{{POINTS}}"],
    keywords: ["要点", "总结", "列表", "核心", "关键"],
    positionFit: { opening: 0.5, middle: 0.9, closing: 0.7 },
    compatibility: {
      goodBefore: ["A-001", "A-003"],
      goodAfter: ["S-002", "D-001"],
      avoidNear: [],
    },
    tone: "neutral",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <!-- 标题区域 + 金色装饰竖条 -->
  <div style="position: relative; margin-bottom: 36px;">
    <div style="position: absolute; left: -20px; top: 8px; width: 5px; height: 36px; background: linear-gradient(180deg, ${COLORS.primary}, #B8962E); border-radius: 3px;"></div>
    <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
    <p style="font-size: 16px; color: #94A3B8; margin: 0;">{{SUBTITLE}}</p>
  </div>

  <div style="display: flex; flex-direction: column; gap: 18px; max-width: 920px;">
    <div style="${CARD_STYLE} display: flex; align-items: flex-start; gap: 16px; border-left: 4px solid ${COLORS.primary};">
      <div style="width: 36px; height: 36px; background: ${COLORS.primary}; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 8px rgba(212, 175, 55, 0.3);">
        <span style="font-size: 15px; font-weight: 900;">1</span>
      </div>
      <div style="flex: 1;">
        <h4 style="font-size: 17px; font-weight: 700; margin: 0 0 8px 0;">{{POINT1_TITLE}}</h4>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{POINT1_DESC}}</p>
      </div>
    </div>

    <div style="${CARD_STYLE} display: flex; align-items: flex-start; gap: 16px; border-left: 4px solid ${COLORS.secondary};">
      <div style="width: 36px; height: 36px; background: ${COLORS.secondary}; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);">
        <span style="font-size: 15px; font-weight: 900;">2</span>
      </div>
      <div style="flex: 1;">
        <h4 style="font-size: 17px; font-weight: 700; margin: 0 0 8px 0;">{{POINT2_TITLE}}</h4>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{POINT2_DESC}}</p>
      </div>
    </div>

    <div style="${CARD_STYLE} display: flex; align-items: flex-start; gap: 16px; border-left: 4px solid ${COLORS.success};">
      <div style="width: 36px; height: 36px; background: ${COLORS.success}; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);">
        <span style="font-size: 15px; font-weight: 900;">3</span>
      </div>
      <div style="flex: 1;">
        <h4 style="font-size: 17px; font-weight: 700; margin: 0 0 8px 0;">{{POINT3_TITLE}}</h4>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{POINT3_DESC}}</p>
      </div>
    </div>

    <div style="${CARD_STYLE} display: flex; align-items: flex-start; gap: 16px; border-left: 4px solid ${COLORS.purple};">
      <div style="width: 36px; height: 36px; background: ${COLORS.purple}; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);">
        <span style="font-size: 15px; font-weight: 900;">4</span>
      </div>
      <div style="flex: 1;">
        <h4 style="font-size: 17px; font-weight: 700; margin: 0 0 8px 0;">{{POINT4_TITLE}}</h4>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{POINT4_DESC}}</p>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}"><span style="color: ${COLORS.primary};">◆</span> {{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// C-004: Card-Grid-2 (2列卡片)
// ============================================================================

export const CARD_GRID_2_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "C-004",
    type: "multiColumn",
    name: "2列卡片",
    description: "2列卡片网格布局",
    useCases: ["对比展示", "双列内容", "两个要点"],
    contentDensity: "medium",
    visualStyle: "professional",
    recommendedFor: ["双要点展示", "简洁对比"],
    maxContentBlocks: 2,
    variables: ["{{TITLE}}", "{{CARDS}}"],
    keywords: ["卡片", "双列", "两个", "对比"],
    positionFit: { opening: 0.4, middle: 0.9, closing: 0.5 },
    compatibility: {
      goodBefore: ["C-003", "A-001"],
      goodAfter: ["S-002"],
      avoidNear: ["C-005", "C-006"],
    },
    tone: "neutral",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
  <p style="font-size: 18px; color: #94A3B8; margin: 0 0 40px 0;">{{SUBTITLE}}</p>

  <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 32px; height: calc(100% - 160px);">
    <div style="${CARD_STYLE} display: flex; flex-direction: column; border-top: 4px solid ${COLORS.primary};">
      <div style="width: 64px; height: 64px; background: rgba(212, 175, 55, 0.15); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
        <span style="font-size: 28px; font-family: ${FONT_STACK};">{{CARD1_ICON}}</span>
      </div>
      <h3 style="font-size: 22px; font-weight: 700; margin: 0 0 16px 0; color: ${COLORS.primary};">{{CARD1_TITLE}}</h3>
      <p style="font-size: 15px; color: #94A3B8; margin: 0; line-height: 1.7; flex: 1;">{{CARD1_DESC}}</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #334155;">
        <div style="font-size: 28px; font-weight: 900; color: ${COLORS.primary};">{{CARD1_STAT}}</div>
        <div style="font-size: 13px; color: #64748B;">{{CARD1_LABEL}}</div>
      </div>
    </div>

    <div style="${CARD_STYLE} display: flex; flex-direction: column; border-top: 4px solid ${COLORS.secondary};">
      <div style="width: 64px; height: 64px; background: rgba(59, 130, 246, 0.15); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
        <span style="font-size: 28px; font-family: ${FONT_STACK};">{{CARD2_ICON}}</span>
      </div>
      <h3 style="font-size: 22px; font-weight: 700; margin: 0 0 16px 0; color: ${COLORS.secondary};">{{CARD2_TITLE}}</h3>
      <p style="font-size: 15px; color: #94A3B8; margin: 0; line-height: 1.7; flex: 1;">{{CARD2_DESC}}</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #334155;">
        <div style="font-size: 28px; font-weight: 900; color: ${COLORS.secondary};">{{CARD2_STAT}}</div>
        <div style="font-size: 13px; color: #64748B;">{{CARD2_LABEL}}</div>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">{{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// C-005: Card-Grid-3 (3列卡片)
// ============================================================================

export const CARD_GRID_3_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "C-005",
    type: "multiColumn",
    name: "3列卡片",
    description: "3列卡片网格布局",
    useCases: ["三要素", "特性展示", "功能介绍"],
    contentDensity: "high",
    visualStyle: "professional",
    recommendedFor: ["功能展示", "特性介绍"],
    maxContentBlocks: 3,
    variables: ["{{TITLE}}", "{{CARDS}}"],
    keywords: ["卡片", "三列", "三个", "功能", "特性"],
    positionFit: { opening: 0.4, middle: 0.95, closing: 0.5 },
    compatibility: {
      goodBefore: ["C-003", "A-001"],
      goodAfter: ["S-002"],
      avoidNear: ["C-004", "C-006"],
    },
    tone: "neutral",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <!-- 标题区域 + 金色装饰竖条 -->
  <div style="position: relative; margin-bottom: 28px;">
    <div style="position: absolute; left: -20px; top: 8px; width: 5px; height: 36px; background: linear-gradient(180deg, ${COLORS.primary}, #B8962E); border-radius: 3px;"></div>
    <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
    <p style="font-size: 16px; color: #94A3B8; margin: 0;">{{SUBTITLE}}</p>
  </div>

  <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; height: calc(100% - 150px);">
    <div style="${CARD_STYLE} display: flex; flex-direction: column; border-top: 4px solid ${COLORS.primary};">
      <div style="width: 56px; height: 56px; background: rgba(212, 175, 55, 0.15); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
        <span style="font-size: 24px; font-family: ${FONT_STACK};">{{CARD1_ICON}}</span>
      </div>
      <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 10px 0; color: ${COLORS.primary}; line-height: 1.3; min-height: 42px;">{{CARD1_TITLE}}</h3>
      <p style="font-size: 13px; color: #94A3B8; margin: 0; line-height: 1.6; flex: 1;">{{CARD1_DESC}}</p>
      <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #334155;">
        <div style="font-size: 24px; font-weight: 900; color: ${COLORS.primary};">{{CARD1_STAT}}</div>
        <div style="font-size: 12px; color: #64748B;">{{CARD1_LABEL}}</div>
      </div>
    </div>

    <div style="${CARD_STYLE} display: flex; flex-direction: column; border-top: 4px solid ${COLORS.secondary};">
      <div style="width: 56px; height: 56px; background: rgba(59, 130, 246, 0.15); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
        <span style="font-size: 24px; font-family: ${FONT_STACK};">{{CARD2_ICON}}</span>
      </div>
      <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 10px 0; color: ${COLORS.secondary}; line-height: 1.3; min-height: 42px;">{{CARD2_TITLE}}</h3>
      <p style="font-size: 13px; color: #94A3B8; margin: 0; line-height: 1.6; flex: 1;">{{CARD2_DESC}}</p>
      <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #334155;">
        <div style="font-size: 24px; font-weight: 900; color: ${COLORS.secondary};">{{CARD2_STAT}}</div>
        <div style="font-size: 12px; color: #64748B;">{{CARD2_LABEL}}</div>
      </div>
    </div>

    <div style="${CARD_STYLE} display: flex; flex-direction: column; border-top: 4px solid ${COLORS.success};">
      <div style="width: 56px; height: 56px; background: rgba(16, 185, 129, 0.15); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
        <span style="font-size: 24px; font-family: ${FONT_STACK};">{{CARD3_ICON}}</span>
      </div>
      <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 10px 0; color: ${COLORS.success}; line-height: 1.3; min-height: 42px;">{{CARD3_TITLE}}</h3>
      <p style="font-size: 13px; color: #94A3B8; margin: 0; line-height: 1.6; flex: 1;">{{CARD3_DESC}}</p>
      <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #334155;">
        <div style="font-size: 24px; font-weight: 900; color: ${COLORS.success};">{{CARD3_STAT}}</div>
        <div style="font-size: 12px; color: #64748B;">{{CARD3_LABEL}}</div>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}"><span style="color: ${COLORS.primary};">◆</span> 战略规划 | {{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// C-006: Card-Grid-4 (4列卡片)
// ============================================================================

export const CARD_GRID_4_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "C-006",
    type: "multiColumn",
    name: "4列卡片",
    description: "4列紧凑卡片网格布局",
    useCases: ["四要素", "多特性", "概览展示"],
    contentDensity: "high",
    visualStyle: "professional",
    recommendedFor: ["多特性展示", "概览页"],
    maxContentBlocks: 4,
    variables: ["{{TITLE}}", "{{CARDS}}"],
    keywords: ["卡片", "四列", "四个", "特性", "概览"],
    positionFit: { opening: 0.3, middle: 0.9, closing: 0.4 },
    compatibility: {
      goodBefore: ["C-003", "A-001"],
      goodAfter: ["S-002"],
      avoidNear: ["C-004", "C-005"],
    },
    tone: "neutral",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
  <p style="font-size: 18px; color: #94A3B8; margin: 0 0 32px 0;">{{SUBTITLE}}</p>

  <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; height: calc(100% - 140px);">
    <div style="${CARD_STYLE} display: flex; flex-direction: column; border-top: 3px solid ${COLORS.primary}; padding: 20px;">
      <div style="font-size: 32px; margin-bottom: 12px; font-family: ${FONT_STACK};">{{CARD1_ICON}}</div>
      <h3 style="font-size: 15px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.primary};">{{CARD1_TITLE}}</h3>
      <p style="font-size: 13px; color: #94A3B8; margin: 0; line-height: 1.5;">{{CARD1_DESC}}</p>
    </div>

    <div style="${CARD_STYLE} display: flex; flex-direction: column; border-top: 3px solid ${COLORS.secondary}; padding: 20px;">
      <div style="font-size: 32px; margin-bottom: 12px; font-family: ${FONT_STACK};">{{CARD2_ICON}}</div>
      <h3 style="font-size: 15px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.secondary};">{{CARD2_TITLE}}</h3>
      <p style="font-size: 13px; color: #94A3B8; margin: 0; line-height: 1.5;">{{CARD2_DESC}}</p>
    </div>

    <div style="${CARD_STYLE} display: flex; flex-direction: column; border-top: 3px solid ${COLORS.success}; padding: 20px;">
      <div style="font-size: 32px; margin-bottom: 12px; font-family: ${FONT_STACK};">{{CARD3_ICON}}</div>
      <h3 style="font-size: 15px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.success};">{{CARD3_TITLE}}</h3>
      <p style="font-size: 13px; color: #94A3B8; margin: 0; line-height: 1.5;">{{CARD3_DESC}}</p>
    </div>

    <div style="${CARD_STYLE} display: flex; flex-direction: column; border-top: 3px solid ${COLORS.purple}; padding: 20px;">
      <div style="font-size: 32px; margin-bottom: 12px; font-family: ${FONT_STACK};">{{CARD4_ICON}}</div>
      <h3 style="font-size: 15px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.purple};">{{CARD4_TITLE}}</h3>
      <p style="font-size: 13px; color: #94A3B8; margin: 0; line-height: 1.5;">{{CARD4_DESC}}</p>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">{{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// C-007: Case-Detail (案例详情)
// ============================================================================

export const CASE_DETAIL_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "C-007",
    type: "caseStudy",
    name: "案例详情",
    description: "详细展示单个案例的完整信息",
    useCases: ["案例分析", "成功案例", "客户故事"],
    contentDensity: "high",
    visualStyle: "professional",
    recommendedFor: ["案例展示", "客户故事"],
    maxContentBlocks: 5,
    variables: ["{{TITLE}}", "{{CASE}}"],
    keywords: ["案例", "客户", "故事", "成功", "实践"],
    positionFit: { opening: 0.3, middle: 0.9, closing: 0.5 },
    compatibility: {
      goodBefore: ["A-001", "C-003"],
      goodAfter: ["S-002", "D-001"],
      avoidNear: [],
    },
    tone: "positive",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
    <div style="padding: 6px 12px; background: rgba(212, 175, 55, 0.2); border-radius: 6px; font-size: 12px; color: ${COLORS.primary}; font-weight: 600;">案例研究</div>
    <div style="font-size: 14px; color: #64748B;">{{INDUSTRY}}</div>
  </div>

  <h1 style="font-size: 32px; font-weight: 900; margin: 0 0 24px 0;">{{TITLE}}</h1>

  <div style="display: flex; gap: 32px; height: calc(100% - 140px);">
    <div style="flex: 1; display: flex; flex-direction: column; gap: 16px;">
      <div style="${CARD_STYLE} border-left: 3px solid ${COLORS.danger};">
        <div style="font-size: 12px; color: ${COLORS.danger}; font-weight: 600; margin-bottom: 8px;">挑战</div>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{CHALLENGE}}</p>
      </div>

      <div style="${CARD_STYLE} border-left: 3px solid ${COLORS.secondary};">
        <div style="font-size: 12px; color: ${COLORS.secondary}; font-weight: 600; margin-bottom: 8px;">解决方案</div>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{SOLUTION}}</p>
      </div>

      <div style="${CARD_STYLE} border-left: 3px solid ${COLORS.success};">
        <div style="font-size: 12px; color: ${COLORS.success}; font-weight: 600; margin-bottom: 8px;">成果</div>
        <p style="font-size: 14px; color: #94A3B8; margin: 0; line-height: 1.6;">{{RESULT}}</p>
      </div>
    </div>

    <div style="flex: 0 0 320px; display: flex; flex-direction: column; gap: 16px;">
      <div style="${CARD_STYLE} text-align: center; background: rgba(212, 175, 55, 0.1); border-color: rgba(212, 175, 55, 0.3);">
        <div style="font-size: 48px; font-weight: 900; color: ${COLORS.primary}; margin-bottom: 8px;">{{STAT1_VALUE}}</div>
        <div style="font-size: 14px; color: #94A3B8;">{{STAT1_LABEL}}</div>
      </div>

      <div style="${CARD_STYLE} text-align: center;">
        <div style="font-size: 36px; font-weight: 900; color: ${COLORS.success}; margin-bottom: 8px;">{{STAT2_VALUE}}</div>
        <div style="font-size: 14px; color: #94A3B8;">{{STAT2_LABEL}}</div>
      </div>

      <div style="${CARD_STYLE} text-align: center;">
        <div style="font-size: 36px; font-weight: 900; color: ${COLORS.secondary}; margin-bottom: 8px;">{{STAT3_VALUE}}</div>
        <div style="font-size: 14px; color: #94A3B8;">{{STAT3_LABEL}}</div>
      </div>

      <div style="${CARD_STYLE} flex: 1;">
        <div style="font-size: 12px; color: #64748B; margin-bottom: 8px;">客户评价</div>
        <p style="font-size: 14px; color: #F8FAFC; margin: 0; line-height: 1.6; font-style: italic;">"{{QUOTE}}"</p>
        <div style="font-size: 13px; color: #94A3B8; margin-top: 12px;">— {{AUTHOR}}</div>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">案例研究 | {{CLIENT_NAME}}</div>
</div>
  `.trim(),
};

// ============================================================================
// Export All Content Templates
// ============================================================================

export const CONTENT_TEMPLATES: SlideTemplate[] = [
  IMAGE_LEFT_TEXT_RIGHT_TEMPLATE,
  TEXT_LEFT_IMAGE_RIGHT_TEMPLATE,
  BULLET_LIST_TEMPLATE,
  CARD_GRID_2_TEMPLATE,
  CARD_GRID_3_TEMPLATE,
  CARD_GRID_4_TEMPLATE,
  CASE_DETAIL_TEMPLATE,
];
