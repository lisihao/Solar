/**
 * Slides Engine v3.0 - Narrative Templates (叙事型模板)
 *
 * 用于故事讲述、开场、收尾的模板
 * 设计意图: 建立情感连接，引导叙事节奏
 */

import {
  COLORS,
  TYPOGRAPHY,
  SPACING,
  EFFECTS,
  CANVAS,
  CARD_VARIANTS,
} from "../base/design-tokens";
import { SlideTemplate, templateRegistry } from "../base/template-registry";
import { PageTemplateType } from "../../checkpoint/checkpoint.types";

// ============================================================================
// N-001: Cover (封面页)
// ============================================================================

const N001_COVER: SlideTemplate = {
  metadata: {
    id: "N-001",
    type: "cover" as PageTemplateType,
    name: "封面页",
    description: "演示文稿的首页，包含标题、副标题和装饰元素",
    useCases: ["报告开场", "产品发布", "战略汇报", "项目启动"],
    contentDensity: "low",
    visualStyle: "professional",
    recommendedFor: ["首页", "开场", "标题页"],
    maxContentBlocks: 2,
    variables: ["TITLE", "SUBTITLE", "AUTHOR", "DATE"],
    keywords: ["封面", "标题", "开场", "首页", "Cover"],
    positionFit: { opening: 1.0, middle: 0.0, closing: 0.3 },
    compatibility: {
      goodBefore: ["S-001", "N-004"],
      goodAfter: [],
      avoidNear: ["A-005"],
    },
    tone: "inspiring",
  },
  html: `
<div style="
  width: ${CANVAS.width}px;
  height: ${CANVAS.height}px;
  background: linear-gradient(135deg, ${COLORS.bgPrimary} 0%, ${COLORS.bgSecondary} 50%, #0c1222 100%);
  font-family: ${TYPOGRAPHY.fontFamily};
  color: ${COLORS.textPrimary};
  padding: ${SPACING.pageTop}px ${SPACING.pageRight}px ${SPACING.pageBottom}px ${SPACING.pageLeft}px;
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
">
  <!-- 增强装饰元素 - 多层渐变光晕 -->
  <div style="position: absolute; top: -150px; right: -100px; width: 500px; height: 500px; background: radial-gradient(circle, rgba(212, 175, 55, 0.15) 0%, rgba(212, 175, 55, 0.05) 40%, transparent 70%); border-radius: 50%;"></div>
  <div style="position: absolute; top: 100px; right: 200px; width: 300px; height: 300px; background: radial-gradient(circle, rgba(59, 130, 246, 0.12) 0%, transparent 60%); border-radius: 50%;"></div>
  <div style="position: absolute; bottom: -100px; left: -100px; width: 400px; height: 400px; background: radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 70%); border-radius: 50%;"></div>
  <div style="position: absolute; bottom: 150px; left: 300px; width: 200px; height: 200px; background: radial-gradient(circle, rgba(16, 185, 129, 0.08) 0%, transparent 60%); border-radius: 50%;"></div>

  <!-- 右侧几何装饰图案 -->
  <div style="position: absolute; top: 80px; right: 80px; width: 180px; height: 180px;">
    <div style="position: absolute; top: 0; right: 0; width: 120px; height: 120px; border: 2px solid rgba(212, 175, 55, 0.3); border-radius: 12px; transform: rotate(15deg);"></div>
    <div style="position: absolute; top: 30px; right: 30px; width: 80px; height: 80px; border: 2px solid rgba(59, 130, 246, 0.25); border-radius: 8px; transform: rotate(-10deg);"></div>
    <div style="position: absolute; top: 50px; right: 50px; width: 40px; height: 40px; background: linear-gradient(135deg, ${COLORS.accentGold}, ${COLORS.accentBlue}); border-radius: 6px; opacity: 0.8;"></div>
  </div>

  <!-- 左侧竖线装饰 -->
  <div style="position: absolute; left: 40px; top: 100px; width: 3px; height: 150px; background: linear-gradient(180deg, ${COLORS.accentGold}, transparent);"></div>

  <!-- 主内容区 -->
  <div style="display: flex; flex-direction: column; justify-content: center; height: 100%; position: relative; z-index: 1; max-width: 75%;">
    <!-- 顶部装饰线组 -->
    <div style="display: flex; gap: 8px; margin-bottom: 40px;">
      <div style="width: 60px; height: 4px; background: ${COLORS.accentGold}; border-radius: 2px;"></div>
      <div style="width: 30px; height: 4px; background: ${COLORS.accentBlue}; border-radius: 2px;"></div>
      <div style="width: 15px; height: 4px; background: ${COLORS.accentGreen}; border-radius: 2px;"></div>
    </div>

    <!-- 标签 -->
    <div style="display: inline-flex; background: rgba(212, 175, 55, 0.15); border: 1px solid rgba(212, 175, 55, 0.3); padding: 6px 16px; border-radius: 20px; font-size: 12px; color: ${COLORS.accentGold}; font-weight: 600; margin-bottom: 24px; width: fit-content; letter-spacing: 2px;">
      专业报告
    </div>

    <!-- 标题 - 增大字号 -->
    <h1 style="font-size: 52px; font-weight: ${TYPOGRAPHY.title.h1.weight}; margin: 0 0 20px 0; line-height: 1.2; background: linear-gradient(90deg, ${COLORS.textPrimary} 0%, ${COLORS.textMuted} 100%); -webkit-background-clip: text; background-clip: text;">{{TITLE}}</h1>

    <!-- 副标题 -->
    <p style="font-size: 22px; color: ${COLORS.textMuted}; margin: 0 0 48px 0; line-height: 1.6;">{{SUBTITLE}}</p>

    <!-- 分隔线 -->
    <div style="width: 100%; height: 1px; background: linear-gradient(90deg, rgba(100, 116, 139, 0.3), transparent); margin-bottom: 32px;"></div>

    <!-- 元信息 - 增强样式 -->
    <div style="display: flex; gap: 48px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 40px; height: 40px; background: rgba(212, 175, 55, 0.1); border: 1px solid rgba(212, 175, 55, 0.2); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${COLORS.accentGold}" stroke-width="2">
            <circle cx="12" cy="8" r="4"/>
            <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
          </svg>
        </div>
        <div>
          <div style="font-size: 11px; color: ${COLORS.textSubtle}; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 1px;">演示者</div>
          <div style="font-size: 15px; font-weight: 600;">{{AUTHOR}}</div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 40px; height: 40px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${COLORS.accentBlue}" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </div>
        <div>
          <div style="font-size: 11px; color: ${COLORS.textSubtle}; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 1px;">日期</div>
          <div style="font-size: 15px; font-weight: 600;">{{DATE}}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- 底部增强装饰 -->
  <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 6px; background: linear-gradient(90deg, ${COLORS.accentGold} 0%, ${COLORS.accentBlue} 50%, ${COLORS.accentGreen} 100%);"></div>
  <div style="position: absolute; bottom: 6px; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, rgba(212, 175, 55, 0.3) 0%, rgba(59, 130, 246, 0.3) 50%, rgba(16, 185, 129, 0.3) 100%);"></div>
</div>
  `.trim(),
};

