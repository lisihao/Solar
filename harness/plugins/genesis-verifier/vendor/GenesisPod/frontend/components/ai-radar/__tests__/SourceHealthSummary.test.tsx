/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { SourceHealthSummary, shouldShowAmber } from '../SourceHealthSummary';

describe('shouldShowAmber', () => {
  it('returns false when totalSources is 0', () => {
    expect(shouldShowAmber(0, 0)).toBe(false);
  });

  it('returns false when fail/total < 0.5', () => {
    expect(shouldShowAmber(2, 7)).toBe(false);
  });

  it('returns true when fail/total === 0.5', () => {
    expect(shouldShowAmber(3, 6)).toBe(true);
  });

  it('returns true when fail/total > 0.5', () => {
    expect(shouldShowAmber(5, 7)).toBe(true);
  });
});

describe('SourceHealthSummary', () => {
  it('renders "0 源" with slate-400 color when totalSources is 0', () => {
    const { container } = render(
      <SourceHealthSummary totalSources={0} okCount={0} failCount={0} />
    );
    expect(container.textContent).toBe('0 源');
    expect(container.querySelector('.text-slate-400')).not.toBeNull();
  });

  it('renders source counts in normal state (no amber)', () => {
    render(<SourceHealthSummary totalSources={7} okCount={5} failCount={2} />);
    const el = screen.getByText(/7 源/);
    expect(el).toBeTruthy();
    // 组件用 Lucide CheckCircle/XCircle 图标，不是 ✓/✗ 字符；textContent 仅含数字
    expect(el.textContent).toContain('5');
    expect(el.textContent).toContain('2');
    expect(el.querySelector('.text-emerald-500')).not.toBeNull(); // OK icon
    expect(el.querySelector('.text-slate-400')).not.toBeNull(); // FAIL icon (non-amber)
    expect(el.className).toContain('text-slate-500');
  });

  it('applies amber text when fail/total >= 0.5', () => {
    render(<SourceHealthSummary totalSources={6} okCount={3} failCount={3} />);
    const el = screen.getByText(/6 源/);
    expect(el.className).toContain('text-amber-600');
  });

  it('calls onAmberStateChange(true) when amber threshold is met', () => {
    const onAmberStateChange = vi.fn();
    render(
      <SourceHealthSummary
        totalSources={4}
        okCount={1}
        failCount={3}
        onAmberStateChange={onAmberStateChange}
      />
    );
    expect(onAmberStateChange).toHaveBeenCalledWith(true);
  });

  it('calls onAmberStateChange(false) when below amber threshold', () => {
    const onAmberStateChange = vi.fn();
    render(
      <SourceHealthSummary
        totalSources={5}
        okCount={4}
        failCount={1}
        onAmberStateChange={onAmberStateChange}
      />
    );
    expect(onAmberStateChange).toHaveBeenCalledWith(false);
  });
});
