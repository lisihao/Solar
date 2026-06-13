/**
 * 安全配置
 *
 * 集中管理应用安全相关配置
 */

/**
 * 敏感数据字段（日志中需要脱敏）
 */
export const SENSITIVE_FIELDS = [
  "password",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "authorization",
  "cookie",
  "creditCard",
  "credit_card",
  "ssn",
  "socialSecurityNumber",
] as const;

/**
 * 需要跳过限流的路径（内部健康检查等）
 */
export const RATE_LIMIT_SKIP_PATHS = [
  "/health",
  "/api/v1/health",
  "/favicon.ico",
  "/api/v1/metrics",
] as const;

/**
 * 安全响应头配置
 */
export const SECURITY_HEADERS = {
  // 防止点击劫持
  "X-Frame-Options": "SAMEORIGIN",
  // 防止 MIME 类型嗅探
  "X-Content-Type-Options": "nosniff",
  // 启用 XSS 过滤
  "X-XSS-Protection": "1; mode=block",
  // 限制 Referrer 信息
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // 禁止 DNS 预取
  "X-DNS-Prefetch-Control": "off",
} as const;

/**
 * 密码策略
 */
export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: false,
} as const;

/**
 * JWT 配置
 */
export const JWT_CONFIG = {
  // Token 过期时间（秒）
  accessTokenExpiry: 60 * 60, // 1 hour
  refreshTokenExpiry: 7 * 24 * 60 * 60, // 7 days
  // 最大并发会话数
  maxConcurrentSessions: 5,
} as const;

/**
 * 敏感数据脱敏
 */
export function maskSensitiveData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const masked = { ...data };

  for (const key of Object.keys(masked)) {
    const lowerKey = key.toLowerCase();
    if (
      SENSITIVE_FIELDS.some((field) => lowerKey.includes(field.toLowerCase()))
    ) {
      const value = masked[key];
      if (typeof value === "string") {
        masked[key] = value.length > 4 ? `***${value.slice(-4)}` : "***";
      } else {
        masked[key] = "***";
      }
    } else if (typeof masked[key] === "object" && masked[key] !== null) {
      masked[key] = maskSensitiveData(masked[key] as Record<string, unknown>);
    }
  }

  return masked;
}

/**
 * 验证密码强度
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < PASSWORD_POLICY.minLength) {
    errors.push(
      `Password must be at least ${PASSWORD_POLICY.minLength} characters`,
    );
  }

  if (password.length > PASSWORD_POLICY.maxLength) {
    errors.push(
      `Password must be at most ${PASSWORD_POLICY.maxLength} characters`,
    );
  }

  if (PASSWORD_POLICY.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (PASSWORD_POLICY.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }

  if (PASSWORD_POLICY.requireNumbers && !/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  if (
    PASSWORD_POLICY.requireSpecialChars &&
    !/[!@#$%^&*(),.?":{}|<>]/.test(password)
  ) {
    errors.push("Password must contain at least one special character");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 安全检查结果
 */
export interface SecurityCheckResult {
  check: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

/**
 * 运行安全检查
 */
export function runSecurityChecks(): SecurityCheckResult[] {
  const results: SecurityCheckResult[] = [];

  // 检查 JWT_SECRET
  const jwtSecret = process.env.JWT_SECRET || "";
  if (!jwtSecret) {
    results.push({
      check: "JWT_SECRET",
      status: "fail",
      message: "JWT_SECRET is not configured",
    });
  } else if (jwtSecret.length < 32) {
    results.push({
      check: "JWT_SECRET",
      status: "warn",
      message: "JWT_SECRET should be at least 32 characters",
    });
  } else {
    results.push({
      check: "JWT_SECRET",
      status: "pass",
      message: "JWT_SECRET is properly configured",
    });
  }

  // 检查 NODE_ENV
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "production") {
    results.push({
      check: "NODE_ENV",
      status: "pass",
      message: "Running in production mode",
    });
  } else {
    results.push({
      check: "NODE_ENV",
      status: "warn",
      message: `Running in ${nodeEnv || "development"} mode`,
    });
  }

  // 检查 HTTPS
  const frontendUrl = process.env.FRONTEND_URL || "";
  if (frontendUrl.startsWith("https://")) {
    results.push({
      check: "HTTPS",
      status: "pass",
      message: "Frontend URL uses HTTPS",
    });
  } else if (frontendUrl.startsWith("http://localhost") || !frontendUrl) {
    results.push({
      check: "HTTPS",
      status: "warn",
      message: "HTTPS not configured (acceptable for development)",
    });
  } else {
    results.push({
      check: "HTTPS",
      status: "fail",
      message: "Frontend URL should use HTTPS in production",
    });
  }

  // 检查数据库加密
  const databaseUrl = process.env.DATABASE_URL || "";
  if (databaseUrl.includes("sslmode=require")) {
    results.push({
      check: "Database SSL",
      status: "pass",
      message: "Database connection uses SSL",
    });
  } else if (databaseUrl.includes("railway.app")) {
    results.push({
      check: "Database SSL",
      status: "pass",
      message: "Railway database (SSL enabled by default)",
    });
  } else {
    results.push({
      check: "Database SSL",
      status: "warn",
      message: "Database SSL mode not explicitly configured",
    });
  }

  return results;
}
