import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Resource {
  id: string;
  type: string;
  title: string;
  abstract?: string;
  thumbnailUrl?: string;
}

interface ReportWorkspace {
  resources: Resource[];
  workspaceId: string | null;
  isExpanded: boolean;
  maxResources: number;

  setWorkspaceId: (id: string | null) => void;
  setResources: (resources: Resource[]) => void;
  addResource: (resource: Resource) => void;
  removeResource: (id: string) => void;
  clearAll: () => void;
  toggleExpanded: () => void;
  hasResource: (id: string) => boolean;
  canAddMore: () => boolean;
}

export const useReportWorkspace = create<ReportWorkspace>()(
  persist(
    (set, get) => ({
      resources: [],
      workspaceId: null,
      isExpanded: false,
      maxResources: 20,

      setWorkspaceId: (id) => {
        set({ workspaceId: id });
      },

      setResources: (resources) => {
        set({ resources, isExpanded: resources.length > 0 });
      },

      addResource: (resource) => {
        const { resources, maxResources } = get();
        if (resources.length >= maxResources) return;
        if (resources.some((r) => r.id === resource.id)) return;

        set({ resources: [...resources, resource], isExpanded: true });
      },

      removeResource: (id) => {
        set((state) => ({
          resources: state.resources.filter((r) => r.id !== id),
        }));
      },

      clearAll: () => {
        set({ resources: [], isExpanded: false, workspaceId: null });
      },

      toggleExpanded: () => {
        set((state) => ({ isExpanded: !state.isExpanded }));
      },

      hasResource: (id) => {
        return get().resources.some((r) => r.id === id);
      },

      canAddMore: () => {
        const { resources, maxResources } = get();
        return resources.length < maxResources;
      },
    }),
    {
      name: 'report-workspace',
      partialize: (state) => ({
        resources: state.resources,
        workspaceId: state.workspaceId,
      }),
      skipHydration: true,
    }
  )
);
