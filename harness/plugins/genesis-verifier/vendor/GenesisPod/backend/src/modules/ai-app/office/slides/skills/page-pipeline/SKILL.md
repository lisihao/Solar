---
name: page-pipeline
description: 协调逐页生成内容和渲染 HTML，支持流式输出
version: 1.0.0
domain: office
layer: orchestration
tags: [slides, pipeline, streaming, generation]
taskTypes: [slides-generation]
priority: 1
author: genesis-ai
source: local

execution-mode: provider
---

# Page Generation Pipeline

> This skill is implemented as a NestJS Provider (code-based tool).
> This SKILL.md provides metadata only — execution is handled by the corresponding .skill.ts file.

Page generation pipeline skill that coordinates page-by-page content generation and rendering. This is the core component enabling "generate and send one page at a time" functionality for real-time slide preview.

## Key Features

- Iterates through all pages in outline plan
- Generates content for each page using ContentCompressionSkill
- Renders HTML for each page using TemplateRenderingSkill
- Emits streaming events after each page completion
- Generates design thinking metadata for each page
- Handles page generation failures gracefully
- Provides comprehensive progress tracking

## Event Emission

Emits `slides.page.generated` events containing:

- Page number and total page count
- Page title and rendered HTML
- Template ID used
- Design thinking metadata
- Key points from page outline

## Input Requirements

Input is extracted from MissionOrchestrator context:

- `outlinePlan`: Complete outline plan with all pages
- `sourceText`: Source text for content generation
- `themeId` (optional): Theme identifier for rendering

## Output Structure

- `pages`: Array of page generation results
- `totalPages`: Total number of pages
- `completedPages`: Number of successfully generated pages
- `failedPages`: Number of failed pages
- `totalDuration`: Total pipeline execution time in milliseconds

Each page result includes:

- `pageNumber`: Page number
- `title`: Page title
- `html`: Rendered HTML
- `templateId`: Template used
- `status`: "completed" or "failed"
- `error` (if failed): Error message
- `duration`: Page generation time
