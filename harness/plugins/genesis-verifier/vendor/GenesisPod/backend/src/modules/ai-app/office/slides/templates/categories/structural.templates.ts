/**
 * Slides Engine v3.0 - Structural Templates
 *
 * 结构型模板 (9个)：用于组织和构建演示文稿的骨架
 * S-001 ~ S-009
 */

import { SlideTemplate } from "../base/template-registry";
import {
  COMMON_CONTAINER,
  CARD_STYLE,
  FOOTER_STYLE,
  COLORS,
  FONT_STACK, // v3.5: 用于emoji图标显示
} from "../base/common-styles";

// ============================================================================
// S-001: TOC-Dual (双列目录) - v3.1 增强版
// ============================================================================

export const TOC_DUAL_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "S-001",
    type: "toc",
    name: "双列目录",
    description: "双列金色编号布局的目录页",
    useCases: ["目录", "大纲", "内容概览"],
    contentDensity: "medium",
    visualStyle: "professional",
    recommendedFor: ["演示开头", "内容导航"],
    maxContentBlocks: 8,
    variables: ["{{TITLE}}", "{{CHAPTERS}}"],
    keywords: ["目录", "大纲", "内容", "章节", "概览", "导航"],
    positionFit: { opening: 0.95, middle: 0.3, closing: 0.1 },
    compatibility: {
      goodBefore: ["S-002"],
      goodAfter: ["N-001"],
      avoidNear: ["A-005"],
    },
    tone: "neutral",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <!-- 右上角透明边框装饰 -->
  <div style="position: absolute; top: 40px; right: 60px; width: 100px; height: 100px; border: 2px solid rgba(212, 175, 55, 0.25); pointer-events: none;"></div>

  <!-- 标题区域 + 金色装饰竖条 -->
  <div style="position: relative; margin-bottom: 48px;">
    <div style="position: absolute; left: -20px; top: 12px; width: 5px; height: 52px; background: linear-gradient(180deg, ${COLORS.primary}, #B8962E); border-radius: 3px;"></div>
    <h1 style="font-size: 56px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
    <p style="font-size: 18px; color: ${COLORS.primary}; font-weight: 500; letter-spacing: 6px; margin: 0;">TABLE OF CONTENTS</p>
  </div>

  <!-- 章节列表 -->
  <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap-x: 60px; gap-y: 28px; margin-bottom: 48px;">
    {{CHAPTERS}}
  </div>

  <!-- 底部分隔线装饰 -->
  <div style="position: absolute; bottom: 70px; left: 80px; right: 80px; height: 1px; background: linear-gradient(90deg, ${COLORS.primary}, transparent);"></div>

  <div style="${FOOTER_STYLE}"><span style="color: ${COLORS.primary};">◆</span> {{TITLE}} | 内容概览</div>
