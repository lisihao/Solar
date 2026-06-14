---
name: layout-optimizer
description: Optimize slide layout based on content features analysis (deterministic, no LLM)
version: 4.0.0
domain: office
layer: optimization
tags: [slides, layout, optimization, design]
taskTypes: [slides-generation]
priority: 50
author: genesis-ai
source: local

execution-mode: provider
---

# Layout Optimizer

> This skill is implemented as a NestJS Provider (code-based tool).
> This SKILL.md provides metadata only -- execution is handled by the corresponding .skill.ts file.

Deterministic layout optimization skill that generates optimal grid layouts based on ContentAnalyzer output. Injects ContentAnalyzerSkill for content feature analysis.

## Decision Pipeline

1. Analyze content features via ContentAnalyzerSkill
2. Determine layout type from recommended layout
3. Calculate grid configuration (columns, rows, widths, heights, gap)
4. Place sections into grid cells
5. Determine visual hierarchy (primary focus, secondary, supporting)
6. Configure title and footer areas
7. Check split requirements and generate suggestions

## Output

`LayoutDecision` with layout type, grid config, section placements, visual hierarchy, title/footer area config, split suggestions, and reasoning.
