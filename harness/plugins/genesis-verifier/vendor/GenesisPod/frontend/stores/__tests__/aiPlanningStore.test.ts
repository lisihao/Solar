import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock the ai-planning API module using auto-mock (vi.mock hoisted before imports)
vi.mock('@/services/ai-planning/api', () => ({
  getPlans: vi.fn(),
  getPlanDetail: vi.fn(),
  getTemplates: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  advancePhase: vi.fn(),
  retryPhase: vi.fn(),
  replanFromPhase: vi.fn(),
  cancelPhase: vi.fn(),
  deletePlan: vi.fn(),
}));

import { useAiPlanningStore } from '../aiPlanningStore';
import * as api from '@/services/ai-planning/api';
import type {
  PlanSummary,
  PlanDetail,
  PlanTemplate,
} from '@/services/ai-planning/api';

const mockApi = vi.mocked(api);

const makePlanSummary = (id = 'plan-1') =>
  ({
    id,
    name: 'Q1 Market Research',
    goal: 'Analyze market trends',
    status: 'active',
    depth: 'medium',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }) as unknown as PlanSummary;

const makePlanDetail = (id = 'plan-1') =>
  ({
    ...makePlanSummary(id),
    phases: [],
    currentPhase: 0,
    totalPhases: 3,
    progress: 0,
  }) as unknown as PlanDetail;

const makePlanTemplate = (id = 'tmpl-1') =>
  ({
    id,
    name: 'Market Research Template',
    description: 'Standard market research plan',
    depth: 'medium',
    estimatedDuration: 60,
  }) as unknown as PlanTemplate;

