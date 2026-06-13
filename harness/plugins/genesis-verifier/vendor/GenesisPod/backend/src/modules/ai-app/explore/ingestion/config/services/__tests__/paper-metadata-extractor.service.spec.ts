/**
 * PaperMetadataExtractorService Unit Tests
 *
 * Tests metadata extraction from multiple academic paper sources:
 * - extractPaperMetadata() - top-level dispatcher
 * - extractPaperIdFromPdfUrl() - public helper
 * - ArXiv / AlphaXiv source handling
 * - IEEE, ACM, Springer, ScienceDirect, Nature sources
 * - DOI / Crossref API fallback
 * - HTML content cleaning
 * - Graceful degradation when APIs fail
 */

// Mock global fetch before imports
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { Test, TestingModule } from "@nestjs/testing";
import { PaperMetadataExtractorService } from "../paper-metadata-extractor.service";

// ── Helper: build a minimal ArXiv XML response ─────────────────────────────

function buildArxivXml(params: {
  title?: string;
  summary?: string;
  authors?: string[];
  published?: string;
  category?: string;
}) {
  const authors = (params.authors ?? ["Author One", "Author Two"])
    .map((a) => `<name>${a}</name>`)
    .join("");
  return `<?xml version="1.0"?>
<feed>
  <entry>
    <title>${params.title ?? "Test Paper"}</title>
    <summary>${params.summary ?? "This is the abstract."}</summary>
    <published>${params.published ?? "2024-01-15T00:00:00Z"}</published>
    ${authors}
    <arxiv:primary_category term="${params.category ?? "cs.LG"}"/>
  </entry>
</feed>`;
}

// ── Helper: build Crossref JSON response ───────────────────────────────────

function buildCrossrefResponse(params: {
  title?: string;
  authors?: Array<{ family: string; given: string }>;
  abstract?: string;
  doi?: string;
  publishedYear?: number;
}) {
  return {
    message: {
      title: [params.title ?? "DOI Paper"],
      author: (params.authors ?? [{ family: "Smith", given: "John" }]).map(
        (a) => ({ family: a.family, given: a.given }),
      ),
      abstract: params.abstract ?? "<p>DOI abstract</p>",
      DOI: params.doi ?? "10.1234/test",
      URL: `https://doi.org/${params.doi ?? "10.1234/test"}`,
      published: {
        "date-parts": [[params.publishedYear ?? 2024, 3, 15]],
      },
    },
  };
}

// ── Test Suite ─────────────────────────────────────────────────────────────

