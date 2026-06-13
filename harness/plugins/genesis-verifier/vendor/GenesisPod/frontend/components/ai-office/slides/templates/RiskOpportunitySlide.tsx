'use client';

/**
 * RiskOpportunitySlide - 风险机会矩阵页模板
 *
 * 功能：
 * - 风险矩阵展示
 * - 机会矩阵展示
 * - 支持三种布局：split / matrix / list
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { RiskOpportunitySlideContent } from '@/lib/types/slides';
import '../styles/slide-tokens.css';

export interface RiskOpportunitySlideProps {
  content: RiskOpportunitySlideContent;
  className?: string;
}

// 级别颜色
const LEVEL_COLORS = {
  high: 'var(--slide-status-down)',
  medium: 'var(--slide-accent-gold)',
  low: 'var(--slide-status-up)',
};

// 级别图标
const LEVEL_ICONS = {
  high: '⬆',
  medium: '➡',
  low: '⬇',
};

// 风险卡片
function RiskCard({
  risk,
  showMitigation,
}: {
  risk: RiskOpportunitySlideContent['risks'][0];
  showMitigation?: boolean;
}) {
  const impactColor = LEVEL_COLORS[risk.impact];
  const probabilityColor = LEVEL_COLORS[risk.probability];

  return (
    <div
      style={{
        background: 'var(--slide-bg-card)',
        borderRadius: 'var(--slide-radius-md)',
        padding: 'var(--slide-space-md)',
        borderLeft: `4px solid ${impactColor}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--slide-space-sm)',
          marginBottom: 'var(--slide-space-sm)',
        }}
      >
        {risk.icon && (
          <span style={{ fontSize: 'var(--slide-font-h4)' }}>{risk.icon}</span>
        )}
        <div style={{ flex: 1 }}>
          <h4
            style={{
              fontSize: 'var(--slide-font-body)',
              fontWeight: 'var(--slide-font-weight-semibold)',
              color: 'var(--slide-text-primary)',
              margin: 0,
            }}
          >
            {risk.title}
          </h4>
          {risk.category && (
            <span
              style={{
                fontSize: 'var(--slide-font-small)',
                color: 'var(--slide-text-tertiary)',
              }}
            >
              {risk.category}
            </span>
          )}
        </div>
      </div>

      <p
        style={{
          fontSize: 'var(--slide-font-small)',
          color: 'var(--slide-text-secondary)',
          lineHeight: 'var(--slide-line-height-normal)',
          margin: '0 0 var(--slide-space-sm) 0',
        }}
      >
        {risk.description}
      </p>

      {/* 风险指标 */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--slide-space-md)',
          marginBottom:
            showMitigation && risk.mitigation ? 'var(--slide-space-sm)' : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            style={{
              fontSize: 'var(--slide-font-small)',
              color: 'var(--slide-text-tertiary)',
            }}
          >
            影响:
          </span>
          <span
            style={{
              fontSize: 'var(--slide-font-small)',
              fontWeight: 'var(--slide-font-weight-semibold)',
              color: impactColor,
            }}
          >
            {LEVEL_ICONS[risk.impact]} {risk.impact}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            style={{
              fontSize: 'var(--slide-font-small)',
              color: 'var(--slide-text-tertiary)',
            }}
          >
            概率:
          </span>
          <span
            style={{
              fontSize: 'var(--slide-font-small)',
              fontWeight: 'var(--slide-font-weight-semibold)',
              color: probabilityColor,
            }}
          >
            {LEVEL_ICONS[risk.probability]} {risk.probability}
          </span>
        </div>
      </div>

      {/* 缓解措施 */}
      {showMitigation && risk.mitigation && (
        <div
          style={{
            background: 'var(--slide-bg-tertiary)',
            borderRadius: 'var(--slide-radius-sm)',
            padding: 'var(--slide-space-sm)',
          }}
        >
          <span
            style={{
              fontSize: 'var(--slide-font-small)',
              color: 'var(--slide-text-tertiary)',
              fontWeight: 'var(--slide-font-weight-semibold)',
            }}
          >
            缓解措施:
          </span>
          <p
            style={{
              fontSize: 'var(--slide-font-small)',
              color: 'var(--slide-text-secondary)',
              margin: 'var(--slide-space-xs) 0 0 0',
            }}
          >
            {risk.mitigation}
          </p>
        </div>
      )}
    </div>
  );
}

