/**
 * AI Simulation API client (visibility slice)
 *
 * 仅包含 visibility 相关调用；其余 simulation API 调用分散在 page.tsx 中直接 fetch。
 */

import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import type { ScenarioCard } from '@/app/ai-simulation/types';

const API_BASE = `${config.apiUrl}/simulation`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const text = await res.text();
      detail = text.length > 300 ? `${text.slice(0, 300)}…` : text;
    } catch {
      // ignore
    }
    throw new Error(
      `Simulation API ${res.status}: ${detail || res.statusText}`
    );
  }
  const raw = (await res.json()) as unknown;
  // Handle wrapped API response format { success, data }
  if (raw && typeof raw === 'object' && 'data' in raw) {
    const wrapper = raw as { success?: boolean; data?: unknown };
    if (wrapper.data !== undefined) return wrapper.data as T;
  }
  return raw as T;
}

export async function setVisibility(
  id: string,
  visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC'
): Promise<ScenarioCard> {
  return request<ScenarioCard>(`/scenarios/${id}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ visibility }),
  });
}
