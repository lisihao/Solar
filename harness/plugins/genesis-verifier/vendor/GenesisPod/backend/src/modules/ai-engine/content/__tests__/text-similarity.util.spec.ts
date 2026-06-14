/**
 * text-similarity.util.spec.ts
 *
 * Unit tests for jaccardSimilarity — token-set similarity primitive.
 */

import { jaccardSimilarity } from "../text-similarity.util";

describe("jaccardSimilarity", () => {
  it("returns 1 for identical strings", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    expect(jaccardSimilarity(text, text)).toBe(1);
  });

  it("returns 1 for two empty strings", () => {
    expect(jaccardSimilarity("", "")).toBe(1);
  });

  it("returns 0 for completely disjoint token sets", () => {
    const a = "alpha beta gamma delta epsilon";
    const b = "one two three four five six seven";
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("returns < 1 for partially overlapping texts", () => {
    const a = "the quick brown fox";
    const b = "the quick brown bear runs fast";
    const sim = jaccardSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it("is case-insensitive — same content different case treated as identical", () => {
    const a = "Artificial Intelligence Research";
    const b = "artificial intelligence research";
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("ignores tokens with length <= 2 (stop-word filter)", () => {
    // "is", "a", "an", "in", "to" are all <= 2 chars → filtered out
    // So "is a" vs "is b" have no usable tokens → both empty sets → similarity=1
    expect(jaccardSimilarity("is a", "is b")).toBe(1);
  });

  it("filters short tokens correctly — token set overlap determines similarity", () => {
    // filter is length > 2 (i.e., >= 3 chars), so "the", "cat", "sat", "mat", "dog", "rug"
    // are all included (each has 3 chars).
    // a tokens: {"the","cat","sat","mat"} (4 unique)
    // b tokens: {"the","dog","sat","rug"} (4 unique)
    // intersection: {"the","sat"} (2)  union: 6  → Jaccard = 2/6 ≈ 0.333
    const a = "the cat sat on the mat";
    const b = "the dog sat on the rug";
    expect(jaccardSimilarity(a, b)).toBeCloseTo(1 / 3, 5);
  });

  it("detects high similarity (> 0.9) for nearly-identical long texts", () => {
    // 19 shared + 1 unique each → intersection=19, union=21 → 19/21 ≈ 0.905
    const shared19 =
      "alpha beta gamma delta epsilon zeta theta kappa lambda sigma tau upsilon phi omicron rho iota psi chi omega".split(
        " ",
      );
    const baseStr2 = [...shared19, "uniquewordone"].join(" ");
    const almostStr2 = [...shared19, "uniquewordtwo"].join(" ");
    expect(jaccardSimilarity(baseStr2, almostStr2)).toBeGreaterThan(0.9);
  });

  it("detects low similarity (< 0.1) for very different texts", () => {
    const a =
      "quantum computing hardware transistor semiconductor photon laser optical";
    const b =
      "medieval history renaissance painting sculpture literature philosophy";
    expect(jaccardSimilarity(a, b)).toBeLessThan(0.1);
  });

  it("handles whitespace normalization — multiple spaces treated same as single", () => {
    const a = "deep  learning  models";
    const b = "deep learning models";
    expect(jaccardSimilarity(a, b)).toBe(1);
  });
});
