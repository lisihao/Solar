import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAdminModels, AIModel } from '../useAdminModels';
import * as useApiCore from '../../core';

// Mock the core API hooks (path must match the import above: hooks/core)
vi.mock('../../core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
}));

describe('useAdminModels', () => {
  const mockModels: AIModel[] = [
    {
      id: 'model-1',
      name: 'GPT-4',
      provider: 'openai',
      modelId: 'gpt-4',
      type: 'CHAT',
      enabled: true,
      config: { temperature: 0.7 },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'model-2',
      name: 'Claude 3',
      provider: 'anthropic',
      modelId: 'claude-3-opus',
      type: 'CHAT',
      enabled: false,
      createdAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    },
  ];

  const mockApiGetReturn = {
    data: mockModels,
    loading: false,
    error: null,
    execute: vi.fn(),
    refresh: vi.fn(),
    reset: vi.fn(),
    setData: vi.fn(),
  };

  const mockApiPostReturn = {
    data: undefined,
    loading: false,
    error: null,
    execute: vi.fn(),
    refresh: vi.fn(),
    reset: vi.fn(),
    setData: vi.fn(),
  };

  const mockApiPutReturn = {
    data: undefined,
    loading: false,
    error: null,
    execute: vi.fn(),
    refresh: vi.fn(),
    reset: vi.fn(),
    setData: vi.fn(),
  };

  const mockApiDeleteReturn = {
    data: undefined,
    loading: false,
    error: null,
    execute: vi.fn(),
    refresh: vi.fn(),
    reset: vi.fn(),
    setData: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiCore.useApiGet).mockReturnValue(mockApiGetReturn);
    vi.mocked(useApiCore.useApiPost).mockReturnValue(mockApiPostReturn);
    vi.mocked(useApiCore.useApiPut).mockReturnValue(mockApiPutReturn);
    vi.mocked(useApiCore.useApiDelete).mockReturnValue(mockApiDeleteReturn);
  });

  describe('initial state', () => {
    it('should initialize with models data from API', () => {
      const { result } = renderHook(() => useAdminModels());

      expect(result.current.models).toEqual(mockModels);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should return empty array when models data is undefined', () => {
      vi.mocked(useApiCore.useApiGet).mockReturnValue({
        ...mockApiGetReturn,
        data: undefined,
      });

      const { result } = renderHook(() => useAdminModels());

      expect(result.current.models).toEqual([]);
    });

    it('should show loading state when list is loading', () => {
      vi.mocked(useApiCore.useApiGet).mockReturnValue({
        ...mockApiGetReturn,
        loading: true,
      });

      const { result } = renderHook(() => useAdminModels());

      expect(result.current.loading).toBe(true);
      expect(result.current.isRefreshing).toBe(true);
    });

    it('should show error when list fetch fails', () => {
      const mockError = { message: 'Failed to fetch', status: 500 };
      vi.mocked(useApiCore.useApiGet).mockReturnValue({
        ...mockApiGetReturn,
        error: mockError,
      });

      const { result } = renderHook(() => useAdminModels());

      expect(result.current.error).toEqual(mockError);
    });
  });

  describe('createModel', () => {
    it('should create model successfully and refresh list', async () => {
      const newModel: Partial<AIModel> = {
        name: 'New Model',
        provider: 'google',
        modelId: 'gemini-pro',
        type: 'CHAT',
        enabled: true,
      };

      const createdModel: AIModel = {
        id: 'model-3',
        ...newModel,
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
      } as AIModel;

      mockApiPostReturn.execute.mockResolvedValue(createdModel);

      const { result } = renderHook(() => useAdminModels());

      let returnedModel: AIModel | undefined;
      await act(async () => {
        returnedModel = await result.current.createModel(newModel);
      });

      expect(mockApiPostReturn.execute).toHaveBeenCalledWith(newModel);
      expect(mockApiGetReturn.execute).toHaveBeenCalled();
      expect(returnedModel).toEqual(createdModel);
    });

    it('should handle create error', async () => {
      mockApiPostReturn.execute.mockResolvedValue(null);

      const { result } = renderHook(() => useAdminModels());

      await act(async () => {
        await result.current.createModel({ name: 'Test' });
      });

      expect(mockApiGetReturn.execute).not.toHaveBeenCalled();
    });

    it('should show creating state', () => {
      vi.mocked(useApiCore.useApiPost).mockReturnValue({
        ...mockApiPostReturn,
        loading: true,
      });

      const { result } = renderHook(() => useAdminModels());

      expect(result.current.isCreating).toBe(true);
      expect(result.current.loading).toBe(true);
    });
  });

  describe('updateModel', () => {
    it('should update model successfully and refresh list', async () => {
      const updatedData: Partial<AIModel> = {
        name: 'Updated Model',
        enabled: false,
      };

      const updatedModel: AIModel = {
        ...mockModels[0],
        ...updatedData,
      };

      mockApiPutReturn.execute.mockResolvedValue(updatedModel);

      const { result } = renderHook(() => useAdminModels());

      let returnedModel: AIModel | undefined;
      await act(async () => {
        returnedModel = await result.current.updateModel(
          'model-1',
          updatedData
        );
      });

      expect(mockApiPutReturn.execute).toHaveBeenCalledWith({
        ...updatedData,
        id: 'model-1',
      });
      expect(mockApiGetReturn.execute).toHaveBeenCalled();
      expect(returnedModel).toEqual(updatedModel);
    });

    it('should not refresh list when update fails', async () => {
      mockApiPutReturn.execute.mockResolvedValue(null);

      const { result } = renderHook(() => useAdminModels());

      await act(async () => {
        await result.current.updateModel('model-1', { name: 'Test' });
      });

      expect(mockApiGetReturn.execute).not.toHaveBeenCalled();
    });

    it('should show updating state', () => {
      vi.mocked(useApiCore.useApiPut).mockReturnValue({
        ...mockApiPutReturn,
        loading: true,
      });

      const { result } = renderHook(() => useAdminModels());

      expect(result.current.isUpdating).toBe(true);
      expect(result.current.loading).toBe(true);
    });
  });

  describe('deleteModel', () => {
    it('should delete model and refresh list', async () => {
      mockApiDeleteReturn.execute.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAdminModels());

      await act(async () => {
        await result.current.deleteModel('model-1');
      });

      expect(mockApiDeleteReturn.execute).toHaveBeenCalledWith({
        id: 'model-1',
      });
      expect(mockApiGetReturn.execute).toHaveBeenCalled();
    });

    it('should show deleting state', () => {
      vi.mocked(useApiCore.useApiDelete).mockReturnValue({
        ...mockApiDeleteReturn,
        loading: true,
      });

      const { result } = renderHook(() => useAdminModels());

      expect(result.current.isDeleting).toBe(true);
      expect(result.current.loading).toBe(true);
    });
  });

  describe('testConnection', () => {
    it('should test model connection', async () => {
      const mockResponse = { success: true, message: 'Connection successful' };
      const mockTestReturn = {
        ...mockApiPostReturn,
        execute: vi.fn().mockResolvedValue(mockResponse),
      };

      // Mock useApiPost to return different values for create and test
      vi.mocked(useApiCore.useApiPost)
        .mockReturnValueOnce(mockApiPostReturn) // For createModel
        .mockReturnValueOnce(mockTestReturn); // For testConnection

      const { result } = renderHook(() => useAdminModels());

      let response: { success: boolean; message: string } | undefined;
      await act(async () => {
        response = await result.current.testConnection('model-1');
      });

      expect(mockTestReturn.execute).toHaveBeenCalledWith({
        modelId: 'model-1',
      });
      expect(response).toEqual(mockResponse);
    });

    it('should show testing state', () => {
      const mockTestReturn = {
        ...mockApiPostReturn,
        loading: true,
      };

      // Mock useApiPost to return different values for create and test
      vi.mocked(useApiCore.useApiPost)
        .mockReturnValueOnce(mockApiPostReturn) // For createModel
        .mockReturnValueOnce(mockTestReturn); // For testConnection

      const { result } = renderHook(() => useAdminModels());

      expect(result.current.isTesting).toBe(true);
    });
  });

  describe('refreshModels', () => {
    it('should call execute function to refresh models', async () => {
      const { result } = renderHook(() => useAdminModels());

      await act(async () => {
        await result.current.refreshModels();
      });

      expect(mockApiGetReturn.execute).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should aggregate errors from all operations', () => {
      const listError = { message: 'List error', status: 500 };
      const createError = { message: 'Create error', status: 400 };

      vi.mocked(useApiCore.useApiGet).mockReturnValue({
        ...mockApiGetReturn,
        error: listError,
      });

      vi.mocked(useApiCore.useApiPost).mockReturnValueOnce({
        ...mockApiPostReturn,
        error: createError,
      });

      const { result } = renderHook(() => useAdminModels());

      expect(result.current.error).toBeTruthy();
    });

    it('should prioritize list error over operation errors', () => {
      const listError = { message: 'List error', status: 500 };
      const createError = { message: 'Create error', status: 400 };

      vi.mocked(useApiCore.useApiGet).mockReturnValue({
        ...mockApiGetReturn,
        error: listError,
      });

      vi.mocked(useApiCore.useApiPost).mockReturnValue({
        ...mockApiPostReturn,
        error: createError,
      });

      const { result } = renderHook(() => useAdminModels());

      expect(result.current.error).toEqual(listError);
    });
  });

  describe('loading states', () => {
    it('should aggregate loading from all operations', () => {
      vi.mocked(useApiCore.useApiPost).mockReturnValue({
        ...mockApiPostReturn,
        loading: true,
      });

      const { result } = renderHook(() => useAdminModels());

      expect(result.current.loading).toBe(true);
    });

    it('should show loading when multiple operations are in progress', () => {
      vi.mocked(useApiCore.useApiGet).mockReturnValue({
        ...mockApiGetReturn,
        loading: true,
      });

      vi.mocked(useApiCore.useApiPut).mockReturnValue({
        ...mockApiPutReturn,
        loading: true,
      });

      const { result } = renderHook(() => useAdminModels());

      expect(result.current.loading).toBe(true);
      expect(result.current.isRefreshing).toBe(true);
      expect(result.current.isUpdating).toBe(true);
    });
  });
});
