# State Persistence Guide

## Basic Persistence

```typescript
// stores/domain/useUserStore.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface UserPreferences {
  theme: "light" | "dark" | "system";
  language: string;
  fontSize: number;
  sidebarCollapsed: boolean;
  recentProjects: string[];
}

interface UserState {
  preferences: UserPreferences;
  setTheme: (theme: UserPreferences["theme"]) => void;
  setLanguage: (language: string) => void;
  resetPreferences: () => void;
}

const defaultPreferences: UserPreferences = {
  theme: "system",
  language: "zh-CN",
  fontSize: 14,
  sidebarCollapsed: false,
  recentProjects: [],
};

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      preferences: defaultPreferences,

      setTheme: (theme) =>
        set((state) => ({
          preferences: { ...state.preferences, theme },
        })),

      setLanguage: (language) =>
        set((state) => ({
          preferences: { ...state.preferences, language },
        })),

      resetPreferences: () => set({ preferences: defaultPreferences }),
    }),
    {
      name: "user-preferences",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ preferences: state.preferences }),
    },
  ),
);
```

## Selective Persistence

```typescript
// Only persist specific fields
export const useWritingStore = create<WritingState>()(
  persist(
    (set, get) => ({
      currentProjectId: null,
      editorSettings: defaultEditorSettings,
      drafts: {}, // Don't persist
      isLoading: false, // Don't persist
      // ... actions
    }),
    {
      name: "writing-store",
      storage: createJSONStorage(() => localStorage),
      // Only persist these fields
      partialize: (state) => ({
        currentProjectId: state.currentProjectId,
        editorSettings: state.editorSettings,
        // Explicitly exclude: drafts, isLoading
      }),
    },
  ),
);
```

## Custom Storage Adapter

```typescript
// sessionStorage instead of localStorage
export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      /* state */
    }),
    {
      name: "session-data",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

// Custom storage with encryption
const encryptedStorage = {
  getItem: (name: string) => {
    const value = localStorage.getItem(name);
    return value ? decrypt(value) : null;
  },
  setItem: (name: string, value: string) => {
    localStorage.setItem(name, encrypt(value));
  },
  removeItem: (name: string) => {
    localStorage.removeItem(name);
  },
};

export const useSecureStore = create<SecureState>()(
  persist(
    (set) => ({
      /* state */
    }),
    {
      name: "secure-data",
      storage: createJSONStorage(() => encryptedStorage),
    },
  ),
);
```

## Migration Between Versions

```typescript
export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      /* state */
    }),
    {
      name: "user-preferences",
      version: 2, // Increment when schema changes
      migrate: (persistedState, version) => {
        if (version === 0) {
          // v0 -> v1: Add language field
          return {
            ...persistedState,
            preferences: {
              ...persistedState.preferences,
              language: "en-US",
            },
          };
        }
        if (version === 1) {
          // v1 -> v2: Rename theme values
          const theme = persistedState.preferences.theme;
          return {
            ...persistedState,
            preferences: {
              ...persistedState.preferences,
              theme: theme === "auto" ? "system" : theme,
            },
          };
        }
        return persistedState;
      },
    },
  ),
);
```

## Storage Best Practices

| Do                              | Don't                                        |
| ------------------------------- | -------------------------------------------- |
| Persist user preferences        | Persist sensitive data (tokens, passwords)   |
| Use partialize to select fields | Store large datasets                         |
| Version your persisted state    | Persist derived/computed state               |
| Handle migration gracefully     | Persist temporary UI state (loading, errors) |
| Consider storage limits (~5MB)  | Store server state (use cache instead)       |
