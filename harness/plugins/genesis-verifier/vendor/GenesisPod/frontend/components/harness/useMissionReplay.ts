'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import type { SelfDrivenMissionEvent } from '@/lib/api/self-driven-stream';

/** Durable event envelope shape shared by /replay and the socket bus. */
interface RawReplayEvent {
  type: string;
  payload: unknown;
  timestamp: number;
}

/** Unwrap the backend { success, data } envelope. */
function unwrap<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    const w = raw as { data?: unknown };
    if (w.data && typeof w.data === 'object') return w.data as T;
  }
  return raw as T;
}

const TERMINAL_TYPES = new Set(['done', 'error']);
const POLL_INTERVAL_MS = 3000;

export interface UseMissionReplayResult {
  events: SelfDrivenMissionEvent[];
  isStreaming: boolean;
  error: string | null;
  load: (missionId: string) => void;
  clear: () => void;
}

/**
 * Admin-side replay hook.
 *
 * Given a missionId it polls GET /ask/self-driven/replay/{id}?since={ts}
 * every 3 s, accumulates and dedupes SelfDrivenMissionEvent[], and stops
 * automatically once a `done` or `error` event is received.
 *
 * Auth: uses getAuthHeader() (same pattern as KernelScheduler / KernelProcesses).
 */
export function useMissionReplay(): UseMissionReplayResult {
  const [events, setEvents] = useState<SelfDrivenMissionEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missionIdRef = useRef<string>('');
  const seenRef = useRef<Set<string>>(new Set());
  const lastTsRef = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const terminalRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    stopPolling();
    missionIdRef.current = '';
    seenRef.current = new Set();
    lastTsRef.current = 0;
    terminalRef.current = false;
    setEvents([]);
    setIsStreaming(false);
    setError(null);
  }, [stopPolling]);

  /** Fetch one page of replay events and merge them. Returns true if terminal. */
  const fetchOnce = useCallback(async (): Promise<boolean> => {
    const missionId = missionIdRef.current;
    if (!missionId) return false;

    const since = lastTsRef.current;
    const qs = since > 0 ? `?since=${since}` : '';

    try {
      const res = await fetch(
        `${config.apiUrl}/ask/self-driven/replay/${encodeURIComponent(missionId)}${qs}`,
        { headers: getAuthHeader() }
      );
      if (!res.ok) {
        setError(`Replay fetch failed: HTTP ${res.status}`);
        return false;
      }

      const raw = await res.json();
      const data = unwrap<{ events?: RawReplayEvent[] }>(raw);
      if (!Array.isArray(data.events)) return false;

      const fresh: SelfDrivenMissionEvent[] = [];
      let terminal = false;

      for (const r of data.events) {
        if (!r || typeof r.type !== 'string') continue;

        let payloadKey = '';
        try {
          payloadKey = JSON.stringify(r.payload);
        } catch {
          payloadKey = String(r.payload);
        }
        const key = `${r.type}|${r.timestamp}|${payloadKey.slice(0, 120)}`;
        if (seenRef.current.has(key)) continue;
        seenRef.current.add(key);

        if (
          typeof r.timestamp === 'number' &&
          r.timestamp > lastTsRef.current
        ) {
          lastTsRef.current = r.timestamp;
        }

        const ev = r.payload as SelfDrivenMissionEvent | undefined;
        if (ev && typeof ev.type === 'string') {
          fresh.push(ev);
          if (TERMINAL_TYPES.has(ev.type)) terminal = true;
        }
      }

      if (fresh.length) {
        setEvents((prev) => [...prev, ...fresh]);
      }

      return terminal;
    } catch (err) {
      logger.warn('[useMissionReplay] fetch failed:', err);
      return false;
    }
  }, []);

  const load = useCallback(
    (missionId: string) => {
      if (!missionId.trim()) return;

      // Reset state for a fresh load.
      stopPolling();
      missionIdRef.current = missionId.trim();
      seenRef.current = new Set();
      lastTsRef.current = 0;
      terminalRef.current = false;
      setEvents([]);
      setError(null);
      setIsStreaming(true);

      // Initial fetch, then start polling unless already terminal.
      void (async () => {
        const done = await fetchOnce();
        if (done) {
          terminalRef.current = true;
          setIsStreaming(false);
          return;
        }

        pollRef.current = setInterval(async () => {
          if (terminalRef.current) {
            stopPolling();
            return;
          }
          const finished = await fetchOnce();
          if (finished) {
            terminalRef.current = true;
            setIsStreaming(false);
            stopPolling();
          }
        }, POLL_INTERVAL_MS);
      })();
    },
    [fetchOnce, stopPolling]
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return { events, isStreaming, error, load, clear };
}
