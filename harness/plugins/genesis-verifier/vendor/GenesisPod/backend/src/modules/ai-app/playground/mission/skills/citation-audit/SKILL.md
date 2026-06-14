---
name: citation-audit
description: Tool-driven citation verification — fetch real sources, match inline quotes, flag contradictions and suspicious domains
version: "1.0.0"
tags:
  - verification
  - citations
  - quality
  - fact-checking
allowedTools:
  - fetch
  - web-search
activateFor:
  - verifier
  - citation-auditor
  - fact-checker
---

# Citation Audit Protocol

Your job is **per-citation verification**. For every citation in scope, call tools
to retrieve the real source and check it against what the report claims.

## Per-citation checks (do all four)

### 1. URL accessibility

- Issue a `fetch` against the URL
- Pass: HTTP 200 with non-empty content
- Fail: 4xx / 5xx / timeout / paywall block / redirect to unrelated page

### 2. Inline quote match (when `inlineQuote` provided)

- Search the fetched content for the exact quoted text
- Allow ≤ 5% char variance (whitespace / minor copy-edit drift)
- Fail if the quote is a paraphrase, fabricated, or attributed to a different speaker

### 3. Publish date sanity

- Not a future date
- Not older than 5 years for "current" claims (older OK for historical context)
- Falsified or missing dates → flag as suspicious

### 4. Domain reputation

- Block list: link farms, content mills, spam aggregators, AI-generated junk sites
- Prefer: gov / edu / peer-reviewed / official corporate sources / established journalism
- Treat blogs and Substack as third-tier — accept only if uniquely authoritative

## Verdict statuses

| Status                     | Meaning                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `verified`                 | tool fetched real content; quote matches; date sane              |
| `unverified-but-plausible` | could not fetch (timeout / paywall) but claim is industry common |
| `unverified-suspicious`    | could not fetch + URL anomalies / domain on block list           |
| `contradicted`             | fetched content disagrees with the quote / number                |

## Output JSON shape

```json
{
  "mode": "citation-audit",
  "summary": {
    "total": <int>,
    "verified": <int>,
    "unverified": <int>,
    "contradicted": <int>
  },
  "verdicts": [
    {
      "index": <int>,
      "url": "<source URL>",
      "status": "verified" | "unverified-but-plausible" | "unverified-suspicious" | "contradicted",
      "evidence": "<≥30 chars: actual snippet from source OR fetch failure reason>"
    }
  ]
}
```

## Hard rules (never violate)

- **You MUST call `fetch` for every citation.** Marking `verified` without a tool call is dereliction.
- `evidence` must be ≥ 30 characters and either:
  - quote a real snippet from the fetched content, or
  - state the specific failure (HTTP code, paywall, redirect target, date mismatch)
- If `inlineQuote` is missing, status can still be `verified` based on URL accessibility + topical match
- A `contradicted` verdict must quote both the report's claim AND the contradicting source text
- Never fabricate URLs, source titles, or quoted text — if you couldn't fetch, say so

## What this skill is NOT

- Not for evaluating overall report quality (that's the meta-critic's job)
- Not for finding new sources (that's the researcher's job)
- Not for stylistic / structural review (that's the reviewer's job)

This skill is a **per-citation verification gate** — it operates on what the
report already cites, and either certifies or flags each one.
