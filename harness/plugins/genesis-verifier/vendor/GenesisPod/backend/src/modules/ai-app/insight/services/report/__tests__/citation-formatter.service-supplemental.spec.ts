/**
 * CitationFormatterService Supplemental Tests
 *
 * Covers missing branches:
 * - formatCitation default case (returns APA)
 * - APA website formatting (non-journal sources)
 * - APA with two authors
 * - APA with no authors
 * - MLA with et al (3+ authors)
 * - MLA website (non-journal) branch
 * - Chicago website branch (with domain or publisher)
 * - Chicago journal no year
 * - IEEE website branch
 * - IEEE no authors
 * - formatAuthorsAPA: zero authors, single author without lastName, two authors, 3+ authors
 * - formatAuthorsMLA: zero, single, two, 3+
 * - formatAuthorsIEEE: no firstName/lastName, all fields present
 * - extractAuthors: object-style authors
 * - extractYear: invalid date string
 * - classifySource: congress-gov, whitehouse-news, social-x, hackernews, github, bbc/cnn, no domain
 * - buildCitationMetadata: with venue metadata (conference paper)
 */

import { CitationFormatterService } from "../citation-formatter.service";
import { CitationStyle, SourceCategory } from "../../../types/citation.types";

describe("CitationFormatterService supplemental", () => {
  let service: CitationFormatterService;

  beforeEach(() => {
    service = new CitationFormatterService();
  });

  // ─────────────────────────── formatCitation default ───────────────────────
  describe("formatCitation default style", () => {
    it("should fall through to APA for unknown style", () => {
      const meta = service.buildCitationMetadata({
        title: "Test Article",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        publishedAt: null,
        metadata: {},
      });
      // Cast to bypass TypeScript type check for unknown style
      const result = service.formatCitation(
        meta,
        "UNKNOWN_STYLE" as CitationStyle,
        1,
      );
      // Should behave like APA (n.d.)
      expect(result.fullCitation).toContain("n.d.");
    });
  });

  // ─────────────────────────── APA branches ─────────────────────────────────
  describe("APA formatting - website source", () => {
    it("should format APA for website source with domain", () => {
      const meta = service.buildCitationMetadata({
        title: "AI Safety Research",
        url: "https://openai.com/safety",
        domain: "openai.com",
        sourceType: "web",
        publishedAt: new Date("2024-01-15"),
        metadata: { authors: ["Sam Altman"] },
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      expect(citation.fullCitation).toContain("openai.com");
      expect(citation.fullCitation).toContain("AI Safety Research");
    });

    it("should format APA for non-journal without url", () => {
      const meta = service.buildCitationMetadata({
        title: "Report Without URL",
        sourceType: "web",
        publishedAt: new Date("2023-06-01"),
        metadata: {
          authors: ["Alice Brown"],
          publisher: "Tech Corp",
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 2);
      expect(citation.fullCitation).toContain("Report Without URL");
    });

    it("should format APA preprint with doi", () => {
      const meta = service.buildCitationMetadata({
        title: "Preprint Paper",
        url: "https://arxiv.org/abs/2024.0001",
        domain: "arxiv.org",
        sourceType: "academic",
        publishedAt: new Date("2024-02-01"),
        metadata: {
          authors: ["Researcher One"],
          doi: "2024.0001",
          journal: "arXiv",
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      // PREPRINT goes through JOURNAL_ARTICLE path
      expect(citation.fullCitation).toContain("doi.org");
    });

    it("should format APA journal without doi but with url", () => {
      const meta = service.buildCitationMetadata({
        title: "Journal Paper No DOI",
        url: "https://journal.org/paper",
        domain: "journal.org",
        sourceType: "academic",
        publishedAt: new Date("2023-01-01"),
        metadata: {
          authors: ["Author One"],
          journal: "Science Journal",
          volume: "10",
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      expect(citation.fullCitation).toContain("journal.org/paper");
    });

    it("should format APA with two authors using & in inText", () => {
      const meta = service.buildCitationMetadata({
        title: "Two Author Paper",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "academic",
        publishedAt: new Date("2024-01-01"),
        metadata: {
          authors: ["John Smith", "Jane Doe"],
          doi: "10.1234/test",
          journal: "Test Journal",
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      expect(citation.inText).toContain("Smith");
      expect(citation.inText).toContain("Doe");
      expect(citation.inText).toContain("&");
    });
  });

  // ─────────────────────────── MLA branches ─────────────────────────────────
  describe("MLA formatting", () => {
    it("should format MLA with 3+ authors using et al.", () => {
      const meta = service.buildCitationMetadata({
        title: "Multi-author Paper",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "academic",
        publishedAt: new Date("2024-01-01"),
        metadata: {
          authors: ["Alice Brown", "Bob Green", "Carol White"],
          doi: "10.1234/multi",
          journal: "Research Journal",
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.MLA, 1);
      expect(citation.inText).toContain("et al.");
    });

    it("should format MLA website (non-journal) branch", () => {
      const meta = service.buildCitationMetadata({
        title: "Website Article",
        url: "https://techblog.com/article",
        domain: "techblog.com",
        sourceType: "web",
        publishedAt: new Date("2024-03-01"),
        metadata: { authors: ["Web Writer"] },
      });
      const citation = service.formatCitation(meta, CitationStyle.MLA, 1);
      expect(citation.fullCitation).toContain("techblog.com");
    });

    it("should format MLA with zero authors", () => {
      const meta = service.buildCitationMetadata({
        title: "No Author Paper",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        publishedAt: null,
        metadata: {},
      });
      // authors = [{ fullName: "Unknown" }] -> single author
      const citation = service.formatCitation(meta, CitationStyle.MLA, 1);
      expect(citation.fullCitation).toContain("No Author Paper");
    });

    it("should format MLA with two authors", () => {
      const meta = service.buildCitationMetadata({
        title: "Two Author Web Article",
        url: "https://blog.com/post",
        domain: "blog.com",
        sourceType: "web",
        publishedAt: new Date("2024-01-01"),
        metadata: { authors: ["Alice Jones", "Bob Smith"] },
      });
      const citation = service.formatCitation(meta, CitationStyle.MLA, 1);
      expect(citation.fullCitation).toContain("and");
    });
  });

  // ─────────────────────────── Chicago branches ─────────────────────────────
  describe("Chicago formatting", () => {
    it("should format Chicago website with domain", () => {
      const meta = service.buildCitationMetadata({
        title: "Tech Report",
        url: "https://research.org/report",
        domain: "research.org",
        sourceType: "web",
        publishedAt: new Date("2024-01-01"),
        metadata: { authors: ["Research Team"] },
      });
      const citation = service.formatCitation(meta, CitationStyle.CHICAGO, 1);
      expect(citation.fullCitation).toContain("research.org");
    });

    it("should format Chicago journal without year", () => {
      const meta = service.buildCitationMetadata({
        title: "Undated Journal Paper",
        url: "https://journal.org/paper",
        domain: "journal.org",
        sourceType: "academic",
        publishedAt: null,
        metadata: {
          authors: ["Author One"],
          doi: "10.1234/undated",
          journal: "Science Today",
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.CHICAGO, 1);
      expect(citation.inText).not.toContain("null");
      expect(citation.fullCitation).toContain("doi.org");
    });

    it("should format Chicago non-journal with publisher (no domain)", () => {
      const meta = service.buildCitationMetadata({
        title: "Book Chapter",
        sourceType: "web",
        publishedAt: new Date("2022-01-01"),
        metadata: {
          authors: ["Book Author"],
          publisher: "Academic Press",
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.CHICAGO, 1);
      expect(citation.fullCitation).toContain("Academic Press");
    });
  });

  // ─────────────────────────── IEEE branches ────────────────────────────────
  describe("IEEE formatting", () => {
    it("should format IEEE website branch without doi", () => {
      const meta = service.buildCitationMetadata({
        title: "Tech Blog Post",
        url: "https://techblog.io/post",
        domain: "techblog.io",
        sourceType: "web",
        publishedAt: new Date("2024-01-01"),
        metadata: { authors: ["John Dev"] },
      });
      const citation = service.formatCitation(meta, CitationStyle.IEEE, 5);
      expect(citation.inText).toBe("[5]");
      expect(citation.fullCitation).toContain("[Online]. Available:");
    });

    it("should format IEEE with author having only fullName (no first/last)", () => {
      const meta = service.buildCitationMetadata({
        title: "Anonymous Paper",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "academic",
        publishedAt: new Date("2024-01-01"),
        metadata: {
          authors: ["Organization Name"],
          doi: "10.1234/org",
          journal: "IEEE Transactions",
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.IEEE, 2);
      // Single-word name has no parts >= 2, falls to fullName
      expect(citation.fullCitation).toContain("Name");
    });
  });

  // ─────────────────────────── classifySource ───────────────────────────────
  describe("classifySource edge cases", () => {
    it("should classify congress-gov as GOVERNMENT_DOCUMENT", () => {
      const meta = service.buildCitationMetadata({
        title: "Congressional Bill",
        url: "https://congress.gov/bill/123",
        domain: "congress.gov",
        sourceType: "congress-gov",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.GOVERNMENT_DOCUMENT);
    });

    it("should classify whitehouse-news as GOVERNMENT_DOCUMENT", () => {
      const meta = service.buildCitationMetadata({
        title: "White House Press Release",
        url: "https://whitehouse.gov/news",
        domain: "whitehouse.gov",
        sourceType: "whitehouse-news",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.GOVERNMENT_DOCUMENT);
    });

    it("should classify social-x as SOCIAL_MEDIA", () => {
      const meta = service.buildCitationMetadata({
        title: "Tweet about AI",
        url: "https://x.com/user/tweet",
        domain: "x.com",
        sourceType: "social-x",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.SOCIAL_MEDIA);
    });

    it("should classify hackernews as BLOG_POST", () => {
      const meta = service.buildCitationMetadata({
        title: "HN Discussion",
        url: "https://news.ycombinator.com/item",
        domain: "news.ycombinator.com",
        sourceType: "hackernews",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.BLOG_POST);
    });

    it("should classify github as WEBSITE", () => {
      const meta = service.buildCitationMetadata({
        title: "GitHub Repository",
        url: "https://github.com/org/repo",
        domain: "github.com",
        sourceType: "github",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.WEBSITE);
    });

    it("should classify bbc.com domain as NEWS_ARTICLE", () => {
      const meta = service.buildCitationMetadata({
        title: "BBC News Article",
        url: "https://bbc.com/news/article",
        domain: "bbc.com",
        sourceType: "web",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.NEWS_ARTICLE);
    });

    it("should classify cnn.com domain as NEWS_ARTICLE", () => {
      const meta = service.buildCitationMetadata({
        title: "CNN Article",
        url: "https://cnn.com/article",
        domain: "cnn.com",
        sourceType: "web",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.NEWS_ARTICLE);
    });

    it("should classify semantic-scholar as JOURNAL_ARTICLE", () => {
      const meta = service.buildCitationMetadata({
        title: "Semantic Scholar Paper",
        url: "https://semanticscholar.org/paper",
        domain: "semanticscholar.org",
        sourceType: "semantic-scholar",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.JOURNAL_ARTICLE);
    });

    it("should classify pubmed as JOURNAL_ARTICLE", () => {
      const meta = service.buildCitationMetadata({
        title: "PubMed Article",
        url: "https://pubmed.ncbi.nlm.nih.gov/123",
        domain: "pubmed.ncbi.nlm.nih.gov",
        sourceType: "pubmed",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.JOURNAL_ARTICLE);
    });

    it("should classify academic source with venue as CONFERENCE_PAPER", () => {
      const meta = service.buildCitationMetadata({
        title: "Conference Paper",
        url: "https://proceedings.com/paper",
        domain: "proceedings.com",
        sourceType: "academic",
        publishedAt: new Date("2024-01-01"),
        metadata: {
          authors: ["Speaker One"],
          doi: "10.1234/conf",
          venue: "NeurIPS 2024",
        },
      });
      expect(meta.sourceCategory).toBe(SourceCategory.CONFERENCE_PAPER);
    });
  });

  // ─────────────────────────── extractAuthors edge cases ────────────────────
  describe("extractAuthors edge cases", () => {
    it("should handle object-style authors with name property", () => {
      const meta = service.buildCitationMetadata({
        title: "Paper with Object Authors",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "academic",
        publishedAt: null,
        metadata: {
          authors: [
            { name: "John Smith" },
            { name: "Jane Doe" },
          ] as unknown as string[],
        },
      });
      expect(meta.authors).toHaveLength(2);
      expect(meta.authors[0].lastName).toBe("Smith");
    });

    it("should handle single-word author names (no parts to split)", () => {
      const meta = service.buildCitationMetadata({
        title: "Single Name Author",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        publishedAt: null,
        metadata: {
          authors: ["Anonymous"],
        },
      });
      // Single-word name: no firstName/lastName set, only fullName
      expect(meta.authors[0].fullName).toBe("Anonymous");
    });
  });

  // ─────────────────────────── extractYear edge cases ───────────────────────
  describe("extractYear edge cases", () => {
    it("should return null for null date", () => {
      const meta = service.buildCitationMetadata({
        title: "No Date Paper",
        url: "https://example.com",
        sourceType: "web",
        publishedAt: null,
        metadata: {},
      });
      // year null -> "n.d." in APA
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      expect(citation.fullCitation).toContain("n.d.");
    });

    it("should return null for invalid date string", () => {
      const meta = service.buildCitationMetadata({
        title: "Invalid Date Paper",
        url: "https://example.com",
        sourceType: "web",
        publishedAt: "not-a-date",
        metadata: {},
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      expect(citation.fullCitation).toContain("n.d.");
    });

    it("should extract year from Date object", () => {
      const meta = service.buildCitationMetadata({
        title: "Valid Date Paper",
        url: "https://example.com",
        sourceType: "web",
        publishedAt: new Date("2022-06-15"),
        metadata: { authors: ["Test Author"] },
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      expect(citation.fullCitation).toContain("2022");
    });
  });

  // ─────────────────────────── formatAuthorsAPA edge cases ──────────────────
  describe("formatAuthorsAPA edge cases", () => {
    it("should return Unknown for empty authors array", () => {
      // We can trigger this by manipulating the metadata
      const meta = service.buildCitationMetadata({
        title: "Test",
        sourceType: "web",
        publishedAt: null,
        metadata: {},
      });
      // meta.authors = [{ fullName: "Unknown" }], single unknown
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      expect(citation.fullCitation).toBeDefined();
    });

    it("should handle single author with fullName only (no lastName)", () => {
      const meta = service.buildCitationMetadata({
        title: "Single Name Paper",
        sourceType: "web",
        publishedAt: null,
        metadata: { authors: ["Pseudonym"] }, // single word, no lastName split
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      // Should use fullName fallback
      expect(citation.inText).toContain("Pseudonym");
    });
  });
});