</div>
  `.trim(),
};

// ============================================================================
// S-002: Section Divider (章节分隔) - v3.1 增强版
// ============================================================================

export const SECTION_DIVIDER_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "S-002",
    type: "chapterTitle", // v3.5: 修复类型映射
    name: "章节分隔页",
    description: "章节过渡页，巨大章节编号+居中标题+金色装饰",
    useCases: ["章节分隔", "过渡页", "新章节开始"],
    contentDensity: "low",
    visualStyle: "professional",
    recommendedFor: ["章节开头", "主题切换"],
    maxContentBlocks: 2,
    variables: ["{{CHAPTER_NUM}}", "{{TITLE}}", "{{SUBTITLE}}"],
    keywords: ["章节", "分隔", "过渡", "第一章", "第二章", "Part"],
    positionFit: { opening: 0.4, middle: 0.9, closing: 0.2 },
    compatibility: {
      goodBefore: ["S-003", "S-004", "S-005", "C-001"],
      goodAfter: ["S-001", "N-001"],
      avoidNear: ["S-002"],
    },
    tone: "neutral",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <!-- 左上角巨大章节编号 (135pt) -->
  <div style="position: absolute; top: 30px; left: 60px; font-size: 135px; font-weight: 900; background: linear-gradient(180deg, #F8FAFC 0%, #64748B 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1;">{{CHAPTER_NUM}}</div>

  <!-- 中央金色装饰条 -->
  <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -180px); width: 100px; height: 5px; background: linear-gradient(90deg, ${COLORS.primary}, #B8962E); border-radius: 3px;"></div>

  <!-- 右上角透明边框装饰 -->
  <div style="position: absolute; top: 40px; right: 60px; width: 140px; height: 140px; border: 2.5px solid rgba(212, 175, 55, 0.3); pointer-events: none;"></div>

  <!-- 左下角透明边框装饰 -->
  <div style="position: absolute; bottom: 60px; left: 60px; width: 140px; height: 140px; border: 2.5px solid rgba(212, 175, 55, 0.3); pointer-events: none;"></div>

  <!-- 中央内容区 -->
  <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; padding-top: 60px;">
    <!-- CHAPTER 标签 -->
    <div style="font-size: 16px; color: #94A3B8; letter-spacing: 6px; margin-bottom: 20px; font-weight: 500;">CHAPTER {{CHAPTER_NUM}}</div>

    <!-- 金色分隔条 -->
    <div style="width: 100px; height: 4px; background: linear-gradient(90deg, ${COLORS.primary}, #B8962E); margin-bottom: 28px; border-radius: 2px;"></div>

    <!-- 章节标题 (48pt) -->
    <h1 style="font-size: 48px; font-weight: 900; margin: 0 0 20px 0; line-height: 1.2; max-width: 900px;">{{TITLE}}</h1>

    <!-- 渐变分隔线 -->
    <div style="width: 500px; height: 1px; background: linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.4), transparent); margin: 24px 0;"></div>

    <!-- 副标题 -->
    <p style="font-size: 18px; color: #94A3B8; margin: 0; max-width: 700px; line-height: 1.5;">{{SUBTITLE}}</p>
  </div>

  <!-- 页脚 -->
  <div style="${FOOTER_STYLE}">
    <span style="color: ${COLORS.primary};">◆</span> 第{{CHAPTER_NUM}}章
  </div>
</div>
  `.trim(),
};

// ============================================================================
// S-003: 3-Pillar (三支柱) - v3.1 增强版
// ============================================================================

export const THREE_PILLAR_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "S-003",
    type: "pillars",
    name: "三支柱",
    description: "三列等宽支柱布局，适合展示三个核心要素",
    useCases: ["核心支柱", "三大要素", "战略重点"],
    contentDensity: "medium",
    visualStyle: "professional",
    recommendedFor: ["战略框架", "核心能力"],
    maxContentBlocks: 3,
    variables: ["{{TITLE}}", "{{PILLAR1}}", "{{PILLAR2}}", "{{PILLAR3}}"],
    keywords: ["支柱", "核心", "三大", "要素", "支撑", "基础"],
    positionFit: { opening: 0.5, middle: 0.95, closing: 0.6 },
    compatibility: {
      goodBefore: ["C-001", "D-001"],
      goodAfter: ["S-002", "N-002"],
      avoidNear: ["S-004", "S-005"],
    },
    tone: "inspiring",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <!-- 标题区域 + 金色装饰竖条 -->
  <div style="position: relative; margin-bottom: 36px;">
    <div style="position: absolute; left: -20px; top: 8px; width: 5px; height: 36px; background: linear-gradient(180deg, ${COLORS.primary}, #B8962E); border-radius: 3px;"></div>
    <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
    <p style="font-size: 16px; color: #94A3B8; margin: 0;">{{SUBTITLE}}</p>
  </div>

  <div style="display: flex; gap: 24px; height: calc(100% - 180px);">
    <!-- 支柱1 -->
    <div style="flex: 1; ${CARD_STYLE} display: flex; flex-direction: column; border-top: 4px solid ${COLORS.primary}; position: relative;">
      <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(180deg, ${COLORS.primary}, transparent); border-radius: 0 0 0 12px;"></div>
      <div style="width: 56px; height: 56px; background: linear-gradient(135deg, rgba(212, 175, 55, 0.2), rgba(212, 175, 55, 0.1)); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
        <span style="font-size: 24px; font-family: ${FONT_STACK};">{{PILLAR1_ICON}}</span>
      </div>
      <h3 style="font-size: 20px; font-weight: 700; margin: 0 0 12px 0; color: ${COLORS.primary};">{{PILLAR1_TITLE}}</h3>
      <p style="font-size: 14px; color: #94A3B8; margin: 0; flex: 1; line-height: 1.6;">{{PILLAR1_DESC}}</p>
      <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #334155;">
        <div style="font-size: 28px; font-weight: 900; color: ${COLORS.primary};">{{PILLAR1_STAT}}</div>
        <div style="font-size: 12px; color: #64748B;">{{PILLAR1_LABEL}}</div>
      </div>
    </div>

    <!-- 支柱2 -->
    <div style="flex: 1; ${CARD_STYLE} display: flex; flex-direction: column; border-top: 4px solid ${COLORS.secondary}; position: relative;">
      <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(180deg, ${COLORS.secondary}, transparent); border-radius: 0 0 0 12px;"></div>
      <div style="width: 56px; height: 56px; background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(59, 130, 246, 0.1)); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
        <span style="font-size: 24px; font-family: ${FONT_STACK};">{{PILLAR2_ICON}}</span>
      </div>
      <h3 style="font-size: 20px; font-weight: 700; margin: 0 0 12px 0; color: ${COLORS.secondary};">{{PILLAR2_TITLE}}</h3>
      <p style="font-size: 14px; color: #94A3B8; margin: 0; flex: 1; line-height: 1.6;">{{PILLAR2_DESC}}</p>
      <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #334155;">
        <div style="font-size: 28px; font-weight: 900; color: ${COLORS.secondary};">{{PILLAR2_STAT}}</div>
        <div style="font-size: 12px; color: #64748B;">{{PILLAR2_LABEL}}</div>
      </div>
    </div>

    <!-- 支柱3 -->
    <div style="flex: 1; ${CARD_STYLE} display: flex; flex-direction: column; border-top: 4px solid ${COLORS.success}; position: relative;">
      <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(180deg, ${COLORS.success}, transparent); border-radius: 0 0 0 12px;"></div>
      <div style="width: 56px; height: 56px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.1)); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 20px;">
        <span style="font-size: 24px; font-family: ${FONT_STACK};">{{PILLAR3_ICON}}</span>
      </div>
      <h3 style="font-size: 20px; font-weight: 700; margin: 0 0 12px 0; color: ${COLORS.success};">{{PILLAR3_TITLE}}</h3>
      <p style="font-size: 14px; color: #94A3B8; margin: 0; flex: 1; line-height: 1.6;">{{PILLAR3_DESC}}</p>
      <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #334155;">
        <div style="font-size: 28px; font-weight: 900; color: ${COLORS.success};">{{PILLAR3_STAT}}</div>
        <div style="font-size: 12px; color: #64748B;">{{PILLAR3_LABEL}}</div>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}"><span style="color: ${COLORS.primary};">◆</span> 战略规划 | {{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// S-004: 4-Pillar (四支柱)
