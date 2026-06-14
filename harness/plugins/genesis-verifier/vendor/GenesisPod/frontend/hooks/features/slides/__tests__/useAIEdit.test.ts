import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('@/lib/utils/config', () => ({
  config: {
    apiUrl: 'http://test-api',
    apiBaseUrl: 'http://test-api',
    streamApiUrl: 'http://test-stream',
  },
}));
vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { useAuth } from '@/contexts/AuthContext';

const mockFixLayoutResult = {
  success: true,
  originalHtml: '<div>Original</div>',
  fixedHtml: '<div>Fixed</div>',
  issuesFound: 3,
  issuesFixed: 3,
  criticalIssues: 1,
};

const mockPolishResult = {
  success: true,
  pagesPolished: 5,
  totalChanges: 12,
  pages: [{ index: 0, title: 'Cover', content: 'Updated cover content' }],
};

const mockFactCheckResult = {
  success: true,
  totalClaims: 10,
  verifiedCount: 8,
  disputedCount: 1,
  needsCitationCount: 1,
  overallCredibility: 0.8,
  pageResults: [
    {
      pageIndex: 0,
      overallScore: 0.9,
      credibilityLevel: 'high',
      claimsCount: 3,
    },
  ],
};

describe('useAIEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'test-token',
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);
  });

  // -----------------------------------------------------------------------
  // fixLayout
  // -----------------------------------------------------------------------

  it('fixLayout sends POST to correct URL with missionId and pageIndex', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockFixLayoutResult }),
    });

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    await act(async () => {
      await result.current.fixLayout('mission-1', 2);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/edit/fix-layout/mission-1/2',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('fixLayout returns FixLayoutResult on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockFixLayoutResult }),
    });

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    let fixResult: typeof mockFixLayoutResult | null = null;
    await act(async () => {
      fixResult = await result.current.fixLayout('mission-1', 0);
    });

    expect(fixResult).toEqual(mockFixLayoutResult);
  });

  it('fixLayout returns null and sets error when user not logged in', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    let fixResult: unknown;
    await act(async () => {
      fixResult = await result.current.fixLayout('mission-1', 0);
    });

    expect(fixResult).toBeNull();
    expect(result.current.error).toBe('User not authenticated');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fixLayout returns null and sets error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    let fixResult: unknown;
    await act(async () => {
      fixResult = await result.current.fixLayout('mission-1', 0);
    });

    expect(fixResult).toBeNull();
    expect(result.current.error).toBe('Failed to fix layout');
  });

  // -----------------------------------------------------------------------
  // polishContent
  // -----------------------------------------------------------------------

  it('polishContent sends POST to correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockPolishResult }),
    });

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    await act(async () => {
      await result.current.polishContent('mission-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/edit/polish/mission-1',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('polishContent sends options in request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockPolishResult }),
    });

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    const options = { targetTone: 'formal' as const, language: 'zh' as const };
    await act(async () => {
      await result.current.polishContent('mission-1', options);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify(options) })
    );
  });

  it('polishContent returns null and sets error when user not logged in', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    let polishResult: unknown;
    await act(async () => {
      polishResult = await result.current.polishContent('mission-1');
    });

    expect(polishResult).toBeNull();
    expect(result.current.error).toBe('User not authenticated');
  });

  // -----------------------------------------------------------------------
  // factCheck
  // -----------------------------------------------------------------------

  it('factCheck sends POST to correct URL with strictMode=false by default', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockFactCheckResult }),
    });

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    await act(async () => {
      await result.current.factCheck('mission-1');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/edit/fact-check/mission-1?strictMode=false',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('factCheck sends strictMode=true when passed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockFactCheckResult }),
    });

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    await act(async () => {
      await result.current.factCheck('mission-1', true);
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('strictMode=true');
  });

  it('factCheck returns null and sets error when user not logged in', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      accessToken: null,
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as any);

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    let factCheckResult: unknown;
    await act(async () => {
      factCheckResult = await result.current.factCheck('mission-1');
    });

    expect(factCheckResult).toBeNull();
    expect(result.current.error).toBe('User not authenticated');
  });

  // -----------------------------------------------------------------------
  // executeAction dispatcher
  // -----------------------------------------------------------------------

  it('executeAction routes fix-layout to fixLayout with pageIndex', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockFixLayoutResult }),
    });

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    let actionResult: unknown;
    await act(async () => {
      actionResult = await result.current.executeAction(
        'fix-layout',
        'mission-1',
        3
      );
    });

    expect(actionResult).toEqual(mockFixLayoutResult);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/edit/fix-layout/mission-1/3',
      expect.any(Object)
    );
  });

  it('executeAction returns null and sets error when fix-layout missing pageIndex', async () => {
    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    let actionResult: unknown;
    await act(async () => {
      actionResult = await result.current.executeAction(
        'fix-layout',
        'mission-1'
      );
    });

    expect(actionResult).toBeNull();
    expect(result.current.error).toBe('Page index is required for fix-layout');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('executeAction routes polish-content to polishContent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockPolishResult }),
    });

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    let actionResult: unknown;
    await act(async () => {
      actionResult = await result.current.executeAction(
        'polish-content',
        'mission-1'
      );
    });

    expect(actionResult).toEqual(mockPolishResult);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/edit/polish/mission-1',
      expect.any(Object)
    );
  });

  it('executeAction routes fact-check to factCheck', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: mockFactCheckResult }),
    });

    const { useAIEdit } = await import('../useAIEdit');
    const { result } = renderHook(() => useAIEdit());

    let actionResult: unknown;
    await act(async () => {
      actionResult = await result.current.executeAction(
        'fact-check',
        'mission-1'
      );
    });

    expect(actionResult).toEqual(mockFactCheckResult);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/fact-check/mission-1'),
      expect.any(Object)
    );
  });
});
