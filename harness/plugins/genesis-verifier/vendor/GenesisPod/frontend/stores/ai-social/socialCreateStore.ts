'use client';

import { create } from 'zustand';
import {
  SocialContentType,
  SocialContentSourceType,
} from '@/hooks/domain/useAISocial';

export type CreateStep = 1 | 2 | 3 | 4;

export interface SeriesPart {
  id: string;
  title: string;
  content: string;
  digest: string;
  seriesOrder: number;
  status: string;
}

interface SocialCreateState {
  // 步骤状态
  currentStep: CreateStep;

  // Step 1: 来源
  sourceType: SocialContentSourceType | null;
  sourceId: string | null;
  sourceTitle: string | null;
  externalUrl: string;
  keepFormat: boolean;

  // Step 2: 平台
  platform: SocialContentType | null;

  // Step 3: 账户
  connectionId: string | null;
  connectionName: string | null;
  skipAccount: boolean;

  // Step 4: 内容（单篇模式）
  title: string;
  content: string;
  digest: string;
  tags: string[];
  coverImage: string;

  // Step 4: 系列模式
  isSeriesMode: boolean;
  seriesId: string | null;
  seriesParts: SeriesPart[];
  activePartIndex: number; // -1 = overview, 0+ = editing that part

  // 状态
  isProcessing: boolean;
  isSaving: boolean;
  isPublishing: boolean;
  currentContentId: string | null;

  // Actions
  setStep: (step: CreateStep) => void;
  setSource: (
    type: SocialContentSourceType | null,
    id?: string | null,
    title?: string | null
  ) => void;
  setExternalUrl: (url: string) => void;
  setPlatform: (platform: SocialContentType | null) => void;
  setConnection: (id: string | null, name: string | null) => void;
  setSkipAccount: (skip: boolean) => void;
  setTitle: (title: string) => void;
  setContentText: (content: string) => void;
  setDigest: (digest: string) => void;
  setTags: (tags: string[]) => void;
  setCoverImage: (coverImage: string) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  setIsSaving: (isSaving: boolean) => void;
  setIsPublishing: (isPublishing: boolean) => void;
  setCurrentContentId: (id: string | null) => void;
  setKeepFormat: (keepFormat: boolean) => void;
  setContentFromAI: (data: {
    title: string;
    content: string;
    digest?: string;
    tags?: string[];
    contentId?: string;
  }) => void;
  // Series actions
  setSeriesFromAI: (data: { seriesId: string; parts: SeriesPart[] }) => void;
  setActivePartIndex: (index: number) => void;
  updateSeriesPart: (index: number, data: Partial<SeriesPart>) => void;
  enterPartEdit: (index: number) => void;
  exitPartEdit: () => void;
  reset: () => void;
  canGoToStep: (step: CreateStep) => boolean;
}

const initialState = {
  currentStep: 1 as CreateStep,
  sourceType: null,
  sourceId: null,
  sourceTitle: null,
  externalUrl: '',
  keepFormat: false,
  platform: null,
  connectionId: null,
  connectionName: null,
  skipAccount: false,
  title: '',
  content: '',
  digest: '',
  tags: [] as string[],
  coverImage: '',
  isSeriesMode: false,
  seriesId: null,
  seriesParts: [] as SeriesPart[],
  activePartIndex: -1,
  isProcessing: false,
  isSaving: false,
  isPublishing: false,
  currentContentId: null,
};

export const useSocialCreateStore = create<SocialCreateState>((set, get) => ({
  ...initialState,

  setStep: (step) => {
    const state = get();
    if (state.canGoToStep(step)) {
      set({ currentStep: step });
    }
  },

  setSource: (type, id = null, title = null) =>
    set({
      sourceType: type,
      sourceId: id,
      sourceTitle: title,
      keepFormat: type === 'AI_TOPIC_INSIGHTS',
      // Reset downstream selections when source changes
      platform: null,
      connectionId: null,
      connectionName: null,
      skipAccount: false,
    }),

  setExternalUrl: (url) => set({ externalUrl: url }),

  setPlatform: (platform) =>
    set({
      platform,
      // Reset account when platform changes
      connectionId: null,
      connectionName: null,
      skipAccount: false,
    }),

  setConnection: (id, name) => set({ connectionId: id, connectionName: name }),

  setSkipAccount: (skip) => set({ skipAccount: skip }),

  setTitle: (title) => set({ title }),

  setContentText: (content) => set({ content }),

  setDigest: (digest) => set({ digest }),

  setTags: (tags) => set({ tags }),

  setCoverImage: (coverImage) => set({ coverImage }),

  setIsProcessing: (isProcessing) => set({ isProcessing }),

  setIsSaving: (isSaving) => set({ isSaving }),

  setIsPublishing: (isPublishing) => set({ isPublishing }),

  setCurrentContentId: (id) => set({ currentContentId: id }),

  setKeepFormat: (keepFormat) => set({ keepFormat }),

  setContentFromAI: (data) =>
    set({
      title: data.title,
      content: data.content,
      digest: data.digest || '',
      tags: data.tags || [],
      currentContentId: data.contentId || null,
      isSeriesMode: false,
      seriesId: null,
      seriesParts: [],
      activePartIndex: -1,
    }),

  setSeriesFromAI: (data) =>
    set({
      isSeriesMode: true,
      seriesId: data.seriesId,
      seriesParts: data.parts,
      activePartIndex: -1,
      // Set first part as current content for backward compat
      title: data.parts[0]?.title || '',
      content: data.parts[0]?.content || '',
      digest: data.parts[0]?.digest || '',
      currentContentId: data.parts[0]?.id || null,
    }),

  setActivePartIndex: (index) => set({ activePartIndex: index }),

  updateSeriesPart: (index, data) => {
    const parts = [...get().seriesParts];
    if (parts[index]) {
      parts[index] = { ...parts[index], ...data };
      set({ seriesParts: parts });
    }
  },

  enterPartEdit: (index) => {
    const parts = get().seriesParts;
    const part = parts[index];
    if (part) {
      set({
        activePartIndex: index,
        title: part.title,
        content: part.content,
        digest: part.digest,
        currentContentId: part.id,
      });
    }
  },

  exitPartEdit: () => {
    const state = get();
    const index = state.activePartIndex;
    if (index >= 0 && state.seriesParts[index]) {
      // Sync current edits back to the part
      const parts = [...state.seriesParts];
      parts[index] = {
        ...parts[index],
        title: state.title,
        content: state.content,
        digest: state.digest,
      };
      set({
        seriesParts: parts,
        activePartIndex: -1,
      });
    }
  },

  reset: () => set(initialState),

  canGoToStep: (step) => {
    const state = get();
    switch (step) {
      case 1:
        return true;
      case 2:
        // Need source selected (except MANUAL which can go directly)
        return (
          state.sourceType === 'MANUAL' ||
          (state.sourceType === 'EXTERNAL_URL' &&
            state.externalUrl.trim() !== '') ||
          (state.sourceType !== null && state.sourceId !== null)
        );
      case 3:
        // Need platform selected
        return state.platform !== null && state.canGoToStep(2);
      case 4:
        // Need account selected or skipped
        return (
          (state.connectionId !== null || state.skipAccount) &&
          state.canGoToStep(3)
        );
      default:
        return false;
    }
  },
}));
