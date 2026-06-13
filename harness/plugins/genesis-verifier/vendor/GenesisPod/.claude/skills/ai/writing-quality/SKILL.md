---
name: Writing Quality
description: |
  Evaluate and improve AI-generated novel/long-form content quality.
  Trigger keywords: writing quality, novel, expression, pacing, style, quality gate
  Not for: Document generation (-> document-generation), Prompt engineering (-> prompt-engineering)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [writing, quality, novel, expression, pacing, style]
boundaries:
  includes:
    - Writing quality evaluation
    - Expression diversity analysis
    - Narrative pacing control
    - Style consistency checking
  excludes:
    - Document file generation
    - Prompt template design
  handoff:
    - skill: document-generation
      when: Document export needed
    - skill: prompt-engineering
      when: Prompt optimization needed
---

# AI Writing Quality

> Evaluate and enhance AI-generated novel/long-form content quality.

## Quality Dimensions

| Dimension | Weight | Focus Areas                     |
| --------- | ------ | ------------------------------- |
| Diversity | 30%    | Expression, sentence, opening   |
| Character | 25%    | Voice, personality, consistency |
| Pacing    | 20%    | Action, progression, rhythm     |
| Style     | 25%    | Tone, atmosphere, dialogue      |

## Quality Score

```
Score = Diversity×30% + Character×25% + Pacing×20% + Style×25%

8-10: Excellent (publish-ready)
6-8:  Good (minor edits)
4-6:  Fair (rewrite sections)
<4:   Poor (replanning needed)
```

## Key Files

```
backend/src/modules/ai-app/writing/services/quality/
├── expression-memory.service.ts     # Expression cooling
├── narrative-pacing.service.ts      # Pacing control
├── character-personality.service.ts # Character voice
├── quality-gate.service.ts          # Quality validation

backend/src/modules/ai-app/writing/services/style/
└── style-template.service.ts        # Style configuration
```

## Three-Layer Style Architecture

```
Code Layer (Immutable)
  └─ writing-style-presets.ts (base features)
        ↓
Database Layer (Configurable)
  └─ WritingStyleTemplate model (rules, examples)
        ↓
Project Layer (Override)
  └─ WritingProject.styleOverrides (project-specific)
```

## Common Issues

| Issue               | Detection                     | Solution                    |
| ------------------- | ----------------------------- | --------------------------- |
| Expression repeat   | High-frequency phrase count   | Expression cooling system   |
| Passive protagonist | Action/observation word ratio | Force action constraints    |
| Opening similarity  | First 100 chars comparison    | Opening type cooling        |
| Dialogue mismatch   | Character voice consistency   | Character personality rules |

## Related Docs

- [Quality Dimensions](references/quality-dimensions.md)
- [Style Configuration](references/style-configuration.md)
- [Verification Checklist](references/verification-checklist.md)
