/**
 * Unit tests for PolicyDataService
 * Covers: getApiKey, getAllApiKeys, multi-key rotation, health tracking,
 *         markKeyFailed/clearKeyFailure, getKeyHealthStatus, HTTP helpers, date helpers
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { AxiosResponse } from "axios";
import { PolicyDataService } from "../policy-data.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";

// ==================== Mocks ====================

const mockHttpService = {
  get: jest.fn(),
  post: jest.fn(),
};

const mockPrisma = {
  toolConfig: {
    findUnique: jest.fn(),
  },
};

const mockSecrets = {
  getValue: jest.fn(),
};

function makeAxiosResponse<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: { headers: {} } as AxiosResponse["config"],
  };
}

// ==================== Test setup ====================

describe("PolicyDataService", () => {
  let service: PolicyDataService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyDataService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SecretsService, useValue: mockSecrets },
      ],
    }).compile();

    service = module.get<PolicyDataService>(PolicyDataService);
  });

  // ==================== getApiKey (single key, backward compat) ====================

  describe("getApiKey (single key)", () => {
    it("returns the secret value when secretKey is configured and secret exists", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "my-tool",
        secretKey: "MY_API_KEY_SECRET",
        config: {},
      });
      mockSecrets.getValue.mockResolvedValue("secret-api-key-value");

      const result = await service.getApiKey("my-tool");
      expect(result).toBe("secret-api-key-value");
      expect(mockSecrets.getValue).toHaveBeenCalledWith("MY_API_KEY_SECRET");
    });

    it("falls back to config.apiKey when secretKey is missing but config.apiKey exists", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "my-tool",
        secretKey: null,
        config: { apiKey: "config-direct-api-key" },
      });

      const result = await service.getApiKey("my-tool");
      expect(result).toBe("config-direct-api-key");
    });

    it("falls back to config.apiKey when secretValue is null/empty", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "my-tool",
        secretKey: "SECRET_KEY_NAME",
        config: { apiKey: "fallback-config-key" },
      });
      mockSecrets.getValue.mockResolvedValue(null);

      const result = await service.getApiKey("my-tool");
      expect(result).toBe("fallback-config-key");
    });

    it("returns null when toolConfig is not found", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue(null);

      const result = await service.getApiKey("unknown-tool");
      expect(result).toBeNull();
    });

    it("returns null when toolConfig has no secretKey and config has no apiKey", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "my-tool",
        secretKey: null,
        config: {},
      });

      const result = await service.getApiKey("my-tool");
      expect(result).toBeNull();
    });

    it("returns null and does not throw on prisma error", async () => {
      mockPrisma.toolConfig.findUnique.mockRejectedValue(
        new Error("DB connection failed"),
      );

      const result = await service.getApiKey("error-tool");
      expect(result).toBeNull();
    });

    it("returns null when secretsService throws", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "my-tool",
        secretKey: "BAD_SECRET",
        config: {},
      });
      mockSecrets.getValue.mockRejectedValue(
        new Error("Secrets service unavailable"),
      );

      const result = await service.getApiKey("my-tool");
      expect(result).toBeNull();
    });
  });

  // ==================== Multi-Key Rotation ====================

  describe("getApiKey (multi-key rotation)", () => {
    it("parses comma-separated keys from Secret Manager", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "serper",
        secretKey: "SERPER_KEYS",
        config: {},
      });
      mockSecrets.getValue.mockResolvedValue("key-a, key-b, key-c");

      const result = await service.getApiKey("serper");
      expect(result).toBeTruthy();
      expect(["key-a", "key-b", "key-c"]).toContain(result);
    });

    it("rotates keys across multiple calls (Round-Robin)", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "serper",
        secretKey: "SERPER_KEYS",
        config: {},
      });
      mockSecrets.getValue.mockResolvedValue("key-1,key-2,key-3");

      const results: string[] = [];
      for (let i = 0; i < 6; i++) {
        const key = await service.getApiKey("serper");
        if (key) results.push(key);
      }

      // Should cycle through all 3 keys
      expect(results.length).toBe(6);
      expect(new Set(results).size).toBe(3);
    });

    it("skips failed keys and returns healthy ones", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "serper",
        secretKey: "SERPER_KEYS",
        config: {},
      });
      mockSecrets.getValue.mockResolvedValue("key-a,key-b");

      // Mark key-a as failed with 429
      service.markKeyFailed("serper", "key-a", 429);

      // Should return key-b (the healthy one)
      const result = await service.getApiKey("serper");
      expect(result).toBe("key-b");
    });

    it("returns oldest-failed key when all keys are rate-limited (429) — degraded fallback", async () => {
      // 2026-05-14 行为修改: 之前全 429 直接 return null 锁死用户;
      // 现在返回 cooldown 最短的 key 作 degraded fallback (上游试一次, 失败再 throw)
      // 见 feedback_single_key_user_cooldown_lockout
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "serper",
        secretKey: "SERPER_KEYS",
        config: {},
      });
      mockSecrets.getValue.mockResolvedValue("key-a,key-b");

      // Mark both keys with 429 (rate limit)
      service.markKeyFailed("serper", "key-a", 429);
      service.markKeyFailed("serper", "key-b", 429);

      const result = await service.getApiKey("serper");
      expect(result).not.toBeNull();
      expect(["key-a", "key-b"]).toContain(result);
    });

    it("returns oldest-failed key when all have temp errors (5xx)", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "serper",
        secretKey: "SERPER_KEYS",
        config: {},
      });
      mockSecrets.getValue.mockResolvedValue("key-a,key-b");

      // Mark both keys with 500 (temp errors, not quota exhausted)
      service.markKeyFailed("serper", "key-a", 500);
      // Wait a tiny bit to ensure different timestamps
      service.markKeyFailed("serper", "key-b", 500);

      // Should return key-a (oldest failed)
      const result = await service.getApiKey("serper");
      expect(result).toBe("key-a");
    });

    it("filters empty keys from comma-separated string", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "serper",
        secretKey: "SERPER_KEYS",
        config: {},
      });
      mockSecrets.getValue.mockResolvedValue("key-a,,  , key-b,");

      const keys = await service.getAllApiKeys("serper");
      expect(keys).toEqual(["key-a", "key-b"]);
    });

    it("parses comma-separated keys from config.apiKey too", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "my-tool",
        secretKey: null,
        config: { apiKey: "cfg-key-1, cfg-key-2" },
      });

      const keys = await service.getAllApiKeys("my-tool");
      expect(keys).toEqual(["cfg-key-1", "cfg-key-2"]);
    });
  });

  // ==================== markKeyFailed / clearKeyFailure ====================

  describe("markKeyFailed / clearKeyFailure", () => {
    it("markKeyFailed causes getHealthyKey to skip that key", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "tool-x",
        secretKey: "KEYS",
        config: {},
      });
      mockSecrets.getValue.mockResolvedValue("alpha,beta");

      service.markKeyFailed("tool-x", "alpha", 429);

      const result = await service.getApiKey("tool-x");
      expect(result).toBe("beta");
    });

    it("clearKeyFailure restores key to rotation", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "tool-x",
        secretKey: "KEYS",
        config: {},
      });
      mockSecrets.getValue.mockResolvedValue("alpha,beta");

      service.markKeyFailed("tool-x", "alpha", 429);
      service.clearKeyFailure("tool-x", "alpha");

      // Both keys should be available now
      const results = new Set<string>();
      for (let i = 0; i < 4; i++) {
        const key = await service.getApiKey("tool-x");
        if (key) results.add(key);
      }
      expect(results.size).toBe(2);
      expect(results.has("alpha")).toBe(true);
      expect(results.has("beta")).toBe(true);
    });

    it("clearKeyFailure is a no-op for a key that was never failed", () => {
      // Should not throw
      service.clearKeyFailure("any-tool", "never-failed-key");
    });
  });

  // ==================== getKeyHealthStatus ====================

  describe("getKeyHealthStatus", () => {
    it("returns health status for all keys", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "serper",
        secretKey: "SERPER_KEYS",
        config: {},
      });
      mockSecrets.getValue.mockResolvedValue("key-aaa-bbb-ccc,key-ddd-eee-fff");

      service.markKeyFailed("serper", "key-aaa-bbb-ccc", 429);

      const statuses = await service.getKeyHealthStatus("serper");
      expect(statuses).toHaveLength(2);

      // First key should be unhealthy (429 within cooldown)
      expect(statuses[0].index).toBe(0);
      expect(statuses[0].maskedKey).toContain("****");
      expect(statuses[0].isHealthy).toBe(false);
      expect(statuses[0].lastError).toBe("HTTP 429");
      expect(statuses[0].cooldownUntil).toBeDefined();

      // Second key should be healthy
      expect(statuses[1].index).toBe(1);
      expect(statuses[1].isHealthy).toBe(true);
      expect(statuses[1].lastError).toBeUndefined();
    });

    it("returns empty array when no keys configured", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue(null);

      const statuses = await service.getKeyHealthStatus("unknown");
      expect(statuses).toEqual([]);
    });
  });

  // ==================== getMaskedKeyForDisplay ====================

  describe("getMaskedKeyForDisplay", () => {
    it("masks long keys with prefix****suffix", () => {
      const result = service.getMaskedKeyForDisplay("tvly-abcdefghij-xyz");
      expect(result).toBe("tvly-abc****xyz");
    });

    it("returns **** for short keys", () => {
      expect(service.getMaskedKeyForDisplay("short")).toBe("****");
      expect(service.getMaskedKeyForDisplay("")).toBe("****");
    });

    it("returns **** for undefined/null-like input", () => {
      expect(service.getMaskedKeyForDisplay("")).toBe("****");
    });
  });

  // ==================== getAllApiKeys ====================

  describe("getAllApiKeys", () => {
    it("returns empty array when no config found", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue(null);
      const keys = await service.getAllApiKeys("unknown");
      expect(keys).toEqual([]);
    });

    it("returns empty array on error", async () => {
      mockPrisma.toolConfig.findUnique.mockRejectedValue(new Error("DB error"));
      const keys = await service.getAllApiKeys("error-tool");
      expect(keys).toEqual([]);
    });

    it("returns keys from Secret Manager", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "tool",
        secretKey: "SECRET",
        config: {},
      });
      mockSecrets.getValue.mockResolvedValue("k1,k2");

      const keys = await service.getAllApiKeys("tool");
      expect(keys).toEqual(["k1", "k2"]);
    });

    it("falls back to config.apiKey when Secret Manager returns null", async () => {
      mockPrisma.toolConfig.findUnique.mockResolvedValue({
        toolId: "tool",
        secretKey: "SECRET",
        config: { apiKey: "fallback-key" },
      });
      mockSecrets.getValue.mockResolvedValue(null);

      const keys = await service.getAllApiKeys("tool");
      expect(keys).toEqual(["fallback-key"]);
    });
  });

  // ==================== httpGet ====================

  describe("httpGet", () => {
    it("returns response data on success", async () => {
      const responseData = { items: [{ id: 1 }] };
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse(responseData)));

      const result = await service.httpGet<typeof responseData>(
        "https://api.example.com/data",
      );
      expect(result).toEqual(responseData);
    });

    it("passes params to HttpService", async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({})));

      await service.httpGet("https://api.example.com/search", {
        q: "test query",
        limit: 10,
        active: true,
      });

      expect(mockHttpService.get).toHaveBeenCalledWith(
        "https://api.example.com/search",
        expect.objectContaining({
          params: { q: "test query", limit: "10", active: "true" },
        }),
      );
    });

    it("filters out undefined param values", async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({})));

      await service.httpGet("https://api.example.com/search", {
        q: "test",
        page: undefined,
        size: 20,
      });

      const callArgs = mockHttpService.get.mock.calls[0][1] as {
        params: Record<string, string>;
      };
      expect(callArgs.params).not.toHaveProperty("page");
      expect(callArgs.params).toHaveProperty("q", "test");
      expect(callArgs.params).toHaveProperty("size", "20");
    });

    it("passes custom headers merged with User-Agent", async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({})));

      await service.httpGet("https://api.example.com/data", undefined, {
        Authorization: "Bearer my-token",
      });

      const callArgs = mockHttpService.get.mock.calls[0][1] as {
        headers: Record<string, string>;
      };
      expect(callArgs.headers).toHaveProperty(
        "Authorization",
        "Bearer my-token",
      );
      expect(callArgs.headers).toHaveProperty("User-Agent");
    });

    it("throws an Error with descriptive message on HTTP failure", async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error("Network unreachable")),
      );

      await expect(
        service.httpGet("https://api.example.com/fail"),
      ).rejects.toThrow("HTTP GET request failed: Network unreachable");
    });

    it("sets timeout to 30000 ms", async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({})));

      await service.httpGet("https://api.example.com/data");

      const callArgs = mockHttpService.get.mock.calls[0][1] as {
        timeout: number;
      };
      expect(callArgs.timeout).toBe(30000);
    });

    // ★ 2026-05-25: 数组参数必须展开为重复 key（fields[]=a&fields[]=b），
    //   某些 API（Federal Register）强制要求；逗号 join 单值会被拒 HTTP 400。
    it("serializes array params as repeated keys (key[]=a&key[]=b)", async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({})));

      await service.httpGet("https://api.example.com/data", {
        "fields[]": ["title", "type"],
        "conditions[term]": "AI export",
        per_page: 10,
      });

      const callArgs = mockHttpService.get.mock.calls[0][1] as {
        params: Record<string, unknown>;
        paramsSerializer: (p: Record<string, unknown>) => string;
      };
      // array preserved into params (not comma-joined)
      expect(callArgs.params["fields[]"]).toEqual(["title", "type"]);
      // serializer expands arrays to repeated keys + url-encodes the rest
      const qs = callArgs.paramsSerializer(callArgs.params);
      expect(qs).toContain("fields%5B%5D=title");
      expect(qs).toContain("fields%5B%5D=type");
      expect(qs).toContain("per_page=10");
      // term url-encoded (space → +)
      expect(qs).toMatch(/conditions%5Bterm%5D=AI(\+|%20)export/);
    });
  });

  // ==================== httpPost ====================

  describe("httpPost", () => {
    it("returns response data on success", async () => {
      const responseData = { created: true, id: "abc123" };
      mockHttpService.post.mockReturnValue(of(makeAxiosResponse(responseData)));

      const result = await service.httpPost<typeof responseData>(
        "https://api.example.com/create",
        { name: "test" },
      );
      expect(result).toEqual(responseData);
    });

    it("passes body data to HttpService", async () => {
      mockHttpService.post.mockReturnValue(of(makeAxiosResponse({})));
      const body = { key: "value", count: 42 };

      await service.httpPost("https://api.example.com/submit", body);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        "https://api.example.com/submit",
        body,
        expect.anything(),
      );
    });

    it("passes custom headers merged with defaults", async () => {
      mockHttpService.post.mockReturnValue(of(makeAxiosResponse({})));

      await service.httpPost(
        "https://api.example.com/submit",
        {},
        {
          "X-Custom-Header": "custom-value",
        },
      );

      const callArgs = mockHttpService.post.mock.calls[0][2] as {
        headers: Record<string, string>;
      };
      expect(callArgs.headers).toHaveProperty(
        "X-Custom-Header",
        "custom-value",
      );
      expect(callArgs.headers).toHaveProperty(
        "Content-Type",
        "application/json",
      );
    });

    it("throws an Error with descriptive message on HTTP failure", async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error("Connection refused")),
      );

      await expect(
        service.httpPost("https://api.example.com/fail", {}),
      ).rejects.toThrow("HTTP POST request failed: Connection refused");
    });

    it("sets timeout to 30000 ms", async () => {
      mockHttpService.post.mockReturnValue(of(makeAxiosResponse({})));

      await service.httpPost("https://api.example.com/data", {});

      const callArgs = mockHttpService.post.mock.calls[0][2] as {
        timeout: number;
      };
      expect(callArgs.timeout).toBe(30000);
    });
  });

  // ==================== formatDate ====================

  describe("formatDate", () => {
    it("formats a Date object to YYYY-MM-DD", () => {
      const date = new Date("2026-02-15T12:00:00.000Z");
      expect(service.formatDate(date)).toBe("2026-02-15");
    });

    it("formats an ISO string to YYYY-MM-DD", () => {
      expect(service.formatDate("2025-12-31T00:00:00.000Z")).toBe("2025-12-31");
    });

    it("formats a date-only string to YYYY-MM-DD", () => {
      expect(service.formatDate("2024-01-01")).toBe("2024-01-01");
    });

    it("strips the time component from a Date with a non-midnight time", () => {
      const date = new Date("2026-06-15T23:59:59.999Z");
      expect(service.formatDate(date)).toBe("2026-06-15");
    });
  });

  // ==================== getDateDaysAgo ====================

  describe("getDateDaysAgo", () => {
    it("returns today's date for 0 days ago", () => {
      const today = new Date().toISOString().split("T")[0];
      expect(service.getDateDaysAgo(0)).toBe(today);
    });

    it("returns yesterday for 1 day ago", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const expected = yesterday.toISOString().split("T")[0];
      expect(service.getDateDaysAgo(1)).toBe(expected);
    });

    it("returns the correct date for 30 days ago", () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const expected = thirtyDaysAgo.toISOString().split("T")[0];
      expect(service.getDateDaysAgo(30)).toBe(expected);
    });

    it("returns a string in YYYY-MM-DD format", () => {
      const result = service.getDateDaysAgo(7);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
