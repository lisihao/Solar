/**
 * Log Sanitization Utility
 *
 * Prevents sensitive data from being logged
 */

import * as crypto from "crypto";

/**
 * Sensitive field names that should be redacted in logs
 */
const SENSITIVE_FIELDS = [
  "token",
  "access_token",
  "refresh_token",
  "password",
  "secret",
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "session",
  "credential",
  "private_key",
  "private",
  "key",
  "salt",
  "hash",
  "otp",
  "pin",
  "cvv",
  "ssn",
  "ticket",
  "data_ticket",
] as const;

/**
 * Patterns that indicate sensitive data
 */
const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_]+/gi,
  /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, // JWT tokens
  /[a-f0-9]{32,}/gi, // Long hex strings (tokens, hashes)
];

/**
 * Sanitize an object for safe logging
 * Redacts sensitive field values
 */
export function sanitizeForLog(obj: unknown, depth = 0): unknown {
  // Prevent stack overflow
  if (depth > 10) {
    return "[MAX_DEPTH]";
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForLog(item, depth + 1));
  }

  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = SENSITIVE_FIELDS.some((field) =>
        lowerKey.includes(field),
      );

      if (isSensitive && typeof value === "string") {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitizeForLog(value, depth + 1);
      }
    }
    return sanitized;
  }

  return obj;
}

/**
 * Sanitize a string, redacting sensitive patterns
 */
function sanitizeString(str: string): string {
  let result = str;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Safe JSON stringify for logging
 * Sanitizes sensitive data before stringifying
 */
export function safeStringify(obj: unknown, space?: number): string {
  try {
    const sanitized = sanitizeForLog(obj);
    return JSON.stringify(sanitized, null, space);
  } catch {
    return "[UNABLE_TO_STRINGIFY]";
  }
}

/**
 * 哈希化 token 用于日志：相同 token → 相同 hash 前缀（可定位/对比），
 * 但不暴露任何明文前缀。
 *
 * 迭代 2 (Security re-audit)：之前用 slice(0,4) + "***" 会暴露 4 位明文
 * 前缀，对 9-10 位数字 token 来说就剩 ~6 位熵，可被日志攫取者用于
 * 暴力相关性攻击。改用 SHA-256 前 8 字符。
 */
export function redactToken(token: string | null | undefined): string {
  if (!token) return "(empty)";
  const h = crypto.createHash("sha256").update(token).digest("hex").slice(0, 8);
  return `***${h}`;
}

/**
 * 把 URL 里 token / access_token / ticket 等查询参数的值替换成 [REDACTED]。
 * 用于 logger 里要打调试 URL 但不想曝凭据。其他参数照旧保留方便定位。
 */
export function redactUrl(url: string): string {
  return url.replace(
    /([?&](?:access_token|token|ticket|data_ticket)=)[^&#]+/gi,
    "$1[REDACTED]",
  );
}

/**
 * Create a safe log message from response body
 */
export function sanitizeResponseBody(body: unknown): string {
  // Only include non-sensitive response fields
  if (typeof body !== "object" || body === null) {
    return String(body);
  }

  const safeFields = ["ret", "errcode", "errmsg", "err_msg", "status", "code"];
  const bodyObj = body as Record<string, unknown>;

  // Extract only safe fields
  const safeBody: Record<string, unknown> = {};
  for (const field of safeFields) {
    if (field in bodyObj) {
      safeBody[field] = bodyObj[field];
    }
    // Check nested base_resp
    if (
      "base_resp" in bodyObj &&
      typeof bodyObj.base_resp === "object" &&
      bodyObj.base_resp !== null
    ) {
      const baseResp = bodyObj.base_resp as Record<string, unknown>;
      if (field in baseResp) {
        safeBody[`base_resp.${field}`] = baseResp[field];
      }
    }
  }

  return JSON.stringify(safeBody);
}
