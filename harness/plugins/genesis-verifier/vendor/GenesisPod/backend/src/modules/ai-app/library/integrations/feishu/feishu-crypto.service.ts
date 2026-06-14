/**
 * Feishu Crypto Service
 * Handles event subscription decryption and signature verification
 * Docs: https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";

@Injectable()
export class FeishuCryptoService {
  private readonly logger = new Logger(FeishuCryptoService.name);

  private encryptKey: string;
  private verificationToken: string;

  constructor(private configService: ConfigService) {
    this.encryptKey = this.configService.get("FEISHU_ENCRYPT_KEY", "");
    this.verificationToken = this.configService.get(
      "FEISHU_VERIFICATION_TOKEN",
      "",
    );
  }

  /**
   * Verify request signature (v2 event subscription)
   * signature = sha256(timestamp + nonce + encrypt_key + body)
   */
  verifySignature(
    timestamp: string,
    nonce: string,
    signature: string,
    body: string,
  ): boolean {
    if (!this.encryptKey) {
      this.logger.warn(
        "FEISHU_ENCRYPT_KEY not configured, skipping signature verification",
      );
      return true;
    }

    const content = timestamp + nonce + this.encryptKey + body;
    const expectedSignature = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");

    return expectedSignature === signature;
  }

  /**
   * Decrypt encrypted event payload
   * Uses AES-256-CBC with key derived from SHA256(encrypt_key)
   */
  decrypt(encryptedContent: string): string {
    if (!this.encryptKey) {
      throw new Error(
        "FEISHU_ENCRYPT_KEY not configured, cannot decrypt events",
      );
    }

    try {
      const encryptedBuffer = Buffer.from(encryptedContent, "base64");

      // Key = SHA256(encrypt_key)
      const keyBuffer = crypto
        .createHash("sha256")
        .update(this.encryptKey)
        .digest();

      // IV = first 16 bytes of encrypted content
      const iv = encryptedBuffer.subarray(0, 16);
      const ciphertext = encryptedBuffer.subarray(16);

      const decipher = crypto.createDecipheriv("aes-256-cbc", keyBuffer, iv);
      let decrypted = decipher.update(ciphertext, undefined, "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      this.logger.error(`Feishu decrypt error: ${error}`);
      throw new Error("Failed to decrypt Feishu event");
    }
  }

  /**
   * Get the verification token for challenge validation
   */
  getVerificationToken(): string {
    return this.verificationToken;
  }

  /**
   * Check if encryption is configured
   */
  isEncryptionConfigured(): boolean {
    return !!this.encryptKey;
  }

  /**
   * Check if basic verification is configured
   */
  isConfigured(): boolean {
    return !!this.verificationToken;
  }
}
