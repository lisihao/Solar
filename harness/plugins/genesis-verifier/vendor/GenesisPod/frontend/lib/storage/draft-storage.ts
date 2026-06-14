/**
 * Draft Storage Service
 *
 * Manages local storage of draft content with automatic expiration
 * Supports CRUD operations and automatic cleanup of expired drafts
 */

import { logger } from '@/lib/utils/logger';

/**
 * Draft data structure
 */
export interface DraftData {
  id: string;
  title: string;
  content: string;
  digest: string;
  tags: string[];
  coverImage: string;
  platform: string;
  sourceType: string;
  sourceId?: string;
  externalUrl?: string;
  savedAt: number; // Unix timestamp
  expiresAt: number; // Unix timestamp
}

/**
 * Draft storage configuration
 */
const DRAFT_CONFIG = {
  STORAGE_KEY_PREFIX: 'ai-social-draft-',
  EXPIRY_DAYS: 7,
  MAX_DRAFTS: 10, // Keep only the most recent N drafts
} as const;

/**
 * Generate storage key for a draft
 */
function getDraftKey(draftId: string): string {
  return `${DRAFT_CONFIG.STORAGE_KEY_PREFIX}${draftId}`;
}

/**
 * Generate draft ID based on platform and source
 */
export function generateDraftId(
  platform: string,
  sourceType: string,
  sourceId?: string
): string {
  const parts = [platform, sourceType];
  if (sourceId) {
    parts.push(sourceId);
  }
  return parts.join('-');
}

/**
 * Calculate expiration timestamp
 */
function getExpiryTimestamp(): number {
  return Date.now() + DRAFT_CONFIG.EXPIRY_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Check if browser supports localStorage
 */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save draft to localStorage
 */
export function saveDraft(
  data: Omit<DraftData, 'savedAt' | 'expiresAt'>
): boolean {
  if (!isLocalStorageAvailable()) {
    logger.warn('localStorage is not available, cannot save draft');
    return false;
  }

  try {
    const now = Date.now();
    const draft: DraftData = {
      ...data,
      savedAt: now,
      expiresAt: getExpiryTimestamp(),
    };

    const key = getDraftKey(draft.id);
    localStorage.setItem(key, JSON.stringify(draft));

    logger.debug('Draft saved:', draft.id);

    // Cleanup old drafts
    cleanupExpiredDrafts();
    limitDraftCount();

    return true;
  } catch (error) {
    logger.error('Failed to save draft:', error);
    return false;
  }
}

/**
 * Load draft from localStorage
 */
export function loadDraft(draftId: string): DraftData | null {
  if (!isLocalStorageAvailable()) {
    return null;
  }

  try {
    const key = getDraftKey(draftId);
    const stored = localStorage.getItem(key);

    if (!stored) {
      return null;
    }

    const draft = JSON.parse(stored) as DraftData;

    // Check if draft has expired
    if (draft.expiresAt && draft.expiresAt < Date.now()) {
      logger.debug('Draft expired, removing:', draftId);
      deleteDraft(draftId);
      return null;
    }

    return draft;
  } catch (error) {
    logger.error('Failed to load draft:', error);
    return null;
  }
}

/**
 * Delete draft from localStorage
 */
export function deleteDraft(draftId: string): boolean {
  if (!isLocalStorageAvailable()) {
    return false;
  }

  try {
    const key = getDraftKey(draftId);
    localStorage.removeItem(key);
    logger.debug('Draft deleted:', draftId);
    return true;
  } catch (error) {
    logger.error('Failed to delete draft:', error);
    return false;
  }
}

/**
 * Get all drafts from localStorage
 */
export function getAllDrafts(): DraftData[] {
  if (!isLocalStorageAvailable()) {
    return [];
  }

  const drafts: DraftData[] = [];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DRAFT_CONFIG.STORAGE_KEY_PREFIX)) {
        const stored = localStorage.getItem(key);
        if (stored) {
          try {
            const draft = JSON.parse(stored) as DraftData;
            drafts.push(draft);
          } catch {
            // Invalid JSON, skip it
            continue;
          }
        }
      }
    }

    // Sort by savedAt descending (newest first)
    drafts.sort((a, b) => b.savedAt - a.savedAt);

    return drafts;
  } catch (error) {
    logger.error('Failed to get all drafts:', error);
    return [];
  }
}

/**
 * Clean up expired drafts
 */
export function cleanupExpiredDrafts(): number {
  if (!isLocalStorageAvailable()) {
    return 0;
  }

  const now = Date.now();
  let removedCount = 0;

  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DRAFT_CONFIG.STORAGE_KEY_PREFIX)) {
        keys.push(key);
      }
    }

    keys.forEach((key) => {
      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          const draft = JSON.parse(stored) as DraftData;
          if (draft.expiresAt && draft.expiresAt < now) {
            localStorage.removeItem(key);
            removedCount++;
          }
        } catch {
          // Invalid JSON, remove it
          localStorage.removeItem(key);
          removedCount++;
        }
      }
    });

    if (removedCount > 0) {
      logger.debug(`Cleaned up ${removedCount} expired drafts`);
    }

    return removedCount;
  } catch (error) {
    logger.error('Failed to cleanup expired drafts:', error);
    return 0;
  }
}

/**
 * Limit the number of drafts to prevent localStorage overflow
 */
export function limitDraftCount(): number {
  if (!isLocalStorageAvailable()) {
    return 0;
  }

  try {
    const drafts = getAllDrafts();

    if (drafts.length <= DRAFT_CONFIG.MAX_DRAFTS) {
      return 0;
    }

    // Remove oldest drafts
    const toRemove = drafts.slice(DRAFT_CONFIG.MAX_DRAFTS);
    let removedCount = 0;

    toRemove.forEach((draft) => {
      if (deleteDraft(draft.id)) {
        removedCount++;
      }
    });

    if (removedCount > 0) {
      logger.debug(`Removed ${removedCount} old drafts to maintain limit`);
    }

    return removedCount;
  } catch (error) {
    logger.error('Failed to limit draft count:', error);
    return 0;
  }
}

/**
 * Clear all drafts from localStorage
 */
export function clearAllDrafts(): boolean {
  if (!isLocalStorageAvailable()) {
    return false;
  }

  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DRAFT_CONFIG.STORAGE_KEY_PREFIX)) {
        keys.push(key);
      }
    }

    keys.forEach((key) => localStorage.removeItem(key));

    logger.debug(`Cleared ${keys.length} drafts`);
    return true;
  } catch (error) {
    logger.error('Failed to clear all drafts:', error);
    return false;
  }
}
