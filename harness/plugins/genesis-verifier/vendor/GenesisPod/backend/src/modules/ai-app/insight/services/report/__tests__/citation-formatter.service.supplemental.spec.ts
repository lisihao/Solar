/**
 * CitationFormatterService - Supplemental Tests
 *
 * Targets uncovered lines:
 * - line 81: publishedDate is a string (extractYear with string input)
 * - line 167: APA website format with domain
 * - lines 207-210: MLA non-journal (website/news with url)
 * - lines 249-254: Chicago non-journal with publisher fallback
 * - lines 286-289: IEEE non-journal
 * - line 335: MLA 2-author format
 * - line 350: MLA 3+ authors
 * - lines 359-361: formatAuthorsMLA: 1-author no lastName, 2-author, 3+ author
 * - line 385: formatAuthorsAPA 1 author no lastName
 * - lines 407, 410: formatAuthorsMLA edge cases
 * - lines 424, 430: formatAuthorsIEEE edge cases
 * - classifySource: semantic-scholar, pubmed, whitehouse-news, social-x, hackernews, github, bbc, cnn
 * - APA 2-author in-text format
 */

import { Test, TestingModule } from "@nestjs/testing";
import { CitationFormatterService } from "../citation-formatter.service";
import { CitationStyle, SourceCategory } from "../../../types/citation.types";

