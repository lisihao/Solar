import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReportWorkspace } from '../useReportWorkspace';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResource(id: string, overrides = {}) {
  return {
    id,
    type: 'article',
    title: `Resource ${id}`,
    abstract: `Abstract for ${id}`,
    thumbnailUrl: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReportWorkspace', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useReportWorkspace.getState().clearAll();
    });
  });

  describe('initial state', () => {
    it('starts with empty resources array', () => {
      const { result } = renderHook(() => useReportWorkspace());
      expect(result.current.resources).toEqual([]);
    });

    it('starts with null workspaceId', () => {
      const { result } = renderHook(() => useReportWorkspace());
      expect(result.current.workspaceId).toBeNull();
    });

    it('starts with isExpanded false', () => {
      const { result } = renderHook(() => useReportWorkspace());
      expect(result.current.isExpanded).toBe(false);
    });

    it('starts with maxResources of 20', () => {
      const { result } = renderHook(() => useReportWorkspace());
      expect(result.current.maxResources).toBe(20);
    });
  });

  describe('setWorkspaceId', () => {
    it('updates workspaceId', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        result.current.setWorkspaceId('ws-abc');
      });
      expect(result.current.workspaceId).toBe('ws-abc');
    });

    it('clears workspaceId when null is passed', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        result.current.setWorkspaceId('ws-abc');
      });
      act(() => {
        result.current.setWorkspaceId(null);
      });
      expect(result.current.workspaceId).toBeNull();
    });
  });

  describe('setResources', () => {
    it('replaces entire resources list', () => {
      const { result } = renderHook(() => useReportWorkspace());
      const resources = [makeResource('r-1'), makeResource('r-2')];

      act(() => {
        result.current.addResource(makeResource('r-old'));
      });
      act(() => {
        result.current.setResources(resources);
      });

      expect(result.current.resources).toHaveLength(2);
      expect(result.current.resources[0].id).toBe('r-1');
    });

    it('sets isExpanded to true when resources are non-empty', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        result.current.setResources([makeResource('r-1')]);
      });
      expect(result.current.isExpanded).toBe(true);
    });

    it('sets isExpanded to false when empty array is set', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        result.current.setResources([makeResource('r-1')]);
      });
      act(() => {
        result.current.setResources([]);
      });
      expect(result.current.isExpanded).toBe(false);
    });
  });

  describe('addResource', () => {
    it('adds a resource to the list', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        result.current.addResource(makeResource('r-1'));
      });
      expect(result.current.resources).toHaveLength(1);
      expect(result.current.resources[0].id).toBe('r-1');
    });

    it('sets isExpanded to true after adding', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        result.current.addResource(makeResource('r-1'));
      });
      expect(result.current.isExpanded).toBe(true);
    });

    it('does not add duplicate resources', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        result.current.addResource(makeResource('r-1'));
        result.current.addResource(makeResource('r-1'));
      });
      expect(result.current.resources).toHaveLength(1);
    });

    it('does not exceed maxResources', () => {
      const { result } = renderHook(() => useReportWorkspace());
      // Fill to max
      act(() => {
        for (let i = 0; i < 20; i++) {
          result.current.addResource(makeResource(`r-${i}`));
        }
      });
      expect(result.current.resources).toHaveLength(20);

      // Attempt to add one more
      act(() => {
        result.current.addResource(makeResource('r-overflow'));
      });
      expect(result.current.resources).toHaveLength(20);
    });
  });

  describe('removeResource', () => {
    it('removes a resource by id', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        result.current.addResource(makeResource('r-1'));
        result.current.addResource(makeResource('r-2'));
      });
      act(() => {
        result.current.removeResource('r-1');
      });
      expect(result.current.resources).toHaveLength(1);
      expect(result.current.resources[0].id).toBe('r-2');
    });

    it('does not throw when removing non-existent id', () => {
      const { result } = renderHook(() => useReportWorkspace());
      expect(() => {
        act(() => {
          result.current.removeResource('non-existent');
        });
      }).not.toThrow();
    });
  });

  describe('clearAll', () => {
    it('clears resources, workspaceId, and collapses panel', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        result.current.addResource(makeResource('r-1'));
        result.current.setWorkspaceId('ws-123');
      });
      act(() => {
        result.current.clearAll();
      });
      expect(result.current.resources).toEqual([]);
      expect(result.current.workspaceId).toBeNull();
      expect(result.current.isExpanded).toBe(false);
    });
  });

  describe('toggleExpanded', () => {
    it('toggles isExpanded from false to true', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        result.current.toggleExpanded();
      });
      expect(result.current.isExpanded).toBe(true);
    });

    it('toggles isExpanded from true to false', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        result.current.addResource(makeResource('r-1')); // sets isExpanded to true
      });
      act(() => {
        result.current.toggleExpanded();
      });
      expect(result.current.isExpanded).toBe(false);
    });
  });

  describe('hasResource', () => {
    it('returns true when resource exists', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        result.current.addResource(makeResource('r-check'));
      });
      expect(result.current.hasResource('r-check')).toBe(true);
    });

    it('returns false when resource does not exist', () => {
      const { result } = renderHook(() => useReportWorkspace());
      expect(result.current.hasResource('r-missing')).toBe(false);
    });
  });

  describe('canAddMore', () => {
    it('returns true when below maxResources', () => {
      const { result } = renderHook(() => useReportWorkspace());
      expect(result.current.canAddMore()).toBe(true);
    });

    it('returns false when at maxResources', () => {
      const { result } = renderHook(() => useReportWorkspace());
      act(() => {
        for (let i = 0; i < 20; i++) {
          result.current.addResource(makeResource(`r-${i}`));
        }
      });
      expect(result.current.canAddMore()).toBe(false);
    });
  });
});
