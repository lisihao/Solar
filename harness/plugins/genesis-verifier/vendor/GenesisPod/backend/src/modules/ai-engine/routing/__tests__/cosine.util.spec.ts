import { cosineSimilarity, relevanceScore } from "../cosine.util";

describe("cosine.util", () => {
  describe("cosineSimilarity", () => {
    it("identical vectors → 1", () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    });

    it("orthogonal vectors → 0", () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    });

    it("opposite vectors → -1", () => {
      expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 6);
    });

    it("dimension mismatch → 0 (safe degrade, no throw)", () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    });

    it("zero vector → 0 (no NaN)", () => {
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });

    it("empty → 0", () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });
  });

  describe("relevanceScore", () => {
    it("cosine 1 → full mark", () => {
      expect(relevanceScore(1, 40)).toBe(40);
    });
    it("cosine -1 → 0", () => {
      expect(relevanceScore(-1, 40)).toBe(0);
    });
    it("cosine 0 → half", () => {
      expect(relevanceScore(0, 40)).toBe(20);
    });
  });
});
