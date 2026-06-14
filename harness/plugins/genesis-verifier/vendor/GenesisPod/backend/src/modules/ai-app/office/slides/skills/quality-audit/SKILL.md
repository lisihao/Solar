---
name: quality-audit
description: Audit slide quality with rule-based template-content semantic matching (deterministic, no LLM)
version: 4.0.0
domain: office
layer: quality
tags: [slides, quality, audit, review]
taskTypes: [slides-generation]
priority: 50
author: genesis-ai
source: local

execution-mode: provider
---

# Quality Audit

> This skill is implemented as a NestJS Provider (code-based tool).
> This SKILL.md provides metadata only -- execution is handled by the corresponding .skill.ts file.

Rule-based quality auditing skill that detects template-content semantic mismatches, chart type issues, content logic problems, and layout issues. Provides auto-fix capabilities for detected problems.

## Audit Checks

1. Template-content semantic matching (framework, timeline, comparison, dashboard, pillars)
2. Chart type validation (category vs time-series vs proportion data)
3. Content logic checks (filler content detection, generic step detection)
4. Layout issue detection (fixed small height containers, sparse content)
5. Cross-page consistency (title style consistency)

## Auto-Fix Capabilities

- Template mismatch: suggest better template type
- Chart type: swap line/bar based on data characteristics
- Filler content: remove unrelated generic business phrases
- Layout issues: convert fixed heights to flexible