// ============================================================================

export const FOUR_PILLAR_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "S-004",
    type: "pillars",
    name: "四支柱",
    description: "四列等宽支柱布局，适合展示四个核心要素",
    useCases: ["四大支柱", "战略框架", "核心能力"],
    contentDensity: "high",
    visualStyle: "professional",
    recommendedFor: ["战略规划", "能力矩阵"],
    maxContentBlocks: 4,
    variables: ["{{TITLE}}", "{{PILLARS}}"],
    keywords: ["四大", "支柱", "框架", "战略", "能力"],
    positionFit: { opening: 0.4, middle: 0.95, closing: 0.5 },
    compatibility: {
      goodBefore: ["C-001", "D-002"],
      goodAfter: ["S-002", "N-002"],
      avoidNear: ["S-003", "S-005"],
    },
    tone: "inspiring",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
    <p style="font-size: 18px; color: #94A3B8; margin: 0;">{{SUBTITLE}}</p>
  </div>

  <div style="display: flex; gap: 20px; height: calc(100% - 160px);">
    <div style="flex: 1; ${CARD_STYLE} display: flex; flex-direction: column; border-top: 4px solid ${COLORS.primary};">
      <div style="width: 48px; height: 48px; background: rgba(212, 175, 55, 0.15); border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
        <span style="font-size: 20px; font-family: ${FONT_STACK};">{{PILLAR1_ICON}}</span>
      </div>
      <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 10px 0; color: ${COLORS.primary};">{{PILLAR1_TITLE}}</h3>
      <p style="font-size: 13px; color: #94A3B8; margin: 0; flex: 1; line-height: 1.5;">{{PILLAR1_DESC}}</p>
    </div>

    <div style="flex: 1; ${CARD_STYLE} display: flex; flex-direction: column; border-top: 4px solid ${COLORS.secondary};">
      <div style="width: 48px; height: 48px; background: rgba(59, 130, 246, 0.15); border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
        <span style="font-size: 20px; font-family: ${FONT_STACK};">{{PILLAR2_ICON}}</span>
      </div>
      <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 10px 0; color: ${COLORS.secondary};">{{PILLAR2_TITLE}}</h3>
      <p style="font-size: 13px; color: #94A3B8; margin: 0; flex: 1; line-height: 1.5;">{{PILLAR2_DESC}}</p>
    </div>

    <div style="flex: 1; ${CARD_STYLE} display: flex; flex-direction: column; border-top: 4px solid ${COLORS.success};">
      <div style="width: 48px; height: 48px; background: rgba(16, 185, 129, 0.15); border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
        <span style="font-size: 20px; font-family: ${FONT_STACK};">{{PILLAR3_ICON}}</span>
      </div>
      <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 10px 0; color: ${COLORS.success};">{{PILLAR3_TITLE}}</h3>
      <p style="font-size: 13px; color: #94A3B8; margin: 0; flex: 1; line-height: 1.5;">{{PILLAR3_DESC}}</p>
    </div>

    <div style="flex: 1; ${CARD_STYLE} display: flex; flex-direction: column; border-top: 4px solid ${COLORS.purple};">
      <div style="width: 48px; height: 48px; background: rgba(139, 92, 246, 0.15); border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
        <span style="font-size: 20px; font-family: ${FONT_STACK};">{{PILLAR4_ICON}}</span>
      </div>
      <h3 style="font-size: 16px; font-weight: 700; margin: 0 0 10px 0; color: ${COLORS.purple};">{{PILLAR4_TITLE}}</h3>
      <p style="font-size: 13px; color: #94A3B8; margin: 0; flex: 1; line-height: 1.5;">{{PILLAR4_DESC}}</p>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">战略规划 | {{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// S-005: 5-Pillar (五支柱)
