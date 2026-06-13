'use client';

import { useCallback, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { config } from '@/lib/utils/config';
import { logger } from '@/lib/utils/logger';
import type { SelfDrivenMissionEvent } from '@/lib/api/self-driven-stream';

/** Minimal user-bubble shape; structurally assignable to the host Message type. */
interface SelfDrivenUserMessage {
  id: string;
  role: 'user';
  content: string;
  createdAt: string;
}

interface UseSelfDrivenChatOptions {
  /** Append a user bubble; the host maps it into its own message list. */
  appendUser: (msg: SelfDrivenUserMessage) => void;
}

/** Durable event envelope (socket emit + /replay row share this shape). */
interface RawEvent {
  type: string;
  payload: unknown;
  timestamp: number;
}

const SELF_DRIVEN_NAMESPACE = '/self-driven';
const POLL_INTERVAL_MS = 4000;
const HANDSHAKE_FAILSAFE_MS = 8000;

/** Unwrap the backend's standard { success, data } response envelope. */
function unwrap<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    const wrapper = raw as { data?: unknown };
    if (wrapper.data && typeof wrapper.data === 'object') {
      return wrapper.data as T;
    }
  }
  return raw as T;
}

/**
 * Self-Driven Team chat hook — durable, connection-decoupled.
 *
 * Replaces the old long-held SSE fetch (which the HTTP/2 edge reset during the
 * 10-min HITL gate). Flow: POST /run returns a missionId immediately; we hydrate
 * history from GET /replay, then subscribe to the `self-driven` Socket.IO room
 * for live events. On (re)connect / refresh we gap-fill via /replay?since=cursor
 * and dedupe by (type,timestamp). Each durable envelope carries the original
 * SelfDrivenMissionEvent as its payload, which is what the UI renders.
 */
export function useSelfDrivenChat({ appendUser }: UseSelfDrivenChatOptions) {
  const [events, setEvents] = useState<SelfDrivenMissionEvent[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const lastTsRef = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef<(() => void) | null>(null);

  const teardown = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (failsafeRef.current) {
      clearTimeout(failsafeRef.current);
      failsafeRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    teardown();
    doneRef.current?.();
    doneRef.current = null;
    seenRef.current = new Set();
    lastTsRef.current = 0;
    setEvents([]);
  }, [teardown]);

  /** Merge durable envelopes: dedupe, advance cursor, unwrap payload, stop on terminal. */
  const ingest = useCallback(
    (raw: readonly RawEvent[]) => {
      const fresh: SelfDrivenMissionEvent[] = [];
      let terminal = false;
      for (const r of raw) {
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
          if (ev.type === 'done' || ev.type === 'error') terminal = true;
        }
      }
      if (fresh.length) setEvents((prev) => [...prev, ...fresh]);
      if (terminal) {
        teardown();
        doneRef.current?.();
        doneRef.current = null;
      }
    },
    [teardown]
  );

  const replay = useCallback(
    async (missionId: string, token: string, since: number) => {
      if (!missionId) return;
      try {
        const qs = since > 0 ? `?since=${since}` : '';
        const res = await fetch(
          `${config.apiUrl}/ask/self-driven/replay/${encodeURIComponent(
            missionId
          )}${qs}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return;
        const data = unwrap<{ events?: RawEvent[] }>(await res.json());
        if (Array.isArray(data.events)) ingest(data.events);
      } catch (err) {
        logger.warn('[SelfDriven] replay failed:', err);
      }
    },
    [ingest]
  );

  const run = useCallback(
    async (args: {
      prompt: string;
      token: string;
      signal: AbortSignal;
      analysisDepth?: 'quick' | 'standard' | 'deep';
      /** BCP-47 locale ('zh' | 'en') — threads through to every step's system prompt. */
      language?: string;
    }) => {
      const { prompt, token, signal, analysisDepth, language } = args;
      reset();
      appendUser({
        id: 'temp-user-' + Date.now(),
        role: 'user',
        content: prompt,
        createdAt: new Date().toISOString(),
      });

      // 1. Fire-and-forget launch → missionId (connection released immediately).
      let missionId: string;
      try {
        const res = await fetch(`${config.apiUrl}/ask/self-driven/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ prompt, analysisDepth, language }),
          signal,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          ingest([
            {
              type: 'self-driven.error',
              payload: {
                type: 'error',
                missionId: '',
                message: body.message ?? `HTTP ${res.status}`,
              },
              timestamp: Date.now(),
            },
          ]);
          return;
        }
        const data = unwrap<{ missionId?: string }>(await res.json());
        if (!data.missionId) {
          throw new Error('launch did not return a missionId');
        }
        missionId = data.missionId;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        ingest([
          {
            type: 'self-driven.error',
            payload: {
              type: 'error',
              missionId: '',
              message: err instanceof Error ? err.message : 'Network error',
            },
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      // 2. Hydrate any events already journaled before the socket connects.
      await replay(missionId, token, 0);

      // 3. Live subscription. Resolve run() only when the mission terminates or
      //    the caller aborts, so the host keeps its loading state meaningful.
      await new Promise<void>((resolve) => {
        doneRef.current = resolve;

        const startPolling = () => {
          if (pollRef.current) return;
          pollRef.current = setInterval(() => {
            void replay(missionId, token, lastTsRef.current);
          }, POLL_INTERVAL_MS);
        };

        const socket = io(`${config.getBackendUrl()}${SELF_DRIVEN_NAMESPACE}`, {
          transports: ['polling', 'websocket'],
          auth: { token },
          reconnectionAttempts: 8,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10000,
          timeout: 12000,
          withCredentials: true,
        });
        socketRef.current = socket;

        failsafeRef.current = setTimeout(() => {
          if (!socket.connected) startPolling();
        }, HANDSHAKE_FAILSAFE_MS);

        socket.on('connect', () => {
          socket.emit(
            'join',
            { missionId },
            (ack: { ok: boolean; error?: string }) => {
              if (ack && ack.ok === false) {
                logger.warn(`[SelfDriven] join rejected: ${ack.error}`);
                startPolling();
              }
            }
          );
          // Cover the hydrate→join gap and any reconnect catch-up.
          void replay(missionId, token, lastTsRef.current);
        });

        socket.onAny((_name: string, envelope: RawEvent) => {
          if (envelope && typeof envelope.type === 'string') ingest([envelope]);
        });

        signal.addEventListener(
          'abort',
          () => {
            teardown();
            resolve();
          },
          { once: true }
        );
      });
    },
    [reset, appendUser, replay, ingest, teardown]
  );

  return { events, reset, run };
}
