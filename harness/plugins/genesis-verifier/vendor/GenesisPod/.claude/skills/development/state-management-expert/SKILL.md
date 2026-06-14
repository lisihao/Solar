---
name: State Management Expert
description: |
  Design and implement Zustand stores, state patterns, and cross-component state sharing.
  Trigger keywords: zustand, store, state, react, persist, selector
  Not for: React components (-> frontend-expert), WebSocket state (-> realtime-communication-expert)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [state, zustand, react, frontend, store]
boundaries:
  includes:
    - Zustand store design and implementation
    - State persistence strategies
    - Cross-component state sharing
    - DevTools integration
    - State hydration and SSR
  excludes:
    - React component development
    - Backend state/database
    - Real-time state updates via WebSocket
  handoff:
    - skill: frontend-expert
      when: Component development needed
    - skill: realtime-communication-expert
      when: WebSocket state sync needed
---

# State Management Expert

> Detailed docs: `references/`

## Architecture Overview

```
React Components (useStore hooks)
           ↓
Store Layer (UI / Domain / Feature stores)
           ↓
Middleware (persist | devtools | immer | subscribeWithSelector)
           ↓
External (localStorage | TanStack Query | WebSocket Events)
```

## Key Files

```
frontend/stores/
├── ui/                          # Global UI state
│   ├── useUIStore.ts            # Sidebar, modals
│   └── useToastStore.ts         # Notifications
├── domain/                      # Business domain state
│   ├── useResourceStore.ts      # Resource management
│   └── useUserStore.ts          # User preferences
├── features/                    # Feature-specific
│   └── ai-teams/useAITeamsStore.ts
└── index.ts                     # Exports
```

## Quick Reference

### Basic Store

```typescript
import { create } from "zustand";

interface UIState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
```

### Store with Immer (Complex Updates)

```typescript
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export const useResourceStore = create<ResourceState>()(
  immer((set) => ({
    resources: {},
    addResource: (r) =>
      set((s) => {
        s.resources[r.id] = r;
      }),
    deleteResource: (id) =>
      set((s) => {
        delete s.resources[id];
      }),
  })),
);
```

### Persisted Store

```typescript
import { persist, createJSONStorage } from "zustand/middleware";

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      preferences: defaultPrefs,
      setTheme: (t) => set({ theme: t }),
    }),
    { name: "user-prefs", storage: createJSONStorage(() => localStorage) },
  ),
);
```

### DevTools + Selectors

```typescript
import { devtools, subscribeWithSelector } from "zustand/middleware";

export const useStore = create<State>()(
  devtools(
    subscribeWithSelector((set) => ({
      /* state */
    })),
    { name: "MyStore" },
  ),
);

// Subscribe to changes
useStore.subscribe(
  (state) => state.activeMissionId,
  (id) => console.log("Mission changed:", id),
);
```

### Computed Selectors

```typescript
// Outside component for reuse
export const selectFilteredResources = (state: ResourceState) =>
  Object.values(state.resources).filter((r) =>
    state.filters.status.includes(r.status),
  );

// In component
const filtered = useResourceStore(selectFilteredResources);
```

## Store Categories

| Type          | Purpose                 | Persistence  |
| ------------- | ----------------------- | ------------ |
| UI Store      | Sidebar, modals, toasts | No           |
| Domain Store  | User prefs, settings    | localStorage |
| Feature Store | Mission state, editor   | Selective    |

## Best Practices

| Do                              | Don't                                  |
| ------------------------------- | -------------------------------------- |
| Keep stores focused (SRP)       | Store server data (use TanStack Query) |
| Use selectors for derived state | Create deeply nested state             |
| Use immer for complex updates   | Update state outside actions           |
| Separate UI from server state   | Persist sensitive data                 |
| Handle SSR hydration            | Forget to clean up subscriptions       |

## Related Docs

- [Zustand Patterns](references/zustand-patterns.md)
- [Persistence Guide](references/persistence.md)
- [SSR Hydration](references/ssr-hydration.md)