// ============================================================================

export const FIVE_PILLAR_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "S-005",
    type: "pillars",
    name: "五支柱",
    description: "五列紧凑支柱布局，适合展示五个核心要素",
    useCases: ["五大要素", "完整框架", "全面覆盖"],
    contentDensity: "high",
    visualStyle: "professional",
    recommendedFor: ["完整战略", "多维度分析"],
    maxContentBlocks: 5,
    variables: ["{{TITLE}}", "{{PILLARS}}"],
    keywords: ["五大", "支柱", "全面", "完整", "要素"],
    positionFit: { opening: 0.3, middle: 0.9, closing: 0.4 },
    compatibility: {
      goodBefore: ["C-001", "A-001"],
      goodAfter: ["S-002"],
      avoidNear: ["S-003", "S-004"],
    },
    tone: "analytical",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <div style="text-align: center; margin-bottom: 28px;">
    <h1 style="font-size: 32px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
    <p style="font-size: 16px; color: #94A3B8; margin: 0;">{{SUBTITLE}}</p>
  </div>

  <div style="display: flex; gap: 16px; height: calc(100% - 140px);">
    <div style="flex: 1; ${CARD_STYLE} display: flex; flex-direction: column; border-top: 3px solid ${COLORS.primary}; padding: 16px;">
      <div style="font-size: 28px; margin-bottom: 12px; font-family: ${FONT_STACK};">{{P1_ICON}}</div>
      <h3 style="font-size: 14px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.primary};">{{P1_TITLE}}</h3>
      <p style="font-size: 12px; color: #94A3B8; margin: 0; line-height: 1.5;">{{P1_DESC}}</p>
    </div>
    <div style="flex: 1; ${CARD_STYLE} display: flex; flex-direction: column; border-top: 3px solid ${COLORS.secondary}; padding: 16px;">
      <div style="font-size: 28px; margin-bottom: 12px; font-family: ${FONT_STACK};">{{P2_ICON}}</div>
      <h3 style="font-size: 14px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.secondary};">{{P2_TITLE}}</h3>
      <p style="font-size: 12px; color: #94A3B8; margin: 0; line-height: 1.5;">{{P2_DESC}}</p>
    </div>
    <div style="flex: 1; ${CARD_STYLE} display: flex; flex-direction: column; border-top: 3px solid ${COLORS.success}; padding: 16px;">
      <div style="font-size: 28px; margin-bottom: 12px; font-family: ${FONT_STACK};">{{P3_ICON}}</div>
      <h3 style="font-size: 14px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.success};">{{P3_TITLE}}</h3>
      <p style="font-size: 12px; color: #94A3B8; margin: 0; line-height: 1.5;">{{P3_DESC}}</p>
    </div>
    <div style="flex: 1; ${CARD_STYLE} display: flex; flex-direction: column; border-top: 3px solid ${COLORS.purple}; padding: 16px;">
      <div style="font-size: 28px; margin-bottom: 12px; font-family: ${FONT_STACK};">{{P4_ICON}}</div>
      <h3 style="font-size: 14px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.purple};">{{P4_TITLE}}</h3>
      <p style="font-size: 12px; color: #94A3B8; margin: 0; line-height: 1.5;">{{P4_DESC}}</p>
    </div>
    <div style="flex: 1; ${CARD_STYLE} display: flex; flex-direction: column; border-top: 3px solid ${COLORS.warning}; padding: 16px;">
      <div style="font-size: 28px; margin-bottom: 12px; font-family: ${FONT_STACK};">{{P5_ICON}}</div>
      <h3 style="font-size: 14px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.warning};">{{P5_TITLE}}</h3>
      <p style="font-size: 12px; color: #94A3B8; margin: 0; line-height: 1.5;">{{P5_DESC}}</p>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">{{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// S-006: Timeline-Horizontal (横向时间线) - v3.1 增强版
