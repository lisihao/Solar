import { create } from 'zustand';
import * as api from '@/services/ai-planning/api';
import { logger } from '@/lib/utils/logger';
import type {
  PlanSummary,
  PlanDetail,
  PlanTemplate,
  CreatePlanPayload,
} from '@/services/ai-planning/api';

interface AiPlanningState {
  plans: PlanSummary[];
  currentPlan: PlanDetail | null;
  templates: PlanTemplate[];
  isLoadingPlans: boolean;
  isLoadingDetail: boolean;
  isCreating: boolean;

  fetchPlans: (search?: string) => Promise<void>;
  fetchPlanDetail: (planId: string) => Promise<void>;
  fetchTemplates: () => Promise<void>;
  createPlan: (data: CreatePlanPayload) => Promise<string>;
  updatePlan: (
    planId: string,
    data: { name?: string; goal?: string; depth?: string }
  ) => Promise<void>;
  advancePhase: (planId: string) => Promise<void>;
  retryPhase: (planId: string, phase: number) => Promise<void>;
  replanFromPhase: (planId: string, startPhase: number) => Promise<void>;
  cancelPhase: (planId: string) => Promise<void>;
  deletePlan: (planId: string) => Promise<void>;
  reset: () => void;
}

export const useAiPlanningStore = create<AiPlanningState>((set, get) => ({
  plans: [],
  currentPlan: null,
  templates: [],
  isLoadingPlans: false,
  isLoadingDetail: false,
  isCreating: false,

  fetchPlans: async (search?: string) => {
    set({ isLoadingPlans: true });
    try {
      const plans = await api.getPlans(search);
      set({ plans });
    } finally {
      set({ isLoadingPlans: false });
    }
  },

  fetchPlanDetail: async (planId: string) => {
    const isInitialLoad = !get().currentPlan;
    if (isInitialLoad) {
      set({ isLoadingDetail: true });
    }
    try {
      const plan = await api.getPlanDetail(planId);
      set({ currentPlan: plan });
    } finally {
      if (isInitialLoad) {
        set({ isLoadingDetail: false });
      }
    }
  },

  fetchTemplates: async () => {
    try {
      const templates = await api.getTemplates();
      set({ templates });
    } catch (error) {
      logger.warn('Failed to fetch planning templates:', error);
    }
  },

  createPlan: async (data: CreatePlanPayload) => {
    set({ isCreating: true });
    try {
      const result = await api.createPlan(data);
      await get().fetchPlans();
      return result.planId;
    } finally {
      set({ isCreating: false });
    }
  },

  updatePlan: async (
    planId: string,
    data: { name?: string; goal?: string; depth?: string }
  ) => {
    const updated = await api.updatePlan(planId, data);
    set({ currentPlan: updated });
  },

  advancePhase: async (planId: string) => {
    await api.advancePhase(planId);
    await get().fetchPlanDetail(planId);
  },

  retryPhase: async (planId: string, phase: number) => {
    await api.retryPhase(planId, phase);
    await get().fetchPlanDetail(planId);
  },

  replanFromPhase: async (planId: string, startPhase: number) => {
    await api.replanFromPhase(planId, startPhase);
    await get().fetchPlanDetail(planId);
  },

  cancelPhase: async (planId: string) => {
    await api.cancelPhase(planId);
    await get().fetchPlanDetail(planId);
  },

  deletePlan: async (planId: string) => {
    await api.deletePlan(planId);
    set({ plans: get().plans.filter((p) => p.id !== planId) });
  },

  reset: () => {
    set({
      plans: [],
      currentPlan: null,
      templates: [],
      isLoadingPlans: false,
      isLoadingDetail: false,
      isCreating: false,
    });
  },
}));
