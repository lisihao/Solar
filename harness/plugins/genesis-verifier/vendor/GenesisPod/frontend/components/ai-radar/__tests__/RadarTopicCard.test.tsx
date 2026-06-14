/// <reference types="@testing-library/jest-dom" />

/**
 * RadarTopicCard 单元测试
 *
 * 覆盖：
 *  - 三种 status badge（ACTIVE / PAUSED / ARCHIVED）
 *  - counts stats 三段（items / sources / runs）
 *  - 关键词 customSection（0 / <=5 / >5）
 *  - extraActions：ACTIVE 时显 pause + archive；PAUSED 时显 resume + archive；ARCHIVED 时不显 archive
 *  - 点卡片走 router.push
 *  - description null 不渲染
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { RadarTopicCard } from '../RadarTopicCard';
import type { RadarTopicWithCounts } from '@/services/ai-radar/types';

function makeTopic(
  overrides: Partial<RadarTopicWithCounts> = {}
): RadarTopicWithCounts {
  return {
    id: 'tid-1',
    userId: 'u-1',
    visibility: 'PRIVATE',
    name: 'GPT-5 发布动态',
    description: '关注 OpenAI 新模型',
    entityType: 'topic',
    keywords: ['gpt-5', 'openai'],
    matchMode: 'semantic',
    refreshCron: '0 */6 * * *',
    status: 'ACTIVE',
    nextDueAt: null,
    lastRunAt: '2026-05-15T10:00:00Z',
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-15T10:00:00Z',
    counts: { sources: 3, items: 42, runs: 7 },
    ...overrides,
  };
}

describe('RadarTopicCard', () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it('renders title + description + ACTIVE badge', () => {
    render(<RadarTopicCard topic={makeTopic()} />);
    expect(screen.getByText('GPT-5 发布动态')).toBeInTheDocument();
    expect(screen.getByText('关注 OpenAI 新模型')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
  });

  it('renders PAUSED status label', () => {
    render(<RadarTopicCard topic={makeTopic({ status: 'PAUSED' })} />);
    expect(screen.getByText('已暂停')).toBeInTheDocument();
  });

  it('renders ARCHIVED status label', () => {
    render(<RadarTopicCard topic={makeTopic({ status: 'ARCHIVED' })} />);
    expect(screen.getByText('已归档')).toBeInTheDocument();
  });

  it('renders three counts stats: items / sources / runs', () => {
    render(<RadarTopicCard topic={makeTopic()} />);
    expect(screen.getByText('42 条')).toBeInTheDocument();
    expect(screen.getByText('3 源')).toBeInTheDocument();
    expect(screen.getByText('7 次刷新')).toBeInTheDocument();
  });

  it('renders keyword chips (<=5)', () => {
    render(<RadarTopicCard topic={makeTopic({ keywords: ['a', 'b', 'c'] })} />);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('c')).toBeInTheDocument();
  });

  it('renders +N suffix when keywords >5', () => {
    render(
      <RadarTopicCard
        topic={makeTopic({ keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })}
      />
    );
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('omits customSection when keywords is empty', () => {
    const { container } = render(
      <RadarTopicCard topic={makeTopic({ keywords: [] })} />
    );
    // chips 容器有 flex flex-wrap，无 chip 时不应渲染
    expect(container.textContent).not.toMatch(/\+\d/);
  });

  it('clicking the card routes to detail page', () => {
    const { container } = render(<RadarTopicCard topic={makeTopic()} />);
    const card = container.querySelector('.cursor-pointer');
    expect(card).not.toBeNull();
    fireEvent.click(card!);
    expect(pushMock).toHaveBeenCalledWith('/ai-radar/topic/tid-1');
  });

  it('handles description = null without crashing', () => {
    render(<RadarTopicCard topic={makeTopic({ description: null })} />);
    expect(screen.getByText('GPT-5 发布动态')).toBeInTheDocument();
  });

  it('uses cyan→sky gradient for icon block', () => {
    const { container } = render(<RadarTopicCard topic={makeTopic()} />);
    const iconBlock = container.querySelector('.h-12.w-12');
    expect(iconBlock?.className).toMatch(/from-cyan-500/);
    expect(iconBlock?.className).toMatch(/to-sky-600/);
  });

  it('permission/edit/delete are the only owner actions (no pause/archive)', () => {
    render(<RadarTopicCard topic={makeTopic()} onDelete={vi.fn()} />);
    expect(screen.queryByLabelText('暂停')).toBeNull();
    expect(screen.queryByLabelText('恢复')).toBeNull();
    expect(screen.queryByLabelText('归档')).toBeNull();
  });
});