// ============================================================================

export const TIMELINE_HORIZONTAL_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "S-006",
    type: "timeline",
    name: "横向时间线",
    description: "横向排列的时间线，展示项目或事件的时间进度",
    useCases: ["时间线", "项目进度", "发展历程", "里程碑"],
    contentDensity: "high",
    visualStyle: "professional",
    recommendedFor: ["项目规划", "历史回顾"],
    maxContentBlocks: 5,
    variables: ["{{TITLE}}", "{{MILESTONES}}"],
    keywords: ["时间", "进度", "里程碑", "阶段", "历程", "发展"],
    positionFit: { opening: 0.3, middle: 0.95, closing: 0.4 },
    compatibility: {
      goodBefore: ["A-004", "C-001"],
      goodAfter: ["S-002", "N-002"],
      avoidNear: ["S-007"],
    },
    tone: "neutral",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <!-- 标题区域 + 金色装饰竖条 -->
  <div style="position: relative; margin-bottom: 40px;">
    <div style="position: absolute; left: -20px; top: 8px; width: 5px; height: 36px; background: linear-gradient(180deg, ${COLORS.primary}, #B8962E); border-radius: 3px;"></div>
    <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
    <p style="font-size: 16px; color: #94A3B8; margin: 0;">项目实施路线图</p>
  </div>

  <div style="position: relative; padding-top: 40px;">
    <!-- 渐变时间线 -->
    <div style="position: absolute; top: 60px; left: 80px; right: 80px; height: 5px; background: linear-gradient(90deg, ${COLORS.primary}, ${COLORS.secondary}, ${COLORS.success}, ${COLORS.purple}); border-radius: 3px;"></div>

    <div style="display: flex; justify-content: space-between; position: relative;">
      <!-- 里程碑1 -->
      <div style="flex: 1; text-align: center;">
        <div style="width: 28px; height: 28px; background: ${COLORS.primary}; border-radius: 50%; margin: 0 auto 16px; position: relative; z-index: 1; box-shadow: 0 0 12px rgba(212, 175, 55, 0.5);"></div>
        <div style="${CARD_STYLE} margin: 0 8px; border-left: 3px solid ${COLORS.primary};">
          <div style="font-size: 14px; font-weight: 700; color: ${COLORS.primary}; margin-bottom: 8px;">{{M1_DATE}}</div>
          <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">{{M1_TITLE}}</div>
          <p style="font-size: 12px; color: #94A3B8; margin: 0; line-height: 1.5;">{{M1_DESC}}</p>
        </div>
      </div>
      <!-- 里程碑2 -->
      <div style="flex: 1; text-align: center;">
        <div style="width: 28px; height: 28px; background: ${COLORS.secondary}; border-radius: 50%; margin: 0 auto 16px; position: relative; z-index: 1; box-shadow: 0 0 12px rgba(59, 130, 246, 0.5);"></div>
        <div style="${CARD_STYLE} margin: 0 8px; border-left: 3px solid ${COLORS.secondary};">
          <div style="font-size: 14px; font-weight: 700; color: ${COLORS.secondary}; margin-bottom: 8px;">{{M2_DATE}}</div>
          <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">{{M2_TITLE}}</div>
          <p style="font-size: 12px; color: #94A3B8; margin: 0; line-height: 1.5;">{{M2_DESC}}</p>
        </div>
      </div>
      <!-- 里程碑3 -->
      <div style="flex: 1; text-align: center;">
        <div style="width: 28px; height: 28px; background: ${COLORS.success}; border-radius: 50%; margin: 0 auto 16px; position: relative; z-index: 1; box-shadow: 0 0 12px rgba(16, 185, 129, 0.5);"></div>
        <div style="${CARD_STYLE} margin: 0 8px; border-left: 3px solid ${COLORS.success};">
          <div style="font-size: 14px; font-weight: 700; color: ${COLORS.success}; margin-bottom: 8px;">{{M3_DATE}}</div>
          <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">{{M3_TITLE}}</div>
          <p style="font-size: 12px; color: #94A3B8; margin: 0; line-height: 1.5;">{{M3_DESC}}</p>
        </div>
      </div>
      <!-- 里程碑4 -->
      <div style="flex: 1; text-align: center;">
        <div style="width: 28px; height: 28px; background: ${COLORS.purple}; border-radius: 50%; margin: 0 auto 16px; position: relative; z-index: 1; box-shadow: 0 0 12px rgba(139, 92, 246, 0.5);"></div>
        <div style="${CARD_STYLE} margin: 0 8px; border-left: 3px solid ${COLORS.purple};">
          <div style="font-size: 14px; font-weight: 700; color: ${COLORS.purple}; margin-bottom: 8px;">{{M4_DATE}}</div>
          <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">{{M4_TITLE}}</div>
          <p style="font-size: 12px; color: #94A3B8; margin: 0; line-height: 1.5;">{{M4_DESC}}</p>
        </div>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}"><span style="color: ${COLORS.primary};">◆</span> 项目周期 | {{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// S-007: Timeline-Card (卡片时间线)
