import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  useSettingsStore,
  useAIFeature,
  AI_FEATURE_INFO,
} from '../settingsStore';
import type { AIFeatureSettings } from '../settingsStore';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_AI_FEATURES: AIFeatureSettings = {
  aiSummaryEnabled: true,
  aiTranslationEnabled: true,
  aiInsightsEnabled: true,
  aiOfficeMultiAgentEnabled: true,
  aiOfficeAutoSaveEnabled: true,
  semanticSearchEnabled: false,
  smartRecommendationsEnabled: false,
  compactViewEnabled: false,
};

// ── Reset helpers ─────────────────────────────────────────────────────────────

function resetStore() {
  useSettingsStore.setState({
    aiFeatures: DEFAULT_AI_FEATURES,
    lastSeenVersion: '',
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// useSettingsStore - AI Features
// ═════════════════════════════════════════════════════════════════════════════

describe('useSettingsStore - aiFeatures', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct default AI features', () => {
      const { result } = renderHook(() => useSettingsStore());
      expect(result.current.aiFeatures).toEqual(DEFAULT_AI_FEATURES);
    });

    it('should start with empty lastSeenVersion', () => {
      const { result } = renderHook(() => useSettingsStore());
      expect(result.current.lastSeenVersion).toBe('');
    });
  });

  describe('setAIFeature', () => {
    it('should enable a feature that was disabled', () => {
      const { result } = renderHook(() => useSettingsStore());

      act(() => {
        result.current.setAIFeature('semanticSearchEnabled', true);
      });

      expect(result.current.aiFeatures.semanticSearchEnabled).toBe(true);
    });

    it('should disable a feature that was enabled', () => {
      const { result } = renderHook(() => useSettingsStore());

      act(() => {
        result.current.setAIFeature('aiSummaryEnabled', false);
      });

      expect(result.current.aiFeatures.aiSummaryEnabled).toBe(false);
    });

    it('should not affect other feature flags', () => {
      const { result } = renderHook(() => useSettingsStore());

      act(() => {
        result.current.setAIFeature('compactViewEnabled', true);
      });

      expect(result.current.aiFeatures.aiSummaryEnabled).toBe(true);
      expect(result.current.aiFeatures.aiTranslationEnabled).toBe(true);
      expect(result.current.aiFeatures.aiInsightsEnabled).toBe(true);
    });

    it('should update any feature key generically', () => {
      const { result } = renderHook(() => useSettingsStore());
      const featureKeys = Object.keys(
        DEFAULT_AI_FEATURES
      ) as (keyof AIFeatureSettings)[];

      featureKeys.forEach((key) => {
        const currentVal = result.current.aiFeatures[key];
        act(() => {
          result.current.setAIFeature(key, !currentVal);
        });
        expect(result.current.aiFeatures[key]).toBe(!currentVal);
        // Reset
        act(() => {
          result.current.setAIFeature(key, currentVal);
        });
      });
    });
  });

  describe('resetAIFeatures', () => {
    it('should restore all features to default values', () => {
      const { result } = renderHook(() => useSettingsStore());
      act(() => {
        result.current.setAIFeature('aiSummaryEnabled', false);
        result.current.setAIFeature('semanticSearchEnabled', true);
        result.current.setAIFeature('compactViewEnabled', true);
      });

      act(() => {
        result.current.resetAIFeatures();
      });

      expect(result.current.aiFeatures).toEqual(DEFAULT_AI_FEATURES);
    });
  });

  describe('setLastSeenVersion', () => {
    it('should update lastSeenVersion', () => {
      const { result } = renderHook(() => useSettingsStore());

      act(() => {
        result.current.setLastSeenVersion('2.5.0');
      });

      expect(result.current.lastSeenVersion).toBe('2.5.0');
    });

    it('should overwrite previous version', () => {
      const { result } = renderHook(() => useSettingsStore());
      act(() => {
        result.current.setLastSeenVersion('1.0.0');
      });

      act(() => {
        result.current.setLastSeenVersion('2.0.0');
      });

      expect(result.current.lastSeenVersion).toBe('2.0.0');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// useAIFeature hook
// ═════════════════════════════════════════════════════════════════════════════

describe('useAIFeature', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should return the current value of the requested feature', () => {
    const { result } = renderHook(() => useAIFeature('aiSummaryEnabled'));
    expect(result.current).toBe(true);
  });

  it('should return false for beta features that are disabled by default', () => {
    const { result } = renderHook(() => useAIFeature('semanticSearchEnabled'));
    expect(result.current).toBe(false);
  });

  it('should reflect store changes reactively', () => {
    const { result } = renderHook(() => useAIFeature('aiSummaryEnabled'));
    expect(result.current).toBe(true);

    act(() => {
      useSettingsStore.getState().setAIFeature('aiSummaryEnabled', false);
    });

    expect(result.current).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AI_FEATURE_INFO constant
// ═════════════════════════════════════════════════════════════════════════════

describe('AI_FEATURE_INFO', () => {
  it('should have 8 feature entries', () => {
    expect(AI_FEATURE_INFO).toHaveLength(8);
  });

  it('each entry should have key, name, description, category, icon', () => {
    AI_FEATURE_INFO.forEach((info) => {
      expect(info).toHaveProperty('key');
      expect(info).toHaveProperty('name');
      expect(info).toHaveProperty('description');
      expect(info).toHaveProperty('category');
      expect(info).toHaveProperty('icon');
    });
  });

  it('all keys should be valid AIFeatureSettings keys', () => {
    const validKeys = Object.keys(DEFAULT_AI_FEATURES);
    AI_FEATURE_INFO.forEach((info) => {
      expect(validKeys).toContain(info.key);
    });
  });

  it('categories should only be core, beta, or ui', () => {
    const validCategories = ['core', 'beta', 'ui'];
    AI_FEATURE_INFO.forEach((info) => {
      expect(validCategories).toContain(info.category);
    });
  });
});
