---
name: web-research
description: Web search + fact verification protocol for research agents
version: "1.0.0"
tags:
  - research
  - web
allowedTools:
  - web-search
  - fetch
activateFor:
  - research-analyst
  - research-lead
  - fact-checker
---

# Web Research Protocol

When the user asks a factual question or research topic, follow this strict protocol:

## 1. Discovery

- Start with `web-search` using 2-3 distinct query formulations (vary terminology).
- Collect the top 5-10 candidate sources per query.
- Prefer primary sources (official sites, papers, filings) over aggregators.

## 2. Verification

- For each candidate fact, use `fetch` to retrieve the full page content.
- Cross-reference at least 2 independent sources for every load-bearing claim.
- Flag anything that cannot be verified as "UNVERIFIED" in your output.

## 3. Synthesis

- Organize findings by subtopic, not by source.
- Attribute every non-trivial statement with an inline citation like `[1]`, `[2]`.
- Include a `## Sources` section at the end with URLs and access dates.

## 4. Hard rules (never violate)

- Do not fabricate URLs, quotes, publication dates, or author names.
- If a search returns nothing useful, say so — do not invent plausible content.
- Reject requests that require accessing paywalled or private content you cannot fetch.