// ============================================================================

export const TIMELINE_CARD_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "S-007",
    type: "evolutionRoadmap",
    name: "卡片时间线",
    description: "纵向卡片式时间线，适合展示演进路线图",
    useCases: ["演进路线", "发展阶段", "技术演进"],
    contentDensity: "medium",
    visualStyle: "professional",
    recommendedFor: ["技术路线图", "产品演进"],
    maxContentBlocks: 4,
    variables: ["{{TITLE}}", "{{STAGES}}"],
    keywords: ["演进", "路线图", "发展", "阶段", "Roadmap"],
    positionFit: { opening: 0.3, middle: 0.9, closing: 0.5 },
    compatibility: {
      goodBefore: ["A-001", "C-001"],
      goodAfter: ["S-002"],
      avoidNear: ["S-006"],
    },
    tone: "inspiring",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
  <p style="font-size: 18px; color: #94A3B8; margin: 0 0 32px 0;">技术演进路线图</p>

  <div style="display: flex; gap: 24px; height: calc(100% - 120px);">
    <div style="flex: 1; position: relative;">
      <div style="position: absolute; left: 20px; top: 40px; bottom: 40px; width: 2px; background: linear-gradient(180deg, ${COLORS.primary}, ${COLORS.success});"></div>

      <div style="position: relative; padding-left: 50px; margin-bottom: 24px;">
        <div style="position: absolute; left: 12px; width: 18px; height: 18px; background: ${COLORS.primary}; border-radius: 50%; border: 3px solid #0F172A;"></div>
        <div style="${CARD_STYLE} border-left: 3px solid ${COLORS.primary};">
          <div style="font-size: 12px; color: ${COLORS.primary}; font-weight: 600;">阶段 1</div>
          <h4 style="font-size: 16px; font-weight: 700; margin: 8px 0;">{{STAGE1_TITLE}}</h4>
          <p style="font-size: 13px; color: #94A3B8; margin: 0;">{{STAGE1_DESC}}</p>
        </div>
      </div>

      <div style="position: relative; padding-left: 50px; margin-bottom: 24px;">
        <div style="position: absolute; left: 12px; width: 18px; height: 18px; background: ${COLORS.secondary}; border-radius: 50%; border: 3px solid #0F172A;"></div>
        <div style="${CARD_STYLE} border-left: 3px solid ${COLORS.secondary};">
          <div style="font-size: 12px; color: ${COLORS.secondary}; font-weight: 600;">阶段 2</div>
          <h4 style="font-size: 16px; font-weight: 700; margin: 8px 0;">{{STAGE2_TITLE}}</h4>
          <p style="font-size: 13px; color: #94A3B8; margin: 0;">{{STAGE2_DESC}}</p>
        </div>
      </div>

      <div style="position: relative; padding-left: 50px;">
        <div style="position: absolute; left: 12px; width: 18px; height: 18px; background: ${COLORS.success}; border-radius: 50%; border: 3px solid #0F172A;"></div>
        <div style="${CARD_STYLE} border-left: 3px solid ${COLORS.success};">
          <div style="font-size: 12px; color: ${COLORS.success}; font-weight: 600;">阶段 3</div>
          <h4 style="font-size: 16px; font-weight: 700; margin: 8px 0;">{{STAGE3_TITLE}}</h4>
          <p style="font-size: 13px; color: #94A3B8; margin: 0;">{{STAGE3_DESC}}</p>
        </div>
      </div>
    </div>

    <div style="flex: 0 0 300px; ${CARD_STYLE} display: flex; flex-direction: column; justify-content: center; background: rgba(212, 175, 55, 0.1); border-color: rgba(212, 175, 55, 0.3);">
      <div style="font-size: 14px; color: ${COLORS.primary}; font-weight: 600; margin-bottom: 16px;">目标愿景</div>
      <h3 style="font-size: 24px; font-weight: 900; margin: 0 0 16px 0; color: ${COLORS.primary};">{{VISION_TITLE}}</h3>
      <p style="font-size: 14px; color: #F8FAFC; margin: 0; line-height: 1.6;">{{VISION_DESC}}</p>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">{{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// S-008: Process-Steps (流程步骤)
