/**
 * Citation Formatter — 5 种学术引用格式（Phase 9 沉淀）
 *
 * 沉淀自：ai-app/{app}/services/report/citation-formatting.util.service.ts
 * 重构：从 NestJS 服务降级为纯函数模块，与同目录的 citation-verifier.util 一致风格。
 *
 * 支持：APA 7th / MLA 9th / Chicago 17th / IEEE / Harvard
 *
 * 用法：
 *   const meta = buildCitationMetadata({ title, url, ... });
 *   const formatted = formatCitation(meta, "apa", 1);
 *   const bib = generateBibliography([meta1, meta2], "ieee");
 */

// ─── Types ───────────────────────────────────────────────

export type CitationStyle =
  | "apa"
  | "mla"
  | "chicago"
  | "ieee"
  | "harvard"
  | "vancouver";

export type SourceCategory =
  | "journal_article"
  | "conference_paper"
  | "book"
  | "book_chapter"
  | "website"
  | "news_article"
  | "report"
  | "government_document"
  | "preprint"
  | "social_media"
  | "blog_post"
  | "dataset";

export interface CitationAuthor {
  firstName?: string;
  lastName?: string;
  fullName: string;
  isOrganization?: boolean;
}

export interface CitationMetadata {
  sourceCategory: SourceCategory;
  title: string;
  authors: CitationAuthor[];
  publishedDate?: Date | string;
  accessedDate?: Date | string;
  url?: string;
  doi?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  publicationPlace?: string;
  edition?: string;
  domain?: string;
  dataSourceType?: string;
}

export interface FormattedCitation {
  inText: string;
  fullCitation: string;
  style: CitationStyle;
  index: number;
  sortKey: string;
}

export interface Bibliography {
  style: CitationStyle;
  entries: FormattedCitation[];
  formattedText: string;
  stats: {
    totalSources: number;
    byCategory: Record<string, number>;
    withDoi: number;
    withUrl: number;
  };
}

export interface RawEvidence {
  title: string;
  url?: string;
  domain?: string;
  sourceType?: string;
  publishedAt?: Date | string | null;
  metadata?: Record<string, unknown>;
}

// ─── Public API ──────────────────────────────────────────

export function buildCitationMetadata(evidence: RawEvidence): CitationMetadata {
  const authors = extractAuthors(evidence.metadata);
  const sourceCategory = classifySource(
    evidence.sourceType,
    evidence.domain,
    evidence.metadata,
  );
  return {
    sourceCategory,
    title: evidence.title,
    authors,
    publishedDate: evidence.publishedAt || undefined,
    accessedDate: new Date(),
    url: evidence.url,
    doi: evidence.metadata?.doi as string | undefined,
    journal: evidence.metadata?.journal as string | undefined,
    volume: evidence.metadata?.volume as string | undefined,
    issue: evidence.metadata?.issue as string | undefined,
    pages: evidence.metadata?.pages as string | undefined,
    publisher: evidence.metadata?.publisher as string | undefined,
    domain: evidence.domain,
    dataSourceType: evidence.sourceType,
  };
}

export function formatCitation(
  metadata: CitationMetadata,
  style: CitationStyle,
  index: number,
): FormattedCitation {
  switch (style) {
    case "apa":
      return formatAPA(metadata, index);
    case "mla":
      return formatMLA(metadata, index);
    case "chicago":
      return formatChicago(metadata, index);
    case "ieee":
      return formatIEEE(metadata, index);
    case "harvard":
      return formatAPA(metadata, index); // Harvard ≈ APA
    case "vancouver":
      return formatIEEE(metadata, index); // Vancouver ≈ IEEE
    default:
      return formatAPA(metadata, index);
  }
}

export function generateBibliography(
  citations: CitationMetadata[],
  style: CitationStyle,
): Bibliography {
  const entries = citations.map((c, i) => formatCitation(c, style, i + 1));
  entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  entries.forEach((entry, i) => (entry.index = i + 1));

  const byCategory: Record<string, number> = {};
  for (const c of citations) {
    byCategory[c.sourceCategory] = (byCategory[c.sourceCategory] || 0) + 1;
  }
  return {
    style,
    entries,
    formattedText: entries.map((e) => e.fullCitation).join("\n\n"),
    stats: {
      totalSources: citations.length,
      byCategory,
      withDoi: citations.filter((c) => c.doi).length,
      withUrl: citations.filter((c) => c.url).length,
    },
  };
}

// ─── Style implementations ───────────────────────────────