// ============================================================================
// N-002: Executive Summary (执行摘要)
// ============================================================================

const N002_EXECUTIVE_SUMMARY: SlideTemplate = {
  metadata: {
    id: "N-002",
    type: "splitLayout" as PageTemplateType,
    name: "执行摘要",
    description: "三大核心判断卡片+底部洞察区，用于报告开头",
    useCases: ["报告摘要", "核心发现", "关键结论", "总结概述"],
    contentDensity: "high",
    visualStyle: "professional",
    recommendedFor: ["摘要", "总结", "要点"],
    maxContentBlocks: 5,
    variables: [
      "TITLE",
      "SUBTITLE",
      "JUDGMENT_1_TITLE",
      "JUDGMENT_1_DESC",
      "JUDGMENT_2_TITLE",
      "JUDGMENT_2_DESC",
      "JUDGMENT_3_TITLE",
      "JUDGMENT_3_DESC",
    ],
    keywords: ["摘要", "执行", "总结", "核心", "发现", "Summary"],
    positionFit: { opening: 0.9, middle: 0.5, closing: 0.7 },
    compatibility: {
      goodBefore: ["S-002", "N-003"],
      goodAfter: ["N-001", "N-004"],
      avoidNear: [],
    },
    tone: "analytical",
  },
  html: `
<div style="
  width: ${CANVAS.width}px;
  height: ${CANVAS.height}px;
  background: linear-gradient(135deg, ${COLORS.bgPrimary} 0%, ${COLORS.bgSecondary} 100%);
  font-family: ${TYPOGRAPHY.fontFamily};
  color: ${COLORS.textPrimary};
  padding: ${SPACING.pageTop}px ${SPACING.pageRight}px ${SPACING.pageBottom}px ${SPACING.pageLeft}px;
  box-sizing: border-box;
  position: relative;
">
  <!-- 标题区 -->
  <div style="margin-bottom: 24px;">
    <h1 style="font-size: 38px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
    <p style="font-size: 16px; color: ${COLORS.textMuted}; margin: 0;">{{SUBTITLE}}</p>
  </div>

  <!-- 三大判断卡片 -->
  <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 20px;">
    <!-- 判断1 -->
    <div style="background: ${CARD_VARIANTS.gold.background}; border: 1px solid ${CARD_VARIANTS.gold.border}; border-radius: ${EFFECTS.borderRadius.lg}; padding: 20px; border-top: 3px solid ${COLORS.accentGold};">
      <div style="display: inline-block; background: ${COLORS.accentGold}; color: ${COLORS.bgPrimary}; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 4px; margin-bottom: 12px;">判断 1</div>
      <h3 style="font-size: 18px; font-weight: 700; color: ${COLORS.accentGold}; margin: 0 0 12px 0;">{{JUDGMENT_1_TITLE}}</h3>
      <p style="font-size: 13px; color: ${COLORS.textMuted}; margin: 0; line-height: 1.6;">{{JUDGMENT_1_DESC}}</p>
    </div>
    <!-- 判断2 -->
    <div style="background: ${CARD_VARIANTS.blue.background}; border: 1px solid ${CARD_VARIANTS.blue.border}; border-radius: ${EFFECTS.borderRadius.lg}; padding: 20px; border-top: 3px solid ${COLORS.accentBlue};">
      <div style="display: inline-block; background: ${COLORS.accentBlue}; color: #FFFFFF; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 4px; margin-bottom: 12px;">判断 2</div>
      <h3 style="font-size: 18px; font-weight: 700; color: ${COLORS.accentBlue}; margin: 0 0 12px 0;">{{JUDGMENT_2_TITLE}}</h3>
      <p style="font-size: 13px; color: ${COLORS.textMuted}; margin: 0; line-height: 1.6;">{{JUDGMENT_2_DESC}}</p>
    </div>
    <!-- 判断3 -->
    <div style="background: ${CARD_VARIANTS.green.background}; border: 1px solid ${CARD_VARIANTS.green.border}; border-radius: ${EFFECTS.borderRadius.lg}; padding: 20px; border-top: 3px solid ${COLORS.accentGreen};">
      <div style="display: inline-block; background: ${COLORS.accentGreen}; color: #FFFFFF; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 4px; margin-bottom: 12px;">判断 3</div>
      <h3 style="font-size: 18px; font-weight: 700; color: ${COLORS.accentGreen}; margin: 0 0 12px 0;">{{JUDGMENT_3_TITLE}}</h3>
      <p style="font-size: 13px; color: ${COLORS.textMuted}; margin: 0; line-height: 1.6;">{{JUDGMENT_3_DESC}}</p>
    </div>
  </div>

  <!-- 底部洞察区 -->
  <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px;">
    <!-- 关键洞察 -->
    <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid ${COLORS.borderDefault}; border-radius: ${EFFECTS.borderRadius.lg}; padding: 20px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
        <span style="color: ${COLORS.accentAmber};">💡</span>
        <span style="font-size: 16px; font-weight: 700; color: ${COLORS.accentAmber};">关键洞察</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        {{KEY_INSIGHTS}}
      </div>
    </div>
    <!-- 建议框 -->
    <div style="background: ${CARD_VARIANTS.highlight.background}; border: 1px solid ${CARD_VARIANTS.highlight.border}; border-radius: ${EFFECTS.borderRadius.lg}; padding: 20px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
        <span style="color: ${COLORS.accentGold};">🎯</span>
        <span style="font-size: 16px; font-weight: 700; color: ${COLORS.accentGold};">核心建议</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        {{RECOMMENDATIONS}}
      </div>
    </div>
  </div>

  <!-- 页脚 -->
  <div style="position: absolute; bottom: 24px; left: ${SPACING.pageLeft}px; right: ${SPACING.pageRight}px; font-size: 12px; color: ${COLORS.textSubtle};">
    数据来源: 战略研究院 | {{TITLE}}
  </div>
</div>
  `.trim(),
};