describe("CitationFormatterService (supplemental)", () => {
  let service: CitationFormatterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CitationFormatterService],
    }).compile();

    service = module.get<CitationFormatterService>(CitationFormatterService);
  });

  // ─────────────────────────── extractYear edge cases ──────────────────────

  describe("extractYear with string date", () => {
    it("should extract year from string publishedDate", () => {
      const meta = service.buildCitationMetadata({
        title: "Article",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        publishedAt: "2023-06-15T00:00:00Z",
        metadata: {},
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      expect(citation.fullCitation).toContain("2023");
    });

    it("should return n.d. for invalid date string", () => {
      const meta = service.buildCitationMetadata({
        title: "Article",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        publishedAt: "not-a-date",
        metadata: {},
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      expect(citation.fullCitation).toContain("n.d.");
    });
  });

  // ─────────────────────────── APA: website and other formats ─────────────

  describe("formatCitation APA - website with domain", () => {
    it("should include domain in APA citation for website", () => {
      const meta = service.buildCitationMetadata({
        title: "AI Report 2024",
        url: "https://openai.com/report",
        domain: "openai.com",
        sourceType: "web",
        publishedAt: new Date("2024-01-01"),
        metadata: {},
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);

      // Website format: *title*. domain. url
      expect(citation.fullCitation).toContain("openai.com");
    });

    it("should include publisher in APA citation for non-website/non-journal", () => {
      const meta = service.buildCitationMetadata({
        title: "Government Report",
        url: "https://gov.org/report",
        domain: "gov.org",
        sourceType: "federal-register",
        publishedAt: new Date("2024-01-01"),
        metadata: {
          publisher: "US Federal Register",
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);

      expect(citation.fullCitation).toContain("US Federal Register");
    });
  });

  describe("formatCitation APA - 2 authors in-text", () => {
    it("should format APA 2-author in-text with & separator", () => {
      const meta = service.buildCitationMetadata({
        title: "Joint Study",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "academic",
        publishedAt: new Date("2023-01-01"),
        metadata: {
          doi: "10.1000/test",
          authors: ["Alice Johnson", "Bob Smith"],
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);

      // 2 authors: (FirstAuthorLast & SecondAuthorLast, year)
      expect(citation.inText).toContain("Johnson");
      expect(citation.inText).toContain("Smith");
    });
  });

  // ─────────────────────────── MLA: non-journal ────────────────────────────

  describe("formatCitation MLA - non-journal (website)", () => {
    it("should format MLA citation for website with domain", () => {
      const meta = service.buildCitationMetadata({
        title: "Technology Article",
        url: "https://techsite.com/article",
        domain: "techsite.com",
        sourceType: "web",
        publishedAt: new Date("2023-05-10"),
        metadata: {},
      });
      const citation = service.formatCitation(meta, CitationStyle.MLA, 1);

      // Non-journal: "title." *domain*, year, url.
      expect(citation.fullCitation).toContain("techsite.com");
    });

    it("should format MLA citation without url when url is missing", () => {
      const meta = service.buildCitationMetadata({
        title: "No URL Article",
        domain: "example.com",
        sourceType: "web",
        publishedAt: new Date("2023-01-01"),
        metadata: {},
      });
      const citation = service.formatCitation(meta, CitationStyle.MLA, 1);

      expect(citation.fullCitation).toContain("No URL Article");
    });
  });

  describe("formatCitation MLA - journal with doi", () => {
    it("should include doi in MLA journal citation", () => {
      const meta = service.buildCitationMetadata({
        title: "Research Paper",
        url: "https://doi.org/10.1234/test",
        domain: "journal.com",
        sourceType: "academic",
        publishedAt: new Date("2023-01-01"),
        metadata: {
          doi: "10.1234/test",
          journal: "Science Journal",
          volume: "5",
          issue: "2",
          pages: "100-120",
          authors: ["John Doe"],
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.MLA, 1);

      expect(citation.fullCitation).toContain("doi.org");
    });
  });

  // ─────────────────────────── Chicago: non-journal ────────────────────────

  describe("formatCitation Chicago - non-journal", () => {
    it("should use publisher when domain missing in Chicago non-journal", () => {
      const meta = service.buildCitationMetadata({
        title: "Policy Document",
        url: "https://whitehouse.gov/policy",
        sourceType: "whitehouse-news",
        publishedAt: new Date("2024-01-15"),
        metadata: {
          publisher: "White House Press Office",
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.CHICAGO, 1);

      expect(citation.fullCitation).toContain("White House Press Office");
    });

    it("should format Chicago non-journal without year", () => {
      const meta = service.buildCitationMetadata({
        title: "Undated Document",
        url: "https://example.com/doc",
        domain: "example.com",
        sourceType: "web",
        publishedAt: null,
        metadata: {},
      });
      const citation = service.formatCitation(meta, CitationStyle.CHICAGO, 1);

      expect(citation.inText).not.toContain(", 20"); // No year in inText
      expect(citation.fullCitation).toContain("Undated Document");
    });

    it("should format Chicago journal with doi", () => {
      const meta = service.buildCitationMetadata({
        title: "Chicago Journal Paper",
        url: "https://doi.org/10.9999/test",
        domain: "journal.org",
        sourceType: "academic",
        publishedAt: new Date("2022-03-15"),
        metadata: {
          doi: "10.9999/test",
          journal: "Academic Journal",
          volume: "12",
          issue: "3",
          pages: "45-78",
          authors: ["Maria Lopez"],
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.CHICAGO, 1);

      expect(citation.fullCitation).toContain("doi.org");
    });
  });

  // ─────────────────────────── IEEE: non-journal ────────────────────────────

  describe("formatCitation IEEE - non-journal", () => {
    it("should format IEEE non-journal with domain and url", () => {
      const meta = service.buildCitationMetadata({
        title: "Tech Blog Post",
        url: "https://techblog.com/post",
        domain: "techblog.com",
        sourceType: "hackernews",
        publishedAt: new Date("2023-10-01"),
        metadata: {},
      });
      const citation = service.formatCitation(meta, CitationStyle.IEEE, 2);

      expect(citation.inText).toBe("[2]");
      expect(citation.fullCitation).toContain("[Online]. Available");
    });

    it("should format IEEE non-journal without year", () => {
      const meta = service.buildCitationMetadata({
        title: "Undated Tech Article",
        url: "https://site.com",
        domain: "site.com",
        sourceType: "github",
        publishedAt: null,
        metadata: {},
      });
      const citation = service.formatCitation(meta, CitationStyle.IEEE, 3);

      expect(citation.fullCitation).toContain("[3]");
    });

    it("should format IEEE non-journal without url", () => {
      const meta = service.buildCitationMetadata({
        title: "Article Without URL",
        domain: "example.com",
        sourceType: "web",
        publishedAt: new Date("2023-01-01"),
        metadata: {},
      });
      const citation = service.formatCitation(meta, CitationStyle.IEEE, 1);

      // URL section might be missing or only domain
      expect(citation.fullCitation).toContain("Article Without URL");
    });
  });

  // ─────────────────────────── classifySource: all paths ──────────────────

  describe("classifySource: all source types", () => {
    it("should classify semantic-scholar as JOURNAL_ARTICLE", () => {
      const meta = service.buildCitationMetadata({
        title: "Paper",
        domain: "semanticscholar.org",
        sourceType: "semantic-scholar",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.JOURNAL_ARTICLE);
    });

    it("should classify pubmed as JOURNAL_ARTICLE", () => {
      const meta = service.buildCitationMetadata({
        title: "Medical Paper",
        domain: "pubmed.ncbi.nlm.nih.gov",
        sourceType: "pubmed",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.JOURNAL_ARTICLE);
    });

    it("should classify congress-gov as GOVERNMENT_DOCUMENT", () => {
      const meta = service.buildCitationMetadata({
        title: "Senate Bill",
        domain: "congress.gov",
        sourceType: "congress-gov",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.GOVERNMENT_DOCUMENT);
    });

    it("should classify whitehouse-news as GOVERNMENT_DOCUMENT", () => {
      const meta = service.buildCitationMetadata({
        title: "White House Statement",
        domain: "whitehouse.gov",
        sourceType: "whitehouse-news",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.GOVERNMENT_DOCUMENT);
    });

    it("should classify social-x as SOCIAL_MEDIA", () => {
      const meta = service.buildCitationMetadata({
        title: "Tweet",
        domain: "x.com",
        sourceType: "social-x",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.SOCIAL_MEDIA);
    });

    it("should classify hackernews as BLOG_POST", () => {
      const meta = service.buildCitationMetadata({
        title: "HN Post",
        domain: "news.ycombinator.com",
        sourceType: "hackernews",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.BLOG_POST);
    });

    it("should classify github as WEBSITE", () => {
      const meta = service.buildCitationMetadata({
        title: "GitHub Repo",
        domain: "github.com",
        sourceType: "github",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.WEBSITE);
    });

    it("should classify bbc domain as NEWS_ARTICLE", () => {
      const meta = service.buildCitationMetadata({
        title: "BBC News",
        domain: "bbc.co.uk",
        sourceType: "news",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.NEWS_ARTICLE);
    });

    it("should classify cnn domain as NEWS_ARTICLE", () => {
      const meta = service.buildCitationMetadata({
        title: "CNN Article",
        domain: "cnn.com",
        sourceType: "news",
        publishedAt: null,
        metadata: {},
      });
      expect(meta.sourceCategory).toBe(SourceCategory.NEWS_ARTICLE);
    });

    it("should classify academic with venue as CONFERENCE_PAPER", () => {
      const meta = service.buildCitationMetadata({
        title: "Conference Paper",
        domain: "conference.org",
        sourceType: "academic",
        publishedAt: null,
        metadata: {
          doi: "10.1145/test",
          venue: "NeurIPS 2023",
        },
      });
      expect(meta.sourceCategory).toBe(SourceCategory.CONFERENCE_PAPER);
    });
  });

  // ─────────────────────────── formatAuthors edge cases ─────────────────────

  describe("formatAuthorsAPA edge cases", () => {
    it("should format APA 1-author with only fullName (no lastName)", () => {
      const meta = service.buildCitationMetadata({
        title: "Single Author Article",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        publishedAt: null,
        metadata: {
          authors: ["Wikipedia"], // single word → no firstName/lastName split
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      // Should use fullName directly
      expect(citation.fullCitation).toContain("Wikipedia");
    });

    it("should format APA 3+ authors with et al.", () => {
      const meta = service.buildCitationMetadata({
        title: "Multi-Author Study",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "academic",
        publishedAt: new Date("2024-01-01"),
        metadata: {
          doi: "10.1234/x",
          authors: ["Alice Brown", "Bob Green", "Carol White", "Dave Black"],
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      // 3+ authors: "Brown, A., et al."
      expect(citation.fullCitation).toContain("et al.");
    });
  });

  describe("formatAuthorsMLA edge cases", () => {
    it("should format MLA 2-author", () => {
      const meta = service.buildCitationMetadata({
        title: "Two Author Paper",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        publishedAt: new Date("2022-01-01"),
        metadata: {
          authors: ["Alice Brown", "Bob Green"],
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.MLA, 1);
      // "Brown, Alice, and Bob Green."
      expect(citation.fullCitation).toContain("Brown");
      expect(citation.fullCitation).toContain("Bob Green");
    });

    it("should format MLA 3+ authors with et al.", () => {
      const meta = service.buildCitationMetadata({
        title: "Multi Author Study",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        publishedAt: new Date("2022-01-01"),
        metadata: {
          authors: ["Alice Brown", "Bob Green", "Carol White"],
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.MLA, 1);
      expect(citation.fullCitation).toContain("et al.");
    });
  });

  describe("formatAuthorsIEEE edge cases", () => {
    it("should format IEEE author with only fullName (no firstName/lastName)", () => {
      const meta = service.buildCitationMetadata({
        title: "IEEE Article",
        url: "https://ieee.org/paper",
        domain: "ieee.org",
        sourceType: "academic",
        publishedAt: new Date("2023-01-01"),
        metadata: {
          doi: "10.1109/test",
          authors: ["Wikipedia"], // single word, no split
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.IEEE, 1);
      expect(citation.fullCitation).toContain("Wikipedia");
    });

    it("should format IEEE 0 authors as Unknown", () => {
      // Explicitly test with empty authors metadata
      const meta = service.buildCitationMetadata({
        title: "No Author Article",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        publishedAt: null,
        metadata: {
          authors: [], // empty array
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.IEEE, 1);
      expect(citation.fullCitation).toContain("Unknown");
    });
  });

  // ─────────────────────────── formatAuthorsAPA/MLA empty authors ─────────────

  describe("formatAuthorsAPA and formatAuthorsMLA with 0 authors", () => {
    it("formatAuthorsAPA: should return Unknown when authors array is empty", () => {
      // metadata.authors = [] makes extractAuthors return []
      const meta = service.buildCitationMetadata({
        title: "No Authors Article",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        publishedAt: new Date("2024-01-01"),
        metadata: {
          authors: [], // Empty array → extractAuthors returns []
        },
      });
      // meta.authors is now []
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);
      // formatAuthorsAPA([]) → "Unknown"
      expect(citation.fullCitation).toContain("Unknown");
    });

    it("formatAuthorsMLA: should return 'Unknown.' when authors array is empty", () => {
      const meta = service.buildCitationMetadata({
        title: "No Authors MLA",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        publishedAt: new Date("2024-01-01"),
        metadata: {
          authors: [], // Empty array
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.MLA, 1);
      // formatAuthorsMLA([]) → "Unknown."
      expect(citation.fullCitation).toContain("Unknown");
    });
  });

  // ─────────────────────────── default case in formatCitation ───────────────

  describe("formatCitation - default (unknown style)", () => {
    it("should fall back to APA for unknown citation style", () => {
      const meta = service.buildCitationMetadata({
        title: "Test Article",
        url: "https://example.com",
        domain: "example.com",
        sourceType: "web",
        publishedAt: new Date("2024-01-01"),
        metadata: {},
      });
      // Cast unknown style to CitationStyle
      const citation = service.formatCitation(
        meta,
        "UNKNOWN_STYLE" as CitationStyle,
        1,
      );

      // Falls back to APA format
      expect(citation.style).toBe(CitationStyle.APA);
    });
  });

  // ─────────────────────────── APA: no url and no doi paths ───────────────

  describe("formatCitation APA - journal without doi (uses url)", () => {
    it("should use url when doi is missing in APA journal citation", () => {
      const meta = service.buildCitationMetadata({
        title: "Journal Article No DOI",
        url: "https://journal.org/article",
        domain: "journal.org",
        sourceType: "academic",
        publishedAt: new Date("2023-01-01"),
        metadata: {
          journal: "Test Journal",
          volume: "10",
          issue: "2",
          pages: "100-110",
          authors: ["John Smith"],
          // No doi field
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);

      expect(citation.fullCitation).toContain("https://journal.org/article");
    });
  });
});


