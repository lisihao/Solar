/**
 * HierarchicalSummaryTab Unit Tests
 */

/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';
import { HierarchicalSummaryTab } from '../HierarchicalSummaryTab';
import * as api from '@/services/ai-writing/api';

// Mock the API module
vi.mock('@/services/ai-writing/api', () => ({
  getHierarchicalSummaries: vi.fn(),
  generateSummaries: vi.fn(),
}));

const mockSummariesResponse: api.HierarchicalSummariesResponse = {
  projectId: 'test-project-id',
  context: {
    recentChapters: [
      {
        chapterNumber: 10,
        title: 'The Final Battle',
        summary: 'The hero faces the dragon in an epic battle.',
        keyEvents: ['Dragon awakens', 'Hero draws sword'],
        emotionalTone: 'Tense',
        characterChanges: {
          Hero: 'Gains courage',
          Dragon: 'Weakened',
        },
        scenes: [
          {
            sceneNumber: 1,
            summary: 'Dragon emerges from cave',
            location: 'Mountain Peak',
            characters: ['Hero', 'Dragon'],
            keyAction: 'Dragon breathes fire',
          },
        ],
      },
    ],
    mediumChapters: [
      {
        chapterNumber: 8,
        title: 'Preparing for Battle',
        summary: 'The hero gathers allies and weapons.',
        keyEvents: ['Alliance formed'],
        emotionalTone: 'Determined',
        characterChanges: {},
      },
    ],
    distantContext:
      'In the early chapters, the hero was just a simple farmer who discovered their destiny...',
    estimatedTokens: 3500,
  },
  formattedContext:
    '【故事背景】\nIn the early chapters...\n\n【近期剧情】\n第8章：The hero gathers allies...',
};