describe('aiPlanningStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state before each test
    act(() => {
      useAiPlanningStore.getState().reset();
    });
  });

  it('should initialize with default state', () => {
    const state = useAiPlanningStore.getState();

    expect(state.plans).toEqual([]);
    expect(state.currentPlan).toBeNull();
    expect(state.templates).toEqual([]);
    expect(state.isLoadingPlans).toBe(false);
    expect(state.isLoadingDetail).toBe(false);
    expect(state.isCreating).toBe(false);
  });

  it('should fetch plans and update state', async () => {
    const plans = [makePlanSummary('plan-1'), makePlanSummary('plan-2')];
    mockApi.getPlans.mockResolvedValue(plans);

    await act(async () => {
      await useAiPlanningStore.getState().fetchPlans();
    });

    const state = useAiPlanningStore.getState();
    expect(state.plans).toEqual(plans);
    expect(state.isLoadingPlans).toBe(false);
    expect(mockApi.getPlans).toHaveBeenCalledWith(undefined);
  });

  it('should fetch plans with search query', async () => {
    mockApi.getPlans.mockResolvedValue([makePlanSummary()]);

    await act(async () => {
      await useAiPlanningStore.getState().fetchPlans('market');
    });

    expect(mockApi.getPlans).toHaveBeenCalledWith('market');
  });

  it('should set isLoadingPlans during fetchPlans', async () => {
    let resolveGetPlans: (value: unknown) => void;
    const getPlansPromise = new Promise((resolve) => {
      resolveGetPlans = resolve;
    });
    mockApi.getPlans.mockReturnValue(getPlansPromise as Promise<PlanSummary[]>);

    // Start fetch without awaiting
    act(() => {
      void useAiPlanningStore.getState().fetchPlans();
    });

    expect(useAiPlanningStore.getState().isLoadingPlans).toBe(true);

    await act(async () => {
      resolveGetPlans!([]);
    });

    expect(useAiPlanningStore.getState().isLoadingPlans).toBe(false);
  });

  it('should reset isLoadingPlans even on fetchPlans error', async () => {
    mockApi.getPlans.mockRejectedValue(new Error('Network error'));

    await act(async () => {
      try {
        await useAiPlanningStore.getState().fetchPlans();
      } catch {
        // expected
      }
    });

    expect(useAiPlanningStore.getState().isLoadingPlans).toBe(false);
  });

  it('should fetch plan detail and set currentPlan', async () => {
    const detail = makePlanDetail('plan-1');
    mockApi.getPlanDetail.mockResolvedValue(detail);

    await act(async () => {
      await useAiPlanningStore.getState().fetchPlanDetail('plan-1');
    });

    const state = useAiPlanningStore.getState();
    expect(state.currentPlan).toEqual(detail);
    expect(state.isLoadingDetail).toBe(false);
  });

  it('should set isLoadingDetail on initial load (no currentPlan)', async () => {
    let resolveGetDetail: (value: unknown) => void;
    const getDetailPromise = new Promise((resolve) => {
      resolveGetDetail = resolve;
    });
    mockApi.getPlanDetail.mockReturnValue(
      getDetailPromise as Promise<PlanDetail>
    );

    // Ensure currentPlan is null (initial load)
    expect(useAiPlanningStore.getState().currentPlan).toBeNull();

    act(() => {
      void useAiPlanningStore.getState().fetchPlanDetail('plan-1');
    });

    expect(useAiPlanningStore.getState().isLoadingDetail).toBe(true);

    await act(async () => {
      resolveGetDetail!(makePlanDetail('plan-1'));
    });

    expect(useAiPlanningStore.getState().isLoadingDetail).toBe(false);
  });

  it('should fetch templates and update state', async () => {
    const templates = [makePlanTemplate('tmpl-1'), makePlanTemplate('tmpl-2')];
    mockApi.getTemplates.mockResolvedValue(templates);

    await act(async () => {
      await useAiPlanningStore.getState().fetchTemplates();
    });

    expect(useAiPlanningStore.getState().templates).toEqual(templates);
  });

  it('should silently handle fetchTemplates error', async () => {
    mockApi.getTemplates.mockRejectedValue(new Error('Templates unavailable'));

    await act(async () => {
      await useAiPlanningStore.getState().fetchTemplates();
    });

    // Should not throw, templates remain empty
    expect(useAiPlanningStore.getState().templates).toEqual([]);
  });

  it('should create plan and return planId', async () => {
    mockApi.createPlan.mockResolvedValue({ planId: 'new-plan-123' });
    mockApi.getPlans.mockResolvedValue([makePlanSummary('new-plan-123')]);

    let planId: string;
    await act(async () => {
      planId = await useAiPlanningStore.getState().createPlan({
        name: 'New Research Plan',
        goal: 'Research AI trends',
        depth: 'high',
      });
    });

    expect(planId!).toBe('new-plan-123');
    expect(useAiPlanningStore.getState().isCreating).toBe(false);
  });

  it('should set isCreating during createPlan', async () => {
    let resolveCreate: (value: unknown) => void;
    const createPromise = new Promise((resolve) => {
      resolveCreate = resolve;
    });
    mockApi.createPlan.mockReturnValue(
      createPromise as Promise<{ planId: string }>
    );
    mockApi.getPlans.mockResolvedValue([]);

    act(() => {
      void useAiPlanningStore.getState().createPlan({
        name: 'Test',
        goal: 'Test goal',
        depth: 'low',
      });
    });

    expect(useAiPlanningStore.getState().isCreating).toBe(true);

    await act(async () => {
      resolveCreate!({ planId: 'plan-new' });
    });

    expect(useAiPlanningStore.getState().isCreating).toBe(false);
  });

  it('should update plan and set currentPlan', async () => {
    const updatedDetail = { ...makePlanDetail('plan-1'), name: 'Updated Name' };
    mockApi.updatePlan.mockResolvedValue(updatedDetail);

    await act(async () => {
      await useAiPlanningStore
        .getState()
        .updatePlan('plan-1', { name: 'Updated Name' });
    });

    expect(useAiPlanningStore.getState().currentPlan).toEqual(updatedDetail);
    expect(mockApi.updatePlan).toHaveBeenCalledWith('plan-1', {
      name: 'Updated Name',
    });
  });

  it('should advance phase and refresh plan detail', async () => {
    const detail = makePlanDetail('plan-1');
    mockApi.advancePhase.mockResolvedValue(
      undefined as unknown as { currentPhase: number }
    );
    mockApi.getPlanDetail.mockResolvedValue(detail);

    await act(async () => {
      await useAiPlanningStore.getState().advancePhase('plan-1');
    });

    expect(mockApi.advancePhase).toHaveBeenCalledWith('plan-1');
    expect(mockApi.getPlanDetail).toHaveBeenCalledWith('plan-1');
    expect(useAiPlanningStore.getState().currentPlan).toEqual(detail);
  });

  it('should retry phase and refresh plan detail', async () => {
    const detail = makePlanDetail('plan-1');
    mockApi.retryPhase.mockResolvedValue(undefined);
    mockApi.getPlanDetail.mockResolvedValue(detail);

    await act(async () => {
      await useAiPlanningStore.getState().retryPhase('plan-1', 2);
    });

    expect(mockApi.retryPhase).toHaveBeenCalledWith('plan-1', 2);
    expect(mockApi.getPlanDetail).toHaveBeenCalledWith('plan-1');
  });

  it('should replan from phase and refresh plan detail', async () => {
    const detail = makePlanDetail('plan-1');
    mockApi.replanFromPhase.mockResolvedValue(
      undefined as unknown as { currentPhase: number }
    );
    mockApi.getPlanDetail.mockResolvedValue(detail);

    await act(async () => {
      await useAiPlanningStore.getState().replanFromPhase('plan-1', 1);
    });

    expect(mockApi.replanFromPhase).toHaveBeenCalledWith('plan-1', 1);
    expect(mockApi.getPlanDetail).toHaveBeenCalledWith('plan-1');
  });

  it('should cancel phase and refresh plan detail', async () => {
    const detail = makePlanDetail('plan-1');
    mockApi.cancelPhase.mockResolvedValue(undefined);
    mockApi.getPlanDetail.mockResolvedValue(detail);

    await act(async () => {
      await useAiPlanningStore.getState().cancelPhase('plan-1');
    });

    expect(mockApi.cancelPhase).toHaveBeenCalledWith('plan-1');
    expect(mockApi.getPlanDetail).toHaveBeenCalledWith('plan-1');
  });

  it('should delete plan and remove it from plans list', async () => {
    const plans = [makePlanSummary('plan-1'), makePlanSummary('plan-2')];
    mockApi.getPlans.mockResolvedValue(plans);
    mockApi.deletePlan.mockResolvedValue(undefined);

    // First load plans
    await act(async () => {
      await useAiPlanningStore.getState().fetchPlans();
    });

    expect(useAiPlanningStore.getState().plans).toHaveLength(2);

    // Now delete one
    await act(async () => {
      await useAiPlanningStore.getState().deletePlan('plan-1');
    });

    expect(mockApi.deletePlan).toHaveBeenCalledWith('plan-1');
    expect(useAiPlanningStore.getState().plans).toHaveLength(1);
    expect(useAiPlanningStore.getState().plans[0].id).toBe('plan-2');
  });

  it('should reset store to initial state', async () => {
    // Set some state first
    const plans = [makePlanSummary()];
    mockApi.getPlans.mockResolvedValue(plans);
    await act(async () => {
      await useAiPlanningStore.getState().fetchPlans();
    });
    expect(useAiPlanningStore.getState().plans).toHaveLength(1);

    // Reset
    act(() => {
      useAiPlanningStore.getState().reset();
    });

    const state = useAiPlanningStore.getState();
    expect(state.plans).toEqual([]);
    expect(state.currentPlan).toBeNull();
    expect(state.templates).toEqual([]);
    expect(state.isLoadingPlans).toBe(false);
    expect(state.isLoadingDetail).toBe(false);
    expect(state.isCreating).toBe(false);
  });
});
