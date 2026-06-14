/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { RadarBriefingCard, type DailySignalView } from '../RadarBriefingCard';

const baseSignal: DailySignalView = {
  id: 'sig-1',
  tier: 3,
  title: 'NVIDIA Q1 财报超预期',
  oneLineTakeaway: 'NVIDIA 数据中心业务同比增长 427%',
  whyItMatters: '这标志着 AI 算力需求仍在快速扩张，供给端紧张态势延续。',
  whatsNext: '关注下季度 H100 出货量与订单积压数据。',
  signalTags: ['AI算力', '财报', '半导体'],
  entities: ['NVIDIA', 'AMD', 'Intel', 'TSMC', 'Microsoft'],
  evidenceItemIds: ['e1', 'e2'],
  narrativeId: undefined,
};

const defaultProps = {
  signal: baseSignal,
  index: 1,
  topicId: 'topic-ai',
  topicName: 'AI 行业动态',
  detailUrl: '/ai-radar/topic/topic-ai/signal/sig-1',
};

describe('RadarBriefingCard', () => {
  it('renders the index and title', () => {
    render(<RadarBriefingCard {...defaultProps} />);
    expect(screen.getByText(/NVIDIA Q1 财报超预期/)).toBeTruthy();
    expect(screen.getByText('1.')).toBeTruthy();
  });

  it('renders TierBadge for tier 3', () => {
    render(<RadarBriefingCard {...defaultProps} />);
    // TierBadge renders ⭐⭐⭐ for tier 3
    expect(screen.getByLabelText('Tier 3')).toBeTruthy();
  });

  it('renders tier 1 badge correctly', () => {
    const signal: DailySignalView = { ...baseSignal, tier: 1 };
    render(<RadarBriefingCard {...defaultProps} signal={signal} />);
    expect(screen.getByLabelText('Tier 1')).toBeTruthy();
  });

  it('renders whyItMatters inside callout', () => {
    render(<RadarBriefingCard {...defaultProps} />);
    const callout = screen.getByRole('note');
    expect(callout.textContent).toContain('AI 算力需求仍在快速扩张');
  });

  it('renders oneLineTakeaway', () => {
    render(<RadarBriefingCard {...defaultProps} />);
    expect(screen.getByText(/NVIDIA 数据中心业务同比增长 427%/)).toBeTruthy();
  });

  it('renders whatsNext', () => {
    render(<RadarBriefingCard {...defaultProps} />);
    expect(screen.getByText(/关注下季度 H100 出货量/)).toBeTruthy();
  });

  it('renders up to 3 signal tags', () => {
    render(<RadarBriefingCard {...defaultProps} />);
    expect(screen.getByText('AI算力')).toBeTruthy();
    expect(screen.getByText('财报')).toBeTruthy();
    expect(screen.getByText('半导体')).toBeTruthy();
  });

  it('renders up to 5 entities', () => {
    render(<RadarBriefingCard {...defaultProps} />);
    expect(screen.getByText('NVIDIA')).toBeTruthy();
    expect(screen.getByText('AMD')).toBeTruthy();
    expect(screen.getByText('TSMC')).toBeTruthy();
  });

  it('does NOT render NarrativeThread when episodes < 2', () => {
    render(
      <RadarBriefingCard
        {...defaultProps}
        signal={{ ...baseSignal, narrativeId: 'narr-1' }}
        narrativeEpisodes={[
          { date: '2026-05-17', signalId: 'sig-0', title: 'Ep 1', tier: 2 },
        ]}
        narrativeLabel="NVIDIA 事件"
      />
    );
    // NarrativeThread returns null when < 2 episodes
    expect(screen.queryByText(/第 \d+ 集/)).toBeNull();
  });

  it('renders NarrativeThread when episodes >= 2', () => {
    const episodes = [
      {
        date: '2026-05-17',
        signalId: 'sig-prev',
        title: 'Ep 1',
        tier: 2 as const,
      },
      {
        date: '2026-05-18',
        signalId: 'sig-1',
        title: 'Ep 2',
        tier: 3 as const,
      },
    ];
    render(
      <RadarBriefingCard
        {...defaultProps}
        signal={{ ...baseSignal, narrativeId: 'narr-1' }}
        narrativeEpisodes={episodes}
        narrativeLabel="NVIDIA 事件"
      />
    );
    expect(screen.getByText(/NVIDIA 事件 · 第 2 集/)).toBeTruthy();
  });

  it('does NOT render NarrativeThread when narrativeId is undefined', () => {
    const episodes = [
      {
        date: '2026-05-17',
        signalId: 'sig-prev',
        title: 'Ep 1',
        tier: 2 as const,
      },
      {
        date: '2026-05-18',
        signalId: 'sig-1',
        title: 'Ep 2',
        tier: 3 as const,
      },
    ];
    render(
      <RadarBriefingCard
        {...defaultProps}
        signal={{ ...baseSignal, narrativeId: undefined }}
        narrativeEpisodes={episodes}
        narrativeLabel="NVIDIA 事件"
      />
    );
    expect(screen.queryByText(/第 2 集/)).toBeNull();
  });

  it('renders all evidence sources (multi-source, no collapse)', () => {
    const sources = [
      {
        name: 'Bloomberg',
        url: 'https://bloomberg.com',
        publishedAt: '2026-05-17',
      },
      {
        name: 'Reuters',
        url: 'https://reuters.com',
        publishedAt: '2026-05-17',
      },
      { name: 'CNBC', publishedAt: '2026-05-17' },
    ];
    render(<RadarBriefingCard {...defaultProps} evidenceSources={sources} />);
    // 多源全量直接可见，不再折叠
    expect(screen.getByText('Bloomberg')).toBeTruthy();
    expect(screen.getByText('Reuters')).toBeTruthy();
    expect(screen.getByText('CNBC')).toBeTruthy();
    expect(screen.queryByText(/展开另/)).toBeNull();
  });

  it('renders url-less source as plain text (no link)', () => {
    const sources = [
      {
        name: 'Bloomberg',
        url: 'https://bloomberg.com',
        publishedAt: '2026-05-17',
      },
      { name: 'CNBC', publishedAt: '2026-05-17' },
    ];
    render(<RadarBriefingCard {...defaultProps} evidenceSources={sources} />);
    // 有 url → 渲染成可点击链接（追溯原文）
    expect(screen.getByText('Bloomberg').closest('a')).toBeTruthy();
    // 无 url → 降级为纯文本，不报错
    expect(screen.getByText('CNBC').closest('a')).toBeNull();
  });

  it('does not render evidence section when evidenceSources is empty', () => {
    render(<RadarBriefingCard {...defaultProps} evidenceSources={[]} />);
    expect(screen.queryByText('📚 证据来源')).toBeNull();
  });

  it('calls onFavorite when ShareActions favorite is triggered', async () => {
    const onFavorite = vi.fn().mockResolvedValue(undefined);
    render(
      <RadarBriefingCard
        {...defaultProps}
        onFavorite={onFavorite}
        isFavorited={false}
      />
    );
    const favBtn = screen.getByLabelText('favorite');
    fireEvent.click(favBtn);
    expect(onFavorite).toHaveBeenCalledTimes(1);
  });
});
