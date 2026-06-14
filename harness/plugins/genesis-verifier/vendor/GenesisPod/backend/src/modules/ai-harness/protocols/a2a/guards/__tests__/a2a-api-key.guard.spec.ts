/**
 * A2AApiKeyGuard Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  Logger,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { A2AApiKeyGuard } from "../a2a-api-key.guard";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
// IS_PUBLIC_KEY used internally by Reflector in guard

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// Mock safeCompare so we control timing-safe comparison
jest.mock("@/common/utils/crypto.utils", () => ({
  safeCompare: jest.fn(),
}));

import { safeCompare } from "@/common/utils/crypto.utils";

const mockSafeCompare = safeCompare as jest.MockedFunction<typeof safeCompare>;

// Helper to build a mock ExecutionContext
function _buildMockContext(
  headers: Record<string, string | string[] | undefined> = {},
  isPublic = false,
): ExecutionContext {
  const mockRequest = { headers, a2aApiKeyId: undefined as string | undefined };

  const mockReflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  };

  const mockContext = {
    switchToHttp: () => ({
      getRequest: () => mockRequest,
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
    // expose the mock reflector so tests can inspect
    _reflector: mockReflector,
    _request: mockRequest,
  } as unknown as ExecutionContext;

  return mockContext;
}

describe("A2AApiKeyGuard", () => {
  let guard: A2AApiKeyGuard;
  let secretsService: jest.Mocked<SecretsService>;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        A2AApiKeyGuard,
        {
          provide: SecretsService,
          useValue: {
            getSecretNames: jest.fn(),
            getValueInternal: jest.fn(),
          },
        },
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<A2AApiKeyGuard>(A2AApiKeyGuard);
    secretsService = module.get(SecretsService);
    reflector = module.get(Reflector);
  });

  afterEach(() => jest.clearAllMocks());

  // Helper that builds a real execution context using the injected reflector
  function buildContext(
    headers: Record<string, string | string[] | undefined>,
  ): ExecutionContext {
    const mockRequest = {
      headers,
      a2aApiKeyId: undefined as string | undefined,
    };
    return {
      switchToHttp: () => ({ getRequest: () => mockRequest }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  // ===================== Public routes =====================

  describe("public routes", () => {
    it("allows access when route is marked @Public()", async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const context = buildContext({});

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(secretsService.getSecretNames).not.toHaveBeenCalled();
    });
  });

  // ===================== Missing key =====================

  describe("missing API key", () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue(false);
    });

    it("throws UnauthorizedException when no authorization header and no x-api-key header", async () => {
      const context = buildContext({});

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        "API key required",
      );
    });

    it("throws UnauthorizedException when authorization header has no Bearer token", async () => {
      const context = buildContext({ authorization: "Basic abc123" });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("throws UnauthorizedException when headers are empty strings", async () => {
      const context = buildContext({ "x-api-key": "" });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ===================== Valid key - Bearer =====================

  describe("Bearer token authentication", () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue(false);
    });

    it("accepts valid API key from Bearer authorization header", async () => {
      const validKey = "valid-api-key-123";
      secretsService.getSecretNames.mockResolvedValue(["my-key"]);
      secretsService.getValueInternal.mockResolvedValue(validKey);
      mockSafeCompare.mockReturnValue(true);

      const context = buildContext({
        authorization: `Bearer ${validKey}`,
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(secretsService.getSecretNames).toHaveBeenCalledWith("MCP");
    });

    it("rejects invalid Bearer token", async () => {
      secretsService.getSecretNames.mockResolvedValue(["my-key"]);
      secretsService.getValueInternal.mockResolvedValue("correct-key");
      mockSafeCompare.mockReturnValue(false);

      const context = buildContext({ authorization: "Bearer wrong-key" });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        "Invalid API key",
      );
    });

    it("extracts Bearer token correctly (strips 'Bearer ' prefix)", async () => {
      const validKey = "my-secret-key";
      secretsService.getSecretNames.mockResolvedValue(["k1"]);
      secretsService.getValueInternal.mockResolvedValue(validKey);
      mockSafeCompare.mockImplementation(
        (stored, provided) => stored === provided,
      );

      const context = buildContext({
        authorization: `Bearer ${validKey}`,
      });

      await guard.canActivate(context);

      expect(mockSafeCompare).toHaveBeenCalledWith(validKey, validKey);
    });

    it("handles array Authorization header (takes first value)", async () => {
      const validKey = "array-bearer-key";
      secretsService.getSecretNames.mockResolvedValue(["k1"]);
      secretsService.getValueInternal.mockResolvedValue(validKey);
      mockSafeCompare.mockReturnValue(true);

      const context = buildContext({
        authorization: [`Bearer ${validKey}`, "Bearer other-key"],
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  // ===================== Valid key - X-API-Key =====================

  describe("X-API-Key header authentication", () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue(false);
    });

    it("accepts valid API key from X-API-Key header", async () => {
      const validKey = "x-api-key-value-789";
      secretsService.getSecretNames.mockResolvedValue(["key-name"]);
      secretsService.getValueInternal.mockResolvedValue(validKey);
      mockSafeCompare.mockReturnValue(true);

      const context = buildContext({ "x-api-key": validKey });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it("rejects invalid X-API-Key", async () => {
      secretsService.getSecretNames.mockResolvedValue(["key-name"]);
      secretsService.getValueInternal.mockResolvedValue("correct-value");
      mockSafeCompare.mockReturnValue(false);

      const context = buildContext({ "x-api-key": "wrong-value" });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("handles array X-API-Key header (takes first value)", async () => {
      const validKey = "array-x-api-key";
      secretsService.getSecretNames.mockResolvedValue(["k"]);
      secretsService.getValueInternal.mockResolvedValue(validKey);
      mockSafeCompare.mockReturnValue(true);

      const context = buildContext({
        "x-api-key": [validKey, "other-key"],
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  // ===================== Multiple keys =====================

  describe("multiple stored keys", () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue(false);
    });

    it("validates against all stored keys and accepts on first match", async () => {
      const targetKey = "key-two";
      secretsService.getSecretNames.mockResolvedValue([
        "key-one",
        "key-two",
        "key-three",
      ]);
      secretsService.getValueInternal
        .mockResolvedValueOnce("value-one")
        .mockResolvedValueOnce("value-two")
        .mockResolvedValueOnce("value-three");

      // Only match on second key
      mockSafeCompare.mockReturnValueOnce(false).mockReturnValueOnce(true);

      const context = buildContext({ "x-api-key": targetKey });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it("rejects when key matches none of the stored keys", async () => {
      secretsService.getSecretNames.mockResolvedValue(["k1", "k2"]);
      secretsService.getValueInternal
        .mockResolvedValueOnce("stored-1")
        .mockResolvedValueOnce("stored-2");
      mockSafeCompare.mockReturnValue(false);

      const context = buildContext({ "x-api-key": "no-match" });

      await expect(guard.canActivate(context)).rejects.toThrow(
        "Invalid API key",
      );
    });

    it("skips keys where stored value is null/undefined", async () => {
      secretsService.getSecretNames.mockResolvedValue(["k1", "k2"]);
      secretsService.getValueInternal
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("valid-value");
      mockSafeCompare.mockReturnValue(true);

      const context = buildContext({ "x-api-key": "valid-value" });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it("sets request.a2aApiKeyId on successful validation", async () => {
      const keyName = "my-validated-key";
      secretsService.getSecretNames.mockResolvedValue([keyName]);
      secretsService.getValueInternal.mockResolvedValue("secret");
      mockSafeCompare.mockReturnValue(true);

      const mockRequest = {
        headers: { "x-api-key": "secret" },
        a2aApiKeyId: undefined as string | undefined,
      };
      const context = {
        switchToHttp: () => ({ getRequest: () => mockRequest }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      await guard.canActivate(context);

      expect(mockRequest.a2aApiKeyId).toBe(keyName);
    });
  });

  // ===================== Empty stored keys =====================

  describe("empty stored keys list", () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue(false);
    });

    it("throws UnauthorizedException when no keys are stored", async () => {
      secretsService.getSecretNames.mockResolvedValue([]);
      mockSafeCompare.mockReturnValue(false);

      const context = buildContext({ "x-api-key": "any-key" });

      await expect(guard.canActivate(context)).rejects.toThrow(
        "Invalid API key",
      );
    });
  });

  // ===================== SecretsService errors =====================

  describe("SecretsService errors", () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue(false);
    });

    it("throws UnauthorizedException when SecretsService.getSecretNames throws", async () => {
      secretsService.getSecretNames.mockRejectedValue(new Error("DB error"));

      const context = buildContext({ "x-api-key": "any-key" });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        "API key validation failed",
      );
    });

    it("throws UnauthorizedException when getValueInternal throws", async () => {
      secretsService.getSecretNames.mockResolvedValue(["k1"]);
      secretsService.getValueInternal.mockRejectedValue(
        new Error("Decryption failed"),
      );

      const context = buildContext({ "x-api-key": "some-key" });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("re-throws UnauthorizedException directly without wrapping", async () => {
      // If we throw UnauthorizedException inside the try block, it should propagate
      secretsService.getSecretNames.mockResolvedValue(["k1"]);
      secretsService.getValueInternal.mockResolvedValue("stored");
      mockSafeCompare.mockReturnValue(false);

      const context = buildContext({ "x-api-key": "wrong" });

      let thrownError: unknown;
      try {
        await guard.canActivate(context);
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(UnauthorizedException);
    });
  });

  // ===================== extractApiKey edge cases =====================

  describe("extractApiKey edge cases", () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue(false);
    });

    it("returns null and throws when authorization header is undefined", async () => {
      const context = buildContext({ authorization: undefined });

      await expect(guard.canActivate(context)).rejects.toThrow(
        "API key required",
      );
    });

    it("treats non-Bearer authorization header as missing key", async () => {
      // authorization header is set but not Bearer — falls through to check x-api-key
      // x-api-key also absent → missing key
      const context = buildContext({ authorization: "Token xyz" });

      await expect(guard.canActivate(context)).rejects.toThrow(
        "API key required",
      );
    });

    it("uses x-api-key when authorization is non-Bearer string", async () => {
      secretsService.getSecretNames.mockResolvedValue(["k1"]);
      secretsService.getValueInternal.mockResolvedValue("x-key-value");
      mockSafeCompare.mockReturnValue(true);

      const context = buildContext({
        authorization: "Basic some-credentials",
        "x-api-key": "x-key-value",
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  // ===================== Bearer takes precedence over X-API-Key =====================

  describe("header priority", () => {
    beforeEach(() => {
      reflector.getAllAndOverride.mockReturnValue(false);
    });

    it("prefers Bearer token over X-API-Key when both are present", async () => {
      const bearerKey = "bearer-key";
      secretsService.getSecretNames.mockResolvedValue(["k1"]);
      secretsService.getValueInternal.mockResolvedValue(bearerKey);
      mockSafeCompare.mockImplementation(
        (stored, provided) => stored === provided,
      );

      const context = buildContext({
        authorization: `Bearer ${bearerKey}`,
        "x-api-key": "x-api-key-value",
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      // Should have used the bearer key, not the x-api-key
      expect(mockSafeCompare).toHaveBeenCalledWith(bearerKey, bearerKey);
    });
  });
});
