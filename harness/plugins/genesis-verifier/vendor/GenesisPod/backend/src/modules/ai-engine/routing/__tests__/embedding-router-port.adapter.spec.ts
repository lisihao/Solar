import { EmbeddingRouterPort } from "../embedding-router-port.adapter";
import type { EmbeddingService } from "../../rag/embedding";

function makeService(
  impl: (text: string) => Promise<{ embedding: number[] }>,
): { svc: EmbeddingService; calls: () => number } {
  let n = 0;
  const svc = {
    generateEmbedding: jest.fn(async (text: string) => {
      n++;
      return impl(text);
    }),
  } as unknown as EmbeddingService;
  return { svc, calls: () => n };
}

describe("EmbeddingRouterPort", () => {
  it("caches by text — same description not re-embedded", async () => {
    const { svc, calls } = makeService(async () => ({ embedding: [1, 2, 3] }));
    const port = new EmbeddingRouterPort(svc);

    const a = await port.embed("arxiv academic search", "document");
    const b = await port.embed("arxiv academic search", "document");

    expect(a).toEqual([1, 2, 3]);
    expect(b).toEqual([1, 2, 3]);
    expect(calls()).toBe(1); // 第二次命中缓存
    expect(port.cacheSize).toBe(1);
  });

  it("separate cache slots per kind", async () => {
    const { svc, calls } = makeService(async () => ({ embedding: [1] }));
    const port = new EmbeddingRouterPort(svc);
    await port.embed("same text", "query");
    await port.embed("same text", "document");
    expect(calls()).toBe(2); // query / document 各算一次
  });

  it("returns null (degrade) when embedding throws — no throw propagated", async () => {
    const { svc } = makeService(async () => {
      throw new Error("circuit-open");
    });
    const port = new EmbeddingRouterPort(svc);
    await expect(port.embed("x", "query")).resolves.toBeNull();
  });

  it("blank text → null without calling service", async () => {
    const { svc, calls } = makeService(async () => ({ embedding: [1] }));
    const port = new EmbeddingRouterPort(svc);
    expect(await port.embed("   ", "document")).toBeNull();
    expect(calls()).toBe(0);
  });
});
