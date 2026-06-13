/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { WeeklyBriefingCard } from '../WeeklyBriefingCard';

const baseProps = {
  topicId: 'topic-1',
  topicName: '英伟达股价与新闻',
  weekStart: '2026-05-11',
  weekEnd: '2026-05-17',
  tier3Count: 2,
  narrativeCount: 1,
  candidatesTotal: 42,
};

describe('WeeklyBriefingCard', () => {
  it('renders week range in header', () => {
    render(<WeeklyBriefingCard {...baseProps} />);
    // i18n: weeklyTitle = "周报 · {{start}} — {{end}}"，组件用 Lucide Calendar 图标（不是 📅 emoji）
    expect(screen.getByText(/周报 · 2026-05-11 — 2026-05-17/)).toBeTruthy();
  });

  it('renders tier3 count, narrative count and candidates total when tier3Count > 0', () => {
    render(<WeeklyBriefingCard {...baseProps} />);
    // i18n: weeklyStats = "{{tier3Count}} · 延续叙事 {{narrativeCount}} · 候选总 {{candidatesTotal}}"
    // 三星用 Lucide Star icon（不是 ⭐ emoji），textContent 仅含 "2 · 延续叙事 1 · 候选总 42"
    const body = screen.getByText(/2 · 延续叙事 1 · 候选总 42/);
    expect(body).toBeTruthy();
  });

  it('shows empty state message when tier3Count is 0', () => {
    render(<WeeklyBriefingCard {...baseProps} tier3Count={0} />);
    expect(screen.getByText('本周暂无最高评级信号 · 周报跳过')).toBeTruthy();
  });

  it('renders "查看完整周报 →" link with correct URL', () => {
    render(<WeeklyBriefingCard {...baseProps} />);
    const link = screen.getByRole('link', { name: '查看完整周报 →' });
    expect(link.getAttribute('href')).toBe(
      '/ai-radar/topic/topic-1/weekly?week=2026-05-11'
    );
  });
});
