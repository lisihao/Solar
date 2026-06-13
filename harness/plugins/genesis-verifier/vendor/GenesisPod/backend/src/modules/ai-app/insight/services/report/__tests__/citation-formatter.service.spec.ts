/**
 * CitationFormatterService Unit Tests
 *
 * Coverage targets:
 * - buildCitationMetadata: extracts authors, classifies source types
 * - formatCitation: APA, MLA, Chicago, IEEE, Harvard styles
 * - generateBibliography: sorts, renumbers, builds stats
 * - Source classification: academic, government, news, blog, website
 */

import { Test, TestingModule } from "@nestjs/testing";
import { CitationFormatterService } from "../citation-formatter.service";
import { CitationStyle, SourceCategory } from "../../../types/citation.types";

// ──────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ──────────────────────────────────────────────────────────────────────────────

const journalEvidence = {
  title: "Deep Learning in Natural Language Processing",
  url: "https://doi.org/10.1234/journal.2024",
  domain: "arxiv.org",
  sourceType: "academic",
  publishedAt: new Date("2024-03-15"),
  metadata: {
    authors: ["John Smith", "Jane Doe"],
    doi: "10.1234/journal.2024",
    journal: "Nature Machine Intelligence",
    volume: "6",
    issue: "3",
    pages: "245-260",
  },
};

const websiteEvidence = {
  title: "OpenAI GPT-4 Technical Report",
  url: "https://openai.com/research/gpt-4",
  domain: "openai.com",
  sourceType: "web",
  publishedAt: new Date("2023-03-14"),
  metadata: {},
};

