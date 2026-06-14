/**
 * Slides Engine v3.0 - Data Templates
 *
 * 数据型模板 (6个)：用于展示数据、指标和分析
 * D-001 ~ D-006
 */

import { SlideTemplate } from "../base/template-registry";
import {
  DATA_CONTAINER,
  COMPARISON_CONTAINER,
  FOOTER_STYLE,
  COLORS,
  GRADIENTS,
} from "../base/common-styles";

// ============================================================================
// D-001: Big-Number (大数字)
// ============================================================================

export const BIG_NUMBER_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "D-001",
    type: "dashboard",
    name: "大数字",
    description: "突出展示单个核心数据指标",
    useCases: ["核心指标", "关键数据", "重点数字"],
    contentDensity: "low",
    visualStyle: "data-driven",
    recommendedFor: ["数据亮点", "成果展示"],
    maxContentBlocks: 3,
    variables: ["{{TITLE}}", "{{NUMBER}}", "{{LABEL}}", "{{CHANGE}}"],
    keywords: ["数字", "指标", "数据", "增长", "统计", "KPI"],
    positionFit: { opening: 0.5, middle: 0.9, closing: 0.6 },
    compatibility: {
      goodBefore: ["C-003", "A-001"],
      goodAfter: ["S-002", "N-002"],
      avoidNear: ["D-002"],
    },
    tone: "positive",
  },
  html: `
<div style="${DATA_CONTAINER}">
  <!-- 背景装饰：大数字强调 -->
  <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 400px; font-weight: 900; color: rgba(212, 175, 55, 0.03); line-height: 1; pointer-events: none;">{{NUMBER}}</div>

  <!-- 顶部指示线 -->
  <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: ${GRADIENTS.primary};"></div>

  <h1 style="font-size: 32px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
  <p style="font-size: 16px; color: #94A3B8; margin: 0 0 24px 0;">核心业务指标</p>

  <div style="display: flex; align-items: center; justify-content: center; height: calc(100% - 160px); position: relative; z-index: 1;">
    <div style="text-align: center;">
      <!-- 数字光晕效果 -->
      <div style="position: relative;">
        <div style="position: absolute; inset: -40px; background: radial-gradient(circle, rgba(212, 175, 55, 0.15) 0%, transparent 70%); border-radius: 50%;"></div>
        <div style="font-size: 140px; font-weight: 900; background: ${GRADIENTS.gold}; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1; margin-bottom: 16px; position: relative;">{{NUMBER}}</div>
      </div>
      <div style="font-size: 28px; color: #F8FAFC; margin-bottom: 32px; font-weight: 600;">{{LABEL}}</div>

      <!-- 变化指示器 -->
      <div style="display: inline-flex; align-items: center; gap: 16px; padding: 16px 32px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px;">
        <div style="width: 48px; height: 48px; background: ${COLORS.success}; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
          <span style="font-size: 24px;">↑</span>
        </div>
        <div style="text-align: left;">
          <div style="font-size: 24px; font-weight: 900; color: ${COLORS.success};">{{CHANGE}}</div>
          <div style="font-size: 14px; color: #94A3B8;">较上期增长</div>
        </div>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">数据更新时间: {{DATE}} | {{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// D-002: Dashboard-4KPI (四指标仪表盘)
// ============================================================================

export const DASHBOARD_4KPI_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "D-002",
    type: "dashboard",
    name: "四指标仪表盘",
    description: "展示四个关键业务指标的综合视图",
    useCases: ["数据仪表盘", "KPI监控", "业务概览"],
    contentDensity: "high",
    visualStyle: "data-driven",
    recommendedFor: ["业务汇报", "指标监控"],
    maxContentBlocks: 4,
    variables: ["{{TITLE}}", "{{KPI1}}", "{{KPI2}}", "{{KPI3}}", "{{KPI4}}"],
    keywords: ["仪表盘", "KPI", "指标", "监控", "Dashboard", "数据"],
    positionFit: { opening: 0.3, middle: 0.95, closing: 0.4 },
    compatibility: {
      goodBefore: ["C-003", "A-001"],
      goodAfter: ["S-002", "D-001"],
      avoidNear: ["D-001"],
    },
    tone: "analytical",
  },
  html: `
