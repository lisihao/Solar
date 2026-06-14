/**
 * Session Data Encryption Utility
 *
 * Provides AES-256-GCM encryption for sensitive session data
 * to protect cookies and tokens stored in the database
 */

import * as crypto from "crypto";
import { Logger } from "@nestjs/common";

const logger = new Logger("SessionCrypto");

// Algorithm configuration
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

// Module-level cached key (set via initSessionCrypto from ConfigService)
let cachedKeyHex: string | undefined;

/**
 * Encrypted data structure
 */
interface EncryptedData {
  /** Initialization vector (hex) */
  iv: string;
  /** Encrypted content (hex) */
  data: string;
  /** Authentication tag (hex) */
  tag: string;
  /** Encryption version for future upgrades */
  version: number;
}

/**
 * Initialize encryption key from ConfigService (call once in module onModuleInit).
 * This avoids direct process.env access at runtime.
 */
export function initSessionCrypto(keyHex: string): void {
  cachedKeyHex = keyHex;
}

/**
 * Get encryption key from cached value, passed parameter, or environment fallback.
 * Key should be 32 bytes (64 hex characters) for AES-256
 *
 * @param keyHex - Optional key hex string override
 */
function getEncryptionKey(keyHex?: string): Buffer {
  keyHex = keyHex || cachedKeyHex || process.env.SESSION_ENCRYPTION_KEY;

  if (!keyHex) {
    // S4 audit fix（2026-05-04）：删除硬编码 dev fallback。
    // dev/test 必须显式设置 SESSION_ENCRYPTION_KEY (可用 generateKey() 生成)。
    // 这避免任何环境下的密钥可预测性 + 防止 dev 环境数据被任意人解密。
    throw new Error(
      "SESSION_ENCRYPTION_KEY environment variable is required (use generateKey() to create one)",
    );
  }

  // Validate key length
  if (keyHex.length !== 64) {
    throw new Error(
      `SESSION_ENCRYPTION_KEY must be 64 hex characters (32 bytes), got ${keyHex.length}`,
    );
  }

  // Validate hex format
  if (!/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new Error("SESSION_ENCRYPTION_KEY must be a valid hex string");
  }

  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypt session data using AES-256-GCM
 *
 * @param data - Plain text data to encrypt (usually JSON string)
 * @param keyHex - Optional encryption key hex string (from ConfigService). Falls back to env var.
 * @returns Encrypted data as JSON string
 */
export function encryptSessionData(data: string, keyHex?: string): string {
  try {
    const key = getEncryptionKey(keyHex);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    const encryptedData: EncryptedData = {
      iv: iv.toString("hex"),
      data: encrypted,
      tag: authTag.toString("hex"),
      version: 1,
    };

    return JSON.stringify(encryptedData);
  } catch (error) {
    logger.error(`Encryption failed: ${(error as Error).message}`);
    throw new Error("Failed to encrypt session data");
  }
}

/**
 * Decrypt session data using AES-256-GCM
 *
 * @param encryptedJson - Encrypted data as JSON string
 * @param keyHex - Optional encryption key hex string (from ConfigService). Falls back to env var.
 * @returns Decrypted plain text data
 */
export function decryptSessionData(
  encryptedJson: string,
  keyHex?: string,
): string {
  try {
    const encryptedData: EncryptedData = JSON.parse(encryptedJson);

    // Version check for future upgrades
    if (encryptedData.version !== 1) {
      throw new Error(
        `Unsupported encryption version: ${encryptedData.version}`,
      );
    }

    const key = getEncryptionKey(keyHex);
    const iv = Buffer.from(encryptedData.iv, "hex");
    const authTag = Buffer.from(encryptedData.tag, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData.data, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    const err = error as Error;
    // Check if it's a decryption failure vs parsing failure
    if (err.message.includes("Unsupported") || err.message.includes("auth")) {
      logger.error(`Decryption failed: ${err.message}`);
      throw new Error("Failed to decrypt session data - key may have changed");
    }
    // Might be unencrypted legacy data
    throw error;
  }
}

/**
 * Check if data is encrypted (has the expected structure)
 */
export function isEncrypted(data: string): boolean {
  try {
    const parsed = JSON.parse(data);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "iv" in parsed &&
      "data" in parsed &&
      "tag" in parsed &&
      "version" in parsed
    );
  } catch {
    return false;
  }
}

/**
 * Encrypt session data with automatic JSON serialization
 */
export function encryptSession<T>(sessionData: T, keyHex?: string): string {
  const jsonData = JSON.stringify(sessionData);
  return encryptSessionData(jsonData, keyHex);
}

/**
 * Decrypt session data with automatic JSON parsing
 * Handles legacy unencrypted data gracefully
 */
export function decryptSession<T>(encryptedData: string, keyHex?: string): T {
  // Check if data is encrypted
  if (isEncrypted(encryptedData)) {
    const decrypted = decryptSessionData(encryptedData, keyHex);
    return JSON.parse(decrypted) as T;
  }

  // Legacy unencrypted data - parse directly
  // Log warning for migration tracking
  logger.warn("Found unencrypted session data - consider migrating");
  return JSON.parse(encryptedData) as T;
}

/**
 * Generate a new encryption key (for initial setup)
 * Run: npx ts-node -e "require('./session-crypto').generateKey()"
 */
export function generateKey(): string {
  const key = crypto.randomBytes(KEY_LENGTH);
  const keyHex = key.toString("hex");
  logger.log("Generated SESSION_ENCRYPTION_KEY:");
  logger.log(keyHex);
  logger.log("Add to your .env file:");
  logger.log(`SESSION_ENCRYPTION_KEY=${keyHex}`);
  return keyHex;
}
