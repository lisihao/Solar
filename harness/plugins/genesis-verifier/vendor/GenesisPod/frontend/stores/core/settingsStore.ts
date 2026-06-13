import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * AI Feature Settings - Real experimental features that can be toggled
 */
export interface AIFeatureSettings {
  // AI Summary & Translation
  aiSummaryEnabled: boolean;
  aiTranslationEnabled: boolean;
  aiInsightsEnabled: boolean;

  // AI Office Features
  aiOfficeMultiAgentEnabled: boolean;
  aiOfficeAutoSaveEnabled: boolean;

  // Search & Discovery
  semanticSearchEnabled: boolean;
  smartRecommendationsEnabled: boolean;

  // UI Experiments
  compactViewEnabled: boolean;
}

interface SettingsState {
  // AI Feature Settings
  aiFeatures: AIFeatureSettings;
  setAIFeature: <K extends keyof AIFeatureSettings>(
    key: K,
    value: AIFeatureSettings[K]
  ) => void;
  resetAIFeatures: () => void;

  // What's New
  lastSeenVersion: string;
  setLastSeenVersion: (version: string) => void;
}

const DEFAULT_AI_FEATURES: AIFeatureSettings = {
  aiSummaryEnabled: true,
  aiTranslationEnabled: true,
  aiInsightsEnabled: true,
  aiOfficeMultiAgentEnabled: true,
  aiOfficeAutoSaveEnabled: true,
  semanticSearchEnabled: false, // Beta
  smartRecommendationsEnabled: false, // Beta
  compactViewEnabled: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // AI Features
      aiFeatures: DEFAULT_AI_FEATURES,
      setAIFeature: (key, value) =>
        set((state) => ({
          aiFeatures: { ...state.aiFeatures, [key]: value },
        })),
      resetAIFeatures: () => set({ aiFeatures: DEFAULT_AI_FEATURES }),

      // What's New
      lastSeenVersion: '',
      setLastSeenVersion: (version) => set({ lastSeenVersion: version }),
    }),
    {
      name: 'deepdive-settings-storage',
      partialize: (state) => ({
        aiFeatures: state.aiFeatures,
        lastSeenVersion: state.lastSeenVersion,
      }),
    }
  )
);

/**
 * Hook to check if a specific AI feature is enabled
 */
export function useAIFeature<K extends keyof AIFeatureSettings>(
  feature: K
): boolean {
  return useSettingsStore((state) => state.aiFeatures[feature]);
}

/**
 * Get all AI features for display
 */
export const AI_FEATURE_INFO: {
  key: keyof AIFeatureSettings;
  name: string;
  description: string;
  category: 'core' | 'beta' | 'ui';
  icon: string;
}[] = [
  {
    key: 'aiSummaryEnabled',
    name: 'AI Summary',
    description: 'Automatically generate summaries for papers and articles',
    category: 'core',
    icon: 'document',
  },
  {
    key: 'aiTranslationEnabled',
    name: 'AI Translation',
    description: 'Translate content between languages using AI',
    category: 'core',
    icon: 'translate',
  },
  {
    key: 'aiInsightsEnabled',
    name: 'AI Insights',
    description: 'Extract key insights and methodologies from research',
    category: 'core',
    icon: 'sparkles',
  },
  {
    key: 'aiOfficeMultiAgentEnabled',
    name: 'Multi-Agent Mode',
    description: 'Use multiple AI agents for complex document generation',
    category: 'core',
    icon: 'users',
  },
  {
    key: 'aiOfficeAutoSaveEnabled',
    name: 'Auto-Save',
    description: 'Automatically save documents while editing',
    category: 'core',
    icon: 'save',
  },
  {
    key: 'semanticSearchEnabled',
    name: 'Semantic Search',
    description: 'Search by meaning using vector embeddings (Beta)',
    category: 'beta',
    icon: 'search',
  },
  {
    key: 'smartRecommendationsEnabled',
    name: 'Smart Recommendations',
    description: 'Get personalized paper recommendations (Beta)',
    category: 'beta',
    icon: 'magic',
  },
  {
    key: 'compactViewEnabled',
    name: 'Compact View',
    description: 'Use a more compact layout for lists and cards',
    category: 'ui',
    icon: 'layout',
  },
  // Dark Mode 已移除 - 功能尚未实现，避免用户困惑
];