// ============================================================================
// N-003: Chapter Divider (章节分隔页)
// ============================================================================

const N003_CHAPTER_DIVIDER: SlideTemplate = {
  metadata: {
    id: "N-003",
    type: "framework" as PageTemplateType,
    name: "章节分隔页",
    description: "章节过渡页，大号章节编号+居中标题，用于分隔报告章节",
    useCases: ["章节过渡", "主题切换", "内容分隔"],
    contentDensity: "low",
    visualStyle: "professional",
    recommendedFor: ["章节", "分隔", "过渡"],
    maxContentBlocks: 1,
    variables: ["CHAPTER_NUM", "CHAPTER_EN", "TITLE", "SUBTITLE"],
    keywords: ["章节", "分隔", "过渡", "Chapter", "Part"],
    positionFit: { opening: 0.4, middle: 0.9, closing: 0.2 },
    compatibility: {
      goodBefore: ["S-003", "C-001"],
      goodAfter: ["N-002", "S-001"],
      avoidNear: ["N-003"],
    },
    tone: "neutral",
  },
  html: `
<div style="
  width: ${CANVAS.width}px;
  height: ${CANVAS.height}px;
  background: linear-gradient(135deg, ${COLORS.bgPrimary} 0%, ${COLORS.bgSecondary} 100%);
  font-family: ${TYPOGRAPHY.fontFamily};
  color: ${COLORS.textPrimary};
  padding: ${SPACING.pageTop}px ${SPACING.pageRight}px ${SPACING.pageBottom}px ${SPACING.pageLeft}px;
  box-sizing: border-box;
  position: relative;
">
  <!-- 左上角装饰 -->
  <div style="position: absolute; top: 50px; left: 80px; font-size: 14px; color: ${COLORS.textSubtle};">I</div>

  <!-- 左侧大号章节编号 -->
  <div style="position: absolute; top: 120px; left: 80px; font-size: 180px; font-weight: 900; color: rgba(100, 116, 139, 0.15); line-height: 1;">{{CHAPTER_NUM}}</div>

  <!-- 右上角装饰线 -->
  <div style="position: absolute; top: 50px; right: 80px; width: 120px; height: 120px; border-top: 2px solid ${COLORS.accentGold}; border-right: 2px solid ${COLORS.accentGold};"></div>

  <!-- 中心内容 -->
  <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center;">
    <!-- 章节标签 -->
    <div style="font-size: 14px; color: ${COLORS.textMuted}; letter-spacing: 4px; margin-bottom: 16px;">{{CHAPTER_EN}}</div>

    <!-- 装饰线 -->
    <div style="width: 80px; height: 4px; background: ${COLORS.accentGold}; margin-bottom: 24px;"></div>

    <!-- 主标题 -->
    <h1 style="font-size: ${TYPOGRAPHY.title.h1.size}; font-weight: ${TYPOGRAPHY.title.h1.weight}; margin: 0 0 16px 0; line-height: 1.3;">{{TITLE}}</h1>

    <!-- 分隔线 -->
    <div style="width: 600px; height: 1px; background: linear-gradient(90deg, transparent, ${COLORS.borderDefault}, transparent); margin: 24px 0;"></div>

    <!-- 副标题 -->
    <p style="font-size: 18px; color: ${COLORS.textMuted}; margin: 0;">{{SUBTITLE}}</p>
  </div>

  <!-- 左下角装饰线 -->
  <div style="position: absolute; bottom: 80px; left: 80px; width: 120px; height: 120px; border-bottom: 2px solid ${COLORS.borderDefault}; border-left: 2px solid ${COLORS.borderDefault};"></div>

  <!-- 页脚 -->
  <div style="position: absolute; bottom: 24px; left: ${SPACING.pageLeft}px; right: ${SPACING.pageRight}px; font-size: 12px; color: ${COLORS.textSubtle};">
    第{{CHAPTER_NUM}}章
  </div>
</div>
  `.trim(),
};

