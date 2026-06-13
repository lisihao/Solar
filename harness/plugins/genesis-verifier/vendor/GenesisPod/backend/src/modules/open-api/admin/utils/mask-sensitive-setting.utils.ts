/**
 * 敏感配置脱敏（task #6 / #18 看护）
 *
 * admin getSettings 返回前调用此工具：命中 sensitive pattern 的 setting key
 * 不返 raw value，只返 { configured: boolean, hint?: 末 4 位 }。
 *
 * 历史背景：
 *   2026-05-05 第三轮审计 P0 — 原 getSettings 直接返 raw value 给 admin
 *   endpoint，含 apiKey / secret / password 等敏感字段 → 浏览器 devtools +
 *   HTTP transit 都能看到明文 → 密钥泄漏。
 */

const SENSITIVE_PATTERNS =
  /api[_-]?key|secret|token|password|credential|private[_-]?key|access[_-]?key/i;

export function maskSensitiveSetting(key: string, value: unknown): unknown {
  if (!SENSITIVE_PATTERNS.test(key)) return value;
  const raw = typeof value === "string" ? value : value ? String(value) : "";
  if (!raw) return { configured: false };
  return {
    configured: true,
    hint: raw.length > 8 ? `***${raw.slice(-4)}` : "****",
  };
}
