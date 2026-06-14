/**
 * key-resolver.errors.ts — unit tests
 * Covers: BYOKError, NoAvailableKeyError, InvalidApiKeyError, QuotaExceededError,
 *         NoModelConfiguredError, NoSystemKeyError, and BYOK_ERROR_CODES map
 */
import { HttpStatus, ForbiddenException } from "@nestjs/common";
import {
  BYOKError,
  BYOK_ERROR_CODES,
  NoAvailableKeyError,
  InvalidApiKeyError,
  QuotaExceededError,
  NoModelConfiguredError,
  NoSystemKeyError,
} from "../key-resolver.errors";

describe("BYOK_ERROR_CODES", () => {
  it("contains all expected keys", () => {
    expect(BYOK_ERROR_CODES.NO_AVAILABLE_KEY).toBe("NO_AVAILABLE_KEY");
    expect(BYOK_ERROR_CODES.NO_MODEL_CONFIGURED).toBe("NO_MODEL_CONFIGURED");
    expect(BYOK_ERROR_CODES.INVALID_API_KEY).toBe("INVALID_API_KEY");
    expect(BYOK_ERROR_CODES.QUOTA_EXCEEDED).toBe("QUOTA_EXCEEDED");
    expect(BYOK_ERROR_CODES.KEY_EXPIRED).toBe("KEY_EXPIRED");
    expect(BYOK_ERROR_CODES.DUPLICATE_REQUEST).toBe("DUPLICATE_REQUEST");
    expect(BYOK_ERROR_CODES.ASSIGNMENT_EXISTS).toBe("ASSIGNMENT_EXISTS");
    expect(BYOK_ERROR_CODES.NO_SYSTEM_KEY).toBe("NO_SYSTEM_KEY");
  });
});

describe("BYOKError", () => {
  it("extends ForbiddenException", () => {
    const err = new BYOKError("NO_AVAILABLE_KEY", "test", {
      provider: "openai",
    });
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  it("sets statusCode, code, message, and meta", () => {
    const meta = { provider: "anthropic", canRequest: true };
    const err = new BYOKError("QUOTA_EXCEEDED", "quota gone", meta);
    expect(err.code).toBe("QUOTA_EXCEEDED");
    expect(err.meta).toEqual(meta);
    const response = err.getResponse() as Record<string, unknown>;
    expect(response.statusCode).toBe(HttpStatus.FORBIDDEN);
    expect(response.code).toBe("QUOTA_EXCEEDED");
    expect(response.message).toBe("quota gone");
    expect(response.meta).toEqual(meta);
  });

  it("defaults meta to empty object", () => {
    const err = new BYOKError("KEY_EXPIRED", "key expired");
    expect(err.meta).toEqual({});
  });
});

describe("NoAvailableKeyError", () => {
  it("uses provider-specific message when provider given", () => {
    const err = new NoAvailableKeyError("openai");
    expect(err.code).toBe("NO_AVAILABLE_KEY");
    expect((err.getResponse() as Record<string, unknown>).message).toContain(
      "openai",
    );
    expect(err.meta.provider).toBe("openai");
    expect(err.meta.canRequest).toBe(true);
    expect(err.meta.requestUrl).toBe("/settings/api-keys/request");
  });

  it("uses generic message when provider is empty", () => {
    const err = new NoAvailableKeyError("");
    const response = err.getResponse() as Record<string, unknown>;
    expect(String(response.message)).toContain("No API Key configured");
  });

  it("merges extra meta", () => {
    const err = new NoAvailableKeyError("openai", { source: "PERSONAL" });
    expect(err.meta.source).toBe("PERSONAL");
  });
});

describe("InvalidApiKeyError", () => {
  it("includes provider and source in meta", () => {
    const err = new InvalidApiKeyError("xai", "ASSIGNED");
    expect(err.code).toBe("INVALID_API_KEY");
    expect(err.meta.provider).toBe("xai");
    expect(err.meta.source).toBe("ASSIGNED");
    const response = err.getResponse() as Record<string, unknown>;
    expect(String(response.message)).toContain("xai");
  });

  it("merges extra meta fields", () => {
    const err = new InvalidApiKeyError("openai", "PERSONAL", {
      canRequest: false,
    });
    expect(err.meta.canRequest).toBe(false);
  });
});

describe("QuotaExceededError", () => {
  it("sets QUOTA_EXCEEDED code", () => {
    const err = new QuotaExceededError("deepseek", "ASSIGNED");
    expect(err.code).toBe("QUOTA_EXCEEDED");
    expect(err.meta.provider).toBe("deepseek");
    expect(err.meta.source).toBe("ASSIGNED");
  });

  it("merges usedCents / limitCents into meta", () => {
    const err = new QuotaExceededError("openai", "ASSIGNED", {
      usedCents: 500,
      limitCents: 1000,
    });
    expect(err.meta.usedCents).toBe(500);
    expect(err.meta.limitCents).toBe(1000);
  });
});

describe("NoModelConfiguredError", () => {
  it("sets NO_MODEL_CONFIGURED code with modelType in message", () => {
    const err = new NoModelConfiguredError("CHAT");
    expect(err.code).toBe("NO_MODEL_CONFIGURED");
    const response = err.getResponse() as Record<string, unknown>;
    expect(String(response.message)).toContain("CHAT");
    expect(err.meta.canRequest).toBe(true);
    expect(err.meta.requestUrl).toBe("/me/ai?tab=models");
  });

  it("merges extra meta", () => {
    const err = new NoModelConfiguredError("EMBEDDING", { source: "SYSTEM" });
    expect(err.meta.source).toBe("SYSTEM");
  });
});

describe("NoSystemKeyError", () => {
  it("sets NO_SYSTEM_KEY code with provider", () => {
    const err = new NoSystemKeyError("gemini");
    expect(err.code).toBe("NO_SYSTEM_KEY");
    expect(err.meta.provider).toBe("gemini");
    const response = err.getResponse() as Record<string, unknown>;
    expect(String(response.message)).toContain("gemini");
  });
});
