/**
 * Tests for session-crypto.ts
 * Uses direct import with a valid test key to avoid env var complexity.
 */

describe("session-crypto", () => {
  const VALID_KEY = "a".repeat(64); // 64 hex chars = valid 32-byte AES key

  beforeEach(() => {
    process.env.SESSION_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    process.env.SESSION_ENCRYPTION_KEY = VALID_KEY; // restore valid key after each test
  });

  describe("encryptSessionData / decryptSessionData", () => {
    it("should encrypt and decrypt data successfully", () => {
      const {
        encryptSessionData,
        decryptSessionData,
      } = require("../mission/services/session-crypto");

      const original = "Hello, World!";
      const encrypted = encryptSessionData(original);

      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe("string");

      // Should be JSON with iv, data, tag, version
      const parsed = JSON.parse(encrypted);
      expect(parsed.iv).toBeDefined();
      expect(parsed.data).toBeDefined();
      expect(parsed.tag).toBeDefined();
      expect(parsed.version).toBe(1);

      const decrypted = decryptSessionData(encrypted);
      expect(decrypted).toBe(original);
    });

    it("should produce different ciphertext for the same input (random IV)", () => {
      const {
        encryptSessionData,
      } = require("../mission/services/session-crypto");

      const data = "same input";
      const enc1 = encryptSessionData(data);
      const enc2 = encryptSessionData(data);

      // Due to random IV, encrypted values should differ
      expect(enc1).not.toBe(enc2);
    });

    it("should throw on unsupported version", () => {
      const {
        decryptSessionData,
      } = require("../mission/services/session-crypto");

      const fakeEncrypted = JSON.stringify({
        iv: "0".repeat(32),
        data: "fake",
        tag: "0".repeat(32),
        version: 99,
      });

      expect(() => decryptSessionData(fakeEncrypted)).toThrow();
    });

    it("should encrypt complex objects as JSON strings", () => {
      const {
        encryptSessionData,
        decryptSessionData,
      } = require("../mission/services/session-crypto");

      const complexData = JSON.stringify({
        cookies: [{ name: "session", value: "abc" }],
        token: "xyz",
      });
      const encrypted = encryptSessionData(complexData);
      const decrypted = decryptSessionData(encrypted);
      expect(decrypted).toBe(complexData);
    });

    it("should handle unicode content", () => {
      const {
        encryptSessionData,
        decryptSessionData,
      } = require("../mission/services/session-crypto");

      const unicode = "中文内容 🎉 日本語";
      const encrypted = encryptSessionData(unicode);
      const decrypted = decryptSessionData(encrypted);
      expect(decrypted).toBe(unicode);
    });
  });

  describe("isEncrypted", () => {
    it("should return true for properly encrypted data", () => {
      const {
        encryptSessionData,
        isEncrypted,
      } = require("../mission/services/session-crypto");

      const encrypted = encryptSessionData("test");
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it("should return false for plain JSON string", () => {
      const { isEncrypted } = require("../mission/services/session-crypto");

      const plain = JSON.stringify({ name: "John" });
      expect(isEncrypted(plain)).toBe(false);
    });

    it("should return false for non-JSON string", () => {
      const { isEncrypted } = require("../mission/services/session-crypto");

      expect(isEncrypted("not json at all")).toBe(false);
    });

    it("should return false for partial encrypted structure (missing tag)", () => {
      const { isEncrypted } = require("../mission/services/session-crypto");

      // Missing 'tag' field
      const partial = JSON.stringify({ iv: "abc", data: "def", version: 1 });
      expect(isEncrypted(partial)).toBe(false);
    });

    it("should return false for partial encrypted structure (missing version)", () => {
      const { isEncrypted } = require("../mission/services/session-crypto");

      const partial = JSON.stringify({ iv: "abc", data: "def", tag: "ghi" });
      expect(isEncrypted(partial)).toBe(false);
    });

    it("should return false for null JSON", () => {
      const { isEncrypted } = require("../mission/services/session-crypto");
      expect(isEncrypted("null")).toBe(false);
    });
  });

  describe("encryptSession / decryptSession", () => {
    it("should encrypt and decrypt objects", () => {
      const {
        encryptSession,
        decryptSession,
      } = require("../mission/services/session-crypto");

      const sessionData = { cookies: [{ name: "session", value: "abc123" }] };
      const encrypted = encryptSession(sessionData);
      const decrypted = decryptSession<typeof sessionData>(encrypted);

      expect(decrypted.cookies).toHaveLength(1);
      expect(decrypted.cookies[0].name).toBe("session");
    });

    it("should handle legacy unencrypted data in decryptSession", () => {
      const { decryptSession } = require("../mission/services/session-crypto");

      const legacy = JSON.stringify({ cookies: [], token: "old-format" });
      const result = decryptSession<{ cookies: unknown[]; token: string }>(
        legacy,
      );

      expect(result.token).toBe("old-format");
    });

    it("should encrypt nested objects correctly", () => {
      const {
        encryptSession,
        decryptSession,
      } = require("../mission/services/session-crypto");

      const data = {
        cookies: [
          {
            name: "a",
            value: "b",
            domain: "example.com",
            path: "/",
            expires: 0,
            httpOnly: false,
            secure: false,
          },
        ],
        localStorage: { key: "value" },
        sessionStorage: {},
        wechatToken: "token-123",
      };

      const encrypted = encryptSession(data);
      const decrypted = decryptSession<typeof data>(encrypted);

      expect(decrypted.wechatToken).toBe("token-123");
      expect(decrypted.localStorage).toEqual({ key: "value" });
    });
  });

  describe("generateKey", () => {
    it("should generate a 64 character hex key", () => {
      const { generateKey } = require("../mission/services/session-crypto");

      const key = generateKey();
      expect(key).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(key)).toBe(true);
    });

    it("should generate unique keys each time", () => {
      const { generateKey } = require("../mission/services/session-crypto");

      const key1 = generateKey();
      const key2 = generateKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe("key validation", () => {
    it("should throw when key is not 64 hex chars (too short)", () => {
      process.env.SESSION_ENCRYPTION_KEY = "tooshort";
      // Need to force re-evaluation of the env var - directly test getEncryptionKey behavior
      const {
        encryptSessionData,
      } = require("../mission/services/session-crypto");
      // The module-level key is evaluated per call to getEncryptionKey() which reads env each time
      expect(() => encryptSessionData("data")).toThrow();
    });

    it("should throw when key contains non-hex characters", () => {
      process.env.SESSION_ENCRYPTION_KEY = "z".repeat(64); // z is not valid hex
      const {
        encryptSessionData,
      } = require("../mission/services/session-crypto");
      expect(() => encryptSessionData("data")).toThrow();
    });
  });
});
