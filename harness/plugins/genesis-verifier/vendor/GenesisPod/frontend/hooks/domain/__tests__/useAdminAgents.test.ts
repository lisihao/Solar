import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useAdminAgents,
  AgentConfig,
  CreateAgentConfigDto,
  UpdateAgentConfigDto,
} from '../useAdminAgents';
import * as useApiCore from '../../core';
import { apiClient } from '@/lib/api/client';

// Mock the core API hooks (path must match the import above: hooks/core)
vi.mock('../../core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
}));

// Mock the API client
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('useAdminAgents', () => {
  const mockAgents: AgentConfig[] = [
    {
      id: 'agent-1',
      agentId: 'coder',
      name: 'Coder Agent',
      description: 'Writes code',
      agentType: 'specialist',
      domain: 'development',
      systemPrompt: 'You are a coding expert',
      tools: ['code-generator'],
      skills: ['typescript', 'react'],
      modelType: 'CHAT',
      taskProfile: { creativity: 'low' },
      enabled: true,
      isBuiltIn: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'agent-2',
      agentId: 'tester',
      name: 'Tester Agent',
      description: 'Tests code',
      agentType: 'specialist',
      domain: 'development',
      systemPrompt: 'You are a testing expert',
      tools: ['test-runner'],
      skills: ['vitest', 'jest'],
      modelType: null,
      taskProfile: null,
      enabled: false,
      isBuiltIn: true,
      createdAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    },
  ];

  const mockApiGetReturn = {
    data: mockAgents,
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiCore.useApiGet).mockReturnValue(mockApiGetReturn);
    vi.mocked(useApiCore.useApiPost).mockReturnValue(mockApiPostReturn);
    vi.mocked(apiClient.patch).mockResolvedValue({} as any);
    vi.mocked(apiClient.delete).mockResolvedValue(undefined);
  });

  describe('initial state', () => {
    it('should initialize with agents data from API', () => {
      const { result } = renderHook(() => useAdminAgents());

      expect(result.current.agents).toEqual(mockAgents);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should return empty array when agents data is undefined', () => {
      vi.mocked(useApiCore.useApiGet).mockReturnValue({
        ...mockApiGetReturn,
        data: undefined,
      });

      const { result } = renderHook(() => useAdminAgents());

      expect(result.current.agents).toEqual([]);
    });

    it('should show loading state when list is loading', () => {
      vi.mocked(useApiCore.useApiGet).mockReturnValue({
        ...mockApiGetReturn,
        loading: true,
      });

      const { result } = renderHook(() => useAdminAgents());

      expect(result.current.loading).toBe(true);
      expect(result.current.isRefreshing).toBe(true);
    });

    it('should apply domain filter in query params', () => {
      renderHook(() => useAdminAgents({ domain: 'development' }));

      expect(useApiCore.useApiGet).toHaveBeenCalledWith(
        '/admin/agents?domain=development',
        expect.any(Object)
      );
    });

    it('should not add query params when no filters provided', () => {
      renderHook(() => useAdminAgents());

      expect(useApiCore.useApiGet).toHaveBeenCalledWith(
        '/admin/agents',
        expect.any(Object)
      );
    });
  });

  describe('createAgent', () => {
    it('should create agent successfully and refresh list', async () => {
      const newAgent: CreateAgentConfigDto = {
        agentId: 'reviewer',
        name: 'Reviewer Agent',
        description: 'Reviews code',
        agentType: 'specialist',
        domain: 'development',
        systemPrompt: 'You are a code reviewer',
        tools: ['linter'],
        skills: ['code-review'],
        enabled: true,
      };

      const createdAgent: AgentConfig = {
        id: 'agent-3',
        agentId: newAgent.agentId,
        name: newAgent.name,
        description: newAgent.description ?? null,
        agentType: newAgent.agentType,
        domain: newAgent.domain,
        systemPrompt: newAgent.systemPrompt,
        tools: newAgent.tools ?? [],
        skills: newAgent.skills ?? [],
        enabled: newAgent.enabled ?? true,
        modelType: null,
        taskProfile: null,
        isBuiltIn: false,
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
      };

      mockApiPostReturn.execute.mockResolvedValue(createdAgent);

      const { result } = renderHook(() => useAdminAgents());

      let returnedAgent: AgentConfig | undefined;
      await act(async () => {
        returnedAgent = await result.current.createAgent(newAgent);
      });

      expect(mockApiPostReturn.execute).toHaveBeenCalledWith(newAgent);
      expect(mockApiGetReturn.execute).toHaveBeenCalled();
      expect(returnedAgent).toEqual(createdAgent);
    });

    it('should not refresh list when create fails', async () => {
      mockApiPostReturn.execute.mockResolvedValue(null);

      const { result } = renderHook(() => useAdminAgents());

      await act(async () => {
        await result.current.createAgent({
          agentId: 'test',
          name: 'Test',
          agentType: 'specialist',
          domain: 'test',
          systemPrompt: 'Test',
        });
      });

      expect(mockApiGetReturn.execute).not.toHaveBeenCalled();
    });

    it('should show creating state', () => {
      vi.mocked(useApiCore.useApiPost).mockReturnValue({
        ...mockApiPostReturn,
        loading: true,
      });

      const { result } = renderHook(() => useAdminAgents());

      expect(result.current.isCreating).toBe(true);
      expect(result.current.loading).toBe(true);
    });
  });

  describe('updateAgent', () => {
    it('should update agent successfully and refresh list', async () => {
      const updateData: UpdateAgentConfigDto = {
        name: 'Updated Agent',
        description: 'Updated description',
        enabled: false,
      };

      const updatedAgent: AgentConfig = {
        ...mockAgents[0],
        ...updateData,
      };

      vi.mocked(apiClient.patch).mockResolvedValue(updatedAgent);

      const { result } = renderHook(() => useAdminAgents());

      let returnedAgent: AgentConfig | undefined;
      await act(async () => {
        returnedAgent = await result.current.updateAgent('agent-1', updateData);
      });

      expect(apiClient.patch).toHaveBeenCalledWith(
        '/admin/agents/agent-1',
        updateData
      );
      expect(mockApiGetReturn.execute).toHaveBeenCalled();
      expect(returnedAgent).toEqual(updatedAgent);
    });

    it('should show updating state during update', async () => {
      vi.mocked(apiClient.patch).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      const { result } = renderHook(() => useAdminAgents());

      act(() => {
        result.current.updateAgent('agent-1', { name: 'Test' });
      });

      expect(result.current.isUpdating).toBe(true);
      expect(result.current.loading).toBe(true);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      expect(result.current.isUpdating).toBe(false);
    });

    it('should handle update errors gracefully', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue(new Error('Update failed'));

      const { result } = renderHook(() => useAdminAgents());

      await act(async () => {
        try {
          await result.current.updateAgent('agent-1', { name: 'Test' });
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
        }
      });

      expect(result.current.isUpdating).toBe(false);
    });

    it('should always reset loading state after update', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useAdminAgents());

      await act(async () => {
        try {
          await result.current.updateAgent('agent-1', { name: 'Test' });
        } catch {
          // Ignore error
        }
      });

      expect(result.current.isUpdating).toBe(false);
    });
  });

  describe('deleteAgent', () => {
    it('should delete agent and refresh list', async () => {
      const { result } = renderHook(() => useAdminAgents());

      await act(async () => {
        await result.current.deleteAgent('agent-1');
      });

      expect(apiClient.delete).toHaveBeenCalledWith('/admin/agents/agent-1');
      expect(mockApiGetReturn.execute).toHaveBeenCalled();
    });

    it('should show deleting state during deletion', async () => {
      vi.mocked(apiClient.delete).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      const { result } = renderHook(() => useAdminAgents());

      act(() => {
        result.current.deleteAgent('agent-1');
      });

      expect(result.current.isDeleting).toBe(true);
      expect(result.current.loading).toBe(true);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      expect(result.current.isDeleting).toBe(false);
    });

    it('should handle delete errors gracefully', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(new Error('Delete failed'));

      const { result } = renderHook(() => useAdminAgents());

      await act(async () => {
        try {
          await result.current.deleteAgent('agent-1');
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
        }
      });

      expect(result.current.isDeleting).toBe(false);
    });

    it('should always reset loading state after delete', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useAdminAgents());

      await act(async () => {
        try {
          await result.current.deleteAgent('agent-1');
        } catch {
          // Ignore error
        }
      });

      expect(result.current.isDeleting).toBe(false);
    });
  });

  describe('refreshAgents', () => {
    it('should call execute function to refresh agents', async () => {
      const { result } = renderHook(() => useAdminAgents());

      await act(async () => {
        await result.current.refreshAgents();
      });

      expect(mockApiGetReturn.execute).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should show list error', () => {
      const listError = { message: 'Failed to fetch agents', status: 500 };
      vi.mocked(useApiCore.useApiGet).mockReturnValue({
        ...mockApiGetReturn,
        error: listError,
      });

      const { result } = renderHook(() => useAdminAgents());

      expect(result.current.error).toEqual(listError);
    });

    it('should show create error', () => {
      const createError = { message: 'Failed to create agent', status: 400 };
      vi.mocked(useApiCore.useApiPost).mockReturnValue({
        ...mockApiPostReturn,
        error: createError,
      });

      const { result } = renderHook(() => useAdminAgents());

      expect(result.current.error).toEqual(createError);
    });

    it('should aggregate errors from list and create', () => {
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

      const { result } = renderHook(() => useAdminAgents());

      expect(result.current.error).toBeTruthy();
    });
  });

  describe('loading states', () => {
    it('should aggregate loading from all operations', () => {
      vi.mocked(useApiCore.useApiPost).mockReturnValue({
        ...mockApiPostReturn,
        loading: true,
      });

      const { result } = renderHook(() => useAdminAgents());

      expect(result.current.loading).toBe(true);
    });

    it('should show loading when list is loading', () => {
      vi.mocked(useApiCore.useApiGet).mockReturnValue({
        ...mockApiGetReturn,
        loading: true,
      });

      const { result } = renderHook(() => useAdminAgents());

      expect(result.current.loading).toBe(true);
      expect(result.current.isRefreshing).toBe(true);
    });
  });
});
