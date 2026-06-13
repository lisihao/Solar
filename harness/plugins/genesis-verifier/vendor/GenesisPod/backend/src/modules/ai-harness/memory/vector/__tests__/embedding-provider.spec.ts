import { NoopEmbeddingProvider } from "../embedding-provider";

describe("NoopEmbeddingProvider", () => {
  it("has id=noop", () => {
    const p = new NoopEmbeddingProvider();
    expect(p.id).toBe("noop");
  });

  it("uses default dim=8", () => {
    const p = new NoopEmbeddingProvider();
    expect(p.dim).toBe(8);
  });

  it("accepts custom dim", () => {
    const p = new NoopEmbeddingProvider(16);
    expect(p.dim).toBe(16);
  });

  describe("embed()", () => {
    it("returns vector of correct dimension", async () => {
      const p = new NoopEmbeddingProvider(4);
      const v = await p.embed("hello");
      expect(v.length).toBe(4);
    });

    it("returns normalized vector (unit length ≈ 1)", async () => {
      const p = new NoopEmbeddingProvider(8);
      const v = await p.embed("test text for normalization");
      const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
      expect(norm).toBeCloseTo(1, 5);
    });

    it("returns zero vector for empty string", async () => {
      const p = new NoopEmbeddingProvider(4);
      const v = await p.embed("");
      // all zeros -> norm=0 -> divides by 1 -> [0,0,0,0]
      v.forEach((x) => expect(x).toBe(0));
    });

    it("produces different vectors for different texts", async () => {
      const p = new NoopEmbeddingProvider(8);
      const v1 = await p.embed("hello world");
      const v2 = await p.embed("goodbye moon");
      const same = v1.every((x, i) => x === v2[i]);
      expect(same).toBe(false);
    });
  });

  describe("embedBatch()", () => {
    it("returns correct number of embeddings", async () => {
      const p = new NoopEmbeddingProvider(4);
      const results = await p.embedBatch(["a", "b", "c"]);
      expect(results.length).toBe(3);
      results.forEach((v) => expect(v.length).toBe(4));
    });

    it("returns empty array for empty batch", async () => {
      const p = new NoopEmbeddingProvider(4);
      const results = await p.embedBatch([]);
      expect(results).toHaveLength(0);
    });
  });
});
