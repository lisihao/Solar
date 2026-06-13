/**
 * TimelineConflictPanel Unit Tests
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
import { TimelineConflictPanel } from '../TimelineConflictPanel';
import * as api from '@/services/ai-writing/api';

// Mock the API module
vi.mock('@/services/ai-writing/api', () => ({
  getChapterTimelineConflicts: vi.fn(),
}));

const mockConflicts: api.TimelineConflict[] = [
  {
    id: 'conflict-1',
    type: 'timeline',
    severity: 'HIGH',
    description: 'Character age inconsistency',
    sourceChapter: 5,
    targetChapter: 10,
    subject: 'John',
    conflictingStatements: [
      'John is 25 years old',
      'John celebrated his 30th birthday',
    ],
    suggestedResolution: 'Adjust the timeline or character age',
  },
  {
    id: 'conflict-2',
    type: 'location',
    severity: 'MEDIUM',
    description: 'Location inconsistency',
    sourceChapter: 3,
    targetChapter: 7,
    subject: 'Castle',
    conflictingStatements: [
      'Castle is in the mountains',
      'Castle overlooks the sea',
    ],
  },
  {
    id: 'conflict-3',
    type: 'trait',
    severity: 'LOW',
    description: 'Minor trait inconsistency',
    sourceChapter: 1,
    subject: 'Mary',
    conflictingStatements: ['Mary has blue eyes', 'Mary has green eyes'],
  },
];

describe('TimelineConflictPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', async () => {
    vi.mocked(api.getChapterTimelineConflicts).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<TimelineConflictPanel chapterId="chapter-1" chapterNumber={5} />);

    expect(screen.getByText('Analyzing...')).toBeInTheDocument();
  });

  it('renders conflicts after loading', async () => {
    vi.mocked(api.getChapterTimelineConflicts).mockResolvedValue({
      chapterId: 'chapter-1',
      conflicts: mockConflicts,
      totalConflicts: 3,
      analyzedAt: new Date().toISOString(),
    });

    render(<TimelineConflictPanel chapterId="chapter-1" chapterNumber={5} />);

    await waitFor(() => {
      expect(screen.getByText('Timeline Conflicts')).toBeInTheDocument();
    });

    // Check severity badges
    expect(screen.getByText('1 High')).toBeInTheDocument();
    expect(screen.getByText('1 Med')).toBeInTheDocument();
    expect(screen.getByText('1 Low')).toBeInTheDocument();

    // Check conflict subjects
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getByText('Castle')).toBeInTheDocument();
    expect(screen.getByText('Mary')).toBeInTheDocument();
  });

  it('renders no conflicts message when empty', async () => {
    vi.mocked(api.getChapterTimelineConflicts).mockResolvedValue({
      chapterId: 'chapter-1',
      conflicts: [],
      totalConflicts: 0,
      analyzedAt: new Date().toISOString(),
    });

    render(<TimelineConflictPanel chapterId="chapter-1" chapterNumber={5} />);

    await waitFor(() => {
      expect(screen.getByText('No Conflicts')).toBeInTheDocument();
      expect(
        screen.getByText('This chapter has no timeline conflicts')
      ).toBeInTheDocument();
    });
  });

  it('expands conflict details when clicked', async () => {
    vi.mocked(api.getChapterTimelineConflicts).mockResolvedValue({
      chapterId: 'chapter-1',
      conflicts: mockConflicts,
      totalConflicts: 3,
      analyzedAt: new Date().toISOString(),
    });

    render(<TimelineConflictPanel chapterId="chapter-1" chapterNumber={5} />);

    await waitFor(() => {
      expect(screen.getByText('John')).toBeInTheDocument();
    });

    // Click on the first conflict to expand
    const conflictButton = screen.getByRole('button', { name: /john/i });
    fireEvent.click(conflictButton);

    // Check that expanded details are shown
    await waitFor(() => {
      expect(screen.getByText('Conflicting Statements')).toBeInTheDocument();
      expect(screen.getByText('John is 25 years old')).toBeInTheDocument();
      expect(
        screen.getByText('John celebrated his 30th birthday')
      ).toBeInTheDocument();
    });

    // Check suggested resolution
    expect(screen.getByText('Suggested Resolution')).toBeInTheDocument();
    expect(
      screen.getByText('Adjust the timeline or character age')
    ).toBeInTheDocument();
  });

  it('calls onJumpToChapter when jump button is clicked', async () => {
    vi.mocked(api.getChapterTimelineConflicts).mockResolvedValue({
      chapterId: 'chapter-1',
      conflicts: mockConflicts,
      totalConflicts: 3,
      analyzedAt: new Date().toISOString(),
    });

    const onJumpToChapter = vi.fn();

    render(
      <TimelineConflictPanel
        chapterId="chapter-1"
        chapterNumber={5}
        onJumpToChapter={onJumpToChapter}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('John')).toBeInTheDocument();
    });

    // Expand the first conflict
    const conflictButton = screen.getByRole('button', { name: /john/i });
    fireEvent.click(conflictButton);

    await waitFor(() => {
      expect(screen.getByText('Jump to Chapter 10')).toBeInTheDocument();
    });

    // Click the jump button
    const jumpButton = screen.getByText('Jump to Chapter 10');
    fireEvent.click(jumpButton);

    expect(onJumpToChapter).toHaveBeenCalledWith(10);
  });

  it('calls onClose when close button is clicked', async () => {
    vi.mocked(api.getChapterTimelineConflicts).mockResolvedValue({
      chapterId: 'chapter-1',
      conflicts: [],
      totalConflicts: 0,
      analyzedAt: new Date().toISOString(),
    });

    const onClose = vi.fn();

    render(
      <TimelineConflictPanel
        chapterId="chapter-1"
        chapterNumber={5}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Timeline Conflicts')).toBeInTheDocument();
    });

    const closeButton = screen.getByRole('button', { name: /close panel/i });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it('refresh button triggers data reload', async () => {
    vi.mocked(api.getChapterTimelineConflicts).mockResolvedValue({
      chapterId: 'chapter-1',
      conflicts: mockConflicts,
      totalConflicts: 3,
      analyzedAt: new Date().toISOString(),
    });

    render(<TimelineConflictPanel chapterId="chapter-1" chapterNumber={5} />);

    await waitFor(() => {
      expect(screen.getByText('Timeline Conflicts')).toBeInTheDocument();
    });

    const refreshButton = screen.getByRole('button', {
      name: /refresh timeline conflicts/i,
    });
    await act(async () => {
      fireEvent.click(refreshButton);
    });

    await waitFor(() => {
      expect(api.getChapterTimelineConflicts).toHaveBeenCalledTimes(2);
    });
  });

  it('displays chapter number in summary', async () => {
    vi.mocked(api.getChapterTimelineConflicts).mockResolvedValue({
      chapterId: 'chapter-1',
      conflicts: mockConflicts,
      totalConflicts: 3,
      analyzedAt: new Date().toISOString(),
    });

    render(<TimelineConflictPanel chapterId="chapter-1" chapterNumber={5} />);

    await waitFor(() => {
      expect(screen.getByText('Chapter 5')).toBeInTheDocument();
    });
  });

  it('renders error state when API fails', async () => {
    vi.mocked(api.getChapterTimelineConflicts).mockRejectedValue(
      new Error('Network error')
    );

    render(<TimelineConflictPanel chapterId="chapter-1" chapterNumber={5} />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
