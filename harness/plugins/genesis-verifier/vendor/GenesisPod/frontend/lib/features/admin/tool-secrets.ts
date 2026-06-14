'use client';

/**
 * Tool drawer secret suggestion hook —— APIServicesTable / BuiltinToolsTable
 * 共享真源，避免双源（feedback_no_dual_sources）。
 *
 * 2026-05-12 三轮迭代后的最终方案：
 *  1) backend DB 里所有 secret 实际 category="AI_MODEL"（seed 时硬编码），
 *     按 SecretCategory 过滤不靠谱
 *  2) 改按"名称模式 + toolId 双过滤":
 *     - 第一闸：name 看起来像 API credential（含 _api_key / _token / _key 等）
 *     - 第二闸：name 含 toolId token（serper 抽屉 → serper_api_key）
 *     - 双重 fallback：toolId 不匹配时退到全部 credential；credential 一个
 *       不匹配时退到全部 name
 *  3) 排除明显的平台基建密钥（db_ / redis_ / jwt_ / session_ 等）
 *  4) 截顶 MAX_SUGGESTIONS=30 避免下拉太长（用户："不要过多"）
 *  5) hook 返回 { names, loading } 让 UI 显示加载态
 */
import { useEffect, useState } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';

const CREDENTIAL_NAME_PATTERN =
  /(_api_key|_apikey|api[-_]?key|_key$|_token|_secret$)/i;

const INFRA_NAME_PATTERN =
  /^(db_|redis_|pg_|postgres_|database_|mongo_|jwt_|session_|cookie_|csrf_|encryption_|signing_|hmac_)/i;

const MAX_SUGGESTIONS = 30;

function looksLikeApiCredential(name: string): boolean {
  if (INFRA_NAME_PATTERN.test(name)) return false;
  return CREDENTIAL_NAME_PATTERN.test(name);
}

function unwrapNames(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as { data?: unknown };
  const arr = Array.isArray(r.data)
    ? r.data
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  return arr.filter((n): n is string => typeof n === 'string');
}

/**
 * 双闸过滤 + 排序 + 截顶：
 *  1) 先滤"看起来像 API credential"的 name（排除 DB/JWT 等基建密钥）；若全 0
 *     退回原始全集
 *  2) 在 credential pool 内按 toolId token 命中加分；matched 优先
 *  3) matched 为 0 时展示 credential pool 全集（按字母）
 *  4) 截顶 MAX_SUGGESTIONS
 */
function filterAndSort(allNames: string[], toolId: string): string[] {
  const credentials = allNames.filter(looksLikeApiCredential);
  const pool = credentials.length > 0 ? credentials : allNames;
  const tokens = toolId
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return [...pool].sort().slice(0, MAX_SUGGESTIONS);
  const score = (n: string): number => {
    const lc = n.toLowerCase();
    let s = 0;
    for (const t of tokens) if (lc.includes(t)) s += 10;
    return s;
  };
  const matched = pool.filter((n) => score(n) > 0);
  const result =
    matched.length > 0
      ? matched.sort((a, b) => {
          const diff = score(b) - score(a);
          if (diff !== 0) return diff;
          return a.localeCompare(b);
        })
      : [...pool].sort();
  return result.slice(0, MAX_SUGGESTIONS);
}

export function useToolSecretSuggestions(toolId: string | undefined): {
  names: string[];
  loading: boolean;
} {
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!toolId) {
      setNames([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`${config.apiUrl}/admin/secrets/names`, {
          headers: getAuthHeader(),
        });
        if (!res.ok) {
          logger.error(
            `[useToolSecretSuggestions] HTTP ${res.status} ${res.statusText}`
          );
          return;
        }
        const raw = await res.json();
        const all = unwrapNames(raw);
        if (!cancelled) setNames(filterAndSort(all, toolId));
      } catch (e) {
        logger.error('[useToolSecretSuggestions] load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toolId]);

  return { names, loading };
}
