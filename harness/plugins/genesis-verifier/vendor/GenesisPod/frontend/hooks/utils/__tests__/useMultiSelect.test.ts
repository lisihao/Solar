import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMultiSelect } from '../useMultiSelect';

describe('useMultiSelect', () => {
  // ==================== Initial State ====================

  it('should return initial empty selection state', () => {
    const { result } = renderHook(() => useMultiSelect());
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.canSelectMore).toBe(true);
    expect(result.current.maxItems).toBe(10);
  });

  it('should use custom maxItems when provided', () => {
    const { result } = renderHook(() => useMultiSelect(5));
    expect(result.current.maxItems).toBe(5);
    expect(result.current.canSelectMore).toBe(true);
  });

  it('should expose all required functions', () => {
    const { result } = renderHook(() => useMultiSelect());
    expect(typeof result.current.toggleSelect).toBe('function');
    expect(typeof result.current.selectAll).toBe('function');
    expect(typeof result.current.clearAll).toBe('function');
    expect(typeof result.current.isSelected).toBe('function');
  });

  // ==================== toggleSelect ====================

  it('toggleSelect: selects an item that is not yet selected', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      result.current.toggleSelect('item-1');
    });

    expect(result.current.selectedIds).toContain('item-1');
    expect(result.current.selectedCount).toBe(1);
  });

  it('toggleSelect: deselects an item that is already selected', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      result.current.toggleSelect('item-1');
    });

    act(() => {
      result.current.toggleSelect('item-1');
    });

    expect(result.current.selectedIds).not.toContain('item-1');
    expect(result.current.selectedCount).toBe(0);
  });

  it('toggleSelect: selects multiple different items', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      result.current.toggleSelect('item-1');
      result.current.toggleSelect('item-2');
      result.current.toggleSelect('item-3');
    });

    expect(result.current.selectedCount).toBe(3);
    expect(result.current.selectedIds).toContain('item-1');
    expect(result.current.selectedIds).toContain('item-2');
    expect(result.current.selectedIds).toContain('item-3');
  });

  it('toggleSelect: does not exceed maxItems limit', () => {
    const { result } = renderHook(() => useMultiSelect(3));

    act(() => {
      result.current.toggleSelect('item-1');
      result.current.toggleSelect('item-2');
      result.current.toggleSelect('item-3');
    });

    expect(result.current.selectedCount).toBe(3);
    expect(result.current.canSelectMore).toBe(false);

    // Try to add a 4th item — should be ignored
    act(() => {
      result.current.toggleSelect('item-4');
    });

    expect(result.current.selectedCount).toBe(3);
    expect(result.current.selectedIds).not.toContain('item-4');
  });

  it('toggleSelect: allows deselecting when at maxItems limit', () => {
    const { result } = renderHook(() => useMultiSelect(2));

    act(() => {
      result.current.toggleSelect('item-1');
      result.current.toggleSelect('item-2');
    });

    expect(result.current.canSelectMore).toBe(false);

    // Deselect should still work
    act(() => {
      result.current.toggleSelect('item-1');
    });

    expect(result.current.selectedCount).toBe(1);
    expect(result.current.canSelectMore).toBe(true);
  });

  it('toggleSelect: canSelectMore becomes false at maxItems', () => {
    const { result } = renderHook(() => useMultiSelect(1));

    act(() => {
      result.current.toggleSelect('item-1');
    });

    expect(result.current.canSelectMore).toBe(false);
  });

  // ==================== selectAll ====================

  it('selectAll: selects all provided ids up to maxItems', () => {
    const { result } = renderHook(() => useMultiSelect(10));
    const ids = ['a', 'b', 'c', 'd', 'e'];

    act(() => {
      result.current.selectAll(ids);
    });

    expect(result.current.selectedCount).toBe(5);
    ids.forEach((id) => {
      expect(result.current.selectedIds).toContain(id);
    });
  });

  it('selectAll: truncates list to maxItems when more ids provided', () => {
    const { result } = renderHook(() => useMultiSelect(3));
    const ids = ['a', 'b', 'c', 'd', 'e'];

    act(() => {
      result.current.selectAll(ids);
    });

    expect(result.current.selectedCount).toBe(3);
    expect(result.current.selectedIds).toContain('a');
    expect(result.current.selectedIds).toContain('b');
    expect(result.current.selectedIds).toContain('c');
    expect(result.current.selectedIds).not.toContain('d');
    expect(result.current.selectedIds).not.toContain('e');
  });

  it('selectAll: replaces existing selection', () => {
    const { result } = renderHook(() => useMultiSelect(10));

    act(() => {
      result.current.selectAll(['old-1', 'old-2']);
    });

    act(() => {
      result.current.selectAll(['new-1', 'new-2', 'new-3']);
    });

    expect(result.current.selectedCount).toBe(3);
    expect(result.current.selectedIds).not.toContain('old-1');
    expect(result.current.selectedIds).not.toContain('old-2');
    expect(result.current.selectedIds).toContain('new-1');
  });

  it('selectAll: handles empty array', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      result.current.selectAll(['item-1', 'item-2']);
    });

    act(() => {
      result.current.selectAll([]);
    });

    expect(result.current.selectedCount).toBe(0);
  });

  // ==================== clearAll ====================

  it('clearAll: removes all selected items', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      result.current.toggleSelect('item-1');
      result.current.toggleSelect('item-2');
      result.current.toggleSelect('item-3');
    });

    expect(result.current.selectedCount).toBe(3);

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.canSelectMore).toBe(true);
  });

  it('clearAll: works on empty selection without error', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.selectedCount).toBe(0);
  });

  // ==================== isSelected ====================

  it('isSelected: returns true for selected item', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      result.current.toggleSelect('item-1');
    });

    expect(result.current.isSelected('item-1')).toBe(true);
  });

  it('isSelected: returns false for unselected item', () => {
    const { result } = renderHook(() => useMultiSelect());
    expect(result.current.isSelected('item-1')).toBe(false);
  });

  it('isSelected: returns false after item is deselected', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      result.current.toggleSelect('item-1');
    });

    act(() => {
      result.current.toggleSelect('item-1');
    });

    expect(result.current.isSelected('item-1')).toBe(false);
  });

  // ==================== selectedIds array ====================

  it('selectedIds is returned as array (not Set)', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      result.current.toggleSelect('item-1');
    });

    expect(Array.isArray(result.current.selectedIds)).toBe(true);
  });

  it('selectedIds does not contain duplicates', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      result.current.toggleSelect('item-1');
      result.current.toggleSelect('item-1'); // toggles off
      result.current.toggleSelect('item-1'); // toggles back on
    });

    const count = result.current.selectedIds.filter(
      (id) => id === 'item-1'
    ).length;
    expect(count).toBe(1);
  });

  // ==================== Default maxItems ====================

  it('default maxItems is 10', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      for (let i = 1; i <= 10; i++) {
        result.current.toggleSelect(`item-${i}`);
      }
    });

    expect(result.current.selectedCount).toBe(10);
    expect(result.current.canSelectMore).toBe(false);

    act(() => {
      result.current.toggleSelect('item-11');
    });

    expect(result.current.selectedCount).toBe(10);
    expect(result.current.selectedIds).not.toContain('item-11');
  });
});
