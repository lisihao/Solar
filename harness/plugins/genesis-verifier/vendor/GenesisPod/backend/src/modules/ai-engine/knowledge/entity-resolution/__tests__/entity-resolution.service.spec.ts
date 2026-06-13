/**
 * EntityResolutionService Unit Tests
 *
 * 离线单测：用预置 mock 向量喂 EmbeddingService，验证：
 *   - 同义/跨语言/缩写归并为 1 实体
 *   - 形近但不同实体不误并（反例）
 *   - 精确去重短路、阈值可调、cosine 正确
 * 不依赖真实 embedding 服务（属集成/部署态）。
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EntityResolutionService } from "../entity-resolution.service";
import { EmbeddingService } from "../../../rag/embedding";

// 受控向量空间：靠向量距离精确控制聚类行为。
// nvidia 家族（3 个变体）几乎同向；smic(中芯国际) 另一方向；intel 第三方向。
const VEC: Record<string, number[]> = {
  // NVIDIA 家族 —— 高度相似（cos ~0.999）
  nvidia: [1, 0, 0, 0],
  "nvidia corp": [0.99, 0.1, 0, 0],
  英伟达: [0.98, 0.15, 0, 0],
  // SMIC —— 与 nvidia 正交（cos ~0），且两个 SMIC 变体彼此相似
  "中芯国际": [0, 1, 0, 0],
  smic: [0, 0.99, 0.1, 0],
  // Intel —— 又一独立方向
  intel: [0, 0, 1, 0],
};

function mockEmbeddingService(): Pick<EmbeddingService, "generateEmbeddings"> {
  return {
    generateEmbeddings: jest.fn(async (texts: string[]) => ({
      texts,
      embeddings: texts.map((t) => VEC[t.toLowerCase()] ?? VEC[t] ?? [0, 0, 0, 1]),
      totalTokens: texts.length,
    })),
  } as unknown as EmbeddingService;
}

describe("EntityResolutionService", () => {
  let service: EntityResolutionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntityResolutionService,
        { provide: EmbeddingService, useValue: mockEmbeddingService() },
      ],
    }).compile();
    service = module.get(EntityResolutionService);
  });

  it("把 NVIDIA / Nvidia Corp / 英伟达 归并为 1 实体", async () => {
    const res = await service.resolve(["NVIDIA", "Nvidia Corp", "英伟达"]);
    expect(res.clusters.length).toBe(1);
    expect(res.clusters[0].members.sort()).toEqual(
      ["NVIDIA", "Nvidia Corp", "英伟达"].sort(),
    );
    // canonical = 最长成员
    expect(res.clusters[0].canonical).toBe("Nvidia Corp");
    expect(res.canonicalOf["英伟达"]).toBe("Nvidia Corp");
  });

  it("形近但不同的实体不误并（NVIDIA vs 中芯国际 vs Intel）", async () => {
    const res = await service.resolve(["NVIDIA", "中芯国际", "Intel"]);
    expect(res.clusters.length).toBe(3);
  });

  it("跨簇混合输入正确分组（3 类）", async () => {
    const res = await service.resolve([
      "NVIDIA",
      "英伟达",
      "中芯国际",
      "SMIC",
      "Intel",
    ]);
    expect(res.clusters.length).toBe(3);
    const sizes = res.clusters.map((c) => c.members.length).sort();
    expect(sizes).toEqual([1, 2, 2]);
  });

  it("归一化精确去重：大小写/空白差异视为同一名", async () => {
    const res = await service.resolve(["NVIDIA", " nvidia ", "NVIDIA"]);
    // 归一化后是同一 key → 单簇短路，不调 embedding
    expect(res.clusters.length).toBe(1);
    expect(res.clusters[0].members).toContain("NVIDIA");
  });

  it("空输入返回空结果", async () => {
    const res = await service.resolve([]);
    expect(res.clusters).toEqual([]);
    expect(res.canonicalOf).toEqual({});
  });

  it("阈值可调：极高阈值拆散近似实体", async () => {
    const res = await service.resolve(["NVIDIA", "英伟达"], { threshold: 0.999 });
    // 0.98/0.15 与 1/0/0 的 cos < 0.999 → 不并
    expect(res.clusters.length).toBe(2);
  });

  it("cosineSimilarity 正确（同向=1，正交=0）", () => {
    expect(EntityResolutionService.cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(EntityResolutionService.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(EntityResolutionService.cosineSimilarity([1, 0], [0, 0])).toBe(0);
  });
});
