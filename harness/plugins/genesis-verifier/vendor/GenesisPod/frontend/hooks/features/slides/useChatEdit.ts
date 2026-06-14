'use client';

/**
 * useChatEdit - Hook for AI chat-based slide editing
 *
 * Sends a natural-language instruction to edit a specific slide page.
 * Returns { updatedHtml, reply } on success.
 */

import { useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@/lib/utils/logger';

export interface ChatEditResult {
  success: boolean;
  updatedHtml: string;
  reply: string;
}

function getAuthHeaders(accessToken: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return headers;
}

export function useChatEdit() {
  const { accessToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useMemo(() => getAuthHeaders(accessToken), [accessToken]);

  const chatEdit = useCallback(
    async (
      sessionId: string,
      pageIndex: number,
      instruction: string
    ): Promise<ChatEditResult | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/ai-office/slides/sessions/${sessionId}/chat-edit`,
          {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ instruction, pageIndex }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new Error(errorText || 'Chat edit failed');
        }

        const result = await response.json();
        // NestJS interceptor wraps as { data: ... }; controller also wraps as { data: result }
        // so the path may be result.data.data — fall back to result.data if .data.data is absent
        const data = result.data?.data ?? result.data;
        return data as ChatEditResult;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Chat edit failed';
        logger.error('[useChatEdit] error:', err);
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [authHeaders]
  );

  return { chatEdit, loading, error };
}
