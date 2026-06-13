import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ImageSourceItem {
  id: string;
  type: 'paper' | 'blog' | 'report' | 'youtube' | 'news' | 'project';
  title: string;
  url: string;
  thumbnailUrl?: string;
  addedAt: Date;
}

interface ImageSourceStore {
  sources: ImageSourceItem[];
  addSource: (item: ImageSourceItem) => void;
  removeSource: (id: string) => void;
  clearSources: () => void;
}

export const useImageSourceStore = create<ImageSourceStore>()(
  persist(
    (set) => ({
      sources: [],
      addSource: (item) =>
        set((state) => {
          // Check if already exists
          if (state.sources.some((s) => s.id === item.id)) {
            return state;
          }
          // Keep max 10 items, remove oldest if needed
          const newSources = [...state.sources, item];
          if (newSources.length > 10) {
            newSources.shift();
          }
          return { sources: newSources };
        }),
      removeSource: (id) =>
        set((state) => ({
          sources: state.sources.filter((s) => s.id !== id),
        })),
      clearSources: () => set({ sources: [] }),
    }),
    {
      name: 'image-source-storage',
    }
  )
);
