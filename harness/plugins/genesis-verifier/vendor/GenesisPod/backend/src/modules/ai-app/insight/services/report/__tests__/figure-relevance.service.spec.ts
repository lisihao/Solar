/**
 * FigureRelevanceService Tests (v17 — Embedding 方案)
 *
 * 替换原 Vision LLM 测试 → 测试新 Embedding 过滤逻辑
 *
 * 核心行为：
 * ① chart/table/diagram → 直接保留（0 API 调用）
 * ② photo, caption < 10 chars → 直接拒绝
 * ③ photo, 有效 caption → cosine(caption, topicTitle) >= 0.35 → 保留
 * ④ Embedding 失败 → fail-open（保留有效 caption 的 photo）
 */

import { Test, TestingModule } from "@nestjs/testing";
import { FigureRelevanceService } from "../figure-relevance.service";
import { AIFacade } from "@/modules/ai-harness/facade";
import type { ExtractedFigure } from "../../../types/research.types";

// ============================================================
// Helpers
// ============================================================

const makeChart = (url = "https://example.com/chart.png"): ExtractedFigure => ({
  imageUrl: url,
  caption: "Chart showing AI adoption rates over time",
  type: "chart",
  alt: "AI adoption chart",
});

const makeTable = (url = "https://example.com/table.png"): ExtractedFigure => ({
  imageUrl: url,
  caption: "Table of model performance benchmarks",
  type: "table",
  alt: "Performance table",
});

const makeDiagram = (
  url = "https://example.com/diagram.png",
): ExtractedFigure => ({
  imageUrl: url,
  caption: "Architecture diagram of the AI pipeline",
  type: "diagram",
  alt: "Pipeline architecture",
});

const makePhoto = (
  caption: string,
  url = "https://example.com/photo.jpg",
): ExtractedFigure => ({
  imageUrl: url,
  caption,
  type: "photo",
  alt: "",
});

/** 生成长度为 n 的随机浮点数向量（单位化） */
const makeVec = (n = 1536, seed = 1): number[] => {
  const arr: number[] = Array.from({ length: n }, (_, i) => Math.sin(i * seed));
  const mag = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  return arr.map((v) => v / mag);
};

/** 高相似度向量（cosine ≈ 1） */
const TOPIC_VEC = makeVec(1536, 1);
const HIGH_SIM_VEC = makeVec(1536, 1); // 同 seed → cosine = 1.0

/** 低相似度向量（cosine ≈ 0.1） */
const LOW_SIM_VEC = makeVec(1536, 999);

// ============================================================
// Mocks
// ============================================================

const mockEngineFacade = {
  /** @deprecated 保留作 spec 兼容字段，新代码走 embeddingGenerateBatch */
  embeddingGenerate: jest.fn(),
  embeddingGenerateBatch: jest.fn(),
};

/**
 * 帮助函数：把 spec 用的 embeddingGenerate(text)→{embedding} 风格 mock
 * 自动转成 batch API 期望的输入。
 *
 * 调用方先用 mockEngineFacade.embeddingGenerate.mockResolvedValueOnce(...) 设期望值，
 * 然后调 wireBatchFromSingleMock() 让 batch mock 串起来：第 1 个 text 是 topicTitle，
 * 之后是 captions —— 按调用顺序消耗 single mock 队列。
 */
function wireBatchFromSingleMock() {
  mockEngineFacade.embeddingGenerateBatch.mockImplementation(
    async (texts: string[]) => {
      const embeddings: number[][] = [];
      for (let i = 0; i < texts.length; i++) {
        const single = await mockEngineFacade.embeddingGenerate(texts[i]);
        embeddings.push(single?.embedding ?? []);
      }
      return { texts, embeddings, totalTokens: texts.length * 100 };
    },
  );
}

// ============================================================
// Test Suite
// ============================================================