// ============================================================================
// N-004: Table of Contents (目录页)
// ============================================================================

const N004_TOC: SlideTemplate = {
  metadata: {
    id: "N-004",
    type: "toc" as PageTemplateType,
    name: "目录页",
    description: "展示演示文稿的内容结构和章节，采用双列金色编号布局",
    useCases: ["内容导航", "章节概览", "结构展示"],
    contentDensity: "medium",
    visualStyle: "professional",
    recommendedFor: ["目录", "大纲", "导航"],
    maxContentBlocks: 8,
    variables: ["TITLE", "CHAPTERS"],
    keywords: ["目录", "大纲", "内容", "TOC", "Contents"],
    positionFit: { opening: 0.95, middle: 0.3, closing: 0.1 },
    compatibility: {
      goodBefore: ["N-003", "S-002"],
      goodAfter: ["N-001"],
      avoidNear: ["A-005"],
    },
    tone: "neutral",
  },
  html: `
<div style="
  width: ${CANVAS.width}px;
  height: ${CANVAS.height}px;
  background: linear-gradient(135deg, ${COLORS.bgPrimary} 0%, ${COLORS.bgSecondary} 100%);
  font-family: ${TYPOGRAPHY.fontFamily};
  color: ${COLORS.textPrimary};
  padding: ${SPACING.pageTop}px ${SPACING.pageRight}px ${SPACING.pageBottom}px ${SPACING.pageLeft}px;
  box-sizing: border-box;
  position: relative;
">
  <!-- 大标题 -->
  <h1 style="font-size: 64px; font-weight: 900; margin: 0 0 4px 0;">{{TITLE}}</h1>
  <p style="font-size: 20px; color: ${COLORS.accentGold}; font-weight: 500; letter-spacing: 4px; margin: 0 0 48px 0;">TABLE OF CONTENTS</p>

  <!-- 双列章节列表 -->
  <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap-x: 80px; gap-y: 32px; margin-bottom: 48px;">
    {{CHAPTERS}}
  </div>

  <!-- 报告概览框 -->
  <div style="position: absolute; bottom: 100px; left: 80px; width: 400px; padding: 20px; border-left: 3px solid ${COLORS.accentGold}; background: rgba(30, 41, 59, 0.5);">
    <div style="font-size: 16px; font-weight: 700; margin-bottom: 8px;">报告概览</div>
    <p style="font-size: 13px; color: ${COLORS.textMuted}; margin: 0; line-height: 1.6;">{{OVERVIEW}}</p>
  </div>

  <!-- 页脚 -->
  <div style="position: absolute; bottom: 24px; left: ${SPACING.pageLeft}px; right: ${SPACING.pageRight}px; font-size: 12px; color: ${COLORS.textSubtle};">
    {{TITLE}} | 内容概览
  </div>
</div>
  `.trim(),
};

