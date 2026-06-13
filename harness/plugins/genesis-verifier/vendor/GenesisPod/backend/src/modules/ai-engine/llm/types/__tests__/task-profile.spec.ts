/**
 * Unit tests for task-profile.types.ts constants
 * These tests verify that mapping constants have the correct values
 * and that no entries are missing.
 */

import {
  CREATIVITY_TO_TEMPERATURE,
  OUTPUT_LENGTH_TO_TOKENS,
  REASONING_MODEL_MIN_TOKENS,
  JSON_OUTPUT_MAX_TEMPERATURE,
  MODEL_KNOWN_LIMITS,
  CreativityLevel,
  OutputLengthLevel,
} from "../task-profile.types";

// ==================== CREATIVITY_TO_TEMPERATURE ====================

describe("CREATIVITY_TO_TEMPERATURE", () => {
  it("has exactly 4 creativity levels", () => {
    const keys = Object.keys(CREATIVITY_TO_TEMPERATURE);
    expect(keys).toHaveLength(4);
  });

  it("maps deterministic to 0.1", () => {
    expect(CREATIVITY_TO_TEMPERATURE.deterministic).toBe(0.1);
  });

  it("maps low to 0.3", () => {
    expect(CREATIVITY_TO_TEMPERATURE.low).toBe(0.3);
  });

  it("maps medium to 0.7", () => {
    expect(CREATIVITY_TO_TEMPERATURE.medium).toBe(0.7);
  });

  it("maps high to 0.9", () => {
    expect(CREATIVITY_TO_TEMPERATURE.high).toBe(0.9);
  });

  it("contains all required CreativityLevel keys", () => {
    const requiredLevels: CreativityLevel[] = [
      "deterministic",
      "low",
      "medium",
      "high",
    ];
    requiredLevels.forEach((level) => {
      expect(CREATIVITY_TO_TEMPERATURE).toHaveProperty(level);
    });
  });

  it("temperatures are ordered from low to high", () => {
    const temps = [
      CREATIVITY_TO_TEMPERATURE.deterministic,
      CREATIVITY_TO_TEMPERATURE.low,
      CREATIVITY_TO_TEMPERATURE.medium,
      CREATIVITY_TO_TEMPERATURE.high,
    ];
    for (let i = 1; i < temps.length; i++) {
      expect(temps[i]).toBeGreaterThan(temps[i - 1]);
    }
  });
});

// ==================== OUTPUT_LENGTH_TO_TOKENS ====================

describe("OUTPUT_LENGTH_TO_TOKENS", () => {
  it("has exactly 6 output length levels", () => {
    const keys = Object.keys(OUTPUT_LENGTH_TO_TOKENS);
    expect(keys).toHaveLength(6);
  });

  it("maps minimal to 500", () => {
    expect(OUTPUT_LENGTH_TO_TOKENS.minimal).toBe(500);
  });

  it("maps short to 1500", () => {
    expect(OUTPUT_LENGTH_TO_TOKENS.short).toBe(1500);
  });

  it("maps medium to 4000", () => {
    expect(OUTPUT_LENGTH_TO_TOKENS.medium).toBe(4000);
  });

  it("maps standard to 6000", () => {
    expect(OUTPUT_LENGTH_TO_TOKENS.standard).toBe(6000);
  });

  it("maps long to 8000", () => {
    expect(OUTPUT_LENGTH_TO_TOKENS.long).toBe(8000);
  });

  it("maps extended to 16000", () => {
    expect(OUTPUT_LENGTH_TO_TOKENS.extended).toBe(16000);
  });

  it("contains all required OutputLengthLevel keys", () => {
    const requiredLevels: OutputLengthLevel[] = [
      "minimal",
      "short",
      "medium",
      "standard",
      "long",
      "extended",
    ];
    requiredLevels.forEach((level) => {
      expect(OUTPUT_LENGTH_TO_TOKENS).toHaveProperty(level);
    });
  });

  it("token counts are in ascending order", () => {
    const counts = [
      OUTPUT_LENGTH_TO_TOKENS.minimal,
      OUTPUT_LENGTH_TO_TOKENS.short,
      OUTPUT_LENGTH_TO_TOKENS.medium,
      OUTPUT_LENGTH_TO_TOKENS.standard,
      OUTPUT_LENGTH_TO_TOKENS.long,
      OUTPUT_LENGTH_TO_TOKENS.extended,
    ];
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    }
  });
});

// ==================== Scalar constants ====================

describe("REASONING_MODEL_MIN_TOKENS", () => {
  it("equals 25000", () => {
    expect(REASONING_MODEL_MIN_TOKENS).toBe(25000);
  });

  it("is a number", () => {
    expect(typeof REASONING_MODEL_MIN_TOKENS).toBe("number");
  });
});

describe("JSON_OUTPUT_MAX_TEMPERATURE", () => {
  it("equals 0.3", () => {
    expect(JSON_OUTPUT_MAX_TEMPERATURE).toBe(0.3);
  });

  it("is a number", () => {
    expect(typeof JSON_OUTPUT_MAX_TEMPERATURE).toBe("number");
  });
});

// ==================== MODEL_KNOWN_LIMITS ====================

describe("MODEL_KNOWN_LIMITS", () => {
  it("is an Array", () => {
    expect(Array.isArray(MODEL_KNOWN_LIMITS)).toBe(true);
  });

  it("is non-empty", () => {
    expect(MODEL_KNOWN_LIMITS.length).toBeGreaterThan(0);
  });

  it("every entry is a tuple [string, number]", () => {
    MODEL_KNOWN_LIMITS.forEach(([prefix, limit]) => {
      expect(typeof prefix).toBe("string");
      expect(typeof limit).toBe("number");
      expect(limit).toBeGreaterThan(0);
    });
  });

  it("gpt-4o-mini appears before gpt-4o (prefix-match ordering)", () => {
    const prefixes = MODEL_KNOWN_LIMITS.map(([p]) => p);
    const miniIndex = prefixes.indexOf("gpt-4o-mini");
    const baseIndex = prefixes.indexOf("gpt-4o");
    expect(miniIndex).toBeGreaterThanOrEqual(0);
    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(miniIndex).toBeLessThan(baseIndex);
  });

  it("contains expected OpenAI models", () => {
    const prefixes = MODEL_KNOWN_LIMITS.map(([p]) => p);
    ["gpt-4o-mini", "gpt-4o", "gpt-4", "o1", "o3"].forEach((model) => {
      expect(prefixes).toContain(model);
    });
  });

  it("contains expected Anthropic models", () => {
    const prefixes = MODEL_KNOWN_LIMITS.map(([p]) => p);
    ["claude-3.5-sonnet", "claude-3-opus"].forEach((model) => {
      expect(prefixes).toContain(model);
    });
  });

  it("all token limits are positive integers", () => {
    MODEL_KNOWN_LIMITS.forEach(([, limit]) => {
      expect(Number.isInteger(limit)).toBe(true);
      expect(limit).toBeGreaterThan(0);
    });
  });
});