describe('HierarchicalSummaryTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', async () => {
    vi.mocked(api.getHierarchicalSummaries).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<HierarchicalSummaryTab projectId="test-project-id" />);

    // Loading spinner is rendered via RefreshCw icon with animate-spin
    await waitFor(() => {
      const spinners = document.querySelectorAll('.animate-spin');
      expect(spinners.length).toBeGreaterThan(0);
    });
  });

  it('renders summaries after loading', async () => {
    vi.mocked(api.getHierarchicalSummaries).mockResolvedValue(
      mockSummariesResponse
    );

    render(<HierarchicalSummaryTab projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('Story Summaries')).toBeInTheDocument();
    });

    // Check token count display
    expect(screen.getByText('~3,500 tokens')).toBeInTheDocument();

    // Check story background section
    expect(screen.getByText('Story Background')).toBeInTheDocument();

    // Check recent chapters
    expect(screen.getByText('Recent Chapters')).toBeInTheDocument();
    expect(screen.getByText('Chapter 10')).toBeInTheDocument();
    expect(screen.getByText('The Final Battle')).toBeInTheDocument();
  });

  it('renders empty state when no summaries', async () => {
    vi.mocked(api.getHierarchicalSummaries).mockResolvedValue({
      projectId: 'test-project-id',
      context: {
        recentChapters: [],
        mediumChapters: [],
        distantContext: '',
        estimatedTokens: 0,
      },
      formattedContext: '',
    });

    render(<HierarchicalSummaryTab projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('No Summaries Yet')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Generate summaries for your chapters to see them here'
        )
      ).toBeInTheDocument();
    });
  });

  it('toggles between structured and context view', async () => {
    vi.mocked(api.getHierarchicalSummaries).mockResolvedValue(
      mockSummariesResponse
    );

    render(<HierarchicalSummaryTab projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('Story Summaries')).toBeInTheDocument();
    });

    // Should be in structured view by default
    expect(screen.getByText('Story Background')).toBeInTheDocument();

    // Click Context button
    const contextButton = screen.getByRole('button', { name: /context/i });
    fireEvent.click(contextButton);

    // Should now show formatted context
    await waitFor(() => {
      expect(
        screen.getByText('Pre-formatted context for AI prompts:')
      ).toBeInTheDocument();
    });

    // Click Structured button to go back
    const structuredButton = screen.getByRole('button', {
      name: /structured/i,
    });
    fireEvent.click(structuredButton);

    await waitFor(() => {
      expect(screen.getByText('Story Background')).toBeInTheDocument();
    });
  });

  it('expands chapter details when clicked', async () => {
    vi.mocked(api.getHierarchicalSummaries).mockResolvedValue(
      mockSummariesResponse
    );

    render(<HierarchicalSummaryTab projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('Chapter 10')).toBeInTheDocument();
    });

    // Click on chapter to expand
    const chapterButton = screen.getByRole('button', {
      name: /chapter 10/i,
    });
    fireEvent.click(chapterButton);

    // Check expanded details
    await waitFor(() => {
      expect(screen.getByText('Key Events')).toBeInTheDocument();
      expect(screen.getByText('Dragon awakens')).toBeInTheDocument();
      expect(screen.getByText('Hero draws sword')).toBeInTheDocument();
    });

    // Check character changes
    expect(screen.getByText('Character Changes')).toBeInTheDocument();
    expect(screen.getByText('Hero:')).toBeInTheDocument();
    expect(screen.getByText('Gains courage')).toBeInTheDocument();

    // Check emotional tone
    expect(screen.getByText('Emotional Tone')).toBeInTheDocument();
    expect(screen.getByText('Tense')).toBeInTheDocument();

    // Check scenes (for recent chapters)
    expect(screen.getByText('Scenes')).toBeInTheDocument();
    expect(screen.getByText('Scene 1')).toBeInTheDocument();
    expect(screen.getByText('Mountain Peak')).toBeInTheDocument();
  });

  it('generates summaries when generate button is clicked', async () => {
    vi.mocked(api.getHierarchicalSummaries).mockResolvedValue({
      projectId: 'test-project-id',
      context: {
        recentChapters: [],
        mediumChapters: [],
        distantContext: '',
        estimatedTokens: 0,
      },
      formattedContext: '',
    });
    vi.mocked(api.generateSummaries).mockResolvedValue({
      projectId: 'test-project-id',
      updatedCount: 5,
      message: 'Generated 5 summaries',
    });

    render(<HierarchicalSummaryTab projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('No Summaries Yet')).toBeInTheDocument();
    });

    // Click generate button
    const generateButton = screen.getByRole('button', {
      name: /generate summaries/i,
    });
    fireEvent.click(generateButton);

    // Verify generateSummaries was called
    await waitFor(() => {
      expect(api.generateSummaries).toHaveBeenCalledWith('test-project-id');
    });

    // Verify it refetches summaries after generation
    await waitFor(() => {
      expect(api.getHierarchicalSummaries).toHaveBeenCalledTimes(2);
    });
  });

  it('refresh button triggers data reload', async () => {
    vi.mocked(api.getHierarchicalSummaries).mockResolvedValue(
      mockSummariesResponse
    );

    render(<HierarchicalSummaryTab projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('Story Summaries')).toBeInTheDocument();
    });

    const refreshButton = screen.getByRole('button', {
      name: /refresh summaries/i,
    });
    await act(async () => {
      fireEvent.click(refreshButton);
    });

    await waitFor(() => {
      expect(api.getHierarchicalSummaries).toHaveBeenCalledTimes(2);
    });
  });

  it('renders error state when API fails', async () => {
    vi.mocked(api.getHierarchicalSummaries).mockRejectedValue(
      new Error('Failed to load')
    );

    render(<HierarchicalSummaryTab projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });
  });

  it('passes currentChapter to API call', async () => {
    vi.mocked(api.getHierarchicalSummaries).mockResolvedValue(
      mockSummariesResponse
    );

    render(
      <HierarchicalSummaryTab projectId="test-project-id" currentChapter={15} />
    );

    await waitFor(() => {
      expect(api.getHierarchicalSummaries).toHaveBeenCalledWith(
        'test-project-id',
        expect.objectContaining({ currentChapter: 15 })
      );
    });
  });

  it('displays medium chapters in Recent Plot section', async () => {
    vi.mocked(api.getHierarchicalSummaries).mockResolvedValue(
      mockSummariesResponse
    );

    render(<HierarchicalSummaryTab projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('Recent Plot')).toBeInTheDocument();
    });

    expect(screen.getByText('Chapter 8')).toBeInTheDocument();
    expect(screen.getByText('Preparing for Battle')).toBeInTheDocument();
  });
});
