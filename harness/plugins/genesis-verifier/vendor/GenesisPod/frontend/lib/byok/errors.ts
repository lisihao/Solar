import type { ApiError } from '@/lib/api/client';

export const BYOK_ERROR_CODES = {
  NO_AVAILABLE_KEY: 'NO_AVAILABLE_KEY',
  NO_MODEL_CONFIGURED: 'NO_MODEL_CONFIGURED',
  INVALID_API_KEY: 'INVALID_API_KEY',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  KEY_EXPIRED: 'KEY_EXPIRED',
  NO_SYSTEM_KEY: 'NO_SYSTEM_KEY',
} as const;

export type ByokErrorCode = keyof typeof BYOK_ERROR_CODES;

export interface ByokErrorMeta {
  provider?: string;
  source?: 'PERSONAL' | 'ASSIGNED' | 'SYSTEM';
  canRequest?: boolean;
  requestUrl?: string;
  usedCents?: number;
  limitCents?: number;
  /** 直接来自 provider（如 OpenAI）的错误说明；用于向用户展示真实原因 */
  providerMessage?: string;
  /** NO_MODEL_CONFIGURED：用户缺哪个类型的模型 */
  modelType?: string;
  status?: number;
}

export interface ByokErrorPayload {
  code: ByokErrorCode;
  message: string;
  meta: ByokErrorMeta;
}

/**
 * 从后端返回的错误对象里解析 BYOK 错误。后端统一通过 ForbiddenException
 * 携带 { code, message, meta }，前端 apiClient 会把 details 透传过来。
 */
export function parseByokError(error: unknown): ByokErrorPayload | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as ApiError & { details?: Record<string, unknown> };
  const code = e.code;
  if (!code || !(code in BYOK_ERROR_CODES)) return null;
  const details = e.details ?? {};
  const meta = (details.meta as ByokErrorMeta) ?? {};
  return {
    code: code as ByokErrorCode,
    message: e.message ?? code,
    meta,
  };
}

export function formatUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}
