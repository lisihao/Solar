'use client';

/**
 * useApprovalQueue
 *
 * 轮询 /api/v1/admin/approvals/pending，每 5 秒刷新一次
 * 并提供 respond(requestId, decision) 方法。
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────

export type ApprovalType = 'confirm' | 'choose' | 'input' | 'review';

export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
}

export interface ApprovalRequest {
  requestId: string;
  approvalType: ApprovalType;
  prompt: string;
  context?: {
    summary?: string;
    details?: unknown;
    preview?: string;
  };
  choices?: ChoiceOption[];
  defaultAction?: string;
  status: 'pending';
  createdAt: string;
}

export interface RespondPayload {
  approved: boolean;
  choice?: string;
  input?: unknown;
  feedback?: string;
}

export interface UseApprovalQueueReturn {
  approvals: ApprovalRequest[];
  loading: boolean;
  error: string | null;
  responding: Set<string>;
  respond: (requestId: string, payload: RespondPayload) => Promise<void>;
  refresh: () => void;
}

// ─── Hook ─────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;
const API_BASE = '/api/v1/admin/approvals';

export function useApprovalQueue(): UseApprovalQueueReturn {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responding, setResponding] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/pending`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApprovalRequest[] = await res.json();
      setApprovals(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  // Polling
  useEffect(() => {
    fetchPending();
    timerRef.current = setInterval(fetchPending, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchPending]);

  const respond = useCallback(
    async (requestId: string, payload: RespondPayload) => {
      setResponding((prev) => new Set(prev).add(requestId));
      // Optimistically remove from list
      setApprovals((prev) => prev.filter((a) => a.requestId !== requestId));
      try {
        const res = await fetch(`${API_BASE}/${requestId}/respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        // Rollback optimistic removal — re-fetch to restore accurate state
        setError(e instanceof Error ? e.message : 'Failed to submit response');
        await fetchPending();
      } finally {
        setResponding((prev) => {
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
      }
    },
    [fetchPending]
  );

  const refresh = useCallback(() => {
    setLoading(true);
    fetchPending();
  }, [fetchPending]);

  return { approvals, loading, error, responding, respond, refresh };
}
