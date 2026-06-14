---
name: chart-renderer
description: 根据数据生成 ECharts 图表配置
version: 4.0.0
domain: office
layer: rendering
tags: [slides, chart, rendering, echarts]
taskTypes: [slides-generation]
priority: 2
author: genesis-ai
source: local

execution-mode: provider
---

# Chart Renderer

> This skill is implemented as a NestJS Provider (code-based tool).
> This SKILL.md provides metadata only — execution is handled by the corresponding .skill.ts file.

Server-side chart rendering skill that uses ECharts to generate SVG strings for embedding in HTML. Supports line, bar, pie, and radar chart types with automatic type inference to prevent incorrect chart selection.

## Key Features

- Renders charts as SVG strings using ECharts SSR mode
- Intelligently infers correct chart type based on data characteristics
- Extracts chart data from content sections or generates sample data
- Supports dark and light theme modes
- Provides fallback placeholder charts on render failure

## Supported Chart Types

- **Line**: Time series and trend data
- **Bar**: Category comparisons and distributions
- **Pie**: Percentage and proportion data
- **Radar**: Multi-dimensional comparisons

## Input Requirements

- `data`: Chart data with type, labels, and datasets
- `options` (optional): Render options including width, height, theme, legend, and title settings

## Output Structure

- `svgString`: Rendered SVG string
- `width`: Chart width in pixels
- `height`: Chart height in pixels
- `type`: Chart type used
