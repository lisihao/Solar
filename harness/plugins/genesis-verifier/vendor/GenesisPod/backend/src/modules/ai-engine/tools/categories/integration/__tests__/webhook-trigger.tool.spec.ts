/**
 * Unit tests for WebhookTriggerTool
 */

import { WebhookTriggerTool } from "../webhook-trigger.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Mock axios
// The tool calls axios(config) directly (as a function), not axios.get / axios.post.
// ============================================================================

jest.mock("axios", () => {
  const fn = jest.fn();
  // Also expose it as the default export
  (fn as unknown as Record<string, unknown>).default = fn;
  return fn;
});

// Get the mocked function after jest.mock
import axiosModule from "axios";
const mockedAxios = axiosModule as unknown as jest.Mock;

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "webhook-trigger",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeAxiosResponse(
  status: number,
  data: unknown = { ok: true },
  headers: Record<string, string> = {},
  statusText = "OK",
) {
  return { status, data, headers, statusText };
}

// ============================================================================
// Test suite
// ============================================================================

describe("WebhookTriggerTool", () => {
  let tool: WebhookTriggerTool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.mockResolvedValue(makeAxiosResponse(200));
    tool = new WebhookTriggerTool();
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for a valid URL", () => {
      expect(tool.validateInput({ url: "https://example.com/hook" })).toBe(
        true,
      );
    });

    it("should return false when url is missing", () => {
      expect(tool.validateInput({ url: "" })).toBe(false);
    });

    it("should return false for an invalid URL format", () => {
      expect(tool.validateInput({ url: "not-a-url" })).toBe(false);
    });

    it("should return false for basic auth without username", () => {
      expect(
        tool.validateInput({
          url: "https://example.com",
          auth: { type: "basic", password: "pass" },
        }),
      ).toBe(false);
    });

    it("should return false for basic auth without password", () => {
      expect(
        tool.validateInput({
          url: "https://example.com",
          auth: { type: "basic", username: "user" },
        }),
      ).toBe(false);
    });

    it("should return false for bearer auth without token", () => {
      expect(
        tool.validateInput({
          url: "https://example.com",
          auth: { type: "bearer" },
        }),
      ).toBe(false);
    });

    it("should return false for api_key auth without apiKeyName", () => {
      expect(
        tool.validateInput({
          url: "https://example.com",
          auth: { type: "api_key", apiKeyValue: "val" },
        }),
      ).toBe(false);
    });

    it("should return false for api_key auth without apiKeyValue", () => {
      expect(
        tool.validateInput({
          url: "https://example.com",
          auth: { type: "api_key", apiKeyName: "X-Key" },
        }),
      ).toBe(false);
    });

    it("should return true for valid bearer auth", () => {
      expect(
        tool.validateInput({
          url: "https://example.com",
          auth: { type: "bearer", token: "mytoken" },
        }),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Successful GET request
  // --------------------------------------------------------------------------

  describe("GET request", () => {
    it("should return success=true with statusCode, body, and headers", async () => {
      mockedAxios.mockResolvedValueOnce(
        makeAxiosResponse(
          200,
          { data: "value" },
          { "content-type": "application/json" },
        ),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { url: "https://example.com/api", method: "GET" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.statusCode).toBe(200);
      expect(result.data?.body).toEqual({ data: "value" });
      expect(result.data?.headers?.["content-type"]).toBe("application/json");
    });
  });

  // --------------------------------------------------------------------------
  // POST with payload
  // --------------------------------------------------------------------------

  describe("POST with payload", () => {
    it("should pass payload in request data for POST", async () => {
      mockedAxios.mockResolvedValueOnce(
        makeAxiosResponse(201, { created: true }),
      );
      const context = createMockContext();
      const payload = { key: "value", count: 42 };

      await tool.execute(
        { url: "https://example.com/api", method: "POST", payload },
        context,
      );

      const callArg = mockedAxios.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.data).toEqual(payload);
      expect(callArg.method).toBe("POST");
    });
  });

  // --------------------------------------------------------------------------
  // Custom headers
  // --------------------------------------------------------------------------

  describe("custom headers", () => {
    it("should merge custom headers into request headers", async () => {
      mockedAxios.mockResolvedValueOnce(makeAxiosResponse(200));
      const context = createMockContext();

      await tool.execute(
        {
          url: "https://example.com/hook",
          method: "POST",
          headers: { "X-Custom-Header": "custom-value" },
        },
        context,
      );

      const callArg = mockedAxios.mock.calls[0][0] as Record<string, unknown>;
      const headers = callArg.headers as Record<string, string>;
      expect(headers["X-Custom-Header"]).toBe("custom-value");
      // Default Content-Type should still be present
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  describe("authentication", () => {
    it("should add Bearer token Authorization header", async () => {
      mockedAxios.mockResolvedValueOnce(makeAxiosResponse(200));
      const context = createMockContext();

      await tool.execute(
        {
          url: "https://example.com/api",
          auth: { type: "bearer", token: "my-secret-token" },
        },
        context,
      );

      const callArg = mockedAxios.mock.calls[0][0] as Record<string, unknown>;
      const headers = callArg.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer my-secret-token");
    });

    it("should add Basic auth Authorization header with base64 credentials", async () => {
      mockedAxios.mockResolvedValueOnce(makeAxiosResponse(200));
      const context = createMockContext();

      await tool.execute(
        {
          url: "https://example.com/api",
          auth: { type: "basic", username: "user", password: "pass" },
        },
        context,
      );

      const callArg = mockedAxios.mock.calls[0][0] as Record<string, unknown>;
      const headers = callArg.headers as Record<string, string>;
      const expected = `Basic ${Buffer.from("user:pass").toString("base64")}`;
      expect(headers["Authorization"]).toBe(expected);
    });

    it("should add API key to header when apiKeyIn=header", async () => {
      mockedAxios.mockResolvedValueOnce(makeAxiosResponse(200));
      const context = createMockContext();

      await tool.execute(
        {
          url: "https://example.com/api",
          auth: {
            type: "api_key",
            apiKeyName: "X-API-Key",
            apiKeyValue: "secret-key",
            apiKeyIn: "header",
          },
        },
        context,
      );

      const callArg = mockedAxios.mock.calls[0][0] as Record<string, unknown>;
      const headers = callArg.headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBe("secret-key");
    });

    it("should add API key to query params when apiKeyIn=query", async () => {
      mockedAxios.mockResolvedValueOnce(makeAxiosResponse(200));
      const context = createMockContext();

      // The tool passes queryParams by reference to applyAuth, so we must
      // provide an explicit queryParams object to ensure the mutation is visible
      // in the axios call.
      await tool.execute(
        {
          url: "https://example.com/api",
          queryParams: {},
          auth: {
            type: "api_key",
            apiKeyName: "api_key",
            apiKeyValue: "secret-key",
            apiKeyIn: "query",
          },
        },
        context,
      );

      const callArg = mockedAxios.mock.calls[0][0] as Record<string, unknown>;
      const params = callArg.params as Record<string, string>;
      expect(params["api_key"]).toBe("secret-key");
    });
  });

  // --------------------------------------------------------------------------
  // Retry on failure
  // --------------------------------------------------------------------------

  describe("retry on failure", () => {
    it("should retry on failure and succeed on the last attempt", async () => {
      mockedAxios
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(makeAxiosResponse(200, { success: true }));

      const context = createMockContext();

      const result = await tool.execute(
        {
          url: "https://example.com/api",
          method: "POST",
          retries: 2,
          retryDelay: 0,
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.retriesUsed).toBe(2);
      expect(mockedAxios).toHaveBeenCalledTimes(3);
    }, 10000);

    it("should return success=false when all retries are exhausted", async () => {
      mockedAxios.mockRejectedValue(new Error("Always fails"));
      const context = createMockContext();

      const result = await tool.execute(
        {
          url: "https://example.com/api",
          retries: 1,
          retryDelay: 0,
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Always fails");
    }, 10000);
  });

  // --------------------------------------------------------------------------
  // waitForResponse=false (fire and forget)
  // --------------------------------------------------------------------------

  describe("waitForResponse=false", () => {
    it("should return 202 immediately without waiting for response", async () => {
      mockedAxios.mockResolvedValue(makeAxiosResponse(200));
      const context = createMockContext();

      const result = await tool.execute(
        {
          url: "https://example.com/hook",
          method: "POST",
          waitForResponse: false,
        },
        context,
      );

      expect(result.data?.statusCode).toBe(202);
      expect(result.data?.body).toEqual({ queued: true });
    });
  });

  // --------------------------------------------------------------------------
  // Timeout configuration
  // --------------------------------------------------------------------------

  describe("timeout", () => {
    it("should pass the timeout option to axios", async () => {
      mockedAxios.mockResolvedValueOnce(makeAxiosResponse(200));
      const context = createMockContext();

      await tool.execute(
        {
          url: "https://example.com/api",
          timeout: 5000,
        },
        context,
      );

      const callArg = mockedAxios.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.timeout).toBe(5000);
    });
  });

  // --------------------------------------------------------------------------
  // Non-2xx response
  // --------------------------------------------------------------------------

  describe("non-2xx response", () => {
    it("should return success=false for a 4xx response", async () => {
      mockedAxios.mockResolvedValueOnce(
        makeAxiosResponse(404, { error: "Not Found" }, {}, "Not Found"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { url: "https://example.com/missing" },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.statusCode).toBe(404);
    });

    it("should return success=false for a 5xx response", async () => {
      mockedAxios.mockResolvedValueOnce(
        makeAxiosResponse(
          500,
          { error: "Server Error" },
          {},
          "Internal Server Error",
        ),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { url: "https://example.com/api" },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.statusCode).toBe(500);
    });
  });

  // --------------------------------------------------------------------------
  // Axios error
  // --------------------------------------------------------------------------

  describe("axios error", () => {
    it("should return success=false with error message when axios throws", async () => {
      mockedAxios.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const context = createMockContext();

      const result = await tool.execute(
        { url: "https://example.com/api" },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("ECONNREFUSED");
    });
  });

  // --------------------------------------------------------------------------
  // requestId
  // --------------------------------------------------------------------------

  describe("requestId", () => {
    it("should include a requestId in the output", async () => {
      mockedAxios.mockResolvedValueOnce(makeAxiosResponse(200));
      const context = createMockContext();

      const result = await tool.execute(
        { url: "https://example.com/api" },
        context,
      );

      expect(result.data?.requestId).toBeDefined();
      expect(typeof result.data?.requestId).toBe("string");
    });
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have correct id and category", () => {
      expect(tool.id).toBe("webhook-trigger");
      expect(tool.category).toBe("integration");
    });
  });
});