function formatAPA(meta: CitationMetadata, index: number): FormattedCitation {
  const authorStr = formatAuthorsAPA(meta.authors);
  const year = extractYear(meta.publishedDate);
  const yearStr = year || "n.d.";
  const firstAuthorLast =
    meta.authors[0]?.lastName || meta.authors[0]?.fullName || "Unknown";
  const inText =
    meta.authors.length > 2
      ? `(${firstAuthorLast} et al., ${yearStr})`
      : meta.authors.length === 2
        ? `(${firstAuthorLast} & ${meta.authors[1]?.lastName || meta.authors[1]?.fullName}, ${yearStr})`
        : `(${firstAuthorLast}, ${yearStr})`;

  let fullCitation = `${authorStr} (${yearStr}). `;
  if (
    meta.sourceCategory === "journal_article" ||
    meta.sourceCategory === "preprint"
  ) {
    fullCitation += `${meta.title}. `;
    if (meta.journal) {
      fullCitation += `*${meta.journal}*`;
      if (meta.volume) fullCitation += `, *${meta.volume}*`;
      if (meta.issue) fullCitation += `(${meta.issue})`;
      if (meta.pages) fullCitation += `, ${meta.pages}`;
      fullCitation += ". ";
    }
    if (meta.doi) fullCitation += `https://doi.org/${meta.doi}`;
    else if (meta.url) fullCitation += meta.url;
  } else if (meta.sourceCategory === "website") {
    fullCitation += `*${meta.title}*. `;
    if (meta.domain) fullCitation += `${meta.domain}. `;
    if (meta.url) fullCitation += meta.url;
  } else {
    fullCitation += `${meta.title}. `;
    if (meta.publisher) fullCitation += `${meta.publisher}. `;
    if (meta.url) fullCitation += meta.url;
  }
  return {
    inText,
    fullCitation: fullCitation.trim(),
    style: "apa",
    index,
    sortKey: `${firstAuthorLast}_${yearStr}`,
  };
}

function formatMLA(meta: CitationMetadata, index: number): FormattedCitation {
  const firstAuthor = meta.authors[0];
  const authorStr = formatAuthorsMLA(meta.authors);
  const year = extractYear(meta.publishedDate);
  const lastName = firstAuthor?.lastName || firstAuthor?.fullName || "Unknown";
  const inText =
    meta.authors.length > 2 ? `(${lastName} et al.)` : `(${lastName})`;

  let fullCitation = `${authorStr} `;
  if (meta.sourceCategory === "journal_article") {
    fullCitation += `"${meta.title}." `;
    if (meta.journal) fullCitation += `*${meta.journal}*, `;
    if (meta.volume) fullCitation += `vol. ${meta.volume}, `;
    if (meta.issue) fullCitation += `no. ${meta.issue}, `;
    if (year) fullCitation += `${year}, `;
    if (meta.pages) fullCitation += `pp. ${meta.pages}. `;
    if (meta.doi) fullCitation += `https://doi.org/${meta.doi}.`;
  } else {
    fullCitation += `"${meta.title}." `;
    if (meta.domain) fullCitation += `*${meta.domain}*, `;
    if (year) fullCitation += `${year}, `;
    if (meta.url) fullCitation += `${meta.url}.`;
  }
  return {
    inText,
    fullCitation: fullCitation.trim(),
    style: "mla",
    index,
    sortKey: lastName,
  };
}

function formatChicago(
  meta: CitationMetadata,
  index: number,
): FormattedCitation {
  const authorStr = formatAuthorsChicago(meta.authors);
  const year = extractYear(meta.publishedDate);
  const firstName =
    meta.authors[0]?.lastName || meta.authors[0]?.fullName || "Unknown";
  const inText = `(${firstName}${year ? `, ${year}` : ""})`;

  let fullCitation = `${authorStr}. `;
  if (meta.sourceCategory === "journal_article") {
    fullCitation += `"${meta.title}." `;
    if (meta.journal) fullCitation += `*${meta.journal}* `;
    if (meta.volume) fullCitation += `${meta.volume}`;
    if (meta.issue) fullCitation += `, no. ${meta.issue}`;
    if (year) fullCitation += ` (${year})`;
    if (meta.pages) fullCitation += `: ${meta.pages}`;
    fullCitation += ". ";
    if (meta.doi) fullCitation += `https://doi.org/${meta.doi}.`;
  } else {
    fullCitation += `"${meta.title}." `;
    if (meta.domain || meta.publisher) {
      fullCitation += `${meta.domain || meta.publisher}. `;
    }
    if (year) fullCitation += `${year}. `;
    if (meta.url) fullCitation += `${meta.url}.`;
  }
  return {
    inText,
    fullCitation: fullCitation.trim(),
    style: "chicago",
    index,
    sortKey: firstName,
  };
}