<div style="${DATA_CONTAINER}">
  <!-- 网格背景装饰 -->
  <div style="position: absolute; inset: 0; background-image: radial-gradient(circle at 1px 1px, rgba(100, 116, 139, 0.1) 1px, transparent 0); background-size: 40px 40px; pointer-events: none;"></div>

  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; position: relative; z-index: 1;">
    <div>
      <h1 style="font-size: 32px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
      <p style="font-size: 16px; color: #94A3B8; margin: 0;">关键业务指标实时监控</p>
    </div>
    <div style="display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px;">
      <div style="width: 8px; height: 8px; background: ${COLORS.success}; border-radius: 50%; animation: pulse 2s infinite;"></div>
      <span style="font-size: 12px; color: ${COLORS.success};">实时更新</span>
    </div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; height: calc(100% - 140px); position: relative; z-index: 1;">
    <!-- KPI 1 - 金色主题 -->
    <div style="background: linear-gradient(135deg, rgba(212, 175, 55, 0.1) 0%, rgba(30, 41, 59, 0.8) 100%); border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; justify-content: center;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
        <div style="width: 8px; height: 8px; background: ${COLORS.primary}; border-radius: 50%;"></div>
        <span style="font-size: 14px; color: #94A3B8;">{{KPI1_LABEL}}</span>
      </div>
      <div style="font-size: 56px; font-weight: 900; color: ${COLORS.primary}; margin-bottom: 8px;">{{KPI1_VALUE}}</div>
      <div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; width: fit-content;">
        <span style="color: ${COLORS.success}; font-size: 16px; font-weight: 700;">↑ {{KPI1_CHANGE}}</span>
        <span style="color: #64748B; font-size: 12px;">较上月</span>
      </div>
    </div>

    <!-- KPI 2 - 蓝色主题 -->
    <div style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(30, 41, 59, 0.8) 100%); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; justify-content: center;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
        <div style="width: 8px; height: 8px; background: ${COLORS.secondary}; border-radius: 50%;"></div>
        <span style="font-size: 14px; color: #94A3B8;">{{KPI2_LABEL}}</span>
      </div>
      <div style="font-size: 56px; font-weight: 900; color: ${COLORS.secondary}; margin-bottom: 8px;">{{KPI2_VALUE}}</div>
      <div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; width: fit-content;">
        <span style="color: ${COLORS.success}; font-size: 16px; font-weight: 700;">↑ {{KPI2_CHANGE}}</span>
        <span style="color: #64748B; font-size: 12px;">较上月</span>
      </div>
    </div>

    <!-- KPI 3 - 绿色主题 -->
    <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(30, 41, 59, 0.8) 100%); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; justify-content: center;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
        <div style="width: 8px; height: 8px; background: ${COLORS.success}; border-radius: 50%;"></div>
        <span style="font-size: 14px; color: #94A3B8;">{{KPI3_LABEL}}</span>
      </div>
      <div style="font-size: 56px; font-weight: 900; color: ${COLORS.success}; margin-bottom: 8px;">{{KPI3_VALUE}}</div>
      <div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; width: fit-content;">
        <span style="color: ${COLORS.success}; font-size: 16px; font-weight: 700;">↑ {{KPI3_CHANGE}}</span>
        <span style="color: #64748B; font-size: 12px;">较上月</span>
      </div>
    </div>

    <!-- KPI 4 - 紫色主题 -->
    <div style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(30, 41, 59, 0.8) 100%); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; justify-content: center;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
        <div style="width: 8px; height: 8px; background: ${COLORS.purple}; border-radius: 50%;"></div>
        <span style="font-size: 14px; color: #94A3B8;">{{KPI4_LABEL}}</span>
      </div>
      <div style="font-size: 56px; font-weight: 900; color: ${COLORS.purple}; margin-bottom: 8px;">{{KPI4_VALUE}}</div>
      <div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; width: fit-content;">
        <span style="color: ${COLORS.success}; font-size: 16px; font-weight: 700;">↑ {{KPI4_CHANGE}}</span>
        <span style="color: #64748B; font-size: 12px;">较上月</span>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">数据更新时间: {{DATE}} | 来源: 业务数据平台</div>
