'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

export type QuickAction = 'research' | 'write' | 'teams' | 'ask';

export interface GlobalAIBarState {
  isOpen: boolean;
  query: string;
  selectedAction: QuickAction | null;
}

export interface GlobalAIBarActions {
  open: (initialQuery?: string) => void;
  close: () => void;
  toggle: () => void;
  setQuery: (query: string) => void;
  setSelectedAction: (action: QuickAction | null) => void;
}

export function useGlobalAIBar(): GlobalAIBarState & GlobalAIBarActions {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState<QuickAction | null>(
    null
  );
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback((initialQuery = '') => {
    setQuery(initialQuery);
    setSelectedAction(null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Delay clearing query so close animation can play
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setQuery('');
      setSelectedAction(null);
    }, 200);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape' && isOpen) {
        close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [toggle, close, isOpen]);

  return {
    isOpen,
    query,
    selectedAction,
    open,
    close,
    toggle,
    setQuery,
    setSelectedAction,
  };
}

// ── Singleton ref pattern for external access (e.g., from buttons outside the bar) ──

type OpenFn = (initialQuery?: string) => void;
const openRef: { current: OpenFn | null } = { current: null };

export function registerGlobalAIBarOpen(fn: OpenFn) {
  openRef.current = fn;
}

export function openGlobalAIBar(initialQuery?: string) {
  openRef.current?.(initialQuery);
}