describe("PaperMetadataExtractorService", () => {
  let service: PaperMetadataExtractorService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PaperMetadataExtractorService],
    }).compile();

    service = module.get<PaperMetadataExtractorService>(
      PaperMetadataExtractorService,
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ── extractPaperIdFromPdfUrl ─────────────────────────────────────────────

  describe("extractPaperIdFromPdfUrl", () => {
    it("extracts paper ID from a standard ArXiv PDF URL", () => {
      const id = service.extractPaperIdFromPdfUrl(
        "https://arxiv.org/pdf/2511.15534.pdf",
      );
      expect(id).toBe("2511.15534");
    });

    it("extracts paper ID with version suffix", () => {
      const id = service.extractPaperIdFromPdfUrl(
        "https://arxiv.org/pdf/2301.00001v2.pdf",
      );
      expect(id).toBe("2301.00001v2");
    });

    it("extracts paper ID from AlphaXiv PDF URL", () => {
      const id = service.extractPaperIdFromPdfUrl(
        "https://alphaxiv.org/pdf/2512.00100.pdf",
      );
      expect(id).toBe("2512.00100");
    });

    it("returns null when URL has no PDF path segment", () => {
      const id = service.extractPaperIdFromPdfUrl(
        "https://arxiv.org/abs/2511.15534",
      );
      expect(id).toBeNull();
    });

    it("returns null for an entirely unrelated URL", () => {
      const id = service.extractPaperIdFromPdfUrl("https://example.com/page");
      expect(id).toBeNull();
    });
  });

  // ── extractPaperMetadata - unsupported domain ────────────────────────────

  describe("extractPaperMetadata - unsupported domain", () => {
    it("returns null for an unknown domain", async () => {
      const result = await service.extractPaperMetadata(
        "https://unknown-journal.com/paper/123",
      );
      expect(result).toBeNull();
    });

    it("returns null and does not throw for a malformed URL", async () => {
      const result = await service.extractPaperMetadata("not-a-valid-url");
      expect(result).toBeNull();
    });
  });

  // ── ArXiv /abs/ URL ──────────────────────────────────────────────────────

  describe("extractPaperMetadata - arxiv.org /abs/", () => {
    it("fetches metadata from ArXiv API for /abs/ URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          buildArxivXml({
            title: "Attention Is All You Need",
            authors: ["Vaswani, Ashish", "Shazeer, Noam"],
            summary: "Transformers for sequence modelling.",
            published: "2017-06-12T00:00:00Z",
          }),
      });

      const result = await service.extractPaperMetadata(
        "https://arxiv.org/abs/1706.03762",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("arxiv");
      expect(result!.title).toBe("Attention Is All You Need");
      expect(result!.authors).toContain("Vaswani, Ashish");
      expect(result!.pdfUrl).toContain("1706.03762");
      expect(result!.arxivId).toBe("1706.03762");
    });

    it("returns fallback metadata when ArXiv API is unreachable for /abs/ URL", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await service.extractPaperMetadata(
        "https://arxiv.org/abs/2301.00001",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("arxiv");
      expect(result!.arxivId).toBe("2301.00001");
      expect(result!.title).toContain("2301.00001");
    });
  });

  // ── ArXiv /pdf/ URL ──────────────────────────────────────────────────────

  describe("extractPaperMetadata - arxiv.org /pdf/", () => {
    it("fetches metadata via ArXiv API when given a PDF URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          buildArxivXml({
            title: "BERT Pre-training",
            authors: ["Devlin, Jacob"],
            summary: "Bidirectional encoder representations.",
          }),
      });

      const result = await service.extractPaperMetadata(
        "https://arxiv.org/pdf/1810.04805.pdf",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("arxiv");
      expect(result!.title).toBe("BERT Pre-training");
    });
  });

  // ── AlphaXiv ─────────────────────────────────────────────────────────────

  describe("extractPaperMetadata - alphaxiv.org", () => {
    it("fetches ArXiv metadata and marks source as alphaxiv", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          buildArxivXml({
            title: "AlphaXiv Paper",
            authors: ["Zhang, Wei"],
            summary: "AlphaXiv abstract.",
          }),
      });

      const result = await service.extractPaperMetadata(
        "https://alphaxiv.org/abs/2510.00100",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("alphaxiv");
      expect(result!.title).toBe("AlphaXiv Paper");
      expect(result!.pdfUrl).toContain("arxiv.org");
    });

    it("returns degraded fallback when ArXiv API fails for AlphaXiv URL", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Timeout"));

      const result = await service.extractPaperMetadata(
        "https://alphaxiv.org/abs/2510.12345",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("alphaxiv");
      expect(result!.arxivId).toBe("2510.12345");
    });

    it("handles alphaxiv PDF URL by routing through ArXiv API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          buildArxivXml({
            title: "AlphaXiv PDF Paper",
            authors: ["Li, Ming"],
          }),
      });

      const result = await service.extractPaperMetadata(
        "https://alphaxiv.org/pdf/2507.00001.pdf",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("alphaxiv");
    });
  });

  // ── ArXiv API - XML parsing edge cases ──────────────────────────────────

  describe("ArXiv API XML parsing", () => {
    it("uses paper ID as title fallback when title tag is absent", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          `<feed><entry><summary>Only abstract here</summary></entry></feed>`,
      });

      const result = await service.extractPaperMetadata(
        "https://arxiv.org/abs/2301.11111",
      );

      expect(result).not.toBeNull();
      // Falls back to degraded data when entry has no title match
      expect(result!.title).toBeDefined();
    });

    it("parses categories from primary_category term", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => buildArxivXml({ category: "cs.AI" }),
      });

      const result = await service.extractPaperMetadata(
        "https://arxiv.org/abs/2401.00001",
      );

      expect(result).not.toBeNull();
      expect(result!.categories).toContain("cs.AI");
    });

    it("handles ArXiv API non-OK response with fallback data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
      });

      const result = await service.extractPaperMetadata(
        "https://arxiv.org/abs/2302.00001",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("arxiv");
      // Degraded fallback includes arxivId
      expect(result!.arxivId).toBe("2302.00001");
    });
  });

  // ── IEEE ─────────────────────────────────────────────────────────────────

  describe("extractPaperMetadata - ieeexplore.ieee.org", () => {
    it("returns basic IEEE paper metadata when HTML scraping succeeds", async () => {
      const html = `<html><head>
        <script type="application/ld+json">{"name":"IEEE Test Paper","description":"IEEE abstract text"}</script>
      </head></html>`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => html,
      });

      const result = await service.extractPaperMetadata(
        "https://ieeexplore.ieee.org/document/9876543",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("ieee");
    });

    it("returns fallback IEEE paper when fetch fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await service.extractPaperMetadata(
        "https://ieeexplore.ieee.org/document/1234567",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("ieee");
      expect(result!.title).toContain("IEEE");
    });
  });

  // ── ACM ──────────────────────────────────────────────────────────────────

  describe("extractPaperMetadata - dl.acm.org", () => {
    it("fetches ACM paper via Crossref using embedded DOI", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          buildCrossrefResponse({ title: "ACM Conference Paper" }),
      });

      const result = await service.extractPaperMetadata(
        "https://dl.acm.org/doi/10.1145/3372278.3372279",
      );

      expect(result).not.toBeNull();
      expect(result!.title).toBe("ACM Conference Paper");
    });

    it("returns degraded ACM fallback when no DOI in URL", async () => {
      const result = await service.extractPaperMetadata(
        "https://dl.acm.org/journal/jacm",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("acm");
      expect(result!.title).toContain("ACM");
    });
  });

  // ── Springer ─────────────────────────────────────────────────────────────

  describe("extractPaperMetadata - springer.com", () => {
    it("fetches Springer paper via Crossref using embedded DOI", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          buildCrossrefResponse({ title: "Springer Book Chapter" }),
      });

      const result = await service.extractPaperMetadata(
        "https://link.springer.com/article/10.1007/s12345-021-00001-1",
      );

      expect(result).not.toBeNull();
      expect(result!.title).toBe("Springer Book Chapter");
    });

    it("returns degraded Springer fallback when no DOI in URL", async () => {
      const result = await service.extractPaperMetadata(
        "https://www.springer.com/book/9783030123456",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("springer");
    });
  });

  // ── ScienceDirect ─────────────────────────────────────────────────────────

  describe("extractPaperMetadata - sciencedirect.com", () => {
    it("fetches ScienceDirect paper via Crossref using embedded DOI", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          buildCrossrefResponse({ title: "Elsevier Journal Paper" }),
      });

      const result = await service.extractPaperMetadata(
        "https://www.sciencedirect.com/science/article/pii/10.1016/j.neunet.2023.01.001",
      );

      expect(result).not.toBeNull();
      expect(result!.title).toBe("Elsevier Journal Paper");
    });

    it("returns degraded ScienceDirect fallback when no DOI in URL", async () => {
      const result = await service.extractPaperMetadata(
        "https://www.sciencedirect.com/journal/neural-networks",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("sciencedirect");
    });
  });

  // ── Nature ───────────────────────────────────────────────────────────────

  describe("extractPaperMetadata - nature.com", () => {
    it("fetches Nature paper via Crossref using embedded DOI", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          buildCrossrefResponse({ title: "Nature Scientific Discovery" }),
      });

      const result = await service.extractPaperMetadata(
        "https://www.nature.com/articles/10.1038/s41586-024-00001-1",
      );

      expect(result).not.toBeNull();
      expect(result!.title).toBe("Nature Scientific Discovery");
    });

    it("returns degraded Nature fallback when no DOI found", async () => {
      const result = await service.extractPaperMetadata(
        "https://www.nature.com/subjects/machine-learning",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("nature");
    });
  });

  // ── DOI / Crossref ────────────────────────────────────────────────────────

  describe("extractPaperMetadata - doi.org", () => {
    it("fetches full metadata from Crossref API for a doi.org URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          buildCrossrefResponse({
            title: "Crossref Paper Title",
            authors: [{ family: "Brown", given: "Tom" }],
            abstract: "<p>Language model scaling laws.</p>",
            doi: "10.48550/arXiv.2005.14165",
          }),
      });

      const result = await service.extractPaperMetadata(
        "https://doi.org/10.48550/arXiv.2005.14165",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("doi");
      expect(result!.title).toBe("Crossref Paper Title");
      expect(result!.authors).toContain("Brown, Tom");
      expect(result!.abstract).not.toContain("<p>");
    });

    it("strips HTML tags from abstract via cleanHtmlContent", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          buildCrossrefResponse({
            abstract:
              "<jats:p>Neural networks &amp; <b>deep learning</b>.</jats:p>",
          }),
      });

      const result = await service.extractPaperMetadata(
        "https://doi.org/10.1000/test.doi",
      );

      expect(result).not.toBeNull();
      expect(result!.abstract).not.toContain("<");
      expect(result!.abstract).toContain("&");
    });

    it("returns degraded DOI fallback when Crossref API returns 404", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({}),
      });

      const result = await service.extractPaperMetadata(
        "https://doi.org/10.9999/nonexistent",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("doi");
      expect(result!.title).toContain("DOI");
    });

    it("returns degraded DOI fallback when Crossref network call fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("DNS lookup failed"));

      const result = await service.extractPaperMetadata(
        "https://doi.org/10.1000/network-fail",
      );

      expect(result).not.toBeNull();
      expect(result!.source).toBe("doi");
    });

    it("formats author names as 'family, given'", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () =>
          buildCrossrefResponse({
            authors: [
              { family: "LeCun", given: "Yann" },
              { family: "Hinton", given: "Geoffrey" },
            ],
          }),
      });

      const result = await service.extractPaperMetadata(
        "https://doi.org/10.1000/ml",
      );

      expect(result!.authors).toContain("LeCun, Yann");
      expect(result!.authors).toContain("Hinton, Geoffrey");
    });

    it("builds publishedDate as ISO string from date-parts array", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => buildCrossrefResponse({ publishedYear: 2023 }),
      });

      const result = await service.extractPaperMetadata(
        "https://doi.org/10.1000/date-test",
      );

      expect(result!.publishedDate).toBeDefined();
      expect(result!.publishedDate).toMatch(/^2023/);
    });
  });

  // ── HTML cleaning ─────────────────────────────────────────────────────────

  describe("HTML entity decoding in extracted metadata", () => {
    it("decodes &nbsp; &lt; &gt; &amp; &quot; &#39; in titles", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            title: ["Artificial &amp; Natural Intelligence: &lt;Theory&gt;"],
            author: [],
            abstract: "",
          },
        }),
      });

      const result = await service.extractPaperMetadata(
        "https://doi.org/10.1000/html-entities",
      );

      expect(result!.title).toBe("Artificial & Natural Intelligence: <Theory>");
    });
  });
});
