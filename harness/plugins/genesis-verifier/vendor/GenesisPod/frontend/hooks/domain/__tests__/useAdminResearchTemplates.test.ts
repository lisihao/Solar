import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/cache', () => ({
  apiCache: {
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    keys: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status?: number
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

import { useAdminResearchTemplates } from '../useAdminResearchTemplates';
import { useApiGet, useApiPost } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';

const mockUseApiGet = vi.mocked(useApiGet);
const mockUseApiPost = vi.mocked(useApiPost);

const makeTemplate = (id = 'tmpl-1') => ({
  id,
  templateId: `template-${id}`,
  name: 'Market Analysis',
  description: 'A comprehensive market analysis template',
  category: 'business',
  dimensions: { depth: 'high', breadth: 'medium' },
  dataSources: ['web', 'news'],
  guidancePrompt: 'Analyze the market...',
  reportStructure: { sections: ['overview', 'analysis'] },
  iterationCount: 3,
  enabled: true,
  isBuiltIn: false,
  usageCount: 10,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
});

const makeApiGetMock = (templates = [makeTemplate()]) => ({
  data: templates,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(templates),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
});

const makeApiPostMock = (
  overrides?: Partial<ReturnType<typeof useApiPost>>
) => ({
  data: undefined,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(makeTemplate('new-tmpl')),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

describe('useAdminResearchTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiGet.mockReturnValue(makeApiGetMock() as never);
    mockUseApiPost.mockReturnValue(makeApiPostMock() as never);
  });

  it('should initialize with templates from API', () => {
    const { result } = renderHook(() => useAdminResearchTemplates());

    expect(result.current.templates).toHaveLength(1);
    expect(result.current.templates[0].name).toBe('Market Analysis');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should return empty array when no templates', () => {
    mockUseApiGet.mockReturnValue(makeApiGetMock([]) as never);

    const { result } = renderHook(() => useAdminResearchTemplates());

    expect(result.current.templates).toEqual([]);
  });

  it('should return empty array when data is undefined', () => {
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      data: undefined,
    } as never);

    const { result } = renderHook(() => useAdminResearchTemplates());

    expect(result.current.templates).toEqual([]);
  });

  it('should reflect loading state', () => {
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      loading: true,
    } as never);

    const { result } = renderHook(() => useAdminResearchTemplates());

    expect(result.current.loading).toBe(true);
    expect(result.current.isRefreshing).toBe(true);
  });

  it('should create template and refresh list', async () => {
    const refreshMock = vi
      .fn()
      .mockResolvedValue([makeTemplate(), makeTemplate('new-tmpl')]);
    const createExecuteMock = vi
      .fn()
      .mockResolvedValue(makeTemplate('new-tmpl'));
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      execute: refreshMock,
    } as never);
    mockUseApiPost.mockReturnValue(
      makeApiPostMock({ execute: createExecuteMock }) as never
    );

    const { result } = renderHook(() => useAdminResearchTemplates());

    const newTemplateData = {
      templateId: 'new-template',
      name: 'Tech Analysis',
      category: 'technology',
      dimensions: { depth: 'high' },
    };

    await act(async () => {
      await result.current.createTemplate(newTemplateData);
    });

    expect(createExecuteMock).toHaveBeenCalledWith(newTemplateData);
    expect(refreshMock).toHaveBeenCalled();
  });

  it('should not refresh list if createTemplate returns null/undefined', async () => {
    const refreshMock = vi.fn();
    const createExecuteMock = vi.fn().mockResolvedValue(undefined);
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      execute: refreshMock,
    } as never);
    mockUseApiPost.mockReturnValue(
      makeApiPostMock({ execute: createExecuteMock }) as never
    );

    const { result } = renderHook(() => useAdminResearchTemplates());

    await act(async () => {
      await result.current.createTemplate({
        templateId: 'fail',
        name: 'Fail',
        category: 'test',
        dimensions: {},
      });
    });

    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('should update template via apiClient.patch and refresh', async () => {
    const updatedTemplate = { ...makeTemplate(), name: 'Updated Name' };
    vi.mocked(apiClient).patch.mockResolvedValue(updatedTemplate);
    const refreshMock = vi.fn().mockResolvedValue([updatedTemplate]);
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      execute: refreshMock,
    } as never);

    const { result } = renderHook(() => useAdminResearchTemplates());

    await act(async () => {
      await result.current.updateTemplate('tmpl-1', { name: 'Updated Name' });
    });

    expect(vi.mocked(apiClient).patch).toHaveBeenCalledWith(
      '/admin/research/templates/tmpl-1',
      { name: 'Updated Name' }
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it('should delete template via apiClient.delete and refresh', async () => {
    vi.mocked(apiClient).delete.mockResolvedValue(undefined);
    const refreshMock = vi.fn().mockResolvedValue([]);
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      execute: refreshMock,
    } as never);

    const { result } = renderHook(() => useAdminResearchTemplates());

    await act(async () => {
      await result.current.deleteTemplate('tmpl-1');
    });

    expect(vi.mocked(apiClient).delete).toHaveBeenCalledWith(
      '/admin/research/templates/tmpl-1'
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it('should duplicate template via apiClient.post and refresh', async () => {
    vi.mocked(apiClient).post.mockResolvedValue(makeTemplate('tmpl-copy'));
    const refreshMock = vi
      .fn()
      .mockResolvedValue([makeTemplate(), makeTemplate('tmpl-copy')]);
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      execute: refreshMock,
    } as never);

    const { result } = renderHook(() => useAdminResearchTemplates());

    await act(async () => {
      await result.current.duplicateTemplate('tmpl-1');
    });

    expect(vi.mocked(apiClient).post).toHaveBeenCalledWith(
      '/admin/research/templates/tmpl-1/duplicate'
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it('should filter templates by category via query param', () => {
    const { result: _result } = renderHook(() =>
      useAdminResearchTemplates({ category: 'technology' })
    );

    // Verify useApiGet was called with a URL containing the category filter
    expect(mockUseApiGet).toHaveBeenCalledWith(
      '/admin/research/templates?category=technology',
      expect.any(Object)
    );
  });

  it('should use base URL when no category filter', () => {
    const { result: _result } = renderHook(() => useAdminResearchTemplates());

    expect(mockUseApiGet).toHaveBeenCalledWith(
      '/admin/research/templates',
      expect.any(Object)
    );
  });

  it('should expose operation state flags', () => {
    const { result } = renderHook(() => useAdminResearchTemplates());

    expect(result.current.isCreating).toBe(false);
    expect(result.current.isUpdating).toBe(false);
    expect(result.current.isDeleting).toBe(false);
    expect(result.current.isDuplicating).toBe(false);
  });
});
