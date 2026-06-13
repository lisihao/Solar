/**
 * ProviderProbeService 错误码归一化 + apiFormat 派发回归。
 *
 * 2026-05-11 P2: PROVIDER_DEFAULTS 硬编码迁移至 DB ai_providers，spec 用
 * mock PrismaService 模拟 DB 返回不同 apiFormat 行，验证按 apiFormat 派发
 * 到不同请求 path（避免 mock-self-confirming：mock 设 endpoint=X 又断言 url=X
 * 同义反复，这里改断言 url **path** 是按 apiFormat 派发的差异化路径）。
 */
import { ProviderProbeService } from "../provider-probe.service";

type DbProviderRow = {
  slug: string;
  endpoint: string;
  apiFormat: string;
};

const makePrismaMock = (rows: DbProviderRow[]) => ({
  aIProvider: {
    findFirst: jest.fn(
      async ({ where }: { where: { slug: string } }) =>
        rows.find((r) => r.slug === where.slug) ?? null,
    ),
  },
});

describe("ProviderProbeService", () => {
  let svc: ProviderProbeService;
  let mockFetch: jest.Mock;
  let originalFetch: typeof fetch;

  const seedRows: DbProviderRow[] = [
    {
      slug: "openai",
      endpoint: "https://api.openai.com/v1",
      apiFormat: "openai",
    },
    {
      slug: "anthropic",
      endpoint: "https://api.anthropic.com/v1",
      apiFormat: "anthropic",
    },
    {
      slug: "google",
      endpoint: "https://generativelanguage.googleapis.com/v1beta",
      apiFormat: "google",
    },
  ];

  beforeEach(() => {
    const prismaMock = makePrismaMock(seedRows);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc = new ProviderProbeService(prismaMock as any);
    mockFetch = jest.fn();
    originalFetch = global.fetch;
    global.fetch = mockFetch as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("probeByProvider", () => {
    it("UNKNOWN provider (DB 无记录 + 无 override) → errorCode UNKNOWN", async () => {
      const r = await svc.probeByProvider({
        provider: "no-such-provider",
        apiKey: "x",
      });
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe("UNKNOWN");
    });

    it("openai 200 → ok=true", async () => {
      mockFetch.mockResolvedValue({ status: 200, text: async () => "" });
      const r = await svc.probeByProvider({ provider: "openai", apiKey: "k" });
      expect(r.ok).toBe(true);
    });

    it("openai 401 → AUTH_FAILED", async () => {
      mockFetch.mockResolvedValue({ status: 401, text: async () => "Invalid" });
      const r = await svc.probeByProvider({ provider: "openai", apiKey: "k" });
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe("AUTH_FAILED");
      expect(r.statusCode).toBe(401);
    });

    it("403 → AUTH_FAILED", async () => {
      mockFetch.mockResolvedValue({ status: 403, text: async () => "" });
      const r = await svc.probeByProvider({ provider: "openai", apiKey: "k" });
      expect(r.errorCode).toBe("AUTH_FAILED");
    });

    it("429 → RATE_LIMIT_KEY", async () => {
      mockFetch.mockResolvedValue({ status: 429, text: async () => "" });
      const r = await svc.probeByProvider({ provider: "openai", apiKey: "k" });
      expect(r.errorCode).toBe("RATE_LIMIT_KEY");
    });

    it("402 → QUOTA_EXCEEDED", async () => {
      mockFetch.mockResolvedValue({ status: 402, text: async () => "" });
      const r = await svc.probeByProvider({ provider: "openai", apiKey: "k" });
      expect(r.errorCode).toBe("QUOTA_EXCEEDED");
    });

    it("503 → PROVIDER_DOWN", async () => {
      mockFetch.mockResolvedValue({ status: 503, text: async () => "" });
      const r = await svc.probeByProvider({ provider: "openai", apiKey: "k" });
      expect(r.errorCode).toBe("PROVIDER_DOWN");
    });

    it("anthropic endpoint 含 /messages 不双重拼（Claude key 测试 404 根因）", async () => {
      // 修复前裸拼 ${endpoint}/messages：endpoint 已是 …/v1/messages →
      // …/v1/messages/messages → 404 → key 测试"失败"。
      mockFetch.mockResolvedValue({ status: 200, text: async () => "" });
      await svc.probe({
        apiFormat: "anthropic",
        apiKey: "k",
        endpoint: "https://api.anthropic.com/v1/messages",
        providerLabel: "anthropic",
      });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(url).not.toContain("/messages/messages");
    });

    it("anthropic endpoint 是 chat 路径剥到 base 拼 /messages", async () => {
      mockFetch.mockResolvedValue({ status: 200, text: async () => "" });
      await svc.probe({
        apiFormat: "anthropic",
        apiKey: "k",
        endpoint: "https://api.anthropic.com/v1/chat",
        providerLabel: "anthropic",
      });
      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://api.anthropic.com/v1/messages",
      );
    });

    it("AbortError → TIMEOUT", async () => {
      const abortErr = new Error("aborted");
      abortErr.name = "AbortError";
      mockFetch.mockRejectedValue(abortErr);
      const r = await svc.probeByProvider({ provider: "openai", apiKey: "k" });
      expect(r.errorCode).toBe("TIMEOUT");
    });

    it("ECONNREFUSED → NETWORK_ERROR", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      const r = await svc.probeByProvider({ provider: "openai", apiKey: "k" });
      expect(r.errorCode).toBe("NETWORK_ERROR");
    });

    it("anthropic uses /messages endpoint (按 apiFormat 派发)", async () => {
      mockFetch.mockResolvedValue({ status: 200, text: async () => "" });
      await svc.probeByProvider({ provider: "anthropic", apiKey: "k" });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/messages");
    });

    it("google uses /models?key= endpoint (按 apiFormat 派发)", async () => {
      mockFetch.mockResolvedValue({ status: 200, text: async () => "" });
      await svc.probeByProvider({ provider: "google", apiKey: "AIza-xxx" });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("models?key=");
    });

    it("override endpoint 覆盖 DB 默认", async () => {
      mockFetch.mockResolvedValue({ status: 200, text: async () => "" });
      await svc.probeByProvider({
        provider: "openai",
        apiKey: "k",
        endpointOverride: "https://custom.example/v9",
      });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("custom.example/v9");
    });
  });
});
