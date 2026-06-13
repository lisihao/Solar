/**
 * StoryAnalysisDashboard Unit Tests
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
import { StoryAnalysisDashboard } from '../StoryAnalysisDashboard';
import * as api from '@/services/ai-writing/api';

// Mock the API module
vi.mock('@/services/ai-writing/api', () => ({
  getAnalysisDashboard: vi.fn(),
}));

const mockDashboard: api.AnalysisDashboard = {
  projectId: 'test-project-id',
  projectName: 'Test Project',
  completion: {
    isComplete: false,
    confidence: 0.65,
    signals: [
      {
        type: 'PLOT_RESOLUTION',
        confidence: 0.7,
        evidence: 'Main conflict resolved',
        source: 'content_analysis',
      },
    ],
    recommendation: 'Continue writing to reach a satisfying conclusion',
  },
  conflicts: {
    total: 3,
    highSeverity: 1,
    mediumSeverity: 1,
    lowSeverity: 1,
    recentConflicts: [
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
    ],
  },
  agentActivity: {
    recentEntries: [
      {
        id: 'entry-1',
        type: 'FACT',
        content: 'Main character entered the castle',
        source: 'writer-agent',
        createdAt: new Date().toISOString(),
      },
    ],
    totalEntries: 1,
  },
  analyzedAt: new Date().toISOString(),
};

describe('StoryAnalysisDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', async () => {
    vi.mocked(api.getAnalysisDashboard).mockImplementation(
      () => new Promise(() => {}) // Never resolves to keep loading state
    );

    render(<StoryAnalysisDashboard projectId="test-project-id" />);

    expect(screen.getByText('Loading analysis...')).toBeInTheDocument();
  });

  it('renders dashboard data after loading', async () => {
    vi.mocked(api.getAnalysisDashboard).mockResolvedValue(mockDashboard);

    render(<StoryAnalysisDashboard projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('Story Analysis')).toBeInTheDocument();
    });

    // Check completion section
    expect(screen.getByText('Story Completion')).toBeInTheDocument();
    expect(screen.getByText('65% towards completion')).toBeInTheDocument();

    // Check conflicts section
    expect(screen.getByText('Timeline Conflicts')).toBeInTheDocument();
    expect(screen.getByText('3 conflicts detected')).toBeInTheDocument();
  });

  it('renders error state when API fails', async () => {
    vi.mocked(api.getAnalysisDashboard).mockRejectedValue(
      new Error('Failed to fetch')
    );

    render(<StoryAnalysisDashboard projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    });
  });

  it('calls onConflictClick when conflict is clicked', async () => {
    vi.mocked(api.getAnalysisDashboard).mockResolvedValue(mockDashboard);
    const onConflictClick = vi.fn();

    render(
      <StoryAnalysisDashboard
        projectId="test-project-id"
        onConflictClick={onConflictClick}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Story Analysis')).toBeInTheDocument();
    });

    // Click on the conflict
    const conflictItem = screen.getByText('John');
    fireEvent.click(conflictItem);

    expect(onConflictClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conflict-1' })
    );
  });

  it('refresh button triggers data reload', async () => {
    vi.mocked(api.getAnalysisDashboard).mockResolvedValue(mockDashboard);

    render(<StoryAnalysisDashboard projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('Story Analysis')).toBeInTheDocument();
    });

    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    await act(async () => {
      fireEvent.click(refreshButton);
    });

    await waitFor(() => {
      expect(api.getAnalysisDashboard).toHaveBeenCalledTimes(2);
    });
  });

  it('toggles sections when clicked', async () => {
    vi.mocked(api.getAnalysisDashboard).mockResolvedValue(mockDashboard);

    render(<StoryAnalysisDashboard projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('Story Analysis')).toBeInTheDocument();
    });

    // Completion section should be expanded by default
    expect(screen.getByText('Detection Signals')).toBeInTheDocument();

    // Click to collapse
    const completionButton = screen.getByRole('button', {
      name: /story completion/i,
    });
    fireEvent.click(completionButton);

    // Detection Signals should now be hidden
    await waitFor(() => {
      expect(screen.queryByText('Detection Signals')).not.toBeInTheDocument();
    });
  });

  it('displays completion status correctly when story is complete', async () => {
    const completeDashboard: api.AnalysisDashboard = {
      ...mockDashboard,
      completion: {
        isComplete: true,
        confidence: 0.95,
        signals: [],
        recommendation: 'Story is complete',
      },
    };
    vi.mocked(api.getAnalysisDashboard).mockResolvedValue(completeDashboard);

    render(<StoryAnalysisDashboard projectId="test-project-id" />);

    await waitFor(() => {
      expect(
        screen.getByText('Story has reached a natural ending')
      ).toBeInTheDocument();
    });
  });

  it('displays no conflicts message when there are none', async () => {
    const noConflictsDashboard = {
      ...mockDashboard,
      conflicts: {
        total: 0,
        highSeverity: 0,
        mediumSeverity: 0,
        lowSeverity: 0,
        recentConflicts: [],
      },
    };
    vi.mocked(api.getAnalysisDashboard).mockResolvedValue(noConflictsDashboard);

    render(<StoryAnalysisDashboard projectId="test-project-id" />);

    await waitFor(() => {
      expect(screen.getByText('No conflicts detected')).toBeInTheDocument();
    });
  });
});