</div>
  `.trim(),
};

// ============================================================================
// D-003: Trend-Chart (趋势图)
// ============================================================================

export const TREND_CHART_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "D-003",
    type: "dashboard",
    name: "趋势图",
    description: "展示数据随时间变化的趋势",
    useCases: ["趋势分析", "增长曲线", "时间序列"],
    contentDensity: "medium",
    visualStyle: "data-driven",
    recommendedFor: ["数据分析", "趋势展示"],
    maxContentBlocks: 2,
    variables: ["{{TITLE}}", "{{CHART_DATA}}"],
    keywords: ["趋势", "增长", "变化", "曲线", "Chart", "图表"],
    positionFit: { opening: 0.3, middle: 0.9, closing: 0.4 },
    compatibility: {
      goodBefore: ["C-003", "A-001"],
      goodAfter: ["D-001", "D-002"],
      avoidNear: [],
    },
    tone: "analytical",
  },
  html: `
<div style="${DATA_CONTAINER}">
  <!-- 图表区域背景装饰 -->
  <div style="position: absolute; top: 120px; left: 60px; right: 340px; bottom: 80px; background: linear-gradient(180deg, rgba(212, 175, 55, 0.02) 0%, transparent 100%); border-radius: 16px;"></div>

  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
    <div>
      <h1 style="font-size: 32px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
      <p style="font-size: 16px; color: #94A3B8; margin: 0;">数据趋势分析 · {{PERIOD}}</p>
    </div>
    <div style="display: flex; gap: 12px;">
      <div style="padding: 6px 12px; background: rgba(212, 175, 55, 0.1); border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 6px; font-size: 12px; color: ${COLORS.primary};">日视图</div>
      <div style="padding: 6px 12px; background: rgba(30, 41, 59, 0.5); border: 1px solid #334155; border-radius: 6px; font-size: 12px; color: #94A3B8;">周视图</div>
      <div style="padding: 6px 12px; background: rgba(30, 41, 59, 0.5); border: 1px solid #334155; border-radius: 6px; font-size: 12px; color: #94A3B8;">月视图</div>
    </div>
  </div>

  <div style="display: flex; gap: 24px; height: calc(100% - 120px); position: relative; z-index: 1;">
    <!-- 图表区域 -->
    <div style="flex: 1; background: rgba(30, 41, 59, 0.4); border: 1px solid #334155; border-radius: 16px; padding: 24px; display: flex; flex-direction: column;">
      <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <div style="width: 12px; height: 3px; background: ${COLORS.primary}; border-radius: 2px;"></div>
          <span style="font-size: 12px; color: #94A3B8;">当前趋势</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <div style="width: 12px; height: 3px; background: ${COLORS.secondary}; border-radius: 2px; opacity: 0.5;"></div>
          <span style="font-size: 12px; color: #64748B;">历史同期</span>
        </div>
      </div>
      <div id="chart-trend" style="width: 100%; flex: 1;"></div>
    </div>

    <!-- 指标侧边栏 -->
    <div style="flex: 0 0 260px; display: flex; flex-direction: column; gap: 16px;">
      <!-- 当前值 - 突出显示 -->
      <div style="background: linear-gradient(135deg, rgba(212, 175, 55, 0.15) 0%, rgba(30, 41, 59, 0.8) 100%); border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 12px; padding: 20px;">
        <div style="font-size: 12px; color: ${COLORS.primary}; font-weight: 600; margin-bottom: 8px;">当前值</div>
        <div style="font-size: 40px; font-weight: 900; color: ${COLORS.primary};">{{CURRENT_VALUE}}</div>
      </div>

      <!-- 环比/同比指标 -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; border-radius: 12px; padding: 16px; text-align: center;">
          <div style="font-size: 11px; color: #64748B; margin-bottom: 6px;">环比</div>
          <div style="font-size: 20px; font-weight: 900; color: ${COLORS.success};">{{MOM_CHANGE}}</div>
        </div>
        <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; border-radius: 12px; padding: 16px; text-align: center;">
          <div style="font-size: 11px; color: #64748B; margin-bottom: 6px;">同比</div>
          <div style="font-size: 20px; font-weight: 900; color: ${COLORS.secondary};">{{YOY_CHANGE}}</div>
        </div>
      </div>

      <!-- 关键洞察 -->
      <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; border-radius: 12px; padding: 16px; flex: 1;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 12px;">
          <span style="font-size: 14px;">💡</span>
          <span style="font-size: 12px; color: ${COLORS.warning}; font-weight: 600;">关键洞察</span>
        </div>
        <p style="font-size: 13px; color: #F8FAFC; margin: 0; line-height: 1.7;">{{INSIGHT}}</p>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">数据周期: {{PERIOD}} | {{TITLE}}</div>