// 机会卡片
function OpportunityCard({
  opportunity,
  showAction,
}: {
  opportunity: RiskOpportunitySlideContent['opportunities'][0];
  showAction?: boolean;
}) {
  const potentialColor =
    LEVEL_COLORS[
      opportunity.potential === 'high'
        ? 'low'
        : opportunity.potential === 'low'
          ? 'high'
          : 'medium'
    ];
  const feasibilityColor =
    LEVEL_COLORS[
      opportunity.feasibility === 'high'
        ? 'low'
        : opportunity.feasibility === 'low'
          ? 'high'
          : 'medium'
    ];

  return (
    <div
      style={{
        background: 'var(--slide-bg-card)',
        borderRadius: 'var(--slide-radius-md)',
        padding: 'var(--slide-space-md)',
        borderLeft: '4px solid var(--slide-status-up)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--slide-space-sm)',
          marginBottom: 'var(--slide-space-sm)',
        }}
      >
        {opportunity.icon && (
          <span style={{ fontSize: 'var(--slide-font-h4)' }}>
            {opportunity.icon}
          </span>
        )}
        <div style={{ flex: 1 }}>
          <h4
            style={{
              fontSize: 'var(--slide-font-body)',
              fontWeight: 'var(--slide-font-weight-semibold)',
              color: 'var(--slide-text-primary)',
              margin: 0,
            }}
          >
            {opportunity.title}
          </h4>
          {opportunity.category && (
            <span
              style={{
                fontSize: 'var(--slide-font-small)',
                color: 'var(--slide-text-tertiary)',
              }}
            >
              {opportunity.category}
            </span>
          )}
        </div>
      </div>

      <p
        style={{
          fontSize: 'var(--slide-font-small)',
          color: 'var(--slide-text-secondary)',
          lineHeight: 'var(--slide-line-height-normal)',
          margin: '0 0 var(--slide-space-sm) 0',
        }}
      >
        {opportunity.description}
      </p>

      {/* 机会指标 */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--slide-space-md)',
          marginBottom:
            showAction && opportunity.action ? 'var(--slide-space-sm)' : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            style={{
              fontSize: 'var(--slide-font-small)',
              color: 'var(--slide-text-tertiary)',
            }}
          >
            潜力:
          </span>
          <span
            style={{
              fontSize: 'var(--slide-font-small)',
              fontWeight: 'var(--slide-font-weight-semibold)',
              color: potentialColor,
            }}
          >
            {opportunity.potential}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            style={{
              fontSize: 'var(--slide-font-small)',
              color: 'var(--slide-text-tertiary)',
            }}
          >
            可行性:
          </span>
          <span
            style={{
              fontSize: 'var(--slide-font-small)',
              fontWeight: 'var(--slide-font-weight-semibold)',
              color: feasibilityColor,
            }}
          >
            {opportunity.feasibility}
          </span>
        </div>
      </div>

      {/* 行动计划 */}
      {showAction && opportunity.action && (
        <div
          style={{
            background: 'var(--slide-status-up)15',
            borderRadius: 'var(--slide-radius-sm)',
            padding: 'var(--slide-space-sm)',
          }}
        >
          <span
            style={{
              fontSize: 'var(--slide-font-small)',
              color: 'var(--slide-status-up)',
              fontWeight: 'var(--slide-font-weight-semibold)',
            }}
          >
            行动计划:
          </span>
          <p
            style={{
              fontSize: 'var(--slide-font-small)',
              color: 'var(--slide-text-secondary)',
              margin: 'var(--slide-space-xs) 0 0 0',
            }}
          >
            {opportunity.action}
          </p>
        </div>
      )}
    </div>
  );
}