const newsEvidence = {
  title: "AI Regulation Bill Passes Congress",
  url: "https://reuters.com/article/ai-regulation",
  domain: "reuters.com",
  sourceType: "news",
  publishedAt: new Date("2024-01-10"),
  metadata: {},
};

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("CitationFormatterService", () => {
  let service: CitationFormatterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CitationFormatterService],
    }).compile();

    service = module.get<CitationFormatterService>(CitationFormatterService);
  });

  // ──────────────────────── buildCitationMetadata ───────────────────────────

  describe("buildCitationMetadata", () => {
    it("should extract authors from metadata", () => {
      const meta = service.buildCitationMetadata(journalEvidence);

      expect(meta.authors).toHaveLength(2);
      expect(meta.authors[0].lastName).toBe("Smith");
      expect(meta.authors[1].lastName).toBe("Doe");
    });

    it("should use Unknown author when no metadata authors", () => {
      const meta = service.buildCitationMetadata(websiteEvidence);

      expect(meta.authors[0].fullName).toBe("Unknown");
    });

    it("should classify academic source as JOURNAL_ARTICLE", () => {
      const meta = service.buildCitationMetadata(journalEvidence);

      expect(meta.sourceCategory).toBe(SourceCategory.JOURNAL_ARTICLE);
    });

    it("should classify arxiv domain as PREPRINT", () => {
      const meta = service.buildCitationMetadata({
        ...websiteEvidence,
        domain: "arxiv.org",
        sourceType: "web",
        metadata: {},
      });

      expect(meta.sourceCategory).toBe(SourceCategory.PREPRINT);
    });

    it("should classify reuters domain as NEWS_ARTICLE", () => {
      const meta = service.buildCitationMetadata(newsEvidence);

      expect(meta.sourceCategory).toBe(SourceCategory.NEWS_ARTICLE);
    });

    it("should classify federal-register sourceType as GOVERNMENT_DOCUMENT", () => {
      const meta = service.buildCitationMetadata({
        title: "Federal Register Notice",
        url: "https://federalregister.gov/notice",
        domain: "federalregister.gov",
        sourceType: "federal-register",
        publishedAt: null,
        metadata: {},
      });

      expect(meta.sourceCategory).toBe(SourceCategory.GOVERNMENT_DOCUMENT);
    });

    it("should default to WEBSITE for unknown sources", () => {
      const meta = service.buildCitationMetadata({
        title: "Unknown Source Article",
        url: "https://randomsite.com/article",
        domain: "randomsite.com",
        sourceType: "web",
        publishedAt: null,
        metadata: {},
      });

      expect(meta.sourceCategory).toBe(SourceCategory.WEBSITE);
    });

    it("should include doi from metadata", () => {
      const meta = service.buildCitationMetadata(journalEvidence);

      expect(meta.doi).toBe("10.1234/journal.2024");
    });
  });

  // ─────────────────────────── formatCitation ───────────────────────────────

  describe("formatCitation - APA", () => {
    it("should format APA in-text citation with year", () => {
      const meta = service.buildCitationMetadata(journalEvidence);
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);

      expect(citation.inText).toContain("Smith");
      expect(citation.inText).toContain("2024");
      expect(citation.style).toBe(CitationStyle.APA);
    });

    it("should format APA full citation with journal details", () => {
      const meta = service.buildCitationMetadata(journalEvidence);
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);

      expect(citation.fullCitation).toContain(
        "Deep Learning in Natural Language Processing",
      );
    });

    it("should handle APA with multiple authors using et al.", () => {
      const meta = service.buildCitationMetadata({
        ...journalEvidence,
        metadata: {
          authors: ["Alice Brown", "Bob Green", "Carol White"],
        },
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);

      expect(citation.inText).toContain("et al.");
    });

    it("should use n.d. when no publication date", () => {
      const meta = service.buildCitationMetadata({
        ...websiteEvidence,
        publishedAt: null,
      });
      const citation = service.formatCitation(meta, CitationStyle.APA, 1);

      expect(citation.fullCitation).toContain("n.d.");
    });
  });

  describe("formatCitation - MLA", () => {
    it("should format MLA in-text citation without year", () => {
      const meta = service.buildCitationMetadata(journalEvidence);
      const citation = service.formatCitation(meta, CitationStyle.MLA, 1);

      expect(citation.inText).toContain("Smith");
      expect(citation.style).toBe(CitationStyle.MLA);
    });

    it("should format MLA full citation with quoted title", () => {
      const meta = service.buildCitationMetadata(journalEvidence);
      const citation = service.formatCitation(meta, CitationStyle.MLA, 1);

      expect(citation.fullCitation).toContain(
        '"Deep Learning in Natural Language Processing."',
      );
    });
  });

  describe("formatCitation - Chicago", () => {
    it("should format Chicago in-text citation with year in parentheses", () => {
      const meta = service.buildCitationMetadata(journalEvidence);
      const citation = service.formatCitation(meta, CitationStyle.CHICAGO, 1);

      expect(citation.inText).toContain("Smith");
      expect(citation.inText).toContain("2024");
      expect(citation.style).toBe(CitationStyle.CHICAGO);
    });
  });

  describe("formatCitation - IEEE", () => {
    it("should format IEEE in-text citation as [index]", () => {
      const meta = service.buildCitationMetadata(journalEvidence);
      const citation = service.formatCitation(meta, CitationStyle.IEEE, 3);

      expect(citation.inText).toBe("[3]");
      expect(citation.fullCitation).toContain("[3]");
      expect(citation.style).toBe(CitationStyle.IEEE);
    });

    it("should format IEEE citation with author initials", () => {
      const meta = service.buildCitationMetadata(journalEvidence);
      const citation = service.formatCitation(meta, CitationStyle.IEEE, 1);

      expect(citation.fullCitation).toContain("J. Smith");
    });
  });

  describe("formatCitation - Harvard", () => {
    it("should format Harvard citation (same as APA)", () => {
      const meta = service.buildCitationMetadata(journalEvidence);
      const harvard = service.formatCitation(meta, CitationStyle.HARVARD, 1);
      const apa = service.formatCitation(meta, CitationStyle.APA, 1);

      expect(harvard.fullCitation).toBe(apa.fullCitation);
    });
  });

  // ──────────────────────── generateBibliography ────────────────────────────

  describe("generateBibliography", () => {
    it("should generate bibliography with correct total count", () => {
      const metas = [
        service.buildCitationMetadata(journalEvidence),
        service.buildCitationMetadata(websiteEvidence),
        service.buildCitationMetadata(newsEvidence),
      ];

      const bib = service.generateBibliography(metas, CitationStyle.APA);

      expect(bib.stats.totalSources).toBe(3);
      expect(bib.entries).toHaveLength(3);
    });

    it("should sort entries and renumber them", () => {
      const metas = [
        service.buildCitationMetadata(newsEvidence),
        service.buildCitationMetadata(journalEvidence),
      ];

      const bib = service.generateBibliography(metas, CitationStyle.APA);

      expect(bib.entries[0].index).toBe(1);
      expect(bib.entries[1].index).toBe(2);
    });

    it("should count DOI entries in stats", () => {
      const metas = [service.buildCitationMetadata(journalEvidence)];

      const bib = service.generateBibliography(metas, CitationStyle.APA);

      expect(bib.stats.withDoi).toBe(1);
    });

    it("should count URL entries in stats", () => {
      const metas = [
        service.buildCitationMetadata(websiteEvidence),
        service.buildCitationMetadata(newsEvidence),
      ];

      const bib = service.generateBibliography(metas, CitationStyle.APA);

      expect(bib.stats.withUrl).toBe(2);
    });

    it("should produce formatted text joining all citations", () => {
      const metas = [service.buildCitationMetadata(journalEvidence)];

      const bib = service.generateBibliography(metas, CitationStyle.APA);

      expect(bib.formattedText).toBeTruthy();
      expect(bib.formattedText.length).toBeGreaterThan(0);
    });

    it("should count by category in stats", () => {
      const metas = [
        service.buildCitationMetadata(journalEvidence),
        service.buildCitationMetadata(newsEvidence),
      ];

      const bib = service.generateBibliography(metas, CitationStyle.APA);

      expect(bib.stats.byCategory).toHaveProperty(
        SourceCategory.JOURNAL_ARTICLE,
      );
      expect(bib.stats.byCategory).toHaveProperty(SourceCategory.NEWS_ARTICLE);
    });
  });
});


