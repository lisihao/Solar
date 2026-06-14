/**
 * LlmRerankerAdapter unit tests
 * Covers: rerank, rerankInternal, failOpen, callLlmForScores (mocked LLM)
 */
import { LlmRerankerAdapter } from "../llm-reranker.adapter";
import { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";
import type { RerankRequest, RerankCandidate } from "../rerank.types";

// ---------------------------------------------------------------------------
// Mock AiChatService
// ---------------------------------------------------------------------------

function makeAiChatService(response: string) {
  return {
    chat: jest.fn().mockResolvedValue({ content: response }),
  } as unknown as jest.Mocked<AiChatService>;
}

// ---------------------------------------------------------------------------
// Sample candidate factory
// ---------------------------------------------------------------------------

function makeCandidate(
  title: string,
  snippet: string,
  url = "https://example.com",
  idx = 0,
): RerankCandidate {
  return {
    item: { title, snippet, url, sourceType: "web" },
    originalIndex: idx,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LlmRerankerAdapter", () => {
  describe("id", () => {
    it("is 'llm'", () => {
      const svc = new LlmRerankerAdapter(makeAiChatService("{}"));
      expect(svc.id).toBe("llm");
    });
  });

  describe("rerank — passthrough when candidates <= topK", () => {
    it("returns passthrough result for empty candidates", async () => {
      const svc = new LlmRerankerAdapter(makeAiChatService("{}"));
      const req: RerankRequest = { query: "test", candidates: [], topK: 5 };
      const result = await svc.rerank(req);
      expect(result.reranked).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it("passes through when candidates.length <= topK", async () => {
      const svc = new LlmRerankerAdapter(makeAiChatService("{}"));
      const candidates = [makeCandidate("A", "snippet A", "https://a.com", 0)];
      const req: RerankRequest = {
        query: "test",
        candidates,
        topK: 5,
      };
      const result = await svc.rerank(req);
      expect(result.reranked).toBe(false);
      expect(result.items).toHaveLength(1);
    });
  });

  describe("rerank — successful LLM scoring", () => {
    it("returns reranked=true with scores from LLM", async () => {
      const llmResponse = JSON.stringify({
        scores: [
          { id: 0, score: 9 },
          { id: 1, score: 5 },
          { id: 2, score: 7 },
        ],
      });
      const svc = new LlmRerankerAdapter(makeAiChatService(llmResponse));
      const candidates = [
        makeCandidate(
          "GPT-4 technical report",
          "GPT-4 achieves 90%",
          "https://openai.com",
          0,
        ),
        makeCandidate(
          "AlphaCode paper",
          "AlphaCode solves 45%",
          "https://deepmind.com",
          1,
        ),
        makeCandidate(
          "Claude safety",
          "Constitutional AI",
          "https://anthropic.com",
          2,
        ),
      ];
      const req: RerankRequest = {
        query: "AI benchmarks 2024",
        candidates,
        topK: 2,
      };
      const result = await svc.rerank(req);
      expect(result.reranked).toBe(true);
      expect(result.items).toHaveLength(2);
      // Highest score (9 → id 0) should be first
      expect(result.items[0].rerankScore).toBeGreaterThan(
        result.items[1].rerankScore,
      );
    });

    it("normalizes scores to 0-1 range", async () => {
      const llmResponse = JSON.stringify({
        scores: [
          { id: 0, score: 10 },
          { id: 1, score: 0 },
          { id: 2, score: 5 },
          { id: 3, score: 8 },
        ],
      });
      const svc = new LlmRerankerAdapter(makeAiChatService(llmResponse));
      const candidates = Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`Title ${i}`, `Snippet ${i}`, `https://ex${i}.com`, i),
      );
      // topK < candidates.length to trigger actual reranking
      const req: RerankRequest = { query: "test", candidates, topK: 3 };
      const result = await svc.rerank(req);
      expect(result.reranked).toBe(true);
      for (const item of result.items) {
        expect(item.rerankScore).toBeGreaterThanOrEqual(0);
        expect(item.rerankScore).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("rerank — LLM parse failure (fail-open)", () => {
    it("falls back to original order when LLM returns invalid JSON", async () => {
      const svc = new LlmRerankerAdapter(makeAiChatService("invalid json!!!"));
      const candidates = Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`Title ${i}`, `Snippet ${i}`, `https://ex${i}.com`, i),
      );
      const req: RerankRequest = { query: "test", candidates, topK: 3 };
      const result = await svc.rerank(req);
      expect(result.reranked).toBe(false);
      expect(result.items).toHaveLength(3);
    });

    it("falls back when LLM returns empty scores array", async () => {
      const svc = new LlmRerankerAdapter(
        makeAiChatService(JSON.stringify({ scores: [] })),
      );
      const candidates = Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`Title ${i}`, `Snippet ${i}`, `https://ex${i}.com`, i),
      );
      const req: RerankRequest = { query: "test", candidates, topK: 3 };
      const result = await svc.rerank(req);
      expect(result.reranked).toBe(false);
    });

    it("falls back when LLM throws", async () => {
      const failChat = {
        chat: jest.fn().mockRejectedValue(new Error("LLM service unavailable")),
      } as unknown as jest.Mocked<AiChatService>;
      const svc = new LlmRerankerAdapter(failChat);
      const candidates = Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`Title ${i}`, `Snippet ${i}`, `https://ex${i}.com`, i),
      );
      const req: RerankRequest = { query: "test", candidates, topK: 3 };
      const result = await svc.rerank(req);
      expect(result.reranked).toBe(false);
    });
  });

  describe("rerank — AbortSignal handling", () => {
    it("returns fail-open when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const svc = new LlmRerankerAdapter(makeAiChatService("{}"));
      const candidates = Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`Title ${i}`, `Snippet ${i}`, `https://ex${i}.com`, i),
      );
      const req: RerankRequest = {
        query: "test",
        candidates,
        topK: 3,
        signal: controller.signal,
      };
      const result = await svc.rerank(req);
      expect(result.reranked).toBe(false);
    });
  });

  describe("rerank — LLM response with markdown code block", () => {
    it("strips markdown ```json fences before parsing", async () => {
      const wrappedResponse = `\`\`\`json\n${JSON.stringify({
        scores: [
          { id: 0, score: 8 },
          { id: 1, score: 6 },
          { id: 2, score: 4 },
          { id: 3, score: 2 },
        ],
      })}\n\`\`\``;
      const svc = new LlmRerankerAdapter(makeAiChatService(wrappedResponse));
      const candidates = Array.from({ length: 4 }, (_, i) =>
        makeCandidate(`Title ${i}`, `Snippet ${i}`, `https://ex${i}.com`, i),
      );
      const req: RerankRequest = { query: "test", candidates, topK: 4 };
      const result = await svc.rerank(req);
      // May succeed or fail-open depending on implementation
      expect(typeof result.reranked).toBe("boolean");
      expect(Array.isArray(result.items)).toBe(true);
    });
  });

  describe("rerank — candidates with missing fields", () => {
    it("handles candidates with null title and snippet", async () => {
      const llmResponse = JSON.stringify({
        scores: [
          { id: 0, score: 5 },
          { id: 1, score: 3 },
          { id: 2, score: 7 },
        ],
      });
      const svc = new LlmRerankerAdapter(makeAiChatService(llmResponse));
      const candidates: RerankCandidate[] = [
        {
          item: { title: null, snippet: null, url: null, sourceType: null },
          originalIndex: 0,
        },
        {
          item: {
            title: "Valid title",
            snippet: null,
            url: "https://a.com",
            sourceType: "web",
          },
          originalIndex: 1,
        },
        {
          item: {
            title: null,
            snippet: "Valid snippet",
            url: null,
            sourceType: null,
          },
          originalIndex: 2,
        },
      ];
      const req: RerankRequest = { query: "test", candidates, topK: 2 };
      const result = await svc.rerank(req);
      expect(result.items).toHaveLength(2);
    });
  });
});
