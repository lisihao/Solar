import { HandoffCompactorService } from "../handoff-compactor.service";

describe("HandoffCompactorService", () => {
  let service: HandoffCompactorService;

  beforeEach(() => {
    service = new HandoffCompactorService();
  });

  // estimateTokens
  it("estimateTokens: null/undefined → 0", () => {
    expect(service.estimateTokens(null)).toBe(0);
    expect(service.estimateTokens(undefined)).toBe(0);
  });

  it("estimateTokens: string → length / 2.0 ceiled", () => {
    const s = "hello world!"; // 12 chars → ceil(12/2.0) = 6
    expect(service.estimateTokens(s)).toBe(Math.ceil(12 / 2.0));
  });

  it("estimateTokens: object → JSON.stringify length / 2.0", () => {
    const obj = { a: 1, b: "test" };
    const expected = Math.ceil(JSON.stringify(obj).length / 2.0);
    expect(service.estimateTokens(obj)).toBe(expected);
  });

  it("estimateTokens: array is JSON-stringified", () => {
    const arr = [1, 2, 3];
    const expected = Math.ceil(JSON.stringify(arr).length / 2.0);
    expect(service.estimateTokens(arr)).toBe(expected);
  });

  // handoffTokenLimit
  it("exposes handoffTokenLimit = 50000", () => {
    expect(service.handoffTokenLimit).toBe(50_000);
  });

  // compressIfNeeded: under limit → returns same reference
  it("compressIfNeeded: returns original when under limit", () => {
    const payload = { small: "data" };
    const result = service.compressIfNeeded(payload, "test");
    expect(result).toBe(payload);
  });

  // compressIfNeeded: over limit with array → compresses
  it("compressIfNeeded: compresses array when over 50K tokens", () => {
    // Create array with items large enough to exceed 50K tokens
    const bigItem = {
      findings: Array.from({ length: 20 }, (_, i) => ({
        claim: "x".repeat(500),
        evidence: "e".repeat(500),
        source: "http://src" + i + ".com",
      })),
    };
    const bigArray = Array.from({ length: 15 }, (_, i) => ({
      ...bigItem,
      dimension: "dim" + i,
    }));
    const result = service.compressIfNeeded(bigArray, "test");
    // Result should be smaller
    expect(JSON.stringify(result).length).toBeLessThan(
      JSON.stringify(bigArray).length,
    );
  });

  it("compressIfNeeded: array limited to 12 items", () => {
    const bigItem = {
      findings: Array.from({ length: 20 }, (_) => ({
        claim: "x".repeat(500),
        evidence: "e".repeat(500),
        source: "s",
      })),
    };
    const bigArray = Array.from({ length: 20 }, (_, i) => ({
      ...bigItem,
      dimension: "dim" + i,
    }));
    const tokens = service.estimateTokens(bigArray);
    if (tokens > 50_000) {
      const result = service.compressIfNeeded(bigArray, "test") as unknown[];
      expect(result.length).toBeLessThanOrEqual(12);
    }
  });

  it("compressIfNeeded: string fields over 500 chars are truncated", () => {
    const longSummary = "x".repeat(800);
    const bigArray = Array.from({ length: 15 }, (_, i) => ({
      dimension: "d" + i,
      findings: Array.from({ length: 10 }, () => ({
        claim: longSummary,
        evidence: longSummary,
        source: "http://a.com",
      })),
      summary: longSummary,
    }));
    const tokens = service.estimateTokens(bigArray);
    if (tokens > 50_000) {
      const result = service.compressIfNeeded(bigArray, "test") as Array<{
        summary: string;
      }>;
      expect(result[0].summary.length).toBeLessThanOrEqual(501); // 500 + "…"
    }
  });

  it("compressIfNeeded: top-level array sliced to max 12 items", () => {
    // 20 dims, each with large string data → triggers compression
    const longStr = "x".repeat(1000);
    const bigArray = Array.from({ length: 20 }, (_, i) => ({
      dimension: "d" + i,
      findings: Array.from({ length: 5 }, () => ({
        claim: longStr,
        evidence: longStr,
        source: "http://a.com",
      })),
      summary: longStr,
    }));
    // Verify we're actually over threshold
    const tokens = service.estimateTokens(bigArray);
    expect(tokens).toBeGreaterThan(50_000);
    const result = service.compressIfNeeded(bigArray, "test") as unknown[];
    // Top-level array is sliced to 12 by compress()
    expect(result.length).toBeLessThanOrEqual(12);
  });

  it("compressIfNeeded: object over limit compresses each key", () => {
    const bigObj: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      bigObj[`key${i}`] = "x".repeat(2000);
    }
    const tokens = service.estimateTokens(bigObj);
    if (tokens > 50_000) {
      const result = service.compressIfNeeded(
        bigObj,
        "test",
      ) as unknown as Record<string, string>;
      // Each long string should be truncated
      expect(Object.values(result)[0].length).toBeLessThan(2000);
    }
  });

  it("compressIfNeeded: long top-level string gets truncated", () => {
    const longStr = "x".repeat(200_000);
    const tokens = service.estimateTokens(longStr);
    if (tokens > 50_000) {
      const result = service.compressIfNeeded(
        longStr,
        "test",
      ) as unknown as string;
      expect(result.length).toBeLessThan(longStr.length);
    }
  });

  it("compressIfNeeded: primitive values pass through compress unchanged", () => {
    const smallPayload = 42;
    expect(service.compressIfNeeded(smallPayload, "test")).toBe(42);
  });

  it("compressIfNeeded: logs warn when compressing", () => {
    const logSpy = jest.spyOn(service["log"], "warn");
    const debugSpy = jest.spyOn(service["log"], "debug");
    // 极大 payload — 即使递归压缩后仍超限（slice 12 dims × 6 findings × 500
    // chars × 多字段 ≈ 36K chars × 多字段 ≈ 仍可能 ~50K，但确保超）
    const giantArray = Array.from({ length: 200 }, (_, i) => ({
      dimension: "d" + i,
      findings: Array.from({ length: 100 }, () => ({
        claim: "x".repeat(2000),
        evidence: "x".repeat(2000),
        extra: Array.from({ length: 50 }, () => "z".repeat(200)),
      })),
      summary: "x".repeat(2000),
    }));
    service.compressIfNeeded(giantArray, "giant.label");
    const eitherCalled =
      logSpy.mock.calls.some((args) =>
        String(args[0]).includes("giant.label"),
      ) ||
      debugSpy.mock.calls.some((args) =>
        String(args[0]).includes("giant.label"),
      );
    expect(eitherCalled).toBe(true);
  });

  // ★ 2026-05-13 P2-#7: 递归压缩回归 —— 之前 compressItem 不递归进 nested
  //   array/object，researcherResults {dimension, findings: [...], summary}
  //   的 findings 数组直接 pass-through，116K tokens 压缩后基本没变。
  describe("recursive compression (P2-#7 regression)", () => {
    it("compresses nested findings array inside ResearcherFinding objects", () => {
      // 模拟真实 researcherResults 结构
      const bigArr = Array.from({ length: 8 }, (_, i) => ({
        dimension: "dim-" + i,
        findings: Array.from({ length: 30 }, (_, j) => ({
          claim: "c".repeat(800), // > 500 → 截
          evidence: "e".repeat(800), // > 500 → 截
          source: "https://example.com/" + j,
        })),
        summary: "s".repeat(2000), // > 500 → 截
      }));
      const tokens = service.estimateTokens(bigArr);
      expect(tokens).toBeGreaterThan(50_000);

      const result = service.compressIfNeeded(bigArr, "test") as Array<{
        dimension: string;
        findings: Array<{ claim: string; evidence: string }>;
        summary: string;
      }>;

      // 顶层数组截 12
      expect(result.length).toBeLessThanOrEqual(12);
      // 每个 dim 的 findings 数组应被截到 6（之前 bug：保持 30 个不变）
      for (const dim of result) {
        expect(dim.findings.length).toBeLessThanOrEqual(6);
        // 每条 finding 的 claim/evidence 长 string 应被截到 501（500 + "…"）
        for (const f of dim.findings) {
          expect(f.claim.length).toBeLessThanOrEqual(501);
          expect(f.evidence.length).toBeLessThanOrEqual(501);
        }
      }
    });

    it("compresses deeply nested objects (not just first level)", () => {
      const deeplyNested = Array.from({ length: 8 }, () => ({
        outer: {
          // nested object — 之前 bug：pass-through
          inner: {
            bigStr: "y".repeat(2000), // > 500 → 应被截
            innerArray: Array.from({ length: 20 }, () => "z".repeat(800)),
          },
        },
      }));
      // 充水使其超限
      const inflated = [
        ...deeplyNested,
        ...Array.from({ length: 50 }, () => ({
          padding: "p".repeat(2000),
        })),
      ];
      const tokens = service.estimateTokens(inflated);
      expect(tokens).toBeGreaterThan(50_000);

      const result = service.compressIfNeeded(inflated, "test") as Array<
        Record<string, unknown>
      >;
      // 找到含 outer 的元素（slice 后顶层 12，前面 8 个应包括）
      const withOuter = result.find(
        (x) => x && typeof x === "object" && "outer" in x,
      );
      expect(withOuter).toBeDefined();
      const outer = (withOuter as { outer: { inner: { bigStr: string } } })
        .outer;
      const inner = outer.inner;
      // 之前 bug：inner 整个 pass-through，bigStr=2000 字符；
      // 修复后：bigStr 截到 501
      expect(inner.bigStr.length).toBeLessThanOrEqual(501);
    });

    it("logs debug (not warn) when compression succeeds", () => {
      const warnSpy = jest.spyOn(service["log"], "warn");
      const debugSpy = jest.spyOn(service["log"], "debug");

      // 中等 payload — 容易压回到限制以下
      const moderate = Array.from({ length: 8 }, (_, i) => ({
        dimension: "d" + i,
        findings: Array.from({ length: 20 }, () => ({
          claim: "c".repeat(800),
          evidence: "e".repeat(800),
        })),
        summary: "s".repeat(2000),
      }));
      const before = service.estimateTokens(moderate);
      expect(before).toBeGreaterThan(50_000);

      service.compressIfNeeded(moderate, "moderate.payload");

      // 应走 debug 分支（压缩到位），不打 warn
      const warnCalled = warnSpy.mock.calls.some((args) =>
        String(args[0]).includes("moderate.payload"),
      );
      const debugCalled = debugSpy.mock.calls.some((args) =>
        String(args[0]).includes("moderate.payload"),
      );
      expect(warnCalled).toBe(false);
      expect(debugCalled).toBe(true);
    });
  });
});