// ============================================================================

export const PROCESS_STEPS_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "S-008",
    type: "framework",
    name: "流程步骤",
    description: "横向箭头流程图，展示步骤化的流程",
    useCases: ["流程图", "步骤说明", "操作指南"],
    contentDensity: "medium",
    visualStyle: "professional",
    recommendedFor: ["操作流程", "实施步骤"],
    maxContentBlocks: 5,
    variables: ["{{TITLE}}", "{{STEPS}}"],
    keywords: ["流程", "步骤", "操作", "指南", "过程"],
    positionFit: { opening: 0.4, middle: 0.9, closing: 0.5 },
    compatibility: {
      goodBefore: ["C-001", "A-004"],
      goodAfter: ["S-002", "N-002"],
      avoidNear: ["S-009"],
    },
    tone: "neutral",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
  <p style="font-size: 18px; color: #94A3B8; margin: 0 0 48px 0;">实施流程与关键步骤</p>

  <div style="display: flex; align-items: flex-start; gap: 12px; height: calc(100% - 160px);">
    <div style="flex: 1; text-align: center;">
      <div style="width: 60px; height: 60px; background: ${COLORS.primary}; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 24px; font-weight: 900;">1</div>
      <div style="${CARD_STYLE}">
        <h4 style="font-size: 16px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.primary};">{{STEP1_TITLE}}</h4>
        <p style="font-size: 13px; color: #94A3B8; margin: 0;">{{STEP1_DESC}}</p>
      </div>
    </div>

    <div style="font-size: 24px; color: #334155; margin-top: 18px;">→</div>

    <div style="flex: 1; text-align: center;">
      <div style="width: 60px; height: 60px; background: ${COLORS.secondary}; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 24px; font-weight: 900;">2</div>
      <div style="${CARD_STYLE}">
        <h4 style="font-size: 16px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.secondary};">{{STEP2_TITLE}}</h4>
        <p style="font-size: 13px; color: #94A3B8; margin: 0;">{{STEP2_DESC}}</p>
      </div>
    </div>

    <div style="font-size: 24px; color: #334155; margin-top: 18px;">→</div>

    <div style="flex: 1; text-align: center;">
      <div style="width: 60px; height: 60px; background: ${COLORS.success}; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 24px; font-weight: 900;">3</div>
      <div style="${CARD_STYLE}">
        <h4 style="font-size: 16px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.success};">{{STEP3_TITLE}}</h4>
        <p style="font-size: 13px; color: #94A3B8; margin: 0;">{{STEP3_DESC}}</p>
      </div>
    </div>

    <div style="font-size: 24px; color: #334155; margin-top: 18px;">→</div>

    <div style="flex: 1; text-align: center;">
      <div style="width: 60px; height: 60px; background: ${COLORS.purple}; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 24px; font-weight: 900;">4</div>
      <div style="${CARD_STYLE}">
        <h4 style="font-size: 16px; font-weight: 700; margin: 0 0 8px 0; color: ${COLORS.purple};">{{STEP4_TITLE}}</h4>
        <p style="font-size: 13px; color: #94A3B8; margin: 0;">{{STEP4_DESC}}</p>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">{{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// S-009: Pyramid (金字塔)
// ============================================================================