</div>
  `.trim(),
  script: `
var chart = echarts.init(document.getElementById('chart-trend'));
chart.setOption({
  backgroundColor: 'transparent',
  textStyle: { color: '#94A3B8' },
  grid: { left: 50, right: 20, top: 20, bottom: 40 },
  xAxis: { type: 'category', data: {{X_DATA}}, axisLine: { lineStyle: { color: '#334155' } } },
  yAxis: { type: 'value', axisLine: { lineStyle: { color: '#334155' } }, splitLine: { lineStyle: { color: '#334155' } } },
  series: [{
    type: 'line',
    data: {{Y_DATA}},
    smooth: true,
    lineStyle: { color: '#D4AF37', width: 3 },
    areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(212, 175, 55, 0.3)' }, { offset: 1, color: 'rgba(212, 175, 55, 0)' }] } },
    symbol: 'circle',
    symbolSize: 8,
    itemStyle: { color: '#D4AF37' }
  }]
});
  `.trim(),
};

// ============================================================================
// D-004: Comparison-Dual (双向对比)
// ============================================================================

export const COMPARISON_DUAL_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "D-004",
    type: "comparison",
    name: "双向对比",
    description: "并排展示两个选项的优劣对比",
    useCases: ["方案对比", "A/B对比", "优劣分析"],
    contentDensity: "high",
    visualStyle: "professional",
    recommendedFor: ["决策支持", "方案选择"],
    maxContentBlocks: 2,
    variables: ["{{TITLE}}", "{{OPTION_A}}", "{{OPTION_B}}"],
    keywords: ["对比", "比较", "VS", "方案", "选择", "优劣"],
    positionFit: { opening: 0.3, middle: 0.95, closing: 0.5 },
    compatibility: {
      goodBefore: ["A-001", "A-003"],
      goodAfter: ["S-002", "N-002"],
      avoidNear: ["D-005"],
    },
    tone: "analytical",
  },
  html: `
