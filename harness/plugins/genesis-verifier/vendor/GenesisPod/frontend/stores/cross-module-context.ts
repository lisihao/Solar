/**
 * Cross-Module Context Store
 *
 * 跨模块上下文传递：当 ActionCards 点击时，将来源模块的查询和上下文
 * 存储到 sessionStorage，目标模块页面可读取并预填充。
 *
 * TTL: 30 分钟，超时后自动清除。
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface CrossModuleContextData {
  /** 可选摘要（来自问答回答或研究摘要） */
  summary?: string;
  /** 识别到的实体列表 */
  entities?: string[];
  /** 相关话题 */
  relatedTopics?: string[];
  /** 来源消息 ID */
  sourceMessageId?: string;
}

export interface CrossModulePayload {
  /** 来源模块标识（如 'ask', 'research', 'teams'） */
  sourceModule: string;
  /** 原始查询文本 */
  query: string;
  /** 可选富结构上下文 */
  contextData?: CrossModuleContextData;
  /** 过期时间戳（ms since epoch） */
  expiresAt: number;
}

interface CrossModuleContextState {
  payload: CrossModulePayload | null;
  /** 设置跨模块上下文（自动添加 30 分钟 TTL） */
  setContext: (data: Omit<CrossModulePayload, 'expiresAt'>) => void;
  /** 读取上下文（过期则自动清除并返回 null） */
  getContext: () => CrossModulePayload | null;
  /** 清除上下文 */
  clearContext: () => void;
}

export const useCrossModuleContext = create<CrossModuleContextState>()(
  persist(
    (set, get) => ({
      payload: null,

      setContext: (data) => {
        set({
          payload: {
            ...data,
            expiresAt: Date.now() + 30 * 60 * 1000,
          },
        });
      },

      getContext: () => {
        const { payload } = get();
        if (!payload) return null;
        if (Date.now() > payload.expiresAt) {
          set({ payload: null });
          return null;
        }
        return payload;
      },

      clearContext: () => set({ payload: null }),
    }),
    {
      name: 'cross-module-ctx',
      storage: createJSONStorage(() => {
        // SSR 环境下 sessionStorage / localStorage 均不存在，返回 noop 存储
        if (typeof window === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return sessionStorage;
      }),
    }
  )
);
