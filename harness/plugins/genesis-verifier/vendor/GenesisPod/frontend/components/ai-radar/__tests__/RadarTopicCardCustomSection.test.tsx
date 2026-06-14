/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/common/badges/TierBadge', () => ({
  TierBadge: ({ tier }: { tier: number }) => (
    <span data-testid="tier-badge">Tier{tier}</span>
  ),
}));

vi.mock('../SourceHealthSummary', () => ({
  SourceHealthSummary: ({
    totalSources,
    okCount,
    failCount,
  }: {
    totalSources: number;
    okCount: number;
    failCount: number;
  }) => (
    <span data-testid="source-health">
      {totalSources}s/{okCount}ok/{failCount}fail
    </span>
  ),
}));

import { RadarTopicCardCustomSection } from '../RadarTopicCardCustomSection';

const health = { totalSources: 7, okCount: 5, failCount: 2 };

describe('RadarTopicCardCustomSection', () => {
  it('shows fallback text when top1 is null', () => {
    render(
      <RadarTopicCardCustomSection
        top1={null}
        health={health}
        briefingTime="08:00"
        nextRefreshIn="6h"
      />
    );
    expect(screen.getByText('今日 0 条 · 持续监控中')).toBeTruthy();
    expect(screen.queryByTestId('tier-badge')).toBeNull();
  });

  it('renders TierBadge + title when top1 is provided', () => {
    render(
      <RadarTopicCardCustomSection
        top1={{ tier: 3, title: 'NVIDIA Q1 财报超预期' }}
        health={health}
        briefingTime="08:00"
        nextRefreshIn="6h"
      />
    );
    expect(screen.getByTestId('tier-badge').textContent).toBe('Tier3');
    expect(screen.getByText('NVIDIA Q1 财报超预期')).toBeTruthy();
  });

  it('renders health summary and briefing/refresh info on line 2', () => {
    render(
      <RadarTopicCardCustomSection
        top1={null}
        health={health}
        briefingTime="12:00"
        nextRefreshIn="2d"
      />
    );
    expect(screen.getByTestId('source-health')).toBeTruthy();
    expect(screen.getByText(/12:00 出炉/)).toBeTruthy();
    expect(screen.getByText(/下次 2d/)).toBeTruthy();
  });

  it('renders exactly 2 layout rows (space-y-1.5 wrapper)', () => {
    const { container } = render(
      <RadarTopicCardCustomSection
        top1={{ tier: 2, title: 'Test' }}
        health={health}
        briefingTime="18:00"
        nextRefreshIn="3h"
      />
    );
    const wrapper = container.firstChild as HTMLElement;
    // wrapper has class space-y-1.5 and exactly 2 child divs
    expect(wrapper.children.length).toBe(2);
  });
});
