/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { RadarBriefingPanel } from '../RadarBriefingPanel';
import type { RadarBriefingPanelGroup } from '../RadarBriefingPanel';
import type { DailySignalView } from '../RadarBriefingCard';

const makeSignal = (id: string, tier: 1 | 2 | 3 = 2): DailySignalView => ({
  id,
  tier,
  title: `Signal ${id}`,
  oneLineTakeaway: `Takeaway for ${id}`,
  whyItMatters: `Why it matters for ${id}`,
  whatsNext: `What is next for ${id}`,
  signalTags: ['tag1'],
  entities: ['EntityA'],
  evidenceItemIds: [],
});

const makeGroup = (
  briefingDate: string,
  signals: DailySignalView[],
  status: RadarBriefingPanelGroup['status'] = 'completed'
): RadarBriefingPanelGroup => ({
  briefingDate,
  status,
  signals,
});

const defaultProps = {
  topicId: 'topic-ai',
  topicName: 'AI 行业',
};

describe('RadarBriefingPanel (R14 bucket aggregation)', () => {
  it('renders today bucket with single-day signals', () => {
    render(
      <RadarBriefingPanel
        {...defaultProps}
        bucket="today"
        groups={[makeGroup('2026-05-19', [makeSignal('s1')])]}
      />
    );
    expect(screen.getByText(/今日精选/)).toBeTruthy();
    expect(screen.getByText('Signal s1')).toBeTruthy();
  });

  it('renders week bucket grouped by date with sub-headers', () => {
    render(
      <RadarBriefingPanel
        {...defaultProps}
        bucket="week"
        groups={[
          makeGroup('2026-05-18', [makeSignal('s1')]),
          makeGroup('2026-05-19', [makeSignal('s2')]),
        ]}
      />
    );
    expect(screen.getByText(/本周精选/)).toBeTruthy();
    expect(screen.getByText(/5月18日/)).toBeTruthy();
    expect(screen.getByText(/5月19日/)).toBeTruthy();
    expect(screen.getByText('Signal s1')).toBeTruthy();
    expect(screen.getByText('Signal s2')).toBeTruthy();
  });

  it('shows EmptyState when all groups are empty', () => {
    render(
      <RadarBriefingPanel
        {...defaultProps}
        bucket="today"
        groups={[makeGroup('2026-05-19', [], 'no_signals')]}
      />
    );
    expect(screen.getByText(/今日 0 条信号/)).toBeTruthy();
  });

  it('shows skeleton when loading', () => {
    render(
      <RadarBriefingPanel
        {...defaultProps}
        bucket="today"
        groups={[]}
        loading
      />
    );
    expect(screen.getByText('精选生成中…')).toBeTruthy();
  });

  it('renders rerun button on today bucket', () => {
    render(
      <RadarBriefingPanel
        {...defaultProps}
        bucket="today"
        groups={[makeGroup('2026-05-19', [makeSignal('s1')])]}
        onRerun={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: '重新精选' })).toBeTruthy();
  });

  it('does NOT render rerun button on non-today buckets (week/month/year are read-only views)', () => {
    render(
      <RadarBriefingPanel
        {...defaultProps}
        bucket="week"
        groups={[makeGroup('2026-05-19', [makeSignal('s1')])]}
        onRerun={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: '重新精选' })).toBeNull();
  });

  it('calls onRerun when today rerun button clicked', () => {
    const onRerun = vi.fn();
    render(
      <RadarBriefingPanel
        {...defaultProps}
        bucket="today"
        groups={[makeGroup('2026-05-19', [makeSignal('s1')])]}
        onRerun={onRerun}
        rerunCount={0}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '重新精选' }));
    expect(onRerun).toHaveBeenCalledTimes(1);
  });

  it('disables rerun button when rerunCount >= 2', () => {
    render(
      <RadarBriefingPanel
        {...defaultProps}
        bucket="today"
        groups={[makeGroup('2026-05-19', [])]}
        onRerun={vi.fn()}
        rerunCount={2}
      />
    );
    const btn = screen.getByRole('button', { name: '重新精选' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('sorts groups descending by date in multi-day view', () => {
    render(
      <RadarBriefingPanel
        {...defaultProps}
        bucket="month"
        groups={[
          makeGroup('2026-05-15', [makeSignal('s-old')]),
          makeGroup('2026-05-19', [makeSignal('s-new')]),
        ]}
      />
    );
    // 5月19日 should appear before 5月15日 in the DOM
    const html = document.body.innerHTML;
    const idx19 = html.indexOf('5月19日');
    const idx15 = html.indexOf('5月15日');
    expect(idx19).toBeLessThan(idx15);
  });
});