function formatIEEE(meta: CitationMetadata, index: number): FormattedCitation {
  const authorStr = formatAuthorsIEEE(meta.authors);
  const year = extractYear(meta.publishedDate);
  const inText = `[${index}]`;
  let fullCitation = `[${index}] ${authorStr}, "${meta.title}," `;
  if (meta.sourceCategory === "journal_article") {
    if (meta.journal) fullCitation += `*${meta.journal}*, `;
    if (meta.volume) fullCitation += `vol. ${meta.volume}, `;
    if (meta.issue) fullCitation += `no. ${meta.issue}, `;
    if (meta.pages) fullCitation += `pp. ${meta.pages}, `;
    if (year) fullCitation += `${year}. `;
    if (meta.doi) fullCitation += `doi: ${meta.doi}.`;
  } else {
    if (meta.domain) fullCitation += `${meta.domain}, `;
    if (year) fullCitation += `${year}. `;
    if (meta.url) fullCitation += `[Online]. Available: ${meta.url}`;
  }
  return {
    inText,
    fullCitation: fullCitation.trim(),
    style: "ieee",
    index,
    sortKey: String(index).padStart(5, "0"),
  };
}

// ─── Helpers ─────────────────────────────────────────────

function extractAuthors(metadata?: Record<string, unknown>): CitationAuthor[] {
  if (!metadata?.authors) {
    return [{ fullName: "Unknown", isOrganization: false }];
  }
  const authors = metadata.authors as Array<string | { name: string }>;
  // ★ P0-R5-6 (2026-04-30): LLM 经常返回 "Jane Smith and John Doe" 一条 string
  //   纯 /\s+/ 拆 → firstName="Jane Smith and John", lastName="Doe"，APA 输出
  //   "Doe, J." 学术格式错。先按 and / & / , / ; 拆多作者，再各自拆名。
  return authors.flatMap((a) => {
    const raw = typeof a === "string" ? a : a.name;
    const splitted = raw
      .split(/\s*(?:\band\b|&|,|;)\s*/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return splitted.map((name) => {
      const parts = name.split(/\s+/);
      if (parts.length >= 2) {
        return {
          firstName: parts.slice(0, -1).join(" "),
          lastName: parts[parts.length - 1],
          fullName: name,
        };
      }
      return { fullName: name };
    });
  });
}

function classifySource(
  sourceType?: string,
  domain?: string,
  metadata?: Record<string, unknown>,
): SourceCategory {
  if (metadata?.doi || sourceType === "academic") {
    return metadata?.venue ? "conference_paper" : "journal_article";
  }
  if (sourceType === "semantic-scholar" || sourceType === "pubmed") {
    return "journal_article";
  }
  if (
    sourceType === "federal-register" ||
    sourceType === "congress-gov" ||
    sourceType === "whitehouse-news"
  ) {
    return "government_document";
  }
  if (sourceType === "social-x") return "social_media";
  if (sourceType === "hackernews") return "blog_post";
  if (sourceType === "github") return "website";

  if (domain) {
    // arxiv 用 includes 安全（学术域名几乎不会有钓鱼）
    if (domain.includes("arxiv")) return "preprint";
    // ★ P1-R5-E (2026-04-30): includes("reuters") 会误把 fakenewsreuters.com /
    //   reuters-clone.com 等钓鱼域名判为权威新闻。改用精确域名匹配 + 子域名后缀。
    const newsExact = ["reuters.com", "bbc.co.uk", "bbc.com", "cnn.com"];
    if (newsExact.some((d) => domain === d || domain.endsWith("." + d))) {
      return "news_article";
    }
  }
  return "website";
}

function extractYear(date?: Date | string | null): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  return isNaN(d.getTime()) ? null : String(d.getFullYear());
}

function formatAuthorsAPA(authors: CitationAuthor[]): string {
  if (authors.length === 0) return "Unknown";
  // ★ P1-R5-H (2026-04-30): firstName 缺失时不输出 "Smith, ." 孤独 dot
  const apaSingle = (a: CitationAuthor): string => {
    if (!a.lastName) return a.fullName;
    const initial = a.firstName?.charAt(0) || "";
    return initial ? `${a.lastName}, ${initial}.` : a.lastName;
  };
  if (authors.length === 1) return apaSingle(authors[0]);
  if (authors.length === 2) return authors.map(apaSingle).join(", & ");
  return `${apaSingle(authors[0])}, et al.`;
}

function formatAuthorsMLA(authors: CitationAuthor[]): string {
  if (authors.length === 0) return "Unknown.";
  const first = authors[0];
  if (authors.length === 1) {
    return `${first.lastName || first.fullName}, ${first.firstName || ""}.`;
  }
  if (authors.length === 2) {
    const second = authors[1];
    return `${first.lastName}, ${first.firstName}, and ${second.fullName}.`;
  }
  return `${first.lastName}, ${first.firstName}, et al.`;
}

function formatAuthorsChicago(authors: CitationAuthor[]): string {
  return formatAuthorsMLA(authors);
}

function formatAuthorsIEEE(authors: CitationAuthor[]): string {
  if (authors.length === 0) return "Unknown";
  return authors
    .map((a) => {
      if (a.firstName && a.lastName) {
        return `${a.firstName.charAt(0)}. ${a.lastName}`;
      }
      return a.fullName;
    })
    .join(", ");
}