describe("FigureRelevanceService (v17 Embedding)", () => {
  let service: FigureRelevanceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    wireBatchFromSingleMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FigureRelevanceService,
        { provide: AIFacade, useValue: mockEngineFacade },
      ],
    }).compile();

    service = module.get<FigureRelevanceService>(FigureRelevanceService);
  });

  // ============================================================
  // 基础行为
  // ============================================================

  describe("filterRelevantFigures — 基础", () => {
    it("should return empty array for empty input", async () => {
      const result = await service.filterRelevantFigures([], "AI Research");
      expect(result).toEqual([]);
      expect(mockEngineFacade.embeddingGenerate).not.toHaveBeenCalled();
    });

    it("should keep all charts without any embedding calls", async () => {
      const figures = [makeChart(), makeTable(), makeDiagram()];
      const result = await service.filterRelevantFigures(
        figures,
        "AI Research",
      );
      expect(result).toHaveLength(3);
      expect(mockEngineFacade.embeddingGenerate).not.toHaveBeenCalled();
    });

    it("should reject photo with no caption (undefined/empty)", async () => {
      const figures = [
        makePhoto(""), // empty string
        {
          ...makePhoto(""),
          caption: undefined,
          alt: undefined,
        } as unknown as ExtractedFigure, // undefined
      ];
      const result = await service.filterRelevantFigures(
        figures,
        "AI Research",
      );
      expect(result).toHaveLength(0);
      expect(mockEngineFacade.embeddingGenerate).not.toHaveBeenCalled();
    });

    it("should reject photo with caption shorter than 10 chars", async () => {
      const figures = [
        makePhoto("AI"), // 2 chars
        makePhoto("Graph"), // 5 chars
        makePhoto("Short"), // 5 chars
      ];
      const result = await service.filterRelevantFigures(
        figures,
        "AI Research",
      );
      expect(result).toHaveLength(0);
      expect(mockEngineFacade.embeddingGenerate).not.toHaveBeenCalled();
    });

    it("should keep photo with cosine >= 0.35 (high similarity)", async () => {
      // topicTitle embedding → TOPIC_VEC, caption embedding → HIGH_SIM_VEC (cosine=1.0)
      mockEngineFacade.embeddingGenerate
        .mockResolvedValueOnce({ embedding: TOPIC_VEC }) // topicTitle
        .mockResolvedValueOnce({ embedding: HIGH_SIM_VEC }); // caption

      const figures = [
        makePhoto("AI agent adoption rates by enterprise sector"),
      ];
      const result = await service.filterRelevantFigures(
        figures,
        "AI adoption",
      );
      expect(result).toHaveLength(1);
    });

    it("should reject photo with cosine < 0.35 (low similarity)", async () => {
      mockEngineFacade.embeddingGenerate
        .mockResolvedValueOnce({ embedding: TOPIC_VEC })
        .mockResolvedValueOnce({ embedding: LOW_SIM_VEC }); // very different

      const figures = [
        makePhoto("Celebration photo from the conference dinner gala"),
      ];
      const result = await service.filterRelevantFigures(
        figures,
        "AI chip market analysis",
      );
      expect(result).toHaveLength(0);
    });
  });

  // ============================================================
  // topicTitle embedding 缓存（只调用一次）
  // ============================================================

  describe("topicTitle embedding 缓存", () => {
    it("should call embeddingGenerate for topicTitle only once for multiple photos", async () => {
      // 3 photos with valid captions → topic embedding should be called once, 3 caption embeddings
      mockEngineFacade.embeddingGenerate.mockResolvedValue({
        embedding: TOPIC_VEC,
      });

      const figures = [
        makePhoto(
          "AI agent adoption rates by enterprise",
          "https://ex.com/1.jpg",
        ),
        makePhoto(
          "Machine learning model performance benchmark",
          "https://ex.com/2.jpg",
        ),
        makePhoto(
          "Generative AI revenue forecast chart data",
          "https://ex.com/3.jpg",
        ),
      ];

      await service.filterRelevantFigures(figures, "AI Research");

      // 1 topicTitle + 3 captions = 4 total
      expect(mockEngineFacade.embeddingGenerate).toHaveBeenCalledTimes(4);
      // First call is for the topicTitle
      expect(mockEngineFacade.embeddingGenerate.mock.calls[0][0]).toBe(
        "AI Research",
      );
    });

    it("should not call embeddingGenerate at all when all figures are chart/table/diagram", async () => {
      const figures = [makeChart(), makeTable(), makeDiagram(), makeChart()];
      await service.filterRelevantFigures(figures, "AI Research");
      expect(mockEngineFacade.embeddingGenerate).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Fail-open 行为
  // ============================================================

  describe("fail-open 行为", () => {
    it("should fail-open when topicTitle embedding returns null (API unavailable)", async () => {
      mockEngineFacade.embeddingGenerate
        .mockResolvedValueOnce(null) // topicTitle → null
        .mockResolvedValueOnce({ embedding: HIGH_SIM_VEC }); // caption → fine

      const figures = [
        makePhoto("AI agent adoption rates by enterprise sector"),
      ];
      const result = await service.filterRelevantFigures(
        figures,
        "AI Research",
      );
      // fail-open: can't compute cosine → keep
      expect(result).toHaveLength(1);
    });

    it("should fail-open when caption embedding throws", async () => {
      mockEngineFacade.embeddingGenerate
        .mockResolvedValueOnce({ embedding: TOPIC_VEC }) // topicTitle OK
        .mockRejectedValueOnce(new Error("API timeout")); // caption throws

      const figures = [
        makePhoto("AI agent adoption rates by enterprise sector"),
      ];
      const result = await service.filterRelevantFigures(
        figures,
        "AI Research",
      );
      // typeBasedFallback: photo + caption >= 10 chars → keep
      expect(result).toHaveLength(1);
    });

    it("should fail-open when embedding returns empty vector []", async () => {
      mockEngineFacade.embeddingGenerate
        .mockResolvedValueOnce({ embedding: [] }) // topicTitle → empty vector
        .mockResolvedValueOnce({ embedding: HIGH_SIM_VEC }); // caption

      const figures = [
        makePhoto("AI agent adoption rates by enterprise sector"),
      ];
      const result = await service.filterRelevantFigures(
        figures,
        "AI Research",
      );
      // empty vector → fail-open
      expect(result).toHaveLength(1);
    });

    it("should keep informational types even when all embedding calls fail", async () => {
      mockEngineFacade.embeddingGenerate.mockRejectedValue(new Error("outage"));

      const figures = [
        makeChart(),
        makeTable(),
        makeDiagram(),
        makePhoto("Stock market celebration photo from annual gala event"), // caption >= 10
      ];

      const result = await service.filterRelevantFigures(
        figures,
        "AI Research",
      );
      // chart/table/diagram: no embedding needed → kept (3)
      // photo: embedding fails → typeBasedFallback(caption >= 10) → kept (1)
      expect(result).toHaveLength(4);
    });
  });

  // ============================================================
  // typeBasedFallback (B2 fix)
  // ============================================================

  describe("typeBasedFallback (B2 fix)", () => {
    it("should keep photo with caption >= 10 chars in fallback", async () => {
      mockEngineFacade.embeddingGenerate.mockRejectedValue(new Error("outage"));
      const figures = [makePhoto("AI adoption rates enterprise data 2024")];
      const result = await service.filterRelevantFigures(
        figures,
        "AI Research",
      );
      expect(result).toHaveLength(1);
    });

    it("should reject photo with caption < 10 chars in fallback", async () => {
      // Caption < 10 chars is rejected at path 2 BEFORE embedding, so fallback never reached
      // but confirm behavior is consistent
      const figures = [makePhoto("AI")];
      const result = await service.filterRelevantFigures(
        figures,
        "AI Research",
      );
      expect(result).toHaveLength(0);
      expect(mockEngineFacade.embeddingGenerate).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // 业务场景仿真
  // ============================================================

  describe("业务场景仿真", () => {
    it("AI 政策话题: chart 全保留，无 caption photo 全拒绝，有效 photo 按相似度过滤", async () => {
      // topicTitle + 2 valid-caption photos
      mockEngineFacade.embeddingGenerate
        .mockResolvedValueOnce({ embedding: TOPIC_VEC }) // topicTitle
        .mockResolvedValueOnce({ embedding: HIGH_SIM_VEC }) // "AI regulation policy data" → high sim → keep
        .mockResolvedValueOnce({ embedding: LOW_SIM_VEC }); // "Celebration dinner photo annual" → low sim → reject

      const figures = [
        makeChart("https://fred.stlouisfed.org/chart.png"), // chart → keep (no embedding)
        makePhoto(""), // empty caption → reject (no embedding)
        makeChart("https://pewresearch.org/chart.png"), // chart → keep (no embedding)
        makePhoto(
          "AI regulation policy data enforcement report",
          "https://example.com/policy.jpg",
        ), // keep
        makePhoto(
          "Celebration dinner photo annual gala event award ceremony",
          "https://cdn.reuters.com/dinner.jpg",
        ), // reject
      ];

      const result = await service.filterRelevantFigures(
        figures,
        "美国 AI 政策与监管趋势",
      );

      expect(result).toHaveLength(3);
      // charts kept
      expect(result.filter((f) => f.type === "chart")).toHaveLength(2);
      // policy photo kept, celebration photo rejected
      expect(result.find((f) => f.imageUrl.includes("policy"))).toBeDefined();
      expect(result.find((f) => f.imageUrl.includes("dinner"))).toBeUndefined();
      // topicTitle embedding called once
      expect(mockEngineFacade.embeddingGenerate).toHaveBeenCalledTimes(3);
    });

    it("Embedding 完全不可用时: chart/table/diagram 保留，有效 caption photo 保留（fail-open）", async () => {
      mockEngineFacade.embeddingGenerate.mockRejectedValue(
        new Error("service down"),
      );

      const figures = [
        makeChart(),
        makePhoto(""), // no caption → path 2 reject (before embedding)
        makeTable(),
        makePhoto("Annual summit keynote celebrating innovation"), // valid caption → fail-open
        makeDiagram(),
      ];

      const result = await service.filterRelevantFigures(
        figures,
        "AI Research",
      );

      // chart + table + diagram = 3, photo no-caption = 0, photo valid = 1 (fail-open)
      expect(result).toHaveLength(4);
      expect(result.filter((f) => f.type === "photo")).toHaveLength(1);
    });

    // ★ 2026-05-05 batch 化改造后：batch 语义不再支持"单张 photo 失败不影响其他"
    //   （batch 一次失败 = 整组 fallback）。以下测试改为 batch 全部成功 + 部分
    //   高/低 cosine 的混合场景，覆盖"按相似度筛选"的核心业务分支。
    it("batch 成功 + 部分 cosine 高/低 — 高保留低拒绝", async () => {
      mockEngineFacade.embeddingGenerate
        .mockResolvedValueOnce({ embedding: TOPIC_VEC }) // topicTitle
        .mockResolvedValueOnce({ embedding: HIGH_SIM_VEC }) // photo 1 → keep
        .mockResolvedValueOnce({ embedding: HIGH_SIM_VEC }) // photo 2 → keep
        .mockResolvedValueOnce({ embedding: LOW_SIM_VEC }); // photo 3 → reject

      const figures = [
        makePhoto(
          "AI agent deployment enterprise adoption data 2024",
          "https://ex.com/1.jpg",
        ),
        makePhoto(
          "Technology adoption rate market analysis report",
          "https://ex.com/2.jpg",
        ),
        makePhoto(
          "Award ceremony gala dinner celebration annual event",
          "https://ex.com/3.jpg",
        ),
      ];

      const result = await service.filterRelevantFigures(
        figures,
        "AI Research",
      );

      expect(result).toHaveLength(2);
      expect(result.find((f) => f.imageUrl.includes("3.jpg"))).toBeUndefined();
    });
  });
});
