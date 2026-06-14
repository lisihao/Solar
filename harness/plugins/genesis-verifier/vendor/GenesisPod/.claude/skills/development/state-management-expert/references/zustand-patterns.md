# Zustand Store Patterns

## Basic Store Pattern

```typescript
// stores/ui/useUIStore.ts
import { create } from "zustand";

interface UIState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  activeModal: string | null;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  openModal: (modalId: string) => void;
  closeModal: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarWidth: 280,
  activeModal: null,

  toggleSidebar: () =>
    set((state) => ({
      sidebarOpen: !state.sidebarOpen,
    })),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  openModal: (modalId) => set({ activeModal: modalId }),

  closeModal: () => set({ activeModal: null }),
}));
```

## Store with Immer (Complex Updates)

```typescript
// stores/domain/useResourceStore.ts
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

interface Resource {
  id: string;
  title: string;
  content: string;
  tags: string[];
  status: "draft" | "published" | "archived";
}

interface ResourceState {
  resources: Record<string, Resource>;
  selectedIds: Set<string>;
  filters: {
    status: string[];
    tags: string[];
    search: string;
  };
  addResource: (resource: Resource) => void;
  updateResource: (id: string, updates: Partial<Resource>) => void;
  deleteResource: (id: string) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  setFilter: (key: keyof ResourceState["filters"], value: any) => void;
}

export const useResourceStore = create<ResourceState>()(
  immer((set) => ({
    resources: {},
    selectedIds: new Set(),
    filters: {
      status: [],
      tags: [],
      search: "",
    },

    addResource: (resource) =>
      set((state) => {
        state.resources[resource.id] = resource;
      }),

    updateResource: (id, updates) =>
      set((state) => {
        if (state.resources[id]) {
          Object.assign(state.resources[id], updates);
        }
      }),

    deleteResource: (id) =>
      set((state) => {
        delete state.resources[id];
        state.selectedIds.delete(id);
      }),

    toggleSelection: (id) =>
      set((state) => {
        if (state.selectedIds.has(id)) {
          state.selectedIds.delete(id);
        } else {
          state.selectedIds.add(id);
        }
      }),

    clearSelection: () =>
      set((state) => {
        state.selectedIds.clear();
      }),

    setFilter: (key, value) =>
      set((state) => {
        state.filters[key] = value;
      }),
  })),
);
```

## DevTools Integration

```typescript
import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export const useAITeamsStore = create<AITeamsState>()(
  devtools(
    subscribeWithSelector(
      immer((set, get) => ({
        missions: {},
        activeMissionId: null,

        createMission: (mission) => {
          const id = crypto.randomUUID();
          set(
            (state) => {
              state.missions[id] = { ...mission, id };
            },
            false,
            "createMission", // Action name for DevTools
          );
          return id;
        },

        updateMissionStatus: (id, status) =>
          set(
            (state) => {
              if (state.missions[id]) {
                state.missions[id].status = status;
              }
            },
            false,
            "updateMissionStatus",
          ),
      })),
    ),
    { name: "AI Teams Store" },
  ),
);

// Subscribe to state changes
useAITeamsStore.subscribe(
  (state) => state.activeMissionId,
  (activeMissionId) => {
    console.log("Active mission changed:", activeMissionId);
  },
);
```

## Computed Values (Selectors)

```typescript
import { shallow } from "zustand/shallow";

// Basic selector
const resources = useResourceStore((state) => state.resources);

// Multiple values with shallow comparison
const { resources, filters } = useResourceStore(
  (state) => ({
    resources: state.resources,
    filters: state.filters,
  }),
  shallow,
);

// Derived selectors (outside component for reuse)
export const selectFilteredResources = (state: ResourceState) => {
  const { resources, filters } = state;
  let result = Object.values(resources);

  if (filters.status.length > 0) {
    result = result.filter((r) => filters.status.includes(r.status));
  }

  if (filters.search) {
    const search = filters.search.toLowerCase();
    result = result.filter(
      (r) =>
        r.title.toLowerCase().includes(search) ||
        r.content.toLowerCase().includes(search),
    );
  }

  return result;
};

// Usage in component
function ResourceList() {
  const filteredResources = useResourceStore(selectFilteredResources);
  // ...
}
```

## Cross-Store Communication

```typescript
// Option 1: Direct store access
function handleMissionComplete(missionId: string) {
  const mission = useAITeamsStore.getState().missions[missionId];
  useNotificationStore.getState().addNotification({
    type: "success",
    message: `Mission "${mission.title}" completed!`,
  });
}

// Option 2: Subscribe to changes
useAITeamsStore.subscribe(
  (state) => state.missions,
  (missions, prevMissions) => {
    Object.keys(missions).forEach((id) => {
      if (
        missions[id].status === "completed" &&
        prevMissions[id]?.status !== "completed"
      ) {
        useNotificationStore.getState().addNotification({
          type: "success",
          message: `Mission completed!`,
        });
      }
    });
  },
);

// Option 3: Unified action
function completeMissionAndNotify(missionId: string) {
  useAITeamsStore.getState().updateMissionStatus(missionId, "completed");
  useNotificationStore.getState().addNotification({
    type: "success",
    message: "Mission completed!",
  });
}
```

## Async Actions with TanStack Query

```typescript
// Zustand for UI state only
interface LibraryUIState {
  viewMode: "grid" | "list";
  sortBy: "name" | "date" | "type";
  setViewMode: (mode: "grid" | "list") => void;
  setSortBy: (sortBy: "name" | "date" | "type") => void;
}

export const useLibraryUIStore = create<LibraryUIState>((set) => ({
  viewMode: "grid",
  sortBy: "date",
  setViewMode: (viewMode) => set({ viewMode }),
  setSortBy: (sortBy) => set({ sortBy }),
}));

// TanStack Query for server state
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useLibraryResources() {
  const { sortBy } = useLibraryUIStore();

  return useQuery({
    queryKey: ["library-resources", sortBy],
    queryFn: () => api.get("/resources", { params: { sortBy } }),
  });
}
```
