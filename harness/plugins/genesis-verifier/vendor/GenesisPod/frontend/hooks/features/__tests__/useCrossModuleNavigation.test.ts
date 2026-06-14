import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import {
  useCrossModuleNavigation,
  type NavigateToSlidesOptions,
  type NavigateToResearchOptions,
} from '../useCrossModuleNavigation';

describe('useCrossModuleNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== Initial State ====================

  it('should expose navigateToSlides and navigateToResearchCreate', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());
    expect(typeof result.current.navigateToSlides).toBe('function');
    expect(typeof result.current.navigateToResearchCreate).toBe('function');
  });

  // ==================== navigateToSlides ====================

  it('navigateToSlides: navigates to /ai-office/slides with action=import', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToSlides({
        sourceType: 'research',
        sourceId: 'sess-123',
      });
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/ai-office/slides');
    expect(calledUrl).toContain('action=import');
    expect(calledUrl).toContain('sourceType=research');
    expect(calledUrl).toContain('sourceId=sess-123');
  });

  it('navigateToSlides: includes outputId when provided', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToSlides({
        sourceType: 'research-project',
        sourceId: 'proj-1',
        outputId: 'out-42',
      });
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).toContain('outputId=out-42');
  });

  it('navigateToSlides: includes title when provided', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToSlides({
        sourceType: 'research',
        sourceId: 'sess-1',
        title: 'My Research Title',
      });
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).toContain('title=My+Research+Title');
  });

  it('navigateToSlides: includes targetPages when provided', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToSlides({
        sourceType: 'research',
        sourceId: 'sess-1',
        targetPages: 15,
      });
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).toContain('targetPages=15');
  });

  it('navigateToSlides: includes stylePreference when provided', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToSlides({
        sourceType: 'research',
        sourceId: 'sess-1',
        stylePreference: 'dark',
      });
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).toContain('stylePreference=dark');
  });

  it('navigateToSlides: includes themeId when provided', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToSlides({
        sourceType: 'research',
        sourceId: 'sess-1',
        themeId: 'theme-corporate',
      });
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).toContain('themeId=theme-corporate');
  });

  it('navigateToSlides: omits optional params when not provided', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToSlides({
        sourceType: 'research',
        sourceId: 'sess-1',
      });
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('outputId');
    expect(calledUrl).not.toContain('title');
    expect(calledUrl).not.toContain('targetPages');
    expect(calledUrl).not.toContain('stylePreference');
    expect(calledUrl).not.toContain('themeId');
  });

  it('navigateToSlides: includes all params when all are provided', () => {
    const options: NavigateToSlidesOptions = {
      sourceType: 'research-project',
      sourceId: 'proj-1',
      outputId: 'out-1',
      title: 'Full Options Test',
      targetPages: 20,
      stylePreference: 'light',
      themeId: 'theme-minimal',
    };

    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToSlides(options);
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).toContain('action=import');
    expect(calledUrl).toContain('sourceType=research-project');
    expect(calledUrl).toContain('sourceId=proj-1');
    expect(calledUrl).toContain('outputId=out-1');
    expect(calledUrl).toContain('targetPages=20');
    expect(calledUrl).toContain('stylePreference=light');
    expect(calledUrl).toContain('themeId=theme-minimal');
  });

  // ==================== navigateToResearchCreate ====================

  it('navigateToResearchCreate: navigates to /ai-research with action=create', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToResearchCreate({ action: 'create' });
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/ai-research');
    expect(calledUrl).toContain('action=create');
  });

  it('navigateToResearchCreate: includes fromTopicId when provided', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToResearchCreate({
        action: 'create',
        fromTopicId: 'topic-42',
      });
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).toContain('fromTopicId=topic-42');
  });

  it('navigateToResearchCreate: includes contextTitle when provided', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToResearchCreate({
        action: 'create',
        contextTitle: 'AI Trends 2026',
      });
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).toContain('contextTitle=AI+Trends+2026');
  });

  it('navigateToResearchCreate: includes contextSummary when provided', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToResearchCreate({
        action: 'create',
        contextSummary: 'A brief summary of the topic',
      });
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).toContain('contextSummary=');
  });

  it('navigateToResearchCreate: omits optional params when not provided', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToResearchCreate({ action: 'create' });
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('fromTopicId');
    expect(calledUrl).not.toContain('contextTitle');
    expect(calledUrl).not.toContain('contextSummary');
  });

  it('navigateToResearchCreate: includes all optional params when all provided', () => {
    const options: NavigateToResearchOptions = {
      action: 'create',
      fromTopicId: 'topic-1',
      contextTitle: 'My Topic',
      contextSummary: 'Detailed summary here',
    };

    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToResearchCreate(options);
    });

    const calledUrl = mockPush.mock.calls[0][0] as string;
    expect(calledUrl).toContain('action=create');
    expect(calledUrl).toContain('fromTopicId=topic-1');
    expect(calledUrl).toContain('contextTitle=My+Topic');
    expect(calledUrl).toContain('contextSummary=Detailed+summary+here');
  });

  // ==================== Multiple calls ====================

  it('can navigate multiple times independently', () => {
    const { result } = renderHook(() => useCrossModuleNavigation());

    act(() => {
      result.current.navigateToSlides({
        sourceType: 'research',
        sourceId: 'a',
      });
      result.current.navigateToResearchCreate({ action: 'create' });
    });

    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush.mock.calls[0][0]).toContain('/ai-office/slides');
    expect(mockPush.mock.calls[1][0]).toContain('/ai-research');
  });
});
