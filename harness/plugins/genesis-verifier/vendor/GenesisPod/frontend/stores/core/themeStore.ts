import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Appearance = 'light' | 'dark' | 'system';

export interface ThemeState {
  userMessageStyle: string;
  aiMessageStyle: string;
  /** 外观主题：浅色 / 深色 / 跟随系统。由 ThemeApplier 写入 <html class="dark">。 */
  appearance: Appearance;
  setUserMessageStyle: (style: string) => void;
  setAiMessageStyle: (style: string) => void;
  setAppearance: (appearance: Appearance) => void;
}

export const USER_MESSAGE_STYLES = [
  {
    id: 'violet-gradient',
    name: 'Violet Gradient',
    value: 'bg-gradient-to-r from-violet-600 to-purple-600 text-white',
    preview: 'bg-gradient-to-r from-violet-600 to-purple-600',
  },
  {
    id: 'blue-gradient',
    name: 'Blue Gradient',
    value: 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white',
    preview: 'bg-gradient-to-r from-blue-600 to-cyan-600',
  },
  {
    id: 'orange-gradient',
    name: 'Orange Gradient',
    value: 'bg-gradient-to-r from-orange-500 to-red-500 text-white',
    preview: 'bg-gradient-to-r from-orange-500 to-red-500',
  },
  {
    id: 'green-gradient',
    name: 'Green Gradient',
    value: 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white',
    preview: 'bg-gradient-to-r from-emerald-500 to-teal-500',
  },
  {
    id: 'dark-gray',
    name: 'Dark Gray',
    value: 'bg-gray-800 text-white',
    preview: 'bg-gray-800',
  },
];

export const AI_MESSAGE_STYLES = [
  {
    id: 'white-shadow',
    name: 'White (Default)',
    value: 'bg-white shadow-sm ring-1 ring-gray-100 text-gray-900',
    preview: 'bg-white border border-gray-200',
  },
  {
    id: 'gray-minimal',
    name: 'Light Gray',
    value: 'bg-gray-50 border border-gray-100 text-gray-900',
    preview: 'bg-gray-50 border border-gray-200',
  },
  {
    id: 'blue-tint',
    name: 'Blue Tint',
    value: 'bg-blue-50/50 border border-blue-100 text-gray-900',
    preview: 'bg-blue-50',
  },
  {
    id: 'warm-tint',
    name: 'Warm Tint',
    value: 'bg-orange-50/50 border border-orange-100 text-gray-900',
    preview: 'bg-orange-50',
  },
];

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      userMessageStyle: USER_MESSAGE_STYLES[0].value,
      aiMessageStyle: AI_MESSAGE_STYLES[0].value,
      appearance: 'light',
      setUserMessageStyle: (style) => set({ userMessageStyle: style }),
      setAiMessageStyle: (style) => set({ aiMessageStyle: style }),
      setAppearance: (appearance) => set({ appearance }),
    }),
    {
      name: 'deepdive-theme-storage',
    }
  )
);
