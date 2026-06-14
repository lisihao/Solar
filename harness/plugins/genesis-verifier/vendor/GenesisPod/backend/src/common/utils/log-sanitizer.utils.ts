/**
 * Log Sanitization Utility
 *
 * Prevents sensitive data from being logged
 */

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
  "connection_string",
  "database_url",
  "redis_url",
] as const;

/**
 * Patterns that indicate sensitive data
 */
const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_]+/gi,
  /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, // JWT tokens
  /[a-f0-9]{32,}/gi, // Long hex strings (tokens, hashes)
  /postgres:\/\/[^\s]+/gi, // PostgreSQL connection strings
  /redis:\/\/[^\s]+/gi, // Redis connection strings
  /mongodb:\/\/[^\s]+/gi, // MongoDB connection strings
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

/**
 * Sanitize error messages that may contain sensitive information
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeString(error.message);
  }
  if (typeof error === "string") {
    return sanitizeString(error);
  }
  return "[UNKNOWN_ERROR]";
}
