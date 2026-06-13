---
name: template-matcher
description: 根据内容特征匹配最佳幻灯片模板
version: 4.0.0
domain: office
layer: design
tags: [slides, template, matching, design]
taskTypes: [slides-generation]
priority: 4
author: genesis-ai
source: local

execution-mode: provider
---

# Template Matcher

> This skill is implemented as a NestJS Provider (code-based tool).
> This SKILL.md provides metadata only — execution is handled by the corresponding .skill.ts file.

Semantic template matching skill that selects the best slide template based on content semantics and context. Uses a weighted matching algorithm to evaluate templates against multiple criteria.

## Key Features

- Weighted scoring algorithm with 6 evaluation dimensions
- Keyword matching against template use cases
- Content capacity analysis to ensure proper fit
- Narrative position awareness (opening, middle, closing)
- Context-aware compatibility checking with previous pages
- Diversity scoring to avoid template repetition
- Emotional arc alignment with narrative plan

## Matching Weights

- Keyword Match: 30% - Content keywords vs template use cases
- Content Capacity: 20% - Content volume vs template max blocks
- Narrative Position: 15% - Position fit (opening/middle/closing)
- Context Fit: 15% - Compatibility with previous/next pages
- Diversity: 10% - Avoids template repetition
- Emotional Match: 10% - Alignment with narrative emotional arc

## Input Requirements

- `pageOutline`: Current page outline with content details
- `previousPages`: Array of previous pages with template IDs
- `positionInStory`: Position in narrative (opening, middle, closing)
- `usedTemplates`: Array of already-used template IDs
- `narrativePlan` (optional): Narrative plan with emotional arc
- `nextPageHint` (optional): Preview of next page content
- `forcedTemplateType` (optional): Hard constraint to force specific template type

## Output Structure

- `recommended`: Best match with template ID, type, confidence, and reason
- `alternatives`: Array of alternative templates with scores
- `matchDetails`: Detailed scoring breakdown for all 6 dimensions