<div style="${COMPARISON_CONTAINER}">
  <!-- 分割式背景 - 左金右蓝 -->
  <div style="position: absolute; top: 0; left: 0; width: 50%; height: 100%; background: linear-gradient(135deg, rgba(212, 175, 55, 0.05) 0%, rgba(15, 23, 42, 1) 100%);"></div>
  <div style="position: absolute; top: 0; right: 0; width: 50%; height: 100%; background: linear-gradient(225deg, rgba(59, 130, 246, 0.05) 0%, rgba(15, 23, 42, 1) 100%);"></div>

  <!-- 中央分割线 -->
  <div style="position: absolute; top: 100px; bottom: 60px; left: 50%; width: 2px; background: linear-gradient(180deg, ${COLORS.primary}, #334155, ${COLORS.secondary}); transform: translateX(-50%);"></div>
  <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 60px; height: 60px; background: #0F172A; border: 2px solid #334155; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; color: #94A3B8; z-index: 10;">VS</div>

  <!-- 标题区 -->
  <div style="position: relative; z-index: 1; padding: 40px 60px 0;">
    <div style="text-align: center;">
      <h1 style="font-size: 36px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
      <p style="font-size: 16px; color: #94A3B8; margin: 0;">方案对比分析 · 决策依据</p>
    </div>
  </div>

  <!-- 对比内容 -->
  <div style="display: flex; gap: 80px; height: calc(100% - 140px); padding: 24px 60px 60px; position: relative; z-index: 1;">
    <!-- 方案 A -->
    <div style="flex: 1; display: flex; flex-direction: column;">
      <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
        <div style="width: 56px; height: 56px; background: linear-gradient(135deg, ${COLORS.primary}, #B8962E); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 900;">A</div>
        <div>
          <div style="font-size: 12px; color: ${COLORS.primary}; font-weight: 600;">方案 A</div>
          <h3 style="font-size: 22px; font-weight: 700; margin: 0;">{{OPTION_A_TITLE}}</h3>
        </div>
      </div>

      <div style="flex: 1; display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px;">
          <div style="width: 28px; height: 28px; background: ${COLORS.success}; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px;">✓</div>
          <span style="font-size: 14px; color: #F8FAFC;">{{A_PRO1}}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px;">
          <div style="width: 28px; height: 28px; background: ${COLORS.success}; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px;">✓</div>
          <span style="font-size: 14px; color: #F8FAFC;">{{A_PRO2}}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px;">
          <div style="width: 28px; height: 28px; background: rgba(239, 68, 68, 0.3); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; color: ${COLORS.danger};">✗</div>
          <span style="font-size: 14px; color: #94A3B8;">{{A_CON1}}</span>
        </div>
      </div>

      <div style="margin-top: 20px; padding: 20px; background: rgba(212, 175, 55, 0.1); border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 12px;">
        <div style="font-size: 12px; color: #94A3B8; margin-bottom: 4px;">预估投入</div>
        <div style="font-size: 36px; font-weight: 900; color: ${COLORS.primary};">{{A_COST}}</div>
      </div>
    </div>

    <!-- 方案 B -->
    <div style="flex: 1; display: flex; flex-direction: column;">
      <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px;">
        <div style="width: 56px; height: 56px; background: linear-gradient(135deg, ${COLORS.secondary}, #2563EB); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 900;">B</div>
        <div>
          <div style="font-size: 12px; color: ${COLORS.secondary}; font-weight: 600;">方案 B</div>
          <h3 style="font-size: 22px; font-weight: 700; margin: 0;">{{OPTION_B_TITLE}}</h3>
        </div>
      </div>

      <div style="flex: 1; display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px;">
          <div style="width: 28px; height: 28px; background: ${COLORS.success}; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px;">✓</div>
          <span style="font-size: 14px; color: #F8FAFC;">{{B_PRO1}}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px;">
          <div style="width: 28px; height: 28px; background: ${COLORS.success}; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px;">✓</div>
          <span style="font-size: 14px; color: #F8FAFC;">{{B_PRO2}}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; padding: 16px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px;">
          <div style="width: 28px; height: 28px; background: rgba(239, 68, 68, 0.3); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; color: ${COLORS.danger};">✗</div>
          <span style="font-size: 14px; color: #94A3B8;">{{B_CON1}}</span>
        </div>
      </div>

      <div style="margin-top: 20px; padding: 20px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px;">
        <div style="font-size: 12px; color: #94A3B8; margin-bottom: 4px;">预估投入</div>
        <div style="font-size: 36px; font-weight: 900; color: ${COLORS.secondary};">{{B_COST}}</div>
      </div>
    </div>
  </div>

  <div style="position: absolute; bottom: 20px; left: 60px; right: 60px; font-size: 12px; color: #64748B;">数据来源: 市场调研报告 | {{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// D-005: Comparison-Table (对比表格)
// ============================================================================

export const COMPARISON_TABLE_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "D-005",
    type: "comparison",
    name: "对比表格",
    description: "表格形式的多维度对比",
    useCases: ["特性对比", "产品对比", "多维比较"],
    contentDensity: "high",
    visualStyle: "professional",
    recommendedFor: ["产品选型", "特性比较"],
    maxContentBlocks: 6,
    variables: ["{{TITLE}}", "{{HEADERS}}", "{{ROWS}}"],
    keywords: ["表格", "对比", "特性", "产品", "比较"],
    positionFit: { opening: 0.2, middle: 0.9, closing: 0.4 },
    compatibility: {
      goodBefore: ["A-001", "A-003"],
      goodAfter: ["S-002"],
      avoidNear: ["D-004"],
    },
    tone: "analytical",
  },
  html: `
<div style="${DATA_CONTAINER}">
  <!-- 表头渐变装饰 -->
  <div style="position: absolute; top: 0; left: 0; right: 0; height: 140px; background: linear-gradient(180deg, rgba(30, 41, 59, 0.8) 0%, transparent 100%);"></div>

  <div style="position: relative; z-index: 1;">
    <h1 style="font-size: 32px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
    <p style="font-size: 16px; color: #94A3B8; margin: 0 0 24px 0;">多维度特性对比分析</p>
  </div>

  <div style="height: calc(100% - 130px); overflow: hidden; position: relative; z-index: 1;">
    <div style="background: rgba(30, 41, 59, 0.4); border: 1px solid #334155; border-radius: 16px; overflow: hidden;">
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: linear-gradient(90deg, rgba(212, 175, 55, 0.1), rgba(59, 130, 246, 0.1), rgba(16, 185, 129, 0.1));">
            <th style="padding: 20px 24px; text-align: left; font-size: 14px; font-weight: 700; color: #94A3B8; border-bottom: 2px solid #334155; width: 25%;">特性维度</th>
            <th style="padding: 20px 24px; text-align: center; font-size: 14px; font-weight: 700; border-bottom: 2px solid #334155;">
              <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                <div style="width: 8px; height: 8px; background: ${COLORS.primary}; border-radius: 50%;"></div>
                <span style="color: ${COLORS.primary};">{{COL1_HEADER}}</span>
              </div>
            </th>
            <th style="padding: 20px 24px; text-align: center; font-size: 14px; font-weight: 700; border-bottom: 2px solid #334155;">
              <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                <div style="width: 8px; height: 8px; background: ${COLORS.secondary}; border-radius: 50%;"></div>
                <span style="color: ${COLORS.secondary};">{{COL2_HEADER}}</span>
              </div>
            </th>
            <th style="padding: 20px 24px; text-align: center; font-size: 14px; font-weight: 700; border-bottom: 2px solid #334155;">
              <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                <div style="width: 8px; height: 8px; background: ${COLORS.success}; border-radius: 50%;"></div>
                <span style="color: ${COLORS.success};">{{COL3_HEADER}}</span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 16px 24px; font-size: 14px; font-weight: 600; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW1_LABEL}}</td>
            <td style="padding: 16px 24px; text-align: center; font-size: 14px; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW1_COL1}}</td>
            <td style="padding: 16px 24px; text-align: center; font-size: 14px; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW1_COL2}}</td>
            <td style="padding: 16px 24px; text-align: center; font-size: 14px; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW1_COL3}}</td>
          </tr>
          <tr style="background: rgba(15, 23, 42, 0.3);">
            <td style="padding: 16px 24px; font-size: 14px; font-weight: 600; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW2_LABEL}}</td>
            <td style="padding: 16px 24px; text-align: center; font-size: 14px; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW2_COL1}}</td>
            <td style="padding: 16px 24px; text-align: center; font-size: 14px; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW2_COL2}}</td>
            <td style="padding: 16px 24px; text-align: center; font-size: 14px; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW2_COL3}}</td>
          </tr>
          <tr>
            <td style="padding: 16px 24px; font-size: 14px; font-weight: 600; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW3_LABEL}}</td>
            <td style="padding: 16px 24px; text-align: center; font-size: 14px; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW3_COL1}}</td>
            <td style="padding: 16px 24px; text-align: center; font-size: 14px; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW3_COL2}}</td>
            <td style="padding: 16px 24px; text-align: center; font-size: 14px; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW3_COL3}}</td>
          </tr>
          <tr style="background: rgba(15, 23, 42, 0.3);">
            <td style="padding: 16px 24px; font-size: 14px; font-weight: 600; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW4_LABEL}}</td>
            <td style="padding: 16px 24px; text-align: center; font-size: 14px; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW4_COL1}}</td>
            <td style="padding: 16px 24px; text-align: center; font-size: 14px; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW4_COL2}}</td>
            <td style="padding: 16px 24px; text-align: center; font-size: 14px; border-bottom: 1px solid rgba(51, 65, 85, 0.5);">{{ROW4_COL3}}</td>
          </tr>
          <tr style="background: linear-gradient(90deg, rgba(212, 175, 55, 0.05), rgba(59, 130, 246, 0.05), rgba(16, 185, 129, 0.05));">
            <td style="padding: 18px 24px; font-size: 15px; font-weight: 700;">{{ROW5_LABEL}}</td>
            <td style="padding: 18px 24px; text-align: center;">
              <div style="font-size: 20px; font-weight: 900; color: ${COLORS.primary};">{{ROW5_COL1}}</div>
            </td>
            <td style="padding: 18px 24px; text-align: center;">
              <div style="font-size: 20px; font-weight: 900; color: ${COLORS.secondary};">{{ROW5_COL2}}</div>
            </td>
            <td style="padding: 18px 24px; text-align: center;">
              <div style="font-size: 20px; font-weight: 900; color: ${COLORS.success};">{{ROW5_COL3}}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">{{TITLE}} | 特性对比</div>
</div>
  `.trim(),
};

