'use client';

import { useState, useCallback } from 'react';

/**
 * 多选功能Hook
 * 用于管理资源的多选状态
 */
export function useMultiSelect(maxItems = 10) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /**
   * 切换选择状态
   */
  const toggleSelect = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(id)) {
          newSet.delete(id);
        } else if (newSet.size < maxItems) {
          newSet.add(id);
        } else {
          // 已达到最大选择数量
          return prev;
        }
        return newSet;
      });
    },
    [maxItems]
  );

  /**
   * 全选（最多maxItems项）
   */
  const selectAll = useCallback(
    (ids: string[]) => {
      setSelectedIds(new Set(ids.slice(0, maxItems)));
    },
    [maxItems]
  );

  /**
   * 清除所有选择
   */
  const clearAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  /**
   * 检查是否已选择
   */
  const isSelected = useCallback(
    (id: string) => {
      return selectedIds.has(id);
    },
    [selectedIds]
  );

  return {
    selectedIds: Array.from(selectedIds),
    selectedCount: selectedIds.size,
    toggleSelect,
    selectAll,
    clearAll,
    isSelected,
    canSelectMore: selectedIds.size < maxItems,
    maxItems,
  };
}
