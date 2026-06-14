/**
 * Evidence Credibility Assessment Utilities
 *
 * Pure functions for scoring evidence credibility based on domain authority,
 * source type, content depth, and timeliness.
 * Extracted from DimensionMissionService to reduce god-object size.
 */

/** Top authority domains (government, education, premier academic) */
const TOP_AUTHORITY = [
  ".gov",
  ".edu",
  ".ac.",
  "nature.com",
  "science.org",
  "sciencedirect.com",
  "springer.com",
  "wiley.com",
  "arxiv.org",
  "pubmed.ncbi",
  "ieee.org",
  "acm.org",
  "who.int",
  "un.org",
  "worldbank.org",
  "imf.org",
  "oecd.org",
];

/** High authority domains (major media, think tanks) */
const HIGH_AUTHORITY = [
  "reuters.com",
  "bloomberg.com",
  "wsj.com",
  "nytimes.com",
  "washingtonpost.com",
  "bbc.com",
  "economist.com",
  "ft.com",
  "theguardian.com",
  "apnews.com",
  "stanford.edu",
  "mit.edu",
  "harvard.edu",
  "brookings.edu",
  "rand.org",
  "mckinsey.com",
  "gartner.com",
  "forrester.com",
  "statista.com",
];

/** Medium authority domains (industry media, notable blogs) */
const MEDIUM_AUTHORITY = [
  "techcrunch.com",
  "wired.com",
  "arstechnica.com",
  "theverge.com",
  "venturebeat.com",
  "forbes.com",
  "businessinsider.com",
  "cnbc.com",
  "cnn.com",
  "medium.com",
  "substack.com",
  "hbr.org",
];

/**
 * assessCredibility 实际使用的字段子集
 * 允许 EvidenceData 和 DataSourceResult 等结构直接传入，无需强转
 */
export interface CredibilityInput {
  domain?: string | null;
  sourceType?: string | null;
  snippet?: string | null;
  publishedAt?: Date | string | null;
}

/**
 * Assess evidence credibility score (15-100).
 *
 * Scoring dimensions:
 * 1. Domain authority (max 40)
 * 2. Source type (max 30)
 * 3. Content depth based on snippet length (max 15)
 * 4. Timeliness based on publication date (max 15)
 */
export function assessCredibility(evidence: CredibilityInput): number {
  let score = 0;

  // 1. Domain authority (max 40)
  if (evidence.domain) {
    const domain = evidence.domain.toLowerCase();
    if (TOP_AUTHORITY.some((auth) => domain.includes(auth))) {
      score += 40;
    } else if (HIGH_AUTHORITY.some((auth) => domain.includes(auth))) {
      score += 30;
    } else if (MEDIUM_AUTHORITY.some((auth) => domain.includes(auth))) {
      score += 20;
    } else {
      score += 20; // General websites get base score
    }
  } else {
    score += 15; // No domain info gets minimum base
  }

  // 2. Source type (max 30)
  const sourceTypeLower = (evidence.sourceType || "").toLowerCase();
  switch (sourceTypeLower) {
    case "academic":
      score += 30;
      break;
    case "official":
      score += 25;
      break;
    case "news":
      score += 20;
      break;
    case "report":
      score += 18;
      break;
    case "web":
      score += 18;
      break;
    default:
      score += 15;
      break;
  }

  // 3. Content depth based on snippet length (max 15)
  const snippetLength = evidence.snippet?.length || 0;
  if (snippetLength > 500) {
    score += 15;
  } else if (snippetLength > 200) {
    score += 10;
  } else if (snippetLength > 50) {
    score += 5;
  }

  // 4. Timeliness (max 15)
  if (evidence.publishedAt) {
    const ageInDays = Math.floor(
      (Date.now() - new Date(evidence.publishedAt).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    if (ageInDays <= 30) {
      score += 15;
    } else if (ageInDays <= 180) {
      score += 12;
    } else if (ageInDays <= 365) {
      score += 8;
    } else if (ageInDays <= 730) {
      score += 5;
    }
  }

  return Math.max(15, Math.min(100, score));
}
