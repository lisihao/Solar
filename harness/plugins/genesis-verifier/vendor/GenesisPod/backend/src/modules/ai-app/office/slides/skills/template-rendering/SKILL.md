---
name: template-rendering
description: 将内容渲染到幻灯片模板中生成最终 HTML
version: 4.0.0
domain: office
layer: rendering
tags: [slides, template, rendering, html]
taskTypes: [slides-generation]
priority: 2
author: genesis-ai
source: local

execution-mode: provider
---

# Template Rendering

> This skill is implemented as a NestJS Provider (code-based tool).
> This SKILL.md provides metadata only — execution is handled by the corresponding .skill.ts file.

Deterministic template rendering skill that maps `PageContent.sections` to template variables and generates final HTML output. This skill operates without AI assistance to ensure stable and predictable output.

## Key Features

- Maps content sections to template-specific variables
- Injects chart SVGs into placeholders
- Wraps content with theme containers and decorations
- Applies overflow protection styles
- Supports fallback rendering when templates are unavailable

## Processing Steps

1. Select appropriate template based on page outline
2. Extract variables from page content by template ID
3. Apply variables to template
4. Inject chart SVG if template contains chart placeholders
5. Add template scripts if present
6. Wrap with theme container and decoration elements

## Input Requirements

- `pageOutline`: Page outline with template type
- `pageContent`: Page content with title, subtitle, and sections
- `usedValues` (optional): Set of used data values to prevent duplicates
- `themeId` (optional): Theme identifier (default: 'genspark-dark')

## Output Structure

- `html`: Rendered HTML string
- `templateId`: ID of the template used
- `variables`: Record of template variables applied
- `themeId`: Theme identifier used
