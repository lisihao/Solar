import { NoopRuntimeEnvironment } from "../noop-runtime-environment";

describe("NoopRuntimeEnvironment", () => {
  let env: NoopRuntimeEnvironment;

  beforeEach(() => {
    env = new NoopRuntimeEnvironment("test-user", "test-workspace");
  });

  it("exposes userId and workspaceId", () => {
    expect(env.userId).toBe("test-user");
    expect(env.workspaceId).toBe("test-workspace");
  });

  it("uses defaults when not provided", () => {
    const def = new NoopRuntimeEnvironment();
    expect(def.userId).toBe("anonymous");
    expect(def.workspaceId).toBeUndefined();
  });

  describe("getByokStatus", () => {
    it("returns platform", async () => {
      expect(await env.getByokStatus()).toBe("platform");
    });
  });

  describe("getCreditState", () => {
    it("returns max safe integer balance", async () => {
      const state = await env.getCreditState();
      expect(state.balance).toBe(Number.MAX_SAFE_INTEGER);
      expect(state.currency).toBe("credit");
    });
  });

  describe("getModelAvailability", () => {
    it("returns always available", async () => {
      const avail = await env.getModelAvailability("gpt-4o");
      expect(avail.available).toBe(true);
      expect(avail.modelId).toBe("gpt-4o");
    });
  });

  describe("listAvailableModels", () => {
    it("returns empty array", async () => {
      const models = await env.listAvailableModels();
      expect(models).toEqual([]);
    });
  });

  describe("getQuotaSnapshot", () => {
    it("returns empty object", async () => {
      const snap = await env.getQuotaSnapshot();
      expect(snap).toEqual({});
    });
  });

  describe("suggestFallback", () => {
    it("always aborts", async () => {
      const hint = await env.suggestFallback({ reason: "no_credit" });
      expect(hint.action).toBe("abort");
    });

    it("includes reason in message", async () => {
      const hint = await env.suggestFallback({ reason: "rate_limit" });
      expect(hint.reason).toContain("noop runtime");
    });
  });
});
