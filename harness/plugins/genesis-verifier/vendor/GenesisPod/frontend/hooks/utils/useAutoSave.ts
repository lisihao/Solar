/**
 * useAutoSave Hook
 *
 * Provides automatic saving functionality with debouncing
 * Supports manual save, clear, and recovery detection
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  saveDraft,
  loadDraft,
  deleteDraft,
  type DraftData,
} from '@/lib/storage/draft-storage';
import { logger } from '@/lib/utils/logger';

export interface AutoSaveData {
  title: string;
  content: string;
  digest: string;
  tags: string[];
  coverImage: string;
}

export interface AutoSaveOptions {
  draftId: string;
  platform: string;
  sourceType: string;
  sourceId?: string;
  externalUrl?: string;
  debounceMs?: number;
  enabled?: boolean;
  onDraftDetected?: (draft: DraftData) => void;
}

export interface AutoSaveReturn {
  isSaving: boolean;
  lastSaved: Date | null;
  hasDraft: boolean;
  save: () => void;
  clear: () => void;
  loadExistingDraft: () => DraftData | null;
}

/**
 * Hook for auto-saving draft content
 */
export function useAutoSave(
  data: AutoSaveData,
  options: AutoSaveOptions
): AutoSaveReturn {
  const {
    draftId,
    platform,
    sourceType,
    sourceId,
    externalUrl,
    debounceMs = 2000,
    enabled = true,
    onDraftDetected,
  } = options;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasDraft, setHasDraft] = useState(false);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previousDataRef = useRef<string>('');
  const hasCheckedForDraftRef = useRef(false);

  /**
   * Save draft to localStorage
   */
  const saveDraftData = useCallback(() => {
    if (!enabled) return;

    setIsSaving(true);

    try {
      const success = saveDraft({
        id: draftId,
        title: data.title,
        content: data.content,
        digest: data.digest,
        tags: data.tags,
        coverImage: data.coverImage,
        platform,
        sourceType,
        sourceId,
        externalUrl,
      });

      if (success) {
        setLastSaved(new Date());
        setHasDraft(true);
        logger.debug('Draft auto-saved:', draftId);
      }
    } catch (error) {
      logger.error('Failed to auto-save draft:', error);
    } finally {
      setIsSaving(false);
    }
  }, [enabled, draftId, data, platform, sourceType, sourceId, externalUrl]);

  /**
   * Manual save (no debounce)
   */
  const save = useCallback(() => {
    // Clear any pending debounced save
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    saveDraftData();
  }, [saveDraftData]);

  /**
   * Clear draft from localStorage
   */
  const clear = useCallback(() => {
    // Clear any pending debounced save
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const success = deleteDraft(draftId);
    if (success) {
      setHasDraft(false);
      setLastSaved(null);
      logger.debug('Draft cleared:', draftId);
    }
  }, [draftId]);

  /**
   * Load existing draft
   */
  const loadExistingDraft = useCallback((): DraftData | null => {
    const draft = loadDraft(draftId);
    if (draft) {
      setHasDraft(true);
      setLastSaved(new Date(draft.savedAt));
    }
    return draft;
  }, [draftId]);

  /**
   * Check for existing draft on mount
   */
  useEffect(() => {
    if (!enabled || hasCheckedForDraftRef.current) return;

    hasCheckedForDraftRef.current = true;

    const existingDraft = loadDraft(draftId);
    if (existingDraft) {
      setHasDraft(true);
      setLastSaved(new Date(existingDraft.savedAt));

      // Notify parent component
      if (onDraftDetected) {
        onDraftDetected(existingDraft);
      }

      logger.debug('Existing draft detected:', draftId);
    }
  }, [enabled, draftId, onDraftDetected]);

  /**
   * Auto-save when data changes (with debouncing)
   */
  useEffect(() => {
    if (!enabled) return;

    // Serialize data for comparison
    const currentData = JSON.stringify(data);

    // Skip if data hasn't changed
    if (currentData === previousDataRef.current) {
      return;
    }

    // Skip if all fields are empty (no need to save empty draft)
    const isEmpty =
      !data.title.trim() &&
      !data.content.trim() &&
      !data.digest.trim() &&
      data.tags.length === 0 &&
      !data.coverImage.trim();

    if (isEmpty) {
      return;
    }

    previousDataRef.current = currentData;

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounced save
    debounceTimerRef.current = setTimeout(() => {
      saveDraftData();
      debounceTimerRef.current = null;
    }, debounceMs);

    // Cleanup on unmount
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [enabled, data, debounceMs, saveDraftData]);

  return {
    isSaving,
    lastSaved,
    hasDraft,
    save,
    clear,
    loadExistingDraft,
  };
}
