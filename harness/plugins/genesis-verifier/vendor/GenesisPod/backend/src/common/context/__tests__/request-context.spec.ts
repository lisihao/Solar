import { RequestContext } from "../request-context";

describe("RequestContext latency accumulator", () => {
  it("accumulates segments within a request and reads them back in push order", () => {
    const segments = RequestContext.run({ requestId: "r1" }, () => {
      RequestContext.pushLatencySegment({ kind: "model_resolve", ms: 5 });
      RequestContext.pushLatencySegment({ kind: "balance_check", ms: 42 });
      RequestContext.pushLatencySegment({
        kind: "llm_ttft",
        ms: 2000,
        meta: { provider: "deepseek" },
      });
      return RequestContext.getLatencySegments();
    });

    expect(segments.map((s) => s.kind)).toEqual([
      "model_resolve",
      "balance_check",
      "llm_ttft",
    ]);
    expect(segments[2].meta).toEqual({ provider: "deepseek" });
  });

  it("no-ops outside any request context (e.g. background task)", () => {
    // 无活跃 store：push 不抛、read 返回空
    expect(() =>
      RequestContext.pushLatencySegment({ kind: "model_resolve", ms: 1 }),
    ).not.toThrow();
    expect(RequestContext.getLatencySegments()).toEqual([]);
  });

  it("isolates segments between concurrent-style separate runs", () => {
    const a = RequestContext.run({ requestId: "a" }, () => {
      RequestContext.pushLatencySegment({ kind: "session_load", ms: 1 });
      return RequestContext.getLatencySegments();
    });
    const b = RequestContext.run({ requestId: "b" }, () => {
      RequestContext.pushLatencySegment({ kind: "context_build", ms: 2 });
      return RequestContext.getLatencySegments();
    });

    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("session_load");
    expect(b).toHaveLength(1);
    expect(b[0].kind).toBe("context_build");
  });
});
