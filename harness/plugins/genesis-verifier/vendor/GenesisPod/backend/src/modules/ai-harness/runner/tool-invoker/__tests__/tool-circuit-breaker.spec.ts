/**
 * ToolCircuitBreaker 单元测试 (PR-I)
 *
 * 修复：constructor 不再接受 opts 参数（DI 安全），改用 configure() 覆盖默认值
 */

import { ToolCircuitBreaker } from "../tool-circuit-breaker";

function makeBreaker(opts?: {
  failureThreshold?: number;
  recoveryWindowMs?: number;
}): ToolCircuitBreaker {
  const cb = new ToolCircuitBreaker();
  if (opts) cb.configure(opts);
  return cb;
}

describe("ToolCircuitBreaker (PR-I)", () => {
  it("allows by default", () => {
    const cb = makeBreaker();
    expect(cb.allow("t1")).toBe(true);
  });

  it("opens after N consecutive failures", () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    cb.recordFailure("t1");
    cb.recordFailure("t1");
    expect(cb.allow("t1")).toBe(true); // 2 failures, still closed
    cb.recordFailure("t1");
    expect(cb.allow("t1")).toBe(false); // 3 failures, open
    expect(cb.getState("t1")).toBe("open");
  });

  it("recordSuccess resets failure count", () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    cb.recordFailure("t1");
    cb.recordFailure("t1");
    cb.recordSuccess("t1");
    cb.recordFailure("t1");
    cb.recordFailure("t1");
    expect(cb.allow("t1")).toBe(true); // back to 2 failures
  });

  it("transitions to half-open after recovery window", async () => {
    const cb = makeBreaker({
      failureThreshold: 1,
      recoveryWindowMs: 50,
    });
    cb.recordFailure("t1");
    expect(cb.allow("t1")).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(cb.allow("t1")).toBe(true); // half-open
    expect(cb.getState("t1")).toBe("half-open");
    cb.recordSuccess("t1");
    expect(cb.getState("t1")).toBe("closed");
  });

  it("isolates state per tool", () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    cb.recordFailure("t1");
    expect(cb.allow("t1")).toBe(false);
    expect(cb.allow("t2")).toBe(true); // unaffected
  });
});
