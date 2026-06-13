/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { RadarBriefingSkeleton } from '../RadarBriefingSkeleton';
import { RadarBriefingEmptyState } from '../RadarBriefingEmptyState';
import { RadarBriefingErrorState } from '../RadarBriefingErrorState';

describe('RadarBriefingSkeleton', () => {
  it('renders default 3 skeleton cards', () => {
    const { container } = render(<RadarBriefingSkeleton />);
    // Each card is an animate-pulse div
    const cards = container.querySelectorAll('.animate-pulse');
    expect(cards.length).toBe(3);
  });

  it('renders custom count of skeleton cards', () => {
    const { container } = render(<RadarBriefingSkeleton count={5} />);
    const cards = container.querySelectorAll('.animate-pulse');
    expect(cards.length).toBe(5);
  });

  it('has aria-busy=true for accessibility', () => {
    render(<RadarBriefingSkeleton />);
    const el = screen.getByLabelText('精选加载中');
    expect(el.getAttribute('aria-busy')).toBe('true');
  });
});

describe('RadarBriefingEmptyState', () => {
  it('renders the empty state message', () => {
    render(<RadarBriefingEmptyState />);
    expect(screen.getByText(/今日 0 条信号 · 持续监控中/)).toBeTruthy();
  });

  it('shows days since last tier 3 when provided and > 0', () => {
    render(<RadarBriefingEmptyState daysSinceLastTier3={7} />);
    // i18n key 渲染为 "上次信号在 7 天前"（单一 text node），不能 getByText 拆分
    expect(screen.getByText(/上次信号在 7 天前/)).toBeTruthy();
  });

  it('does not show days text when daysSinceLastTier3 is undefined', () => {
    render(<RadarBriefingEmptyState />);
    expect(screen.queryByText(/上次/)).toBeNull();
  });

  it('does not show days text when daysSinceLastTier3 is 0', () => {
    render(<RadarBriefingEmptyState daysSinceLastTier3={0} />);
    expect(screen.queryByText(/上次/)).toBeNull();
  });
});

describe('RadarBriefingErrorState', () => {
  it('renders the error heading', () => {
    render(<RadarBriefingErrorState />);
    expect(screen.getByText(/加载精选失败/)).toBeTruthy();
  });

  it('has role=alert for accessibility', () => {
    render(<RadarBriefingErrorState />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders the error message when provided', () => {
    render(<RadarBriefingErrorState error="网络请求超时，请稍后重试" />);
    expect(screen.getByText('网络请求超时，请稍后重试')).toBeTruthy();
  });

  it('does not render error message when error is undefined', () => {
    const { container } = render(<RadarBriefingErrorState />);
    // Only heading paragraph should exist, no extra text
    expect(container.querySelectorAll('p').length).toBe(1);
  });

  it('renders retry button when onRetry is provided', () => {
    render(<RadarBriefingErrorState onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('does not render retry button when onRetry is not provided', () => {
    render(<RadarBriefingErrorState />);
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  });

  it('calls onRetry when retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<RadarBriefingErrorState onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
