/**
 * runtime/env/types.ts — HumanInLoopPause + DelayedDependencyError
 */

import { HumanInLoopPause, DelayedDependencyError } from "../types";

describe("HumanInLoopPause", () => {
  it("is an instance of Error", () => {
    const err = new HumanInLoopPause("task-1", { question: "confirm?" });
    expect(err).toBeInstanceOf(Error);
  });

  it("message contains taskId", () => {
    const err = new HumanInLoopPause("task-abc", null);
    expect(err.message).toContain("task-abc");
  });

  it("name is HumanInLoopPause", () => {
    const err = new HumanInLoopPause("t", {});
    expect(err.name).toBe("HumanInLoopPause");
  });

  it("exposes taskId and payload", () => {
    const payload = { foo: "bar" };
    const err = new HumanInLoopPause("task-42", payload);
    expect(err.taskId).toBe("task-42");
    expect(err.payload).toBe(payload);
  });
});

describe("DelayedDependencyError", () => {
  it("is an instance of Error", () => {
    const err = new DelayedDependencyError(5000);
    expect(err).toBeInstanceOf(Error);
  });

  it("message contains delay", () => {
    const err = new DelayedDependencyError(3000);
    expect(err.message).toContain("3000");
  });

  it("name is DelayedDependencyError", () => {
    const err = new DelayedDependencyError(100);
    expect(err.name).toBe("DelayedDependencyError");
  });

  it("exposes delayMs", () => {
    const err = new DelayedDependencyError(1234);
    expect(err.delayMs).toBe(1234);
  });
});
