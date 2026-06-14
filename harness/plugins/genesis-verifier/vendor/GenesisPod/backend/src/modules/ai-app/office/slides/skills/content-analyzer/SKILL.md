---
name: content-analyzer
description: Analyze page content shape and extract layout decision features (deterministic, no LLM)
version: 4.0.0
domain: office
layer: understanding
tags: [slides, content, analysis, understanding]
taskTypes: [slides-generation]
priority: 50
author: genesis-ai
source: local

execution-mode: provider
---

# Content Analyzer

> This skill is implemented as a NestJS Provider (code-based tool).
> This SKILL.md provides metadata only -- execution is handled by the corresponding .skill.ts file.

Deterministic content analysis skill that extracts layout decision features from page content. Replaces hardcoded template capacity configuration with data-driven content shape analysis.

## Analysis Pipeline

1. Count section type distribution (stat, list, text, chart, image, quote)
2. Calculate content volume metrics (total chars, avg/max/min section length)
3. Detect logical structures (comparison, pillars, timeline)
4. Analyze data density (numeric density, percentages, currencies)
5. Assess visual complexity (simple/moderate/complex/dense)
6. Recommend layout type
7. Calculate grid suggestion
8. Estimate page capacity

## Output

`ContentAnalysisResult` with section types, content metrics, logical structures, data density, visual complexity, recommended layout, grid suggestion, and capacity estimate.
