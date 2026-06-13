---
name: page-type-selection
description: 根据内容自动选择合适的幻灯片页面类型
version: 4.0.0
domain: office
layer: design
tags: [slides, page, type, selection, design]
taskTypes: [slides-generation]
priority: 4
author: genesis-ai
source: local

execution-mode: provider
---

# Page Type Selection

> This skill is implemented as a NestJS Provider (code-based tool).
> This SKILL.md provides metadata only — execution is handled by the corresponding .skill.ts file.

Page type selection skill that automatically determines the most appropriate slide template type based on content characteristics. Uses a rule engine with priority-based matching.

## Key Features

- Rule-based template selection with priority scoring
- Content feature analysis (lists, data, timelines, comparisons)
- Batch processing with sequence optimization
- Automatic detection of chapter starts and ends
- Avoids consecutive duplicate template types
- Enforces hard rules (e.g., first page is cover, last page is closing)

## Template Rules

Evaluates pages against 17+ template rules including:

- Cover (封面页)
- Table of Contents (目录页)
- Questions (问题页)
- Pillars (支柱页)
- Framework (框架页)
- Timeline (时间线页)
- Dashboard (仪表板页)
- Comparison (对比页)
- And more...

## Content Analysis

Analyzes 15+ content features:

- Has title/subtitle
- List items and count
- Data points and count
- Timeline points
- Comparison items
- Chart requirements
- Content complexity score
- Keywords extraction

## Input Requirements

- `pageOutlines`: Array of page outline objects

Each page outline should contain:

- `pageNumber`: Page number
- `title`: Page title
- `contentBrief`: Brief content description
- `keyElements`: Array of key content elements
- `dataRequirements` (optional): Data visualization requirements

## Output Structure

Returns a Map with:

- Key: Page number
- Value: Selected PageTemplateType

Also performs sequence optimization to prevent consecutive template repetition.
