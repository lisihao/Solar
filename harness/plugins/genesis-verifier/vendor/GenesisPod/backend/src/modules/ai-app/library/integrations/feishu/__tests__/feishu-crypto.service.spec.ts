import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { FeishuCryptoService } from "../feishu-crypto.service";

describe("FeishuCryptoService", () => {
  let service: FeishuCryptoService;
  let configService: jest.Mocked<ConfigService>;

  const mockEncryptKey = "test-encrypt-key-1234567890";
  const mockVerificationToken = "test-verification-token";

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeishuCryptoService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: string) => {
              if (key === "FEISHU_ENCRYPT_KEY") return mockEncryptKey;
              if (key === "FEISHU_VERIFICATION_TOKEN")
                return mockVerificationToken;
              return defaultVal ?? "";
            }),
          },
        },
      ],
    }).compile();

    service = module.get<FeishuCryptoService>(FeishuCryptoService);
    configService = module.get(ConfigService);
  });

  describe("getVerificationToken", () => {
    it("should return the verification token", () => {
      expect(service.getVerificationToken()).toBe(mockVerificationToken);
    });
  });

  describe("isConfigured", () => {
    it("should return true when verification token is set", () => {
      expect(service.isConfigured()).toBe(true);
    });

    it("should return false when verification token is empty", () => {
      (configService.get as jest.Mock).mockImplementation(
        (key: string, defaultVal?: string) => {
          if (key === "FEISHU_VERIFICATION_TOKEN") return "";
          if (key === "FEISHU_ENCRYPT_KEY") return mockEncryptKey;
          return defaultVal ?? "";
        },
      );
      const newService = new FeishuCryptoService(
        configService as unknown as ConfigService,
      );
      expect(newService.isConfigured()).toBe(false);
    });
  });

  describe("isEncryptionConfigured", () => {
    it("should return true when encrypt key is set", () => {
      expect(service.isEncryptionConfigured()).toBe(true);
    });

    it("should return false when encrypt key is empty", () => {
      (configService.get as jest.Mock).mockImplementation(
        (key: string, defaultVal?: string) => {
          if (key === "FEISHU_ENCRYPT_KEY") return "";
          if (key === "FEISHU_VERIFICATION_TOKEN") return mockVerificationToken;
          return defaultVal ?? "";
        },
      );
      const newService = new FeishuCryptoService(
        configService as unknown as ConfigService,
      );
      expect(newService.isEncryptionConfigured()).toBe(false);
    });
  });

  describe("verifySignature", () => {
    it("should return true for a valid signature", () => {
      const timestamp = "1609459200";
      const nonce = "test-nonce";
      const body = '{"test":"data"}';

      const content = timestamp + nonce + mockEncryptKey + body;
      const expectedSignature = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");

      const result = service.verifySignature(
        timestamp,
        nonce,
        expectedSignature,
        body,
      );
      expect(result).toBe(true);
    });

    it("should return false for an invalid signature", () => {
      const result = service.verifySignature(
        "1609459200",
        "test-nonce",
        "invalid-signature",
        '{"test":"data"}',
      );
      expect(result).toBe(false);
    });

    it("should return true when encrypt key is not configured (skip verification)", () => {
      (configService.get as jest.Mock).mockImplementation(
        (key: string, defaultVal?: string) => {
          if (key === "FEISHU_ENCRYPT_KEY") return "";
          if (key === "FEISHU_VERIFICATION_TOKEN") return mockVerificationToken;
          return defaultVal ?? "";
        },
      );
      const newService = new FeishuCryptoService(
        configService as unknown as ConfigService,
      );
      const result = newService.verifySignature(
        "timestamp",
        "nonce",
        "any-signature",
        "body",
      );
      expect(result).toBe(true);
    });
  });

  describe("decrypt", () => {
    it("should throw when encrypt key is not configured", () => {
      (configService.get as jest.Mock).mockImplementation(
        (key: string, defaultVal?: string) => {
          if (key === "FEISHU_ENCRYPT_KEY") return "";
          return defaultVal ?? "";
        },
      );
      const newService = new FeishuCryptoService(
        configService as unknown as ConfigService,
      );
      expect(() => newService.decrypt("some-content")).toThrow(
        "FEISHU_ENCRYPT_KEY not configured",
      );
    });

    it("should throw for invalid encrypted content", () => {
      expect(() => service.decrypt("invalid-base64-content")).toThrow(
        "Failed to decrypt Feishu event",
      );
    });

    it("should decrypt valid encrypted content", () => {
      // Build a valid encrypted payload: IV (16 bytes) + AES-256-CBC ciphertext
      const keyBuffer = crypto
        .createHash("sha256")
        .update(mockEncryptKey)
        .digest();
      const iv = crypto.randomBytes(16);
      const plaintext = '{"type":"test","data":"hello"}';

      const cipher = crypto.createCipheriv("aes-256-cbc", keyBuffer, iv);
      let encrypted = cipher.update(plaintext, "utf8");
      encrypted = Buffer.concat([encrypted, cipher.final()]);

      // Prepend IV to encrypted data and base64 encode
      const combined = Buffer.concat([iv, encrypted]);
      const encryptedContent = combined.toString("base64");

      const decrypted = service.decrypt(encryptedContent);
      expect(decrypted).toBe(plaintext);
    });
  });
});
