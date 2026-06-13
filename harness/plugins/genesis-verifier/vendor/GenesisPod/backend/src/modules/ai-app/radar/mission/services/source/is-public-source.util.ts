import type { RadarSourceType } from "@prisma/client";

export interface IsPublicSourceInput {
  type: RadarSourceType;
  identifier: string;
  config?: Record<string, unknown> | null;
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

/**
 * Determines whether a RadarSource is publicly accessible (no auth, no private network).
 *
 * Rules:
 * - X / YOUTUBE: always public (public accounts by definition)
 * - RSS / CUSTOM: public only if the URL has no credentials, no private-IP host,
 *   and no auth-related config keys (Authorization header, Cookie, apiKey, bearerToken)
 * - Unknown types: conservatively public (true)
 */
export function isPublicSource(input: IsPublicSourceInput): boolean {
  const { type, identifier, config } = input;

  if (type === "X" || type === "YOUTUBE") return true;

  if (type === "RSS" || type === "CUSTOM") {
    let url: URL;
    try {
      url = new URL(identifier);
    } catch {
      // URL parse failure — conservatively treat as private
      return false;
    }
    if (url.username || url.password) return false;
    if (PRIVATE_HOST_PATTERNS.some((re) => re.test(url.hostname))) return false;
    const headers = (config?.headers ?? {}) as Record<string, string>;
    if (headers.Authorization || headers.Cookie) return false;
    if (config?.apiKey || config?.bearerToken) return false;
    return true;
  }

  return true;
}
