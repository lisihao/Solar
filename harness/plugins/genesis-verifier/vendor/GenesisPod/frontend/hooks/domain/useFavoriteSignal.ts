import { useState, useCallback } from 'react';
import { useApiPost } from '@/hooks/core';
import type { ApiError } from '@/lib/api/client';

interface FavoriteToggleResponse {
  // 后端返回字段（与 favorite.service.ts toggle 返回值对齐）
  favorited: boolean;
}

interface FavoriteToggleBody {
  signalId: string;
  topicId: string;
}

export function useFavoriteSignal(
  signalId: string | null,
  topicId: string | null,
  /**
   * 初始收藏状态（从父组件已知的 favoritedIds set 注入）。
   *
   * R5 frontend review P1：之前 hook 内部硬 useState(false)，导致已收藏的信号在
   * 首次 render 时 isFavorited=false，BriefingCardConnected 的 effect 同步会把
   * favoritedLocal 强制覆写为 false 显示成"未收藏"。
   */
  initialValue: boolean = false
): {
  isFavorited: boolean;
  loading: boolean;
  error: ApiError | null;
  toggle: () => Promise<void>;
} {
  const [isFavorited, setIsFavorited] = useState(initialValue);

  const {
    loading,
    error,
    execute: toggleApi,
  } = useApiPost<FavoriteToggleResponse, FavoriteToggleBody>(
    // apiClient.baseUrl 已含 /api/v1
    '/radar/favorites/toggle'
  );

  const toggle = useCallback(async () => {
    if (!signalId || !topicId) return;

    // Optimistic update
    const previous = isFavorited;
    setIsFavorited(!previous);

    const result = await toggleApi({ signalId, topicId });
    if (result === undefined) {
      // Request failed — rollback
      setIsFavorited(previous);
    } else {
      setIsFavorited(result.favorited);
    }
  }, [signalId, topicId, isFavorited, toggleApi]);

  return {
    isFavorited: signalId ? isFavorited : false,
    loading,
    error,
    toggle,
  };
}
