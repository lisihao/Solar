import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  useThemeStore,
  USER_MESSAGE_STYLES,
  AI_MESSAGE_STYLES,
} from '../themeStore';

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

// ── Reset helpers ─────────────────────────────────────────────────────────────

function resetStore() {
  useThemeStore.setState({
    userMessageStyle: USER_MESSAGE_STYLES[0].value,
    aiMessageStyle: AI_MESSAGE_STYLES[0].value,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// useThemeStore
// ═════════════════════════════════════════════════════════════════════════════

describe('useThemeStore', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should default userMessageStyle to the first USER_MESSAGE_STYLES value', () => {
      const { result } = renderHook(() => useThemeStore());
      expect(result.current.userMessageStyle).toBe(
        USER_MESSAGE_STYLES[0].value
      );
    });

    it('should default aiMessageStyle to the first AI_MESSAGE_STYLES value', () => {
      const { result } = renderHook(() => useThemeStore());
      expect(result.current.aiMessageStyle).toBe(AI_MESSAGE_STYLES[0].value);
    });
  });

  describe('setUserMessageStyle', () => {
    it('should update userMessageStyle', () => {
      const { result } = renderHook(() => useThemeStore());
      const newStyle = USER_MESSAGE_STYLES[1].value;

      act(() => {
        result.current.setUserMessageStyle(newStyle);
      });

      expect(result.current.userMessageStyle).toBe(newStyle);
    });

    it('should allow setting any of the 5 USER_MESSAGE_STYLES values', () => {
      const { result } = renderHook(() => useThemeStore());

      USER_MESSAGE_STYLES.forEach((style) => {
        act(() => {
          result.current.setUserMessageStyle(style.value);
        });
        expect(result.current.userMessageStyle).toBe(style.value);
      });
    });

    it('should allow setting an arbitrary custom style string', () => {
      const { result } = renderHook(() => useThemeStore());
      const custom = 'bg-custom-class text-white';

      act(() => {
        result.current.setUserMessageStyle(custom);
      });

      expect(result.current.userMessageStyle).toBe(custom);
    });

    it('should not affect aiMessageStyle', () => {
      const { result } = renderHook(() => useThemeStore());
      const originalAi = result.current.aiMessageStyle;

      act(() => {
        result.current.setUserMessageStyle(USER_MESSAGE_STYLES[2].value);
      });

      expect(result.current.aiMessageStyle).toBe(originalAi);
    });
  });

  describe('setAiMessageStyle', () => {
    it('should update aiMessageStyle', () => {
      const { result } = renderHook(() => useThemeStore());
      const newStyle = AI_MESSAGE_STYLES[2].value;

      act(() => {
        result.current.setAiMessageStyle(newStyle);
      });

      expect(result.current.aiMessageStyle).toBe(newStyle);
    });

    it('should allow setting any of the 4 AI_MESSAGE_STYLES values', () => {
      const { result } = renderHook(() => useThemeStore());

      AI_MESSAGE_STYLES.forEach((style) => {
        act(() => {
          result.current.setAiMessageStyle(style.value);
        });
        expect(result.current.aiMessageStyle).toBe(style.value);
      });
    });

    it('should not affect userMessageStyle', () => {
      const { result } = renderHook(() => useThemeStore());
      act(() => {
        result.current.setUserMessageStyle(USER_MESSAGE_STYLES[3].value);
      });
      const savedUserStyle = result.current.userMessageStyle;

      act(() => {
        result.current.setAiMessageStyle(AI_MESSAGE_STYLES[1].value);
      });

      expect(result.current.userMessageStyle).toBe(savedUserStyle);
    });
  });

  describe('both styles can be changed independently', () => {
    it('should maintain separate state for userMessageStyle and aiMessageStyle', () => {
      const { result } = renderHook(() => useThemeStore());

      act(() => {
        result.current.setUserMessageStyle(USER_MESSAGE_STYLES[4].value);
        result.current.setAiMessageStyle(AI_MESSAGE_STYLES[3].value);
      });

      expect(result.current.userMessageStyle).toBe(
        USER_MESSAGE_STYLES[4].value
      );
      expect(result.current.aiMessageStyle).toBe(AI_MESSAGE_STYLES[3].value);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Exported constants
// ═════════════════════════════════════════════════════════════════════════════

describe('USER_MESSAGE_STYLES', () => {
  it('should export exactly 5 styles', () => {
    expect(USER_MESSAGE_STYLES).toHaveLength(5);
  });

  it('each style should have id, name, value, preview fields', () => {
    USER_MESSAGE_STYLES.forEach((style) => {
      expect(style).toHaveProperty('id');
      expect(style).toHaveProperty('name');
      expect(style).toHaveProperty('value');
      expect(style).toHaveProperty('preview');
    });
  });

  it('all style ids should be unique', () => {
    const ids = USER_MESSAGE_STYLES.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe('AI_MESSAGE_STYLES', () => {
  it('should export exactly 4 styles', () => {
    expect(AI_MESSAGE_STYLES).toHaveLength(4);
  });

  it('each style should have id, name, value, preview fields', () => {
    AI_MESSAGE_STYLES.forEach((style) => {
      expect(style).toHaveProperty('id');
      expect(style).toHaveProperty('name');
      expect(style).toHaveProperty('value');
      expect(style).toHaveProperty('preview');
    });
  });

  it('all style ids should be unique', () => {
    const ids = AI_MESSAGE_STYLES.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
