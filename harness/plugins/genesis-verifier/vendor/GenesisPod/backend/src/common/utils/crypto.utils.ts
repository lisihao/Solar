/**
 * Cryptographic Utility Functions
 * 加密相关工具函数
 */

import { timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison to prevent timing attacks
 * 恒定时间字符串比较，防止时序攻击
 *
 * @param a First string to compare
 * @param b Second string to compare
 * @returns true if strings are equal, false otherwise
 */
export function safeCompare(a: string, b: string): boolean {
  // Type validation
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  // Convert to buffers
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  // If lengths differ, compare bufA with itself to maintain constant time
  // This prevents length-based timing attacks
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }

  // Use crypto.timingSafeEqual for constant-time comparison
  return timingSafeEqual(bufA, bufB);
}
