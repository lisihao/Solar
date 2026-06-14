/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { NarrativeThread, type NarrativeEpisode } from '../NarrativeThread';

const makeEpisodes = (n: number): NarrativeEpisode[] =>
  Array.from({ length: n }, (_, i) => ({
    date: `2026-05-${String(10 + i).padStart(2, '0')}`,
    signalId: `sig-${i}`,
    title: `Episode ${i + 1} title`,
    tier: 2 as const,
  }));

describe('NarrativeThread', () => {
  it('returns null when episodes.length < 2', () => {
    const { container } = render(
      <NarrativeThread
        topicId="topic-1"
        narrativeId="narr-1"
        label="Test Narrative"
        episodes={[]}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when episodes.length === 1', () => {
    const { container } = render(
      <NarrativeThread
        topicId="topic-1"
        narrativeId="narr-1"
        label="Single"
        episodes={makeEpisodes(1)}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders label and episode count when episodes.length >= 2', () => {
    render(
      <NarrativeThread
        topicId="topic-1"
        narrativeId="narr-1"
        label="NVIDIA Blackwell 量产时间线"
        episodes={makeEpisodes(3)}
      />
    );
    expect(
      screen.getByText(/NVIDIA Blackwell 量产时间线 · 第 3 集/)
    ).toBeTruthy();
  });

  it('renders prev link pointing to the narrative route', () => {
    render(
      <NarrativeThread
        topicId="topic-abc"
        narrativeId="narr-xyz"
        label="Test"
        episodes={makeEpisodes(2)}
      />
    );
    const link = screen.getByRole('link', { name: '前情 →' });
    expect(link.getAttribute('href')).toBe(
      '/ai-radar/topic/topic-abc/narrative/narr-xyz'
    );
  });

  it('highlights the circle matching currentSignalDate', () => {
    const episodes = makeEpisodes(3);
    const targetDate = episodes[1].date;

    const { container } = render(
      <NarrativeThread
        topicId="topic-1"
        narrativeId="narr-1"
        label="Test"
        episodes={episodes}
        currentSignalDate={targetDate}
      />
    );

    const circles = container.querySelectorAll('.rounded-full');

    // Second circle (index 1) should be highlighted
    expect(circles[1].className).toContain('bg-violet-600');
    // Others should not
    expect(circles[0].className).not.toContain('bg-violet-600');
    expect(circles[2].className).not.toContain('bg-violet-600');
  });
});
