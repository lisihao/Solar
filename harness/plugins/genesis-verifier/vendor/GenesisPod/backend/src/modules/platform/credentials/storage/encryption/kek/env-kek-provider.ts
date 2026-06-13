import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { IKekProvider } from "./kek-provider.interface";

/**
 * On-prem / dev 用 KEK provider：KEK 取自 env（客户自管，不回连厂商）。
 *
 * 多版本（轮换）：
 *  - `SETTINGS_KEK_V1`, `SETTINGS_KEK_V2`, ... 各版本 KEK（hex / base64 / 任意字符串）。
 *  - `SETTINGS_KEK_VERSION` 指定当前 wrap 用哪个版本（默认 = 已配置的最大版本，或 1）。
 *  - 未配置任何 `SETTINGS_KEK_V*` 时，从 `SETTINGS_ENCRYPTION_KEY` 派生 v1 KEK
 *    （HKDF 独立 salt），保证无额外配置的部署也能用信封加密。
 *
 * wrap 算法：AES-256-GCM，wrapped 串编码为 `iv:authTag:ciphertext`（均 hex）。
 */
export class EnvKekProvider implements IKekProvider {
  private readonly logger = new Logger(EnvKekProvider.name);
  /** version -> 32-byte KEK */
  private readonly keks = new Map<number, Buffer>();
  readonly currentVersion: number;

  constructor(config: ConfigService) {
    // 收集所有 SETTINGS_KEK_V{n}
    let maxVersion = 0;
    for (let v = 1; v <= 64; v++) {
      const raw = config.get<string>(`SETTINGS_KEK_V${v}`);
      if (raw?.trim()) {
        this.keks.set(v, this.normalizeKek(raw.trim()));
        maxVersion = Math.max(maxVersion, v);
      }
    }

    if (this.keks.size === 0) {
      // 无专用 KEK 配置：从 master key 派生 v1 KEK（HKDF 独立 salt，与 per-user 子密钥隔离）。
      const master = config.get<string>("SETTINGS_ENCRYPTION_KEY");
      if (!master) {
        const nodeEnv = config.get<string>("NODE_ENV");
        if (nodeEnv === "production") {
          throw new Error(
            "CRITICAL: no KEK configured. Set SETTINGS_KEK_V1 (or SETTINGS_ENCRYPTION_KEY) in production.",
          );
        }
        this.logger.warn(
          "No KEK configured; deriving dev-only KEK from default master key.",
        );
      }
      const ikm = crypto.pbkdf2Sync(
        master || "deepdive-dev-only-key",
        "byok-kek-salt-v1",
        100000,
        32,
        "sha256",
      );
      this.keks.set(1, ikm);
      maxVersion = 1;
    }

    const configured = config.get<string>("SETTINGS_KEK_VERSION");
    const parsed = configured ? parseInt(configured, 10) : NaN;
    this.currentVersion =
      Number.isInteger(parsed) && this.keks.has(parsed) ? parsed : maxVersion;
  }

  /** 把任意字符串 KEK 归一为 32 字节：hex(64) 直接用，否则 SHA-256。 */
  private normalizeKek(raw: string): Buffer {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, "hex");
    }
    return crypto.createHash("sha256").update(raw).digest();
  }

  private getKek(version: number): Buffer {
    const kek = this.keks.get(version);
    if (!kek) {
      throw new Error(`KEK version ${version} not available`);
    }
    return kek;
  }

  async wrap(dek: Buffer): Promise<{ wrapped: string; kekVersion: number }> {
    const kek = this.getKek(this.currentVersion);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const wrapped = `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
    return { wrapped, kekVersion: this.currentVersion };
  }

  async unwrap(wrapped: string, kekVersion: number): Promise<Buffer> {
    const kek = this.getKek(kekVersion);
    const parts = wrapped.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid wrapped DEK format");
    }
    const [ivHex, authTagHex, ciphertextHex] = parts;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      kek,
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, "hex")),
      decipher.final(),
    ]);
  }
}