// ============================================================================
// D-006: Ranking-List (排名列表)
// ============================================================================

export const RANKING_LIST_TEMPLATE: SlideTemplate = {
  metadata: {
    id: "D-006",
    type: "dashboard",
    name: "排名列表",
    description: "展示排名数据的列表视图",
    useCases: ["排行榜", "Top N", "排名展示"],
    contentDensity: "high",
    visualStyle: "data-driven",
    recommendedFor: ["竞争分析", "业绩排名"],
    maxContentBlocks: 6,
    variables: ["{{TITLE}}", "{{ITEMS}}"],
    keywords: ["排名", "Top", "排行", "列表", "第一", "榜单"],
    positionFit: { opening: 0.3, middle: 0.9, closing: 0.4 },
    compatibility: {
      goodBefore: ["C-003", "A-001"],
      goodAfter: ["D-001", "D-002"],
      avoidNear: [],
    },
    tone: "analytical",
  },
  html: `
<div style="${DATA_CONTAINER}">
  <!-- 冠军装饰 -->
  <div style="position: absolute; top: 60px; right: 60px; font-size: 120px; color: rgba(212, 175, 55, 0.08);">🏆</div>

  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
    <div>
      <h1 style="font-size: 32px; font-weight: 900; margin: 0 0 8px 0;">{{TITLE}}</h1>
      <p style="font-size: 16px; color: #94A3B8; margin: 0;">竞争力排名分析</p>
    </div>
    <div style="display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: rgba(212, 175, 55, 0.1); border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 8px;">
      <span style="font-size: 14px;">📊</span>
      <span style="font-size: 12px; color: ${COLORS.primary};">TOP 5</span>
    </div>
  </div>

  <div style="display: flex; gap: 24px; height: calc(100% - 120px);">
    <!-- 排名列表 -->
    <div style="flex: 1; display: flex; flex-direction: column; gap: 12px;">
      <!-- 第1名 - 金色冠军 -->
      <div style="background: linear-gradient(90deg, rgba(212, 175, 55, 0.15) 0%, rgba(30, 41, 59, 0.8) 100%); border: 1px solid rgba(212, 175, 55, 0.4); border-radius: 16px; padding: 20px; display: flex; align-items: center; gap: 20px;">
        <div style="width: 56px; height: 56px; background: linear-gradient(135deg, ${COLORS.primary}, #B8962E); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 900; box-shadow: 0 4px 12px rgba(212, 175, 55, 0.3);">1</div>
        <div style="flex: 1;">
          <div style="font-size: 18px; font-weight: 700; margin-bottom: 4px;">{{RANK1_NAME}}</div>
          <div style="font-size: 13px; color: #94A3B8;">{{RANK1_DESC}}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 32px; font-weight: 900; color: ${COLORS.primary};">{{RANK1_VALUE}}</div>
        </div>
      </div>

      <!-- 第2名 - 银色 -->
      <div style="background: linear-gradient(90deg, rgba(59, 130, 246, 0.1) 0%, rgba(30, 41, 59, 0.8) 100%); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 14px; padding: 18px; display: flex; align-items: center; gap: 18px;">
        <div style="width: 48px; height: 48px; background: ${COLORS.secondary}; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 900;">2</div>
        <div style="flex: 1;">
          <div style="font-size: 16px; font-weight: 700; margin-bottom: 2px;">{{RANK2_NAME}}</div>
          <div style="font-size: 12px; color: #94A3B8;">{{RANK2_DESC}}</div>
        </div>
        <div style="font-size: 26px; font-weight: 900; color: ${COLORS.secondary};">{{RANK2_VALUE}}</div>
      </div>

      <!-- 第3名 - 铜色 -->
      <div style="background: linear-gradient(90deg, rgba(16, 185, 129, 0.1) 0%, rgba(30, 41, 59, 0.8) 100%); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 14px; padding: 18px; display: flex; align-items: center; gap: 18px;">
        <div style="width: 48px; height: 48px; background: ${COLORS.success}; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 900;">3</div>
        <div style="flex: 1;">
          <div style="font-size: 16px; font-weight: 700; margin-bottom: 2px;">{{RANK3_NAME}}</div>
          <div style="font-size: 12px; color: #94A3B8;">{{RANK3_DESC}}</div>
        </div>
        <div style="font-size: 26px; font-weight: 900; color: ${COLORS.success};">{{RANK3_VALUE}}</div>
      </div>

      <!-- 第4、5名 - 常规 -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; border-radius: 12px; padding: 16px; display: flex; align-items: center; gap: 12px;">
          <div style="width: 36px; height: 36px; background: #475569; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 900;">4</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{RANK4_NAME}}</div>
          </div>
          <div style="font-size: 18px; font-weight: 900; color: #94A3B8;">{{RANK4_VALUE}}</div>
        </div>
        <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; border-radius: 12px; padding: 16px; display: flex; align-items: center; gap: 12px;">
          <div style="width: 36px; height: 36px; background: #475569; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 900;">5</div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{RANK5_NAME}}</div>
          </div>
          <div style="font-size: 18px; font-weight: 900; color: #94A3B8;">{{RANK5_VALUE}}</div>
        </div>
      </div>
    </div>

    <!-- 洞察侧边栏 -->
    <div style="flex: 0 0 280px; display: flex; flex-direction: column; gap: 16px;">
      <div style="background: linear-gradient(135deg, rgba(212, 175, 55, 0.1) 0%, rgba(30, 41, 59, 0.8) 100%); border: 1px solid rgba(212, 175, 55, 0.3); border-radius: 16px; padding: 24px; flex: 1;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
          <span style="font-size: 18px;">💡</span>
          <span style="font-size: 16px; font-weight: 700; color: ${COLORS.primary};">榜单洞察</span>
        </div>
        <p style="font-size: 14px; color: #F8FAFC; margin: 0; line-height: 1.7;">{{INSIGHT}}</p>
      </div>

      <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; border-radius: 12px; padding: 16px;">
        <div style="font-size: 12px; color: #64748B; margin-bottom: 6px;">数据截止日期</div>
        <div style="font-size: 16px; font-weight: 600;">{{DATE}}</div>
      </div>
    </div>
  </div>

  <div style="${FOOTER_STYLE}">{{TITLE}}</div>
</div>
  `.trim(),
};

// ============================================================================
// Export All Data Templates
// ============================================================================

export const DATA_TEMPLATES: SlideTemplate[] = [
  BIG_NUMBER_TEMPLATE,
  DASHBOARD_4KPI_TEMPLATE,
  TREND_CHART_TEMPLATE,
  COMPARISON_DUAL_TEMPLATE,
  COMPARISON_TABLE_TEMPLATE,
  RANKING_LIST_TEMPLATE,
];
