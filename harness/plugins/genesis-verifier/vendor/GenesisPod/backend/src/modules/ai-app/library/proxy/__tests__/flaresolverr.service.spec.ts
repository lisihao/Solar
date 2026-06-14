import { Test, TestingModule } from "@nestjs/testing";
import { FlareSolverrService } from "../flaresolverr.service";
import axios from "axios";

// Mock axios at module level
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock axios.isAxiosError
const mockIsAxiosError = jest.fn().mockReturnValue(false);
(axios as jest.Mocked<typeof axios>).isAxiosError = mockIsAxiosError;

describe("FlareSolverrService", () => {
  let service: FlareSolverrService;

  const mockSuccessfulSolution = {
    url: "https://example.com/page",
    status: 200,
    headers: { "content-type": "text/html" },
    response: "<html><body>Page content here</body></html>",
    cookies: [
      {
        name: "cf_clearance",
        value: "abc123",
        domain: "example.com",
        path: "/",
        expires: Date.now() / 1000 + 3600,
        httpOnly: false,
        secure: true,
      },
    ],
    userAgent: "Mozilla/5.0 (compatible; FlareSolverr/3.0.0)",
  };

  const mockFlareSolverrOkResponse = {
    data: {
      status: "ok",
      message: "",
      solution: mockSuccessfulSolution,
      startTimestamp: Date.now(),
      endTimestamp: Date.now() + 2000,
      version: "3.0.0",
    },
    status: 200,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: checkHealth returns false (service not available) to avoid
    // automatic health checks in onModuleInit interfering with tests
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: { status: "error", message: "Not available" },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [FlareSolverrService],
    }).compile();

    service = module.get<FlareSolverrService>(FlareSolverrService);

    // onModuleInit is called, which calls checkHealth
    // We override availability for specific tests
  });

  describe("onModuleInit", () => {
    it("should skip checkHealth when FLARESOLVERR_URL is not set", async () => {
      // Ensure env var is not set
      delete process.env.FLARESOLVERR_URL;
      mockedAxios.post = jest.fn();

      await service.onModuleInit();

      // Should NOT call checkHealth when env var is not configured
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("should call checkHealth when FLARESOLVERR_URL is set", async () => {
      process.env.FLARESOLVERR_URL = "http://flaresolverr:8191/v1";
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "ok", sessions: [] },
      });

      await service.onModuleInit();

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        { cmd: "sessions.list" },
        expect.objectContaining({ timeout: 5000 }),
      );

      // Cleanup
      delete process.env.FLARESOLVERR_URL;
    });
  });

  describe("checkHealth", () => {
    it("should mark service as available when sessions.list returns ok", async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "ok", sessions: [] },
      });

      const result = await service.checkHealth();

      expect(result).toBe(true);
      expect(service.getIsAvailable()).toBe(true);
    });

    it("should mark service as unavailable when response status is not ok", async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "error", message: "FlareSolverr error" },
      });

      const result = await service.checkHealth();

      expect(result).toBe(false);
      expect(service.getIsAvailable()).toBe(false);
    });

    it("should mark service as unavailable when request throws", async () => {
      mockedAxios.post = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await service.checkHealth();

      expect(result).toBe(false);
      expect(service.getIsAvailable()).toBe(false);
    });
  });

  describe("getIsAvailable", () => {
    it("should return false when service is not available", () => {
      expect(service.getIsAvailable()).toBe(false);
    });

    it("should return true when service becomes available after checkHealth", async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "ok", sessions: [] },
      });

      await service.checkHealth();

      expect(service.getIsAvailable()).toBe(true);
    });
  });

  describe("fetchPage", () => {
    beforeEach(async () => {
      // Make service available for fetchPage tests
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "ok", sessions: [] },
      });
      await service.checkHealth();
    });

    it("should return html content when FlareSolverr succeeds", async () => {
      mockedAxios.post = jest
        .fn()
        .mockResolvedValue(mockFlareSolverrOkResponse);

      const result = await service.fetchPage("https://example.com/page");

      expect(result.success).toBe(true);
      expect(result.html).toBe("<html><body>Page content here</body></html>");
      expect(result.cookies).toEqual(mockSuccessfulSolution.cookies);
      expect(result.userAgent).toBe(mockSuccessfulSolution.userAgent);
      expect(result.finalUrl).toBe(mockSuccessfulSolution.url);
    });

    it("should include solveTime in successful result", async () => {
      mockedAxios.post = jest
        .fn()
        .mockResolvedValue(mockFlareSolverrOkResponse);

      const result = await service.fetchPage("https://example.com/page");

      expect(result.solveTime).toBeDefined();
      expect(result.solveTime).toBeGreaterThanOrEqual(0);
    });

    it("should send correct request body to FlareSolverr", async () => {
      mockedAxios.post = jest
        .fn()
        .mockResolvedValue(mockFlareSolverrOkResponse);

      await service.fetchPage("https://example.com/target");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          cmd: "request.get",
          url: "https://example.com/target",
          maxTimeout: 60000,
        }),
        expect.any(Object),
      );
    });

    it("should include cookies in request when provided", async () => {
      mockedAxios.post = jest
        .fn()
        .mockResolvedValue(mockFlareSolverrOkResponse);

      const cookies = [
        {
          name: "session",
          value: "abc",
          domain: "example.com",
          path: "/",
          expires: Date.now() / 1000 + 3600,
          httpOnly: false,
          secure: false,
        },
      ];

      await service.fetchPage("https://example.com", { cookies });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cookies }),
        expect.any(Object),
      );
    });

    it("should include session in request when provided", async () => {
      mockedAxios.post = jest
        .fn()
        .mockResolvedValue(mockFlareSolverrOkResponse);

      await service.fetchPage("https://example.com", { session: "my-session" });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ session: "my-session" }),
        expect.any(Object),
      );
    });

    it("should not include session in request when not provided", async () => {
      mockedAxios.post = jest
        .fn()
        .mockResolvedValue(mockFlareSolverrOkResponse);

      await service.fetchPage("https://example.com");

      const callArgs = (mockedAxios.post as jest.Mock).mock.calls[0][1];
      expect(callArgs).not.toHaveProperty("session");
    });

    it("should return failure when FlareSolverr returns error status", async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: {
          status: "error",
          message: "Error fetching page",
          startTimestamp: Date.now(),
          endTimestamp: Date.now() + 1000,
          version: "3.0.0",
        },
      });

      const result = await service.fetchPage("https://example.com");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Error fetching page");
    });

    it("should return failure when service becomes unavailable during request", async () => {
      // Service is available but request throws ECONNREFUSED
      const connectionError = Object.assign(new Error("ECONNREFUSED"), {
        code: "ECONNREFUSED",
      });
      mockedAxios.post = jest.fn().mockRejectedValue(connectionError);
      mockIsAxiosError.mockReturnValue(true);

      const result = await service.fetchPage("https://example.com");

      expect(result.success).toBe(false);
    });

    it("should return timeout error message when ECONNABORTED", async () => {
      const timeoutError = Object.assign(
        new Error("timeout of 60000ms exceeded"),
        {
          code: "ECONNABORTED",
        },
      );
      mockedAxios.post = jest.fn().mockRejectedValue(timeoutError);
      mockIsAxiosError.mockReturnValue(true);

      const result = await service.fetchPage("https://slow-site.com");

      expect(result.success).toBe(false);
      expect(result.error).toContain("timeout");
    });

    it("should re-check availability when service is unavailable", async () => {
      // Make service unavailable
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "error" },
      });
      await service.checkHealth();

      expect(service.getIsAvailable()).toBe(false);

      // Now the check in fetchPage will re-check
      const result = await service.fetchPage("https://example.com");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not available");
    });

    it("should use custom maxTimeout when specified", async () => {
      mockedAxios.post = jest
        .fn()
        .mockResolvedValue(mockFlareSolverrOkResponse);

      await service.fetchPage("https://example.com", { maxTimeout: 30000 });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxTimeout: 30000 }),
        expect.objectContaining({ timeout: 40000 }), // maxTimeout + 10000
      );
    });
  });

  describe("createSession", () => {
    beforeEach(async () => {
      // Make service available
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "ok", sessions: [] },
      });
      await service.checkHealth();
    });

    it("should return sessionId when session is created successfully", async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "ok", message: "Session created" },
      });

      const sessionId = await service.createSession("my-session");

      expect(sessionId).toBe("my-session");
    });

    it("should return default session id when no sessionId provided", async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "ok" },
      });

      const sessionId = await service.createSession();

      expect(sessionId).toBe("default");
    });

    it("should return null when session creation fails", async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "error", message: "Failed" },
      });

      const sessionId = await service.createSession("failing-session");

      expect(sessionId).toBeNull();
    });

    it("should return null when service is not available", async () => {
      // Make service unavailable
      mockedAxios.post = jest
        .fn()
        .mockResolvedValue({ data: { status: "error" } });
      await service.checkHealth();

      const sessionId = await service.createSession("session-1");

      expect(sessionId).toBeNull();
    });

    it("should return null when createSession throws", async () => {
      mockedAxios.post = jest
        .fn()
        .mockRejectedValue(new Error("Network error"));

      const sessionId = await service.createSession("error-session");

      expect(sessionId).toBeNull();
    });

    it("should send correct cmd to FlareSolverr", async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "ok" },
      });

      await service.createSession("test-session");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          cmd: "sessions.create",
          session: "test-session",
        }),
        expect.any(Object),
      );
    });
  });

  describe("destroySession", () => {
    beforeEach(async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "ok", sessions: [] },
      });
      await service.checkHealth();
    });

    it("should return true when session is destroyed successfully", async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "ok" },
      });

      const result = await service.destroySession("session-to-destroy");

      expect(result).toBe(true);
    });

    it("should return false when session destruction fails", async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "error" },
      });

      const result = await service.destroySession("non-existent-session");

      expect(result).toBe(false);
    });

    it("should return false when service is not available", async () => {
      // Make service unavailable
      mockedAxios.post = jest
        .fn()
        .mockResolvedValue({ data: { status: "error" } });
      await service.checkHealth();

      const result = await service.destroySession("session-1");

      expect(result).toBe(false);
    });

    it("should return false when destroySession throws", async () => {
      mockedAxios.post = jest
        .fn()
        .mockRejectedValue(new Error("Network error"));

      const result = await service.destroySession("error-session");

      expect(result).toBe(false);
    });

    it("should send correct cmd to FlareSolverr", async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { status: "ok" },
      });

      await service.destroySession("my-session");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          cmd: "sessions.destroy",
          session: "my-session",
        }),
        expect.any(Object),
      );
    });
  });
});
