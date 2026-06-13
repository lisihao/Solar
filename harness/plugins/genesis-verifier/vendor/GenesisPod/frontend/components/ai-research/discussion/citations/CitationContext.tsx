'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from 'react';
import type {
  CitationContextValue,
  HighlightedSource,
  SourceReference,
} from './types';

const CitationContext = createContext<CitationContextValue | null>(null);

interface CitationProviderProps {
  children: React.ReactNode;
  sources: SourceReference[];
  onScrollToSource?: (sourceId: string) => void;
}

export function CitationProvider({
  children,
  sources,
  onScrollToSource,
}: CitationProviderProps) {
  const [highlightedSource, setHighlightedSource] =
    useState<HighlightedSource | null>(null);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleSetHighlightedSource = useCallback(
    (source: HighlightedSource | null) => {
      // Clear any existing timeout
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }

      setHighlightedSource(source);

      // Auto-clear highlight after 5 seconds
      if (source) {
        highlightTimeoutRef.current = setTimeout(() => {
          setHighlightedSource(null);
        }, 5000);
      }
    },
    []
  );

  const scrollToSource = useCallback(
    (sourceId: string) => {
      if (onScrollToSource) {
        onScrollToSource(sourceId);
      }
    },
    [onScrollToSource]
  );

  const value: CitationContextValue = {
    highlightedSource,
    setHighlightedSource: handleSetHighlightedSource,
    scrollToSource,
    sources,
  };

  return (
    <CitationContext.Provider value={value}>
      {children}
    </CitationContext.Provider>
  );
}

export function useCitation() {
  const context = useContext(CitationContext);
  if (!context) {
    throw new Error('useCitation must be used within a CitationProvider');
  }
  return context;
}

// Optional hook that doesn't throw if not in provider
export function useCitationOptional() {
  return useContext(CitationContext);
}