// ============================================================================
// N-005: Closing/Thank You (结束页)
// ============================================================================

const N005_CLOSING: SlideTemplate = {
  metadata: {
    id: "N-005",
    type: "closing" as PageTemplateType, // 修复：使用正确的 closing 类型
    name: "结束页",
    description: "演示文稿的结束页，包含感谢语、联系方式和品牌信息",
    useCases: ["演示结束", "感谢致辞", "联系方式"],
    contentDensity: "low",
    visualStyle: "professional",
    recommendedFor: ["结束", "感谢", "结尾"],
    maxContentBlocks: 2,
    variables: [
      "TITLE",
      "MESSAGE",
      "CONTACT_NAME",
      "CONTACT_EMAIL",
      "CONTACT_PHONE",
    ],
    keywords: ["结束", "感谢", "谢谢", "Thank", "End"],
    positionFit: { opening: 0.0, middle: 0.0, closing: 1.0 },
    compatibility: {
      goodBefore: [],
      goodAfter: ["A-001", "A-003", "A-004"],
      avoidNear: ["N-001"],
    },
    tone: "positive",
  },
  html: `
<div style="
  width: ${CANVAS.width}px;
  height: ${CANVAS.height}px;
  background: linear-gradient(135deg, ${COLORS.bgPrimary} 0%, ${COLORS.bgSecondary} 100%);
  font-family: ${TYPOGRAPHY.fontFamily};
  color: ${COLORS.textPrimary};
  padding: ${SPACING.pageTop}px ${SPACING.pageRight}px ${SPACING.pageBottom}px ${SPACING.pageLeft}px;
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
">
  <!-- 装饰元素 -->
  <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 600px; height: 600px; background: radial-gradient(circle, rgba(212, 175, 55, 0.05) 0%, transparent 70%); border-radius: 50%;"></div>

  <!-- 主内容区 -->
  <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; position: relative; z-index: 1;">
    <!-- 装饰线 -->
    <div style="width: 80px; height: 4px; background: linear-gradient(90deg, ${COLORS.accentGold} 0%, ${COLORS.accentBlue} 100%); margin-bottom: 32px;"></div>

    <!-- 感谢语 -->
    <h1 style="font-size: 56px; font-weight: 900; margin: 0 0 24px 0; background: linear-gradient(90deg, ${COLORS.accentGold}, ${COLORS.accentBlue}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">{{TITLE}}</h1>

    <!-- 副标题 -->
    <p style="font-size: 20px; color: ${COLORS.textMuted}; margin: 0 0 48px 0; max-width: 600px;">{{MESSAGE}}</p>

    <!-- 联系信息 -->
    <div style="background: ${CARD_VARIANTS.default.background}; border: 1px solid ${COLORS.borderDefault}; border-radius: ${EFFECTS.borderRadius.lg}; padding: 24px 48px; display: inline-flex; gap: 48px;">
      <div style="text-align: center;">
        <div style="font-size: 12px; color: ${COLORS.textSubtle}; margin-bottom: 4px;">联系人</div>
        <div style="font-size: 16px; font-weight: 600;">{{CONTACT_NAME}}</div>
      </div>
      <div style="width: 1px; background: ${COLORS.borderDefault};"></div>
      <div style="text-align: center;">
        <div style="font-size: 12px; color: ${COLORS.textSubtle}; margin-bottom: 4px;">邮箱</div>
        <div style="font-size: 16px; font-weight: 600; color: ${COLORS.accentBlue};">{{CONTACT_EMAIL}}</div>
      </div>
      <div style="width: 1px; background: ${COLORS.borderDefault};"></div>
      <div style="text-align: center;">
        <div style="font-size: 12px; color: ${COLORS.textSubtle}; margin-bottom: 4px;">电话</div>
        <div style="font-size: 16px; font-weight: 600;">{{CONTACT_PHONE}}</div>
      </div>
    </div>
  </div>

  <!-- 底部装饰 -->
  <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, ${COLORS.accentGold}, ${COLORS.accentBlue}, ${COLORS.accentGreen});"></div>
</div>
  `.trim(),
};

// ============================================================================
// Register All Narrative Templates
// ============================================================================

export const NARRATIVE_TEMPLATES = [
  N001_COVER,
  N002_EXECUTIVE_SUMMARY,
  N003_CHAPTER_DIVIDER,
  N004_TOC,
  N005_CLOSING,
];

export function registerNarrativeTemplates(): void {
  NARRATIVE_TEMPLATES.forEach((template) => {
    templateRegistry.register(template);
  });
}
