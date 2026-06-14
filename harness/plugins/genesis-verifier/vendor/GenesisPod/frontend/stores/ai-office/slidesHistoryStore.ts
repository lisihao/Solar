/**
 * AI Slides 历史记录 Store
 * 使用 localStorage 持久化存储幻灯片生成历史
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 幻灯片产物
 */
export interface SlidesArtifact {
  id: string;
  name: string;
  type: string;
  url: string;
}

/**
 * 历史记录项
 */
export interface SlidesHistoryItem {
  id: string;
  timestamp: Date;
  // 主要字段
  title?: string;
  sourceText?: string;
  targetPages?: number;
  // 兼容字段
  prompt?: string;
  slideCount?: number;
  templateId?: string;
  summary?: string;
  // 共用字段
  status: 'success' | 'error' | 'pending';
  sessionId?: string;
  checkpointId?: string;
  /** 智能标签 */
  tags?: string[];
  /** 保存结果以便恢复 */
  result?: {
    artifacts: SlidesArtifact[];
    duration: number;
    documentId?: string;
    content?: string;
  };
}

interface SlidesHistoryStore {
  history: SlidesHistoryItem[];
  addHistory: (item: Omit<SlidesHistoryItem, 'id' | 'timestamp'>) => string;
  updateHistory: (id: string, updates: Partial<SlidesHistoryItem>) => void;
  removeHistory: (id: string) => void;
  clearHistory: () => void;
}

const MAX_HISTORY_ITEMS = 50;

export const useSlidesHistoryStore = create<SlidesHistoryStore>()(
  persist(
    (set) => ({
      history: [],

      addHistory: (item) => {
        const id = `slides_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newItem: SlidesHistoryItem = {
          ...item,
          id,
          timestamp: new Date(),
        };

        set((state) => {
          const newHistory = [newItem, ...state.history];
          // 保留最多 MAX_HISTORY_ITEMS 条记录
          if (newHistory.length > MAX_HISTORY_ITEMS) {
            newHistory.splice(MAX_HISTORY_ITEMS);
          }
          return { history: newHistory };
        });

        return id;
      },

      updateHistory: (id, updates) => {
        set((state) => ({
          history: state.history.map((item) =>
            item.id === id ? { ...item, ...updates } : item
          ),
        }));
      },

      removeHistory: (id) => {
        set((state) => ({
          history: state.history.filter((item) => item.id !== id),
        }));
      },

      clearHistory: () => {
        set({ history: [] });
      },
    }),
    {
      name: 'slides-history-storage',
      partialize: (state) => ({
        history: state.history.map((item) => ({
          ...item,
          timestamp:
            item.timestamp instanceof Date
              ? item.timestamp.toISOString()
              : item.timestamp,
        })),
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // 将 timestamp 字符串转换回 Date 对象
          state.history = state.history.map((item) => ({
            ...item,
            timestamp: new Date(item.timestamp as unknown as string),
          }));
        }
      },
    }
  )
);

/**
 * 格式化时间为相对时间
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const timestamp =
    date instanceof Date ? date.getTime() : new Date(date).getTime();
  const diff = now.getTime() - timestamp;

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
