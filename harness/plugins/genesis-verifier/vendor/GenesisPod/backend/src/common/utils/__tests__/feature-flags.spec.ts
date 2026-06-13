/**
 * Feature Flags Unit Tests
 *
 * Tests for isWorkspaceAiV2Enabled and isFeatureEnabled,
 * covering all truthy/falsy env var values and fallback behavior.
 */

import { isWorkspaceAiV2Enabled, isFeatureEnabled } from "../feature-flags";

describe("Feature Flags", () => {
  // Save and restore env vars around each test
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  // ========== isWorkspaceAiV2Enabled ==========

  describe("isWorkspaceAiV2Enabled", () => {
    // --- WORKSPACE_AI_V2_ENABLED truthy values ---

    it('should return true when WORKSPACE_AI_V2_ENABLED is "true"', () => {
      process.env.WORKSPACE_AI_V2_ENABLED = "true";
      expect(isWorkspaceAiV2Enabled()).toBe(true);
    });

    it('should return true when WORKSPACE_AI_V2_ENABLED is "1"', () => {
      process.env.WORKSPACE_AI_V2_ENABLED = "1";
      expect(isWorkspaceAiV2Enabled()).toBe(true);
    });

    it('should return true when WORKSPACE_AI_V2_ENABLED is "yes"', () => {
      process.env.WORKSPACE_AI_V2_ENABLED = "yes";
      expect(isWorkspaceAiV2Enabled()).toBe(true);
    });

    it('should return true when WORKSPACE_AI_V2_ENABLED is "on"', () => {
      process.env.WORKSPACE_AI_V2_ENABLED = "on";
      expect(isWorkspaceAiV2Enabled()).toBe(true);
    });

    it('should return true when WORKSPACE_AI_V2_ENABLED is "TRUE" (uppercase)', () => {
      process.env.WORKSPACE_AI_V2_ENABLED = "TRUE";
      expect(isWorkspaceAiV2Enabled()).toBe(true);
    });

    it('should return true when WORKSPACE_AI_V2_ENABLED is "YES" (uppercase)', () => {
      process.env.WORKSPACE_AI_V2_ENABLED = "YES";
      expect(isWorkspaceAiV2Enabled()).toBe(true);
    });

    it('should return true when WORKSPACE_AI_V2_ENABLED is "ON" (uppercase)', () => {
      process.env.WORKSPACE_AI_V2_ENABLED = "ON";
      expect(isWorkspaceAiV2Enabled()).toBe(true);
    });

    // --- WORKSPACE_AI_V2_ENABLED falsy values ---

    it('should return false when WORKSPACE_AI_V2_ENABLED is "false"', () => {
      process.env.WORKSPACE_AI_V2_ENABLED = "false";
      expect(isWorkspaceAiV2Enabled()).toBe(false);
    });

    it('should return false when WORKSPACE_AI_V2_ENABLED is "0"', () => {
      process.env.WORKSPACE_AI_V2_ENABLED = "0";
      expect(isWorkspaceAiV2Enabled()).toBe(false);
    });

    it('should return false when WORKSPACE_AI_V2_ENABLED is "no"', () => {
      process.env.WORKSPACE_AI_V2_ENABLED = "no";
      expect(isWorkspaceAiV2Enabled()).toBe(false);
    });

    it('should return false when WORKSPACE_AI_V2_ENABLED is ""', () => {
      process.env.WORKSPACE_AI_V2_ENABLED = "";
      expect(isWorkspaceAiV2Enabled()).toBe(false);
    });

    // --- Fallback to NEXT_PUBLIC_ variant ---

    it("should fall back to NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED when direct is undefined", () => {
      delete process.env.WORKSPACE_AI_V2_ENABLED;
      process.env.NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED = "true";

      expect(isWorkspaceAiV2Enabled()).toBe(true);
    });

    it("should return false from fallback when NEXT_PUBLIC is falsy", () => {
      delete process.env.WORKSPACE_AI_V2_ENABLED;
      process.env.NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED = "false";

      expect(isWorkspaceAiV2Enabled()).toBe(false);
    });

    it("should prefer direct env over NEXT_PUBLIC fallback", () => {
      process.env.WORKSPACE_AI_V2_ENABLED = "false";
      process.env.NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED = "true";

      // Direct var takes precedence
      expect(isWorkspaceAiV2Enabled()).toBe(false);
    });

    it("should return false when both env vars are undefined", () => {
      delete process.env.WORKSPACE_AI_V2_ENABLED;
      delete process.env.NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED;

      expect(isWorkspaceAiV2Enabled()).toBe(false);
    });
  });

  // ========== isFeatureEnabled ==========

  describe("isFeatureEnabled", () => {
    // --- Truthy values ---

    it('should return true when env var is "true"', () => {
      process.env.MY_FEATURE = "true";
      expect(isFeatureEnabled("MY_FEATURE")).toBe(true);
    });

    it('should return true when env var is "1"', () => {
      process.env.MY_FEATURE = "1";
      expect(isFeatureEnabled("MY_FEATURE")).toBe(true);
    });

    it('should return true when env var is "yes"', () => {
      process.env.MY_FEATURE = "yes";
      expect(isFeatureEnabled("MY_FEATURE")).toBe(true);
    });

    it('should return true when env var is "on"', () => {
      process.env.MY_FEATURE = "on";
      expect(isFeatureEnabled("MY_FEATURE")).toBe(true);
    });

    it('should be case-insensitive for "True"', () => {
      process.env.MY_FEATURE = "True";
      expect(isFeatureEnabled("MY_FEATURE")).toBe(true);
    });

    it('should be case-insensitive for "YES"', () => {
      process.env.MY_FEATURE = "YES";
      expect(isFeatureEnabled("MY_FEATURE")).toBe(true);
    });

    // --- Falsy values ---

    it('should return false when env var is "false"', () => {
      process.env.MY_FEATURE = "false";
      expect(isFeatureEnabled("MY_FEATURE")).toBe(false);
    });

    it('should return false when env var is "0"', () => {
      process.env.MY_FEATURE = "0";
      expect(isFeatureEnabled("MY_FEATURE")).toBe(false);
    });

    it('should return false when env var is "off"', () => {
      process.env.MY_FEATURE = "off";
      expect(isFeatureEnabled("MY_FEATURE")).toBe(false);
    });

    it('should return false when env var is ""', () => {
      process.env.MY_FEATURE = "";
      expect(isFeatureEnabled("MY_FEATURE")).toBe(false);
    });

    it('should return false when env var is "no"', () => {
      process.env.MY_FEATURE = "no";
      expect(isFeatureEnabled("MY_FEATURE")).toBe(false);
    });

    // --- Fallback behavior ---

    it("should return false by default when env var is undefined", () => {
      delete process.env.MY_FEATURE;
      expect(isFeatureEnabled("MY_FEATURE")).toBe(false);
    });

    it("should return custom fallback (true) when env var is undefined", () => {
      delete process.env.MY_FEATURE;
      expect(isFeatureEnabled("MY_FEATURE", true)).toBe(true);
    });

    it("should return custom fallback (false) when env var is undefined", () => {
      delete process.env.MY_FEATURE;
      expect(isFeatureEnabled("MY_FEATURE", false)).toBe(false);
    });

    it("should NOT use fallback when env var is defined but falsy", () => {
      // env var is set to "false" — fallback should NOT apply
      process.env.MY_FEATURE = "false";
      expect(isFeatureEnabled("MY_FEATURE", true)).toBe(false);
    });

    it("should NOT use fallback when env var is defined and truthy", () => {
      process.env.MY_FEATURE = "true";
      expect(isFeatureEnabled("MY_FEATURE", false)).toBe(true);
    });

    // --- Different key names ---

    it("should read the correct env var by key", () => {
      process.env.FEATURE_A = "true";
      process.env.FEATURE_B = "false";

      expect(isFeatureEnabled("FEATURE_A")).toBe(true);
      expect(isFeatureEnabled("FEATURE_B")).toBe(false);
    });
  });
});
