import { ConfigService } from "@nestjs/config";
import { InternalServerErrorException, Logger } from "@nestjs/common";
import { EncryptionService } from "../encryption.service";

const buildConfig = (env: Record<string, string | undefined>): ConfigService =>
  ({
    get: (key: string) => env[key],
  }) as unknown as ConfigService;

describe("EncryptionService", () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  describe("constructor", () => {
    it("throws in production when SETTINGS_ENCRYPTION_KEY missing", () => {
      expect(
        () => new EncryptionService(buildConfig({ NODE_ENV: "production" })),
      ).toThrow(InternalServerErrorException);
    });

    it("uses dev fallback key in test/dev", () => {
      expect(
        () => new EncryptionService(buildConfig({ NODE_ENV: "test" })),
      ).not.toThrow();
    });
  });

  describe("encrypt/decrypt roundtrip", () => {
    const svc = new EncryptionService(
      buildConfig({
        NODE_ENV: "test",
        SETTINGS_ENCRYPTION_KEY: "unit-test-master-key",
      }),
    );

    it("decrypts what it encrypts", () => {
      const { encryptedValue, iv } = svc.encrypt("sk-secret-value");
      expect(svc.decrypt(encryptedValue, iv)).toBe("sk-secret-value");
    });

    it("different IVs produce different ciphertexts", () => {
      const a = svc.encrypt("same-plaintext");
      const b = svc.encrypt("same-plaintext");
      expect(a.iv).not.toBe(b.iv);
      expect(a.encryptedValue).not.toBe(b.encryptedValue);
    });

    it("returns null for invalid ciphertext", () => {
      expect(svc.decrypt("not-hex", "bad-iv")).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(svc.decrypt("", "")).toBeNull();
    });
  });

  describe("encryptForUser/decryptForUser — HKDF per-user 子密钥", () => {
    const svc = new EncryptionService(
      buildConfig({
        NODE_ENV: "test",
        SETTINGS_ENCRYPTION_KEY: "unit-test-master-key",
      }),
    );

    it("roundtrips with the same userId", () => {
      const { encryptedValue, iv } = svc.encryptForUser("sk-user-a", "user-a");
      expect(encryptedValue).not.toContain("sk-user-a");
      expect(svc.decryptForUser(encryptedValue, iv, "user-a")).toBe(
        "sk-user-a",
      );
    });

    it("isolates users: user B cannot decrypt user A's ciphertext", () => {
      const { encryptedValue, iv } = svc.encryptForUser("sk-user-a", "user-a");
      expect(svc.decryptForUser(encryptedValue, iv, "user-b")).toBeNull();
    });

    it("user subkey differs from admin key (admin decrypt fails)", () => {
      const { encryptedValue, iv } = svc.encryptForUser("sk-user-a", "user-a");
      expect(svc.decrypt(encryptedValue, iv)).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(svc.decryptForUser("", "", "user-a")).toBeNull();
    });
  });

  describe("decryptLegacy", () => {
    const svc = new EncryptionService(
      buildConfig({
        NODE_ENV: "test",
        SETTINGS_ENCRYPTION_KEY: "unit-test-master-key",
      }),
    );

    it("handles the colon-separated legacy format", () => {
      // produce ciphertext with the current key + synthesize legacy format
      const { encryptedValue, iv } = svc.encrypt("legacy-secret");
      const legacy = `${iv}:${encryptedValue}`;
      expect(svc.decryptLegacy(legacy)).toBe("legacy-secret");
    });

    it("returns input unchanged when not in legacy format", () => {
      expect(svc.decryptLegacy("no-colon-here")).toBe("no-colon-here");
    });

    it("returns null for null input", () => {
      expect(svc.decryptLegacy(null)).toBeNull();
    });
  });

  describe("hashValue", () => {
    const svc = new EncryptionService(
      buildConfig({
        NODE_ENV: "test",
        SETTINGS_ENCRYPTION_KEY: "unit-test-master-key",
      }),
    );

    it("produces stable sha256 hex output", () => {
      const hash = svc.hashValue("hello");
      expect(hash).toHaveLength(64);
      expect(hash).toBe(svc.hashValue("hello"));
    });
  });

  describe("createKeyHint", () => {
    const svc = new EncryptionService(
      buildConfig({
        NODE_ENV: "test",
        SETTINGS_ENCRYPTION_KEY: "unit-test-master-key",
      }),
    );

    it("masks long keys with prefix+suffix", () => {
      expect(svc.createKeyHint("sk-abcdef1234567890")).toBe("sk-...7890");
    });

    it("returns *** for very short input", () => {
      expect(svc.createKeyHint("abc")).toBe("***");
    });

    it("returns *** for empty", () => {
      expect(svc.createKeyHint("")).toBe("***");
    });
  });

  describe("encryptEnvelope/decryptEnvelope — AES-256-GCM + KEK (v2)", () => {
    const svc = new EncryptionService(
      buildConfig({
        NODE_ENV: "test",
        SETTINGS_ENCRYPTION_KEY: "unit-test-master-key",
      }),
    );

    it("roundtrips and tags row as encVersion=2", async () => {
      const row = await svc.encryptEnvelope("sk-envelope-secret");
      expect(row.encVersion).toBe(2);
      expect(row.encryptedValue).not.toContain("sk-envelope-secret");
      expect(row.authTag).toMatch(/^[0-9a-f]{32}$/);
      expect(await svc.decryptEnvelope(row)).toBe("sk-envelope-secret");
    });

    it("uses a fresh random 12-byte iv each call", async () => {
      const a = await svc.encryptEnvelope("same");
      const b = await svc.encryptEnvelope("same");
      expect(a.iv).toMatch(/^[0-9a-f]{24}$/);
      expect(a.iv).not.toBe(b.iv);
      expect(a.encryptedValue).not.toBe(b.encryptedValue);
      expect(a.wrappedDek).not.toBe(b.wrappedDek);
    });

    it("fails (returns null) when authTag is tampered", async () => {
      const row = await svc.encryptEnvelope("sk-tamper");
      const flipped = row.authTag.startsWith("0")
        ? "1" + row.authTag.slice(1)
        : "0" + row.authTag.slice(1);
      expect(
        await svc.decryptEnvelope({ ...row, authTag: flipped }),
      ).toBeNull();
    });

    it("fails (returns null) when ciphertext is tampered", async () => {
      const row = await svc.encryptEnvelope("sk-tamper-ct");
      const flipped = row.encryptedValue.startsWith("0")
        ? "1" + row.encryptedValue.slice(1)
        : "0" + row.encryptedValue.slice(1);
      expect(
        await svc.decryptEnvelope({ ...row, encryptedValue: flipped }),
      ).toBeNull();
    });

    it("returns null when v2 columns are missing", async () => {
      expect(
        await svc.decryptEnvelope({ encryptedValue: "x", iv: "y" }),
      ).toBeNull();
    });
  });

  describe("decryptAny — dual-read dispatch", () => {
    const svc = new EncryptionService(
      buildConfig({
        NODE_ENV: "test",
        SETTINGS_ENCRYPTION_KEY: "unit-test-master-key",
      }),
    );

    it("dispatches v2 rows to the envelope path", async () => {
      const row = await svc.encryptEnvelope("v2-secret");
      expect(await svc.decryptAny(row)).toBe("v2-secret");
    });

    it("dispatches v1 master rows to decrypt()", async () => {
      const { encryptedValue, iv } = svc.encrypt("v1-master");
      expect(await svc.decryptAny({ encryptedValue, iv })).toBe("v1-master");
    });

    it("dispatches v1 per-user rows to decryptForUser() via opts.userId", async () => {
      const { encryptedValue, iv } = svc.encryptForUser("v1-user", "user-x");
      expect(
        await svc.decryptAny({ encryptedValue, iv }, { userId: "user-x" }),
      ).toBe("v1-user");
    });

    it("dispatches legacy combined rows via opts.legacyCombined", async () => {
      const { encryptedValue, iv } = svc.encrypt("legacy-combined");
      const combined = `${iv}:${encryptedValue}`;
      expect(
        await svc.decryptAny(
          { encryptedValue: combined, iv: "" },
          { legacyCombined: true },
        ),
      ).toBe("legacy-combined");
    });
  });
});