export const PYRAMID_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "S-009",
    type: "framework",
    name: "金字塔",
    description: "金字塔层次结构图，展示层级关系",
    useCases: ["层次结构", "优先级", "金字塔模型"],
    contentDensity: "medium",
    visualStyle: "professional",
    recommendedFor: ["战略层级", "能力模型"],
    maxContentBlocks: 4,
    variables: ["{{TITLE}}", "{{LAYERS}}"],
    keywords: ["金字塔", "层次", "结构", "优先级", "层级"],
    positionFit: { opening: 0.4, middle: 0.9, closing: 0.5 },
    compatibility: {
      goodBefore: ["C-001", "A-001"],
      goodAfter: ["S-002"],
      avoidNear: ["S-008"],
    },
    tone: "analytical",
  },
  html: `
<div style="${COMMON_CONTAINER}">
  <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
  <p style="font-size: 18px; color: #94A3B8; margin: 0 0 32px 0;">战略层次模型</p>

  <div style="display: flex; gap: 40px; height: calc(100% - 120px);">
    <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;">
      <div style="width: 100%; max-width: 500px;">
        <div style="width: 40%; margin: 0 auto 8px; padding: 20px; background: ${COLORS.primary}; text-align: center; clip-path: polygon(10% 0%, 90% 0%, 100% 100%, 0% 100%);">
          <div style="font-size: 14px; font-weight: 700;">{{L1_TITLE}}</div>
        </div>
        <div style="width: 60%; margin: 0 auto 8px; padding: 20px; background: ${COLORS.secondary}; text-align: center; clip-path: polygon(8% 0%, 92% 0%, 100% 100%, 0% 100%);">
          <div style="font-size: 14px; font-weight: 700;">{{L2_TITLE}}</div>
        </div>
        <div style="width: 80%; margin: 0 auto 8px; padding: 20px; background: ${COLORS.success}; text-align: center; clip-path: polygon(5% 0%, 95% 0%, 100% 100%, 0% 100%);">
          <div style="font-size: 14px; font-weight: 700;">{{L3_TITLE}}</div>
        </div>
        <div style="width: 100%; padding: 24px; background: rgba(30, 41, 59, 0.8); border: 1px solid #334155; text-align: center;">
          <div style="font-size: 14px; font-weight: 700;">{{L4_TITLE}}</div>
        </div>
      </div>
    </div>

    <div style="flex: 0 0 350px; display: flex; flex-direction: column; gap: 16px;">
      <div style="${CARD_STYLE} border-left: 3px solid ${COLORS.primary};">
        <div style="font-size: 14px; font-weight: 700; color: ${COLORS.primary}; margin-bottom: 8px;">{{L1_TITLE}}</div>
        <p style="font-size: 13px; color: #94A3B8; margin: 0;">{{L1_DESC}}</p>
      </div>
      <div style="${CARD_STYLE} border-left: 3px solid ${COLORS.secondary};">
        <div style="font-size: 14px; font-weight: 700; color: ${COLORS.secondary}; margin-bottom: 8px;">{{L2_TITLE}}</div>
        <p style="font-size: 13px; color: #94A3B8; margin: 0;">{{L2_DESC}}</p>
      </div>
      <div style="${CARD_STYLE} border-left: 3px solid ${COLORS.success};">
        <div style="font-size: 14px; font-weight: 700; color: ${COLORS.success}; margin-bottom: 8px;">{{L3_TITLE}}</div>
        <p style="font-size: 13px; color: #94A3B8; margin: 0;">{{L3_DESC}}</p>
      </div>
      <div style="${CARD_STYLE} border-left: 3px solid #64748B;">
        <div style="font-size: 14px; font-weight: 700; color: #94A3B8; margin-bottom: 8px;">{{L4_TITLE}}</div>
        <p style="font-size: 13px; color: #94A3B8; margin: 0;">{{L4_DESC}}</p>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">{{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// Export All Structural Templates
// ============================================================================

export const STRUCTURAL_TEMPLATES: SlideTemplate[] = [
  TOC_DUAL_TEMPLATE,
  SECTION_DIVIDER_TEMPLATE,
  THREE_PILLAR_TEMPLATE,
  FOUR_PILLAR_TEMPLATE,
  FIVE_PILLAR_TEMPLATE,
  TIMELINE_HORIZONTAL_TEMPLATE,
  TIMELINE_CARD_TEMPLATE,
  PROCESS_STEPS_TEMPLATE,
  PYRAMID_TEMPLATE,
];
