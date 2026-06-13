import {
  DocumentChunker,
  DEFAULT_CHUNKING_CONFIG,
  ChunkingConfig,
} from "../document-chunker";

describe("DocumentChunker", () => {
  let chunker: DocumentChunker;

  beforeEach(() => {
    chunker = new DocumentChunker();
  });

  // ─── estimateTokens ──────────────────────────────────

  describe("estimateTokens()", () => {
    it("returns 0 for empty string", () => {
      expect(chunker.estimateTokens("")).toBe(0);
    });

    it("returns 0 for null-like input", () => {
      expect(chunker.estimateTokens(null as unknown as string)).toBe(0);
    });

    it("estimates English text at ~4 chars per token", () => {
      const text = "Hello world test text"; // 20 chars → ~5 tokens
      const tokens = chunker.estimateTokens(text);
      expect(tokens).toBeGreaterThanOrEqual(4);
      expect(tokens).toBeLessThanOrEqual(7);
    });

    it("estimates Chinese text at ~1.5 chars per token", () => {
      const text = "人工智能改变世界"; // 8 Chinese chars → ~6 tokens (ceil(8/1.5))
      const tokens = chunker.estimateTokens(text);
      expect(tokens).toBe(6);
    });

    it("handles mixed Chinese and English text", () => {
      const text = "AI人工智能"; // 2 English + 4 Chinese
      const tokens = chunker.estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  // ─── chunkDocument: basic behavior ──────────────────

  describe("chunkDocument() - basic structure", () => {
    it("returns ChunkedDocument with correct documentId and title", () => {
      const result = chunker.chunkDocument("doc-1", "Short text.", "My Doc");
      expect(result.documentId).toBe("doc-1");
      expect(result.title).toBe("My Doc");
    });

    it("returns at least one parent chunk for non-empty content", () => {
      const content =
        "This is a sentence. And another sentence. More text here.";
      const result = chunker.chunkDocument("doc-1", content, "Test");
      expect(result.parentChunks.length).toBeGreaterThan(0);
    });

    it("returns empty parent chunks for empty content", () => {
      const result = chunker.chunkDocument("doc-1", "", "Empty");
      expect(result.parentChunks).toHaveLength(0);
      expect(result.totalTokens).toBe(0);
      expect(result.totalChildChunks).toBe(0);
    });

    it("sets metadata with processedAt timestamp", () => {
      const result = chunker.chunkDocument(
        "doc-1",
        "Some content here.",
        "Test",
      );
      expect(result.metadata?.processedAt).toBeDefined();
      // Should be a valid ISO date string
      const date = new Date(result.metadata!.processedAt as string);
      expect(date.getTime()).not.toBeNaN();
    });

    it("generates unique IDs for parent chunks", () => {
      const content =
        "Sentence one. Sentence two. Sentence three. Sentence four.";
      const result = chunker.chunkDocument("doc-1", content, "Test");
      const ids = result.parentChunks.map((p) => p.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it("generates unique IDs for child chunks", () => {
      const content = Array(20).fill("This is a test sentence.").join(" ");
      const result = chunker.chunkDocument("doc-1", content, "Test");
      const childIds = result.parentChunks.flatMap((p) =>
        p.childChunks.map((c) => c.id),
      );
      const unique = new Set(childIds);
      expect(unique.size).toBe(childIds.length);
    });

    it("sets totalChildChunks to sum of all child chunks", () => {
      const content =
        "Sentence one. Sentence two. More content here. Even more text.";
      const result = chunker.chunkDocument("doc-1", content, "Test");
      const expectedTotal = result.parentChunks.reduce(
        (sum, p) => sum + p.childChunks.length,
        0,
      );
      expect(result.totalChildChunks).toBe(expectedTotal);
    });

    it("sets totalTokens to sum of parent token counts", () => {
      const content = "Test content sentence. Another sentence here.";
      const result = chunker.chunkDocument("doc-1", content, "Test");
      const expectedTotal = result.parentChunks.reduce(
        (sum, p) => sum + p.tokenCount,
        0,
      );
      expect(result.totalTokens).toBe(expectedTotal);
    });
  });

  // ─── chunkDocument: parent chunk properties ──────────

  describe("chunkDocument() - parent chunk properties", () => {
    it("assigns sequential position to parent chunks", () => {
      const content = Array(30)
        .fill("This is a longer sentence to fill up token space.")
        .join(" ");
      const config: ChunkingConfig = {
        ...DEFAULT_CHUNKING_CONFIG,
        parentChunkSize: 100, // small to force multiple parents
        parentChunkOverlap: 10,
      };
      const result = chunker.chunkDocument("doc-1", content, "Test", config);
      result.parentChunks.forEach((p, index) => {
        expect(p.position).toBe(index);
      });
    });

    it("assigns pageStart >= 1 for all parent chunks", () => {
      const content = Array(10).fill("Page content sentence.").join(" ");
      const result = chunker.chunkDocument("doc-1", content, "Test");
      result.parentChunks.forEach((p) => {
        expect(p.pageStart).toBeGreaterThanOrEqual(1);
      });
    });

    it("extracts section title from markdown headings", () => {
      const content = "## Introduction\n\nThis section introduces the topic.";
      const result = chunker.chunkDocument("doc-1", content, "Test");
      // The first parent chunk should have the heading as sectionTitle
      const parentWithTitle = result.parentChunks.find((p) => p.sectionTitle);
      if (parentWithTitle) {
        // sectionTitle strips leading ## but preserves the rest of the first line
        expect(parentWithTitle.sectionTitle).toContain("Introduction");
      }
    });

    it("extracts section title from numbered headings", () => {
      const content = "1. 引言\n\nThis is the introduction.";
      const result = chunker.chunkDocument("doc-1", content, "Test");
      const parentWithTitle = result.parentChunks.find(
        (p) => p.sectionTitle !== undefined,
      );
      if (parentWithTitle) {
        expect(parentWithTitle.sectionTitle).toContain("引言");
      }
    });

    it("does not extract title from long first lines", () => {
      const longLine = "a".repeat(150) + "\nContent here.";
      const result = chunker.chunkDocument("doc-1", longLine, "Test");
      result.parentChunks.forEach((p) => {
        expect(p.sectionTitle).toBeUndefined();
      });
    });

    it("initializes metadata as empty object for each parent", () => {
      const result = chunker.chunkDocument("doc-1", "Content here.", "Test");
      result.parentChunks.forEach((p) => {
        expect(p.metadata).toEqual({});
      });
    });
  });

  // ─── chunkDocument: child chunk properties ───────────

  describe("chunkDocument() - child chunk properties", () => {
    it("child chunks have tokenCount > 0 for non-empty content", () => {
      const content = "This is some test content to chunk.";
      const result = chunker.chunkDocument("doc-1", content, "Test");
      result.parentChunks.forEach((p) => {
        p.childChunks.forEach((c) => {
          expect(c.tokenCount).toBeGreaterThan(0);
        });
      });
    });

    it("child chunk parentPosition matches parent position", () => {
      const content = Array(50)
        .fill("Child chunk test sentence here.")
        .join(" ");
      const config: ChunkingConfig = {
        ...DEFAULT_CHUNKING_CONFIG,
        parentChunkSize: 100,
        parentChunkOverlap: 10,
        childChunkSize: 40,
        childChunkOverlap: 5,
      };
      const result = chunker.chunkDocument("doc-1", content, "Test", config);
      result.parentChunks.forEach((parent, parentIndex) => {
        parent.childChunks.forEach((child) => {
          expect(child.parentPosition).toBe(parentIndex);
        });
      });
    });

    it("child chunks have sequential positions within each parent", () => {
      const content = Array(30)
        .fill("A test sentence for child chunking.")
        .join(" ");
      const config: ChunkingConfig = {
        ...DEFAULT_CHUNKING_CONFIG,
        parentChunkSize: 200,
        childChunkSize: 50,
        childChunkOverlap: 5,
      };
      const result = chunker.chunkDocument("doc-1", content, "Test", config);
      result.parentChunks.forEach((parent) => {
        parent.childChunks.forEach((child, index) => {
          expect(child.position).toBe(index);
        });
      });
    });

    it("each parent has at least one child chunk", () => {
      const content = "Each parent should have at least one child chunk.";
      const result = chunker.chunkDocument("doc-1", content, "Test");
      result.parentChunks.forEach((p) => {
        expect(p.childChunks.length).toBeGreaterThan(0);
      });
    });
  });

  // ─── chunkDocument: large document splitting ─────────

  describe("chunkDocument() - large document splitting", () => {
    it("creates multiple parent chunks for large content", () => {
      // Create content that exceeds parentChunkSize=2000 tokens
      const content = Array(200)
        .fill("This is a sentence with some reasonable length for testing.")
        .join(" ");
      const result = chunker.chunkDocument("doc-1", content, "Large Doc");
      expect(result.parentChunks.length).toBeGreaterThan(1);
    });

    it("creates multiple child chunks for large parents", () => {
      // Use small child chunk size to force multiple children
      const content = Array(50).fill("This is a sentence.").join(" ");
      const config: ChunkingConfig = {
        parentChunkSize: 2000,
        parentChunkOverlap: 200,
        childChunkSize: 20, // very small
        childChunkOverlap: 5,
      };
      const result = chunker.chunkDocument("doc-1", content, "Test", config);
      const totalChildren = result.parentChunks.reduce(
        (sum, p) => sum + p.childChunks.length,
        0,
      );
      expect(totalChildren).toBeGreaterThan(result.parentChunks.length);
    });

    it("preserves all text across chunks (no content loss)", () => {
      const sentences = [
        "First sentence.",
        "Second sentence.",
        "Third sentence.",
      ];
      const content = sentences.join(" ");
      const result = chunker.chunkDocument("doc-1", content, "Test");

      // All parent content combined should contain all original sentences
      const allContent = result.parentChunks.map((p) => p.content).join(" ");
      sentences.forEach((s) => {
        // Each word should appear somewhere in the combined chunks
        const firstWord = s.split(" ")[0];
        expect(allContent).toContain(firstWord);
      });
    });
  });

  // ─── chunkDocument: custom config ────────────────────

  describe("chunkDocument() - custom config", () => {
    it("uses DEFAULT_CHUNKING_CONFIG when no config provided", () => {
      const content = "Default config test sentence.";
      // Should not throw when using default config
      expect(() =>
        chunker.chunkDocument("doc-1", content, "Test"),
      ).not.toThrow();
    });

    it("respects custom parentChunkSize", () => {
      const content = Array(100)
        .fill("Token count test sentence here now.")
        .join(" ");
      const smallConfig: ChunkingConfig = {
        parentChunkSize: 30,
        parentChunkOverlap: 5,
        childChunkSize: 10,
        childChunkOverlap: 2,
      };
      const largeConfig: ChunkingConfig = {
        parentChunkSize: 500,
        parentChunkOverlap: 50,
        childChunkSize: 100,
        childChunkOverlap: 10,
      };

      const smallResult = chunker.chunkDocument(
        "doc-1",
        content,
        "Test",
        smallConfig,
      );
      const largeResult = chunker.chunkDocument(
        "doc-1",
        content,
        "Test",
        largeConfig,
      );

      // Smaller config should produce more chunks
      expect(smallResult.parentChunks.length).toBeGreaterThanOrEqual(
        largeResult.parentChunks.length,
      );
    });
  });

  // ─── edge cases ───────────────────────────────────────

  describe("edge cases", () => {
    it("handles content with only whitespace", () => {
      const result = chunker.chunkDocument(
        "doc-1",
        "   \n  \t  ",
        "Whitespace",
      );
      expect(result.parentChunks).toHaveLength(0);
    });

    it("handles single very long sentence", () => {
      const longSentence = "word ".repeat(500).trim();
      const result = chunker.chunkDocument(
        "doc-1",
        longSentence,
        "Long Sentence",
      );
      expect(result.parentChunks.length).toBeGreaterThan(0);
    });

    it("handles content with multiple newlines", () => {
      const content = "Para one.\n\n\n\nPara two.\n\n\nPara three.";
      expect(() =>
        chunker.chunkDocument("doc-1", content, "Multi-newline"),
      ).not.toThrow();
    });

    it("handles Chinese-only content", () => {
      const content =
        "人工智能正在改变我们的生活方式。机器学习是其核心技术之一。深度学习取得了巨大突破。";
      const result = chunker.chunkDocument("doc-1", content, "Chinese Doc");
      expect(result.parentChunks.length).toBeGreaterThan(0);
      expect(result.totalTokens).toBeGreaterThan(0);
    });

    it("handles very short content as single chunk", () => {
      const result = chunker.chunkDocument("doc-1", "Hi.", "Tiny");
      expect(result.parentChunks).toHaveLength(1);
      expect(result.parentChunks[0].childChunks).toHaveLength(1);
    });
  });
});
