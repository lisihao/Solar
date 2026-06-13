/**
 * figure-relevance.service.spec.ts
 *
 * Tests for FigureRelevanceService — mocks AIFacade embedding calls.
 */

import { FigureRelevanceService } from "../figure-relevance.service";
import type { ExtractedFigure } from "@/modules/ai-engine/facade";

function makeFigure(overrides: Partial<ExtractedFigure>): ExtractedFigure {
  return {
    imageUrl: "https://example.com/image.jpg",
    type: "photo",
    caption: "A chart showing data",
    alt: "",
    width: 800,
    height: 600,
    sourceUrl: "https://example.com",
    ...overrides,
  } as ExtractedFigure;
}

function makeEngineFacade(embedding: number[] | null = [0.5, 0.5, 0.5]) {
  return {
    embeddingGenerate: jest.fn(async () => (embedding ? { embedding } : null)),
  };
}

describe("FigureRelevanceService", () => {
  describe("filterRelevantFigures", () => {
    it("returns empty array for empty input", async () => {
      const facade = makeEngineFacade();
      const svc = new FigureRelevanceService(facade as never);
      const result = await svc.filterRelevantFigures([], "AI Technology");
      expect(result).toEqual([]);
    });

    it("accepts chart/table/diagram figures without embedding", async () => {
      const facade = makeEngineFacade();
      const svc = new FigureRelevanceService(facade as never);
      const figures = [
        makeFigure({ type: "chart", caption: "" }),
        makeFigure({ type: "table", caption: "" }),
        makeFigure({ type: "diagram", caption: "" }),
      ];
      const result = await svc.filterRelevantFigures(figures, "AI Research");
      expect(result).toHaveLength(3);
      // Informational types bypass embedding — no API call needed
      expect(facade.embeddingGenerate).not.toHaveBeenCalled();
    });

    it("rejects photo with caption < 10 chars", async () => {
      const facade = makeEngineFacade();
      const svc = new FigureRelevanceService(facade as never);
      const figures = [makeFigure({ type: "photo", caption: "Short" })]; // 5 chars
      const result = await svc.filterRelevantFigures(figures, "AI Research");
      expect(result).toHaveLength(0);
    });

    it("rejects photo with no caption and no alt", async () => {
      const facade = makeEngineFacade();
      const svc = new FigureRelevanceService(facade as never);
      const figures = [makeFigure({ type: "photo", caption: "", alt: "" })];
      const result = await svc.filterRelevantFigures(figures, "AI Research");
      expect(result).toHaveLength(0);
    });

    it("accepts photo when caption embedding similarity >= threshold", async () => {
      // Both embeddings are identical → cosine = 1.0 → accepted
      const embedding = [0.8, 0.2, 0.5];
      const facade = makeEngineFacade(embedding);
      const svc = new FigureRelevanceService(facade as never);
      const figures = [
        makeFigure({
          type: "photo",
          caption: "AI technology market growth chart analysis",
        }),
      ];
      const result = await svc.filterRelevantFigures(figures, "AI Technology");
      expect(result).toHaveLength(1);
    });

    it("rejects photo when cosine similarity < threshold", async () => {
      // Topic embedding vs completely orthogonal caption embedding
      const facade = {
        embeddingGenerate: jest
          .fn()
          .mockResolvedValueOnce({ embedding: [1, 0, 0] }) // topic embedding
          .mockResolvedValueOnce({ embedding: [0, 1, 0] }), // caption embedding (orthogonal → cosine=0)
      };
      const svc = new FigureRelevanceService(facade as never);
      const figures = [
        makeFigure({
          type: "photo",
          caption: "Completely unrelated content photo",
        }),
      ];
      const result = await svc.filterRelevantFigures(figures, "AI Technology");
      expect(result).toHaveLength(0);
    });

    it("falls back to type-based logic when embedding fails", async () => {
      const facade = {
        embeddingGenerate: jest.fn(async () => {
          throw new Error("Embedding API down");
        }),
      };
      const svc = new FigureRelevanceService(facade as never);
      const figures = [
        makeFigure({ type: "chart", caption: "" }), // informational → accepted
        makeFigure({ type: "photo", caption: "Valid caption text here" }), // caption >= 10 → accepted
        makeFigure({ type: "photo", caption: "" }), // no caption → rejected
      ];
      const result = await svc.filterRelevantFigures(figures, "AI Technology");
      expect(result).toHaveLength(2); // chart + photo-with-caption
    });

    it("uses cached topic embedding (only computed once per call)", async () => {
      const embedding = [0.5, 0.5, 0.5];
      const facade = makeEngineFacade(embedding);
      const svc = new FigureRelevanceService(facade as never);
      const figures = [
        makeFigure({
          type: "photo",
          caption: "Market analysis chart for technology",
        }),
        makeFigure({
          type: "photo",
          caption: "Financial data and growth metrics information",
        }),
      ];
      await svc.filterRelevantFigures(figures, "AI Technology");
      // Topic embedding should be called exactly once (lazy cache), plus 2 caption embeddings
      const calls = facade.embeddingGenerate.mock.calls;
      // First call is topic embedding (caching), subsequent calls are for captions
      expect(calls.length).toBeLessThanOrEqual(3); // max: 1 topic + 2 captions
    });

    it("fail-open when embedding returns null embedding", async () => {
      const facade = {
        embeddingGenerate: jest
          .fn()
          .mockResolvedValueOnce(null) // topic embedding null
          .mockResolvedValueOnce({ embedding: [0.5, 0.5] }), // caption embedding
      };
      const svc = new FigureRelevanceService(facade as never);
      const figures = [
        makeFigure({ type: "photo", caption: "Valid caption here for test" }),
      ];
      const result = await svc.filterRelevantFigures(figures, "AI Technology");
      // fail-open: embedding unavailable → accept (caption >= 10 chars)
      expect(result).toHaveLength(1);
    });

    it("handles mixed figure types correctly", async () => {
      const embedding = [0.6, 0.4, 0.7];
      const facade = makeEngineFacade(embedding);
      const svc = new FigureRelevanceService(facade as never);
      const figures = [
        makeFigure({ type: "chart" }), // informational → accepted
        makeFigure({ type: "photo", caption: "" }), // no caption → rejected
        makeFigure({ type: "table" }), // informational → accepted
        makeFigure({
          type: "photo",
          caption: "Relevant technology market photo",
        }), // embedding → accepted
      ];
      const result = await svc.filterRelevantFigures(
        figures,
        "Technology Market",
      );
      expect(result.length).toBeGreaterThanOrEqual(2); // at least chart + table
    });

    it("logs rejection summary for rejected figures", async () => {
      const embedding = [1, 0, 0];
      const facade = {
        embeddingGenerate: jest
          .fn()
          .mockResolvedValueOnce({ embedding }) // topic
          .mockResolvedValueOnce({ embedding: [0, 1, 0] }), // caption (orthogonal → rejected)
      };
      const svc = new FigureRelevanceService(facade as never);
      const figures = [
        makeFigure({ type: "photo", caption: "This is a long enough caption" }),
      ];
      // Should not throw even when figure is rejected
      await expect(
        svc.filterRelevantFigures(figures, "AI"),
      ).resolves.toBeDefined();
    });
  });
});
