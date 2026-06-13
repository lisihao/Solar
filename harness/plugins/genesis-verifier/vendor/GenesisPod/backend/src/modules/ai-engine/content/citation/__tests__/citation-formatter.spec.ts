import {
  buildCitationMetadata,
  formatCitation,
  generateBibliography,
  type CitationMetadata,
} from "../citation-formatting.util";

describe("buildCitationMetadata", () => {
  it("classifies arxiv as preprint", () => {
    const meta = buildCitationMetadata({
      title: "Quantum Foo",
      url: "https://arxiv.org/abs/2401.01234",
      domain: "arxiv.org",
    });
    expect(meta.sourceCategory).toBe("preprint");
  });

  it("classifies sourceType=academic + doi as journal_article", () => {
    const meta = buildCitationMetadata({
      title: "Foo",
      sourceType: "academic",
      metadata: { doi: "10.1/abc" },
    });
    expect(meta.sourceCategory).toBe("journal_article");
  });

  it("classifies semantic-scholar as journal_article", () => {
    const meta = buildCitationMetadata({
      title: "Foo",
      sourceType: "semantic-scholar",
    });
    expect(meta.sourceCategory).toBe("journal_article");
  });

  it("classifies gov sources", () => {
    const meta = buildCitationMetadata({
      title: "Foo",
      sourceType: "federal-register",
    });
    expect(meta.sourceCategory).toBe("government_document");
  });

  it("classifies reuters as news_article", () => {
    const meta = buildCitationMetadata({
      title: "Foo",
      domain: "reuters.com",
    });
    expect(meta.sourceCategory).toBe("news_article");
  });

  it("default fallback to website", () => {
    const meta = buildCitationMetadata({ title: "Foo" });
    expect(meta.sourceCategory).toBe("website");
  });

  it("extracts authors from metadata.authors", () => {
    const meta = buildCitationMetadata({
      title: "Foo",
      metadata: { authors: ["Jane Smith", "John Doe"] },
    });
    expect(meta.authors).toHaveLength(2);
    expect(meta.authors[0].lastName).toBe("Smith");
    expect(meta.authors[0].firstName).toBe("Jane");
  });

  it("falls back to Unknown author when none provided", () => {
    const meta = buildCitationMetadata({ title: "Foo" });
    expect(meta.authors[0].fullName).toBe("Unknown");
  });
});

describe("formatCitation", () => {
  const baseMeta: CitationMetadata = {
    sourceCategory: "journal_article",
    title: "Quantum Foo",
    authors: [{ firstName: "Jane", lastName: "Smith", fullName: "Jane Smith" }],
    publishedDate: new Date("2024-06-01"),
    journal: "Nature",
    volume: "12",
    issue: "3",
    pages: "100-110",
    doi: "10.1/abc",
  };

  it("APA format", () => {
    const c = formatCitation(baseMeta, "apa", 1);
    expect(c.style).toBe("apa");
    expect(c.inText).toContain("Smith");
    expect(c.inText).toContain("2024");
    expect(c.fullCitation).toContain("Quantum Foo");
    expect(c.fullCitation).toContain("Nature");
    expect(c.fullCitation).toContain("doi.org/10.1/abc");
  });

  it("MLA format", () => {
    const c = formatCitation(baseMeta, "mla", 1);
    expect(c.style).toBe("mla");
    expect(c.fullCitation).toContain('"Quantum Foo."');
    expect(c.fullCitation).toContain("vol. 12");
  });

  it("Chicago format", () => {
    const c = formatCitation(baseMeta, "chicago", 1);
    expect(c.style).toBe("chicago");
    expect(c.fullCitation).toContain('"Quantum Foo."');
  });

  it("IEEE format with numbered prefix", () => {
    const c = formatCitation(baseMeta, "ieee", 7);
    expect(c.style).toBe("ieee");
    expect(c.inText).toBe("[7]");
    expect(c.fullCitation.startsWith("[7]")).toBe(true);
    expect(c.sortKey).toBe("00007");
  });

  it("Harvard maps to APA-like output", () => {
    const c = formatCitation(baseMeta, "harvard", 1);
    expect(c.fullCitation).toContain("Quantum Foo");
    expect(c.inText).toContain("2024");
  });

  it("APA with 3+ authors uses et al.", () => {
    const meta: CitationMetadata = {
      ...baseMeta,
      authors: [
        { firstName: "A", lastName: "X", fullName: "A X" },
        { firstName: "B", lastName: "Y", fullName: "B Y" },
        { firstName: "C", lastName: "Z", fullName: "C Z" },
      ],
    };
    const c = formatCitation(meta, "apa", 1);
    expect(c.inText).toContain("et al.");
  });

  it("APA n.d. when no published date", () => {
    const meta: CitationMetadata = { ...baseMeta, publishedDate: undefined };
    const c = formatCitation(meta, "apa", 1);
    expect(c.fullCitation).toContain("(n.d.)");
  });

  it("website format uses domain", () => {
    const meta: CitationMetadata = {
      ...baseMeta,
      sourceCategory: "website",
      domain: "example.com",
      journal: undefined,
      doi: undefined,
    };
    const c = formatCitation(meta, "apa", 1);
    expect(c.fullCitation).toContain("example.com");
  });
});

describe("generateBibliography", () => {
  const items: CitationMetadata[] = [
    {
      sourceCategory: "journal_article",
      title: "Foo",
      authors: [{ lastName: "Zhang", fullName: "Zhang" }],
      publishedDate: new Date("2024-01-01"),
    },
    {
      sourceCategory: "website",
      title: "Bar",
      authors: [{ lastName: "Adams", fullName: "Adams" }],
      url: "https://x.com",
    },
  ];

  it("APA bibliography sorts by sortKey (Adams before Zhang)", () => {
    const bib = generateBibliography(items, "apa");
    expect(bib.entries[0].fullCitation).toContain("Adams");
    expect(bib.entries[1].fullCitation).toContain("Zhang");
    expect(bib.stats.totalSources).toBe(2);
  });

  it("IEEE bibliography uses numeric sort", () => {
    const bib = generateBibliography(items, "ieee");
    expect(bib.entries[0].index).toBe(1);
    expect(bib.entries[1].index).toBe(2);
  });

  it("stats counts byCategory + withUrl", () => {
    const bib = generateBibliography(items, "apa");
    expect(bib.stats.byCategory.journal_article).toBe(1);
    expect(bib.stats.byCategory.website).toBe(1);
    expect(bib.stats.withUrl).toBe(1);
  });
});

