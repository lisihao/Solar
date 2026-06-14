import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the PerspectiveSelector module since it's a component file
vi.mock('@/components/ai-simulation/PerspectiveSelector', () => ({
  // Export the type alias as a value (not actually used at runtime)
}));

// We need to import the type separately
type ViewPerspective = 'GOD' | 'BLUE' | 'RED' | 'GREEN' | 'WHITE';

import {
  useSimulationPerspective,
  canViewContent,
  getVisibleTeams,
} from '../useSimulationPerspective';

const STORAGE_KEY = 'deepdive_simulation_preferences';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearStorage() {
  localStorage.clear();
}

function setStoredPreferences(prefs: {
  defaultPerspective: ViewPerspective;
  scenarioPreferences: Record<string, ViewPerspective>;
  lastUpdated?: string;
}) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ lastUpdated: new Date().toISOString(), ...prefs })
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSimulationPerspective', () => {
  beforeEach(() => {
    clearStorage();
  });

  afterEach(() => {
    clearStorage();
  });

  describe('initial state', () => {
    it('defaults to GOD perspective when no stored preferences', async () => {
      const { result } = renderHook(() => useSimulationPerspective());
      // Wait for useEffect to run
      await act(async () => {});
      expect(result.current.perspective).toBe('GOD');
    });

    it('defaults to GOD as defaultPerspective', async () => {
      const { result } = renderHook(() => useSimulationPerspective());
      await act(async () => {});
      expect(result.current.defaultPerspective).toBe('GOD');
    });

    it('starts with isLoading true and resolves to false', async () => {
      const { result } = renderHook(() => useSimulationPerspective());
      // After useEffect settles
      await act(async () => {});
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('initialPerspective option', () => {
    it('uses initialPerspective when provided', async () => {
      const { result } = renderHook(() =>
        useSimulationPerspective({ initialPerspective: 'BLUE' })
      );
      await act(async () => {});
      expect(result.current.perspective).toBe('BLUE');
    });
  });

  describe('stored preferences', () => {
    it('loads default perspective from localStorage', async () => {
      setStoredPreferences({
        defaultPerspective: 'RED',
        scenarioPreferences: {},
      });

      const { result } = renderHook(() => useSimulationPerspective());
      await act(async () => {});
      expect(result.current.defaultPerspective).toBe('RED');
    });

    it('loads scenario-specific perspective when scenarioId matches', async () => {
      setStoredPreferences({
        defaultPerspective: 'GOD',
        scenarioPreferences: { 'scenario-42': 'GREEN' },
      });

      const { result } = renderHook(() =>
        useSimulationPerspective({ scenarioId: 'scenario-42' })
      );
      await act(async () => {});
      expect(result.current.perspective).toBe('GREEN');
    });

    it('loads run-specific perspective when runId matches', async () => {
      setStoredPreferences({
        defaultPerspective: 'GOD',
        scenarioPreferences: { 'run_run-99': 'WHITE' },
      });

      const { result } = renderHook(() =>
        useSimulationPerspective({ runId: 'run-99' })
      );
      await act(async () => {});
      expect(result.current.perspective).toBe('WHITE');
    });
  });

  describe('setPerspective', () => {
    it('updates the current perspective', async () => {
      const { result } = renderHook(() =>
        useSimulationPerspective({ scenarioId: 'sc-1' })
      );
      await act(async () => {});

      act(() => {
        result.current.setPerspective('BLUE');
      });

      expect(result.current.perspective).toBe('BLUE');
    });

    it('saves perspective to localStorage under scenarioId key', async () => {
      const { result } = renderHook(() =>
        useSimulationPerspective({ scenarioId: 'sc-save' })
      );
      await act(async () => {});

      act(() => {
        result.current.setPerspective('RED');
      });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      expect(stored.scenarioPreferences['sc-save']).toBe('RED');
    });

    it('saves perspective under run_<runId> key when runId is provided', async () => {
      const { result } = renderHook(() =>
        useSimulationPerspective({ runId: 'run-123' })
      );
      await act(async () => {});

      act(() => {
        result.current.setPerspective('GREEN');
      });

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      expect(stored.scenarioPreferences['run_run-123']).toBe('GREEN');
    });

    it('does not save to localStorage when no scenarioId or runId', async () => {
      const { result } = renderHook(() => useSimulationPerspective());
      await act(async () => {});

      act(() => {
        result.current.setPerspective('BLUE');
      });

      // Storage should remain empty (no key saved)
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      expect(stored.scenarioPreferences ?? {}).toEqual({});
    });
  });

  describe('setDefaultPerspective', () => {
    it('updates defaultPerspective and persists to localStorage', async () => {
      const { result } = renderHook(() => useSimulationPerspective());
      await act(async () => {});

      act(() => {
        result.current.setDefaultPerspective('RED');
      });

      expect(result.current.defaultPerspective).toBe('RED');
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      expect(stored.defaultPerspective).toBe('RED');
    });
  });

  describe('resetToDefault', () => {
    it('resets current perspective to the default', async () => {
      const { result } = renderHook(() =>
        useSimulationPerspective({ scenarioId: 'sc-reset' })
      );
      await act(async () => {});

      act(() => {
        result.current.setPerspective('BLUE');
      });
      expect(result.current.perspective).toBe('BLUE');

      act(() => {
        result.current.resetToDefault();
      });
      expect(result.current.perspective).toBe('GOD');
    });
  });
});

// ---------------------------------------------------------------------------
// Helper function tests
// ---------------------------------------------------------------------------

describe('canViewContent', () => {
  it('GOD perspective can view all content types', () => {
    expect(canViewContent('GOD', 'BLUE', 'full')).toBe(true);
    expect(canViewContent('GOD', 'RED', 'inner')).toBe(true);
    expect(canViewContent('GOD', 'GREEN', 'public')).toBe(true);
  });

  it('any perspective can view public content', () => {
    expect(canViewContent('BLUE', 'RED', 'public')).toBe(true);
    expect(canViewContent('RED', 'GREEN', 'public')).toBe(true);
    expect(canViewContent('WHITE', 'BLUE', 'public')).toBe(true);
  });

  it('team perspective can view its own full content', () => {
    expect(canViewContent('BLUE', 'BLUE', 'full')).toBe(true);
    expect(canViewContent('RED', 'RED', 'inner')).toBe(true);
  });

  it('team perspective cannot view opposing team full content', () => {
    expect(canViewContent('BLUE', 'RED', 'full')).toBe(false);
    expect(canViewContent('RED', 'BLUE', 'inner')).toBe(false);
    expect(canViewContent('GREEN', 'WHITE', 'full')).toBe(false);
  });
});

describe('getVisibleTeams', () => {
  it('GOD perspective sees all teams', () => {
    const teams = getVisibleTeams('GOD');
    expect(teams).toContain('BLUE');
    expect(teams).toContain('RED');
    expect(teams).toContain('GREEN');
    expect(teams).toContain('WHITE');
  });

  it('team perspective only sees its own team', () => {
    expect(getVisibleTeams('BLUE')).toEqual(['BLUE']);
    expect(getVisibleTeams('RED')).toEqual(['RED']);
    expect(getVisibleTeams('GREEN')).toEqual(['GREEN']);
  });
});
