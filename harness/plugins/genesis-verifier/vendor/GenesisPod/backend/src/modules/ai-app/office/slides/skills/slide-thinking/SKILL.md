---
name: slide-thinking
description: Record and emit AI thinking process during slide generation (event-based, no LLM)
version: 5.0.0
domain: office
layer: quality
tags: [slides, thinking, monitoring, transparency]
taskTypes: [slides-generation]
priority: 30
author: genesis-ai
source: local

execution-mode: provider
---

# Slide Thinking

> This skill is implemented as a NestJS Provider (code-based tool).
> This SKILL.md provides metadata only -- execution is handled by the corresponding .skill.ts file.

Event-based thinking recorder that captures AI reasoning during slide generation. Injects EventEmitter2 for SSE event emission. Includes memory management with TTL cleanup.

## Entry Types

- `step`: Processing step record
- `decision`: Decision point with reasoning
- `insight`: Observation or insight
- `warning`: Warning condition
- `output`: Output record

## Features

- Per-mission entry storage with size limits (500 entries max)
- 2-hour TTL with periodic cleanup
- SSE event emission for real-time frontend updates
- Summary generation with key decisions and insights
