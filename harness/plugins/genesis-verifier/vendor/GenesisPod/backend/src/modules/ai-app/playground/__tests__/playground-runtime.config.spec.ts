/**
 * playground-runtime.config — unit tests
 *
 * Verifies that:
 *   - All defaults match the documented values when no env is set
 *   - Each knob can be overridden via its env var
 *   - Invalid env values (negatives, junk) fall back to defaults
 *   - Cross-field invariants hold (hardCap >= soft, softWarn >= stale)
 *   - The Zod schema rejects any pathological raw object
 */

import {
  loadPlaygroundRuntimeConfig,
  PlaygroundRuntimeConfigSchema,
} from "../runtime/playground-runtime.config";

describe("playground-runtime.config", () => {
  describe("defaults", () => {
    const cfg = loadPlaygroundRuntimeConfig({} as NodeJS.ProcessEnv);

    it("loads frontier-model-safe defaults when no env vars are set", () => {
      expect(cfg).toEqual({
        minFindingsThreshold: 5,
        chapterToleranceRatio: 0.3,
        staleThresholdMin: 15,
        softWarnThresholdMin: 20,
        // ★ 2026-06-11：guard 墙钟默认降为 0（不限）——卡死改由进度检测回收，
        //   绝对成本兜底走每-mission 档位墙钟（in-shell wallTimer 3h/10h/24h）。
        wallTimeCapMs: 0,
      });
    });
  });

  describe("overrides", () => {
    it("overrides minFindingsThreshold from MIN_FINDINGS_THRESHOLD", () => {
      const cfg = loadPlaygroundRuntimeConfig({
        MIN_FINDINGS_THRESHOLD: "3",
      } as NodeJS.ProcessEnv);
      expect(cfg.minFindingsThreshold).toBe(3);
    });

    it("overrides chapterToleranceRatio from CHAPTER_TOLERANCE_RATIO", () => {
      const cfg = loadPlaygroundRuntimeConfig({
        CHAPTER_TOLERANCE_RATIO: "0.4",
      } as NodeJS.ProcessEnv);
      expect(cfg.chapterToleranceRatio).toBe(0.4);
    });

    it("overrides liveness thresholds", () => {
      const cfg = loadPlaygroundRuntimeConfig({
        PLAYGROUND_STALE_THRESHOLD_MIN: "60",
        PLAYGROUND_SOFT_WARN_THRESHOLD_MIN: "75",
      } as NodeJS.ProcessEnv);
      expect(cfg.staleThresholdMin).toBe(60);
      expect(cfg.softWarnThresholdMin).toBe(75);
    });

    it("overrides wallTimeCapMs from PLAYGROUND_WALL_TIME_CAP_MS", () => {
      const cfg = loadPlaygroundRuntimeConfig({
        PLAYGROUND_WALL_TIME_CAP_MS: "0",
      } as NodeJS.ProcessEnv);
      expect(cfg.wallTimeCapMs).toBe(0); // 0 means "unlimited" upstream
    });
  });

  describe("invalid env values fall back to defaults", () => {
    it("ignores negative integers", () => {
      const cfg = loadPlaygroundRuntimeConfig({
        MIN_FINDINGS_THRESHOLD: "-5",
      } as NodeJS.ProcessEnv);
      expect(cfg.minFindingsThreshold).toBe(5); // default
    });

    it("ignores non-numeric junk", () => {
      const cfg = loadPlaygroundRuntimeConfig({
        PLAYGROUND_STALE_THRESHOLD_MIN: "not-a-number",
      } as NodeJS.ProcessEnv);
      expect(cfg.staleThresholdMin).toBe(15); // default
    });

    it("ignores out-of-range ratio", () => {
      const cfg = loadPlaygroundRuntimeConfig({
        CHAPTER_TOLERANCE_RATIO: "1.5",
      } as NodeJS.ProcessEnv);
      expect(cfg.chapterToleranceRatio).toBe(0.3); // default
    });

    it("ignores 0 for positive-int fields (staleThresholdMin must be >= 1)", () => {
      const cfg = loadPlaygroundRuntimeConfig({
        PLAYGROUND_STALE_THRESHOLD_MIN: "0",
      } as NodeJS.ProcessEnv);
      expect(cfg.staleThresholdMin).toBe(15); // default
    });
  });

  describe("cross-field invariants", () => {
    it("forces softWarnThresholdMin >= staleThresholdMin", () => {
      const cfg = loadPlaygroundRuntimeConfig({
        PLAYGROUND_STALE_THRESHOLD_MIN: "30",
        PLAYGROUND_SOFT_WARN_THRESHOLD_MIN: "3",
      } as NodeJS.ProcessEnv);
      expect(cfg.softWarnThresholdMin).toBe(30);
    });
  });

  describe("schema integrity", () => {
    it("the loaded config always satisfies the Zod schema", () => {
      const cfg = loadPlaygroundRuntimeConfig({} as NodeJS.ProcessEnv);
      expect(PlaygroundRuntimeConfigSchema.safeParse(cfg).success).toBe(true);
    });

    it("the schema rejects a pathological raw object", () => {
      expect(
        PlaygroundRuntimeConfigSchema.safeParse({
          minFindingsThreshold: -1,
        }).success,
      ).toBe(false);
    });
  });
});