export function RiskOpportunitySlide({
  content,
  className = '',
}: RiskOpportunitySlideProps) {
  // 分屏布局
  if (content.layout === 'split') {
    return (
      <div
        className={`risk-opportunity-slide ${className}`}
        style={{
          width: '100%',
          height: '100%',
          background:
            'linear-gradient(135deg, var(--slide-bg-primary) 0%, var(--slide-bg-secondary) 100%)',
          padding: 'var(--slide-space-2xl)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 标题 */}
        <div style={{ marginBottom: 'var(--slide-space-xl)' }}>
          <h2
            style={{
              fontSize: 'var(--slide-font-h1)',
              fontWeight: 'var(--slide-font-weight-bold)',
              color: 'var(--slide-text-primary)',
              marginBottom: content.description ? 'var(--slide-space-sm)' : 0,
            }}
          >
            {content.title}
          </h2>
          {content.description && (
            <p
              style={{
                fontSize: 'var(--slide-font-body)',
                color: 'var(--slide-text-tertiary)',
              }}
            >
              {content.description}
            </p>
          )}
        </div>

        {/* 分屏内容 */}
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--slide-space-xl)',
            overflow: 'hidden',
          }}
        >
          {/* 风险区域 */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--slide-space-sm)',
                marginBottom: 'var(--slide-space-md)',
                padding: 'var(--slide-space-sm) var(--slide-space-md)',
                background: 'var(--slide-status-down)15',
                borderRadius: 'var(--slide-radius-md)',
              }}
            >
              <AlertTriangle
                style={{
                  color: 'var(--slide-status-down)',
                  width: 'var(--slide-font-h3)',
                  height: 'var(--slide-font-h3)',
                }}
              />
              <h3
                style={{
                  fontSize: 'var(--slide-font-h3)',
                  fontWeight: 'var(--slide-font-weight-semibold)',
                  color: 'var(--slide-status-down)',
                  margin: 0,
                }}
              >
                风险 ({content.risks.length})
              </h3>
            </div>
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--slide-space-sm)',
              }}
            >
              {content.risks.map((risk) => (
                <RiskCard
                  key={risk.id}
                  risk={risk}
                  showMitigation={content.showMitigations}
                />
              ))}
            </div>
          </div>

          {/* 机会区域 */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--slide-space-sm)',
                marginBottom: 'var(--slide-space-md)',
                padding: 'var(--slide-space-sm) var(--slide-space-md)',
                background: 'var(--slide-status-up)15',
                borderRadius: 'var(--slide-radius-md)',
              }}
            >
              <span style={{ fontSize: 'var(--slide-font-h3)' }}>✨</span>
              <h3
                style={{
                  fontSize: 'var(--slide-font-h3)',
                  fontWeight: 'var(--slide-font-weight-semibold)',
                  color: 'var(--slide-status-up)',
                  margin: 0,
                }}
              >
                机会 ({content.opportunities.length})
              </h3>
            </div>
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--slide-space-sm)',
              }}
            >
              {content.opportunities.map((opportunity) => (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  showAction={content.showMitigations}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 矩阵布局
  if (content.layout === 'matrix') {
    return (
      <div
        className={`risk-opportunity-slide ${className}`}
        style={{
          width: '100%',
          height: '100%',
          background:
            'linear-gradient(135deg, var(--slide-bg-primary) 0%, var(--slide-bg-secondary) 100%)',
          padding: 'var(--slide-space-2xl)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 标题 */}
        <div style={{ marginBottom: 'var(--slide-space-lg)' }}>
          <h2
            style={{
              fontSize: 'var(--slide-font-h1)',
              fontWeight: 'var(--slide-font-weight-bold)',
              color: 'var(--slide-text-primary)',
            }}
          >
            {content.title}
          </h2>
        </div>

        {/* 2x2 矩阵 */}
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            gap: 'var(--slide-space-md)',
            position: 'relative',
          }}
        >
          {/* 轴标签 */}
          <div
            style={{
              position: 'absolute',
              left: '-20px',
              top: '50%',
              transform: 'rotate(-90deg) translateX(50%)',
              fontSize: 'var(--slide-font-small)',
              color: 'var(--slide-text-tertiary)',
              fontWeight: 'var(--slide-font-weight-semibold)',
            }}
          >
            影响/潜力 →
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: '-20px',
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: 'var(--slide-font-small)',
              color: 'var(--slide-text-tertiary)',
              fontWeight: 'var(--slide-font-weight-semibold)',
            }}
          >
            概率/可行性 →
          </div>

          {/* 高影响/高概率 */}
          <div
            style={{
              background: 'var(--slide-status-down)10',
              borderRadius: 'var(--slide-radius-md)',
              padding: 'var(--slide-space-md)',
              border: '2px solid var(--slide-status-down)30',
            }}
          >
            <div
              style={{
                fontSize: 'var(--slide-font-small)',
                fontWeight: 'var(--slide-font-weight-bold)',
                color: 'var(--slide-status-down)',
                marginBottom: 'var(--slide-space-sm)',
              }}
            >
              高优先级
            </div>
            <div
              style={{
                fontSize: 'var(--slide-font-small)',
                color: 'var(--slide-text-secondary)',
              }}
            >
              {
                content.risks.filter(
                  (r) => r.impact === 'high' && r.probability === 'high'
                ).length
              }{' '}
              风险
            </div>
          </div>

          {/* 高影响/低概率 */}
          <div
            style={{
              background: 'var(--slide-accent-gold)10',
              borderRadius: 'var(--slide-radius-md)',
              padding: 'var(--slide-space-md)',
              border: '2px solid var(--slide-accent-gold)30',
            }}
          >
            <div
              style={{
                fontSize: 'var(--slide-font-small)',
                fontWeight: 'var(--slide-font-weight-bold)',
                color: 'var(--slide-accent-gold)',
                marginBottom: 'var(--slide-space-sm)',
              }}
            >
              监控关注
            </div>
            <div
              style={{
                fontSize: 'var(--slide-font-small)',
                color: 'var(--slide-text-secondary)',
              }}
            >
              {
                content.risks.filter(
                  (r) => r.impact === 'high' && r.probability === 'low'
                ).length
              }{' '}
              风险
            </div>
          </div>

          {/* 低影响/高概率 */}
          <div
            style={{
              background: 'var(--slide-accent-primary)10',
              borderRadius: 'var(--slide-radius-md)',
              padding: 'var(--slide-space-md)',
              border: '2px solid var(--slide-accent-primary)30',
            }}
          >
            <div
              style={{
                fontSize: 'var(--slide-font-small)',
                fontWeight: 'var(--slide-font-weight-bold)',
                color: 'var(--slide-accent-primary)',
                marginBottom: 'var(--slide-space-sm)',
              }}
            >
              快速处理
            </div>
            <div
              style={{
                fontSize: 'var(--slide-font-small)',
                color: 'var(--slide-text-secondary)',
              }}
            >
              {
                content.risks.filter(
                  (r) => r.impact === 'low' && r.probability === 'high'
                ).length
              }{' '}
              风险
            </div>
          </div>

          {/* 低影响/低概率 */}
          <div
            style={{
              background: 'var(--slide-status-up)10',
              borderRadius: 'var(--slide-radius-md)',
              padding: 'var(--slide-space-md)',
              border: '2px solid var(--slide-status-up)30',
            }}
          >
            <div
              style={{
                fontSize: 'var(--slide-font-small)',
                fontWeight: 'var(--slide-font-weight-bold)',
                color: 'var(--slide-status-up)',
                marginBottom: 'var(--slide-space-sm)',
              }}
            >
              接受风险
            </div>
            <div
              style={{
                fontSize: 'var(--slide-font-small)',
                color: 'var(--slide-text-secondary)',
              }}
            >
              {
                content.risks.filter(
                  (r) => r.impact === 'low' && r.probability === 'low'
                ).length
              }{' '}
              风险
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 列表布局（默认）
  return (
    <div
      className={`risk-opportunity-slide ${className}`}
      style={{
        width: '100%',
        height: '100%',
        background:
          'linear-gradient(135deg, var(--slide-bg-primary) 0%, var(--slide-bg-secondary) 100%)',
        padding: 'var(--slide-space-2xl)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 标题 */}
      <div style={{ marginBottom: 'var(--slide-space-xl)' }}>
        <h2
          style={{
            fontSize: 'var(--slide-font-h1)',
            fontWeight: 'var(--slide-font-weight-bold)',
            color: 'var(--slide-text-primary)',
          }}
        >
          {content.title}
        </h2>
      </div>

      {/* 列表内容 */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--slide-space-md)',
        }}
      >
        {content.risks.map((risk) => (
          <RiskCard
            key={risk.id}
            risk={risk}
            showMitigation={content.showMitigations}
          />
        ))}
        {content.opportunities.map((opportunity) => (
          <OpportunityCard
            key={opportunity.id}
            opportunity={opportunity}
            showAction={content.showMitigations}
          />
        ))}
      </div>
    </div>
  );
}

export default RiskOpportunitySlide;
