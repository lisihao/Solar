# 22e - Search Layer Architecture

## Overview

Search Layer: Multi-source search + result fusion + quality assessment + LLM reranking.
18 files, ~4380 lines core code, ~1140 lines adapters.

## Files

| File                              | Lines | Role                   |
| --------------------------------- | ----- | ---------------------- |
| search-orchestrator.service.ts    | 469   | 8-step orchestration   |
| search-executor.service.ts        | 241   | Concurrency + throttle |
| global-source-throttle.service.ts | 156   | Per-source limits      |
| search.types.ts                   | 147   | Interfaces             |
| query-strategy.service.ts         | 289   | Bilingual queries      |
| search-adapter.base.ts            | 222   | Timeout/CB wrapper     |
| web-search.adapter.ts             | 76    | WEB (c:8)              |
| academic-search.adapter.ts        | 326   | 4-phase (c:5)          |
| github-search.adapter.ts          | 88    | GitHub (c:2)           |
| hackernews-search.adapter.ts      | 76    | HackerNews (c:3)       |
| policy-search.adapter.ts          | 187   | 3-tool policy          |
| industry-report-search.adapter.ts | 180   | Site-filter            |
| social-search.adapter.ts          | 154   | Grok+fallback          |
| local-search.adapter.ts           | 69    | RAG                    |
| finance-search.adapter.ts         | 73    | Finance (c:1)          |
| weather-search.adapter.ts         | 72    | Weather (c:1)          |
| result-fusion.service.ts          | 462   | Dedup+score            |
| quality-gate.service.ts           | 189   | 5-check                |

## 5.1 search-orchestrator.service.ts (469 lines)

**async search()** [76-280]: 8-step pipeline

1. Resolve sources (assignedTools | dimension.searchSources)
2. Capability guard filter (optional)
3. Tool availability filter (optional)
4. Generate queries
5. Search all sources in parallel
6. Fuse results (deduplicate + score)
7. Optional LLM rerank (RAG-Fusion stage 2)
8. Quality gate + WEB fallback retry (max 1)

Invariants: Sources never empty, max 1 retry, rerank fail-open, time range priority.

## 5.2 search-executor.service.ts (241 lines)

**async searchAllSources()** [92-213]: Parallel sources, sequential queries per source

- Source-level: Promise.allSettled
- Query-level: for loop with early stop (accumulatedItems >= maxResults)
- Global throttle: throttle.execute(sourceId, search, signal)

Return: Map<DataSourceType, AdapterSearchResult> (failed sources filtered)

## 5.3 global-source-throttle.service.ts (156 lines)

**DEFAULT_CONCURRENCY** [19-32]:
arxiv:1, semantic:2, pubmed:3, openalex:5, web:8, github:2, hackernews:3, social:2, policy:3, finance:1, weather:1, local:3

**async execute()** [77-132]: Queue management, AbortSignal support

## 5.4 search.types.ts (147 lines)

ISearchAdapter, AdapterSearchRequest/Result, SourceAwareQueries, QualityVerdict

## 5.5 query-strategy.service.ts (289 lines)

**async generateQueries()** [16-132]: Bilingual + source-specific

Pipeline: extract raw queries -> language detect -> bilingual pairs -> source customization -> base queries

Source customization:

- WEB: English + timestamp + Chinese (if mixed)
- ACADEMIC: English, strip time words
- GITHUB: append "framework OR library" if technical
- Others: English or English+Chinese mix

## 5.6 search-adapter.base.ts (222 lines)

**async search()** [70-159]: Timeout + circuit breaker + latency tracking

Defense: CB check -> abort check -> timeout wrap -> success record -> error classify -> latency track

## 5.7-5.16 Adapters

WEB: c8, 15s | ACADEMIC: c5, 20s, 4-phase | GITHUB: c2, 15s | HN: c3, 10s
POLICY: c3, 15s, 3-tools | INDUSTRY: c1, 15s, site-filter+cache | SOCIAL: c2, 15s, Grok+fallback
LOCAL: c3, 10s, RAG | FINANCE: c1, 20s | WEATHER: c1, 10s

## 5.17 result-fusion.service.ts (462 lines)

**fuse()** [139-203]: Flatten -> deduplicate (URL + title) -> score -> sort -> domain diversity (max 3/domain)

Scoring:

- relevanceScore: coverage (title 0.6 + snippet 0.4) + bonuses + penalties
- credibilityScore: sourceType (50%) + domainAuthority (30%) + contentDepth (20%)
- compositeScore: rel×0.35 + cred×0.75 + recency×0.15

Source scores: ACADEMIC 0.9, SEMANTIC 0.85, INDUSTRY 0.85, GITHUB 0.7, WEB 0.6, HN 0.5, SOCIAL 0.4, DEFAULT 0.55
Domain: Academic 1.0, .gov/.mil 0.9, baseline 0.7
Recency: <=1y 1.0, 1-3y 0.8, >3y 0.6
Depth: >500 1.0, >200 0.7, else 0.5

## 5.18 quality-gate.service.ts (189 lines)

**evaluate()** [55-188]: 5 checks

1. Min results (default 5) -> add_web_fallback
2. Source diversity (>=2 types) -> broaden_query
3. Freshness (>=20% within 6mo) -> extend_time_range
4. Academic coverage (optional) -> add_academic_source
5. Failed ratio (>50% failed) -> retry_failed_sources

## Key Decisions

1. Layered concurrency: source-parallel, query-sequential, throttle-global
2. Dedup: URL norm + title Jaccard + domain cap (max 3)
3. Rerank fail-open: preserve fusion if LLM fails
4. Dual guards: capability + tool availability (optional)
5. CB + AbortSignal + timeout

## Paths (Baseline Worktree)

/d/projects/codes/genesis-agent-teams/.claude/worktrees/baseline-38347e2a/backend/src/modules/ai-app/topic-insights/services/search/

**Stats**: 18 files, ~5520 lines, 7 core services + 10 adapters

Version: 2.0 | Updated: 2026-04-24 | Stability: High
