# Style Configuration

## Three-Layer Architecture

```
┌─────────────────────────────────────────┐
│  Code Layer                              │
│  - Base style features (immutable)       │
│  - writing-style-presets.ts             │
│  - e.g., web_gongdou base rhythm        │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Database Layer                          │
│  - WritingStyleTemplate model            │
│  - Detailed rules, examples (config)     │
│  - System presets + user custom          │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Project Layer                           │
│  - WritingProject.styleOverrides         │
│  - Project-specific overrides (highest)  │
└─────────────────────────────────────────┘
```

## System Preset Templates

| Template     | Base Style  | Features                           |
| ------------ | ----------- | ---------------------------------- |
| 甄嬛传式宫斗 | web_gongdou | Double meanings, micro-expressions |
| 琅琊榜式权谋 | web_gongdou | Deep planning, intellect duels     |
| 金庸经典武侠 | jin_yong    | Chivalry, martial arts imagery     |

## Usage Flow

1. **System startup:** `StyleTemplateService.initializeSystemTemplates()` creates templates
2. **User selects template:** `setProjectTemplate(projectId, templateId)` links project
3. **During writing:** `getMergedStyleConfig(projectId)` gets merged config
4. **Generate prompt:** `fullPrompt` includes detailed style requirements

## Key Code Locations

| Feature          | File Path                                                 |
| ---------------- | --------------------------------------------------------- |
| Style template   | `ai-app/writing/services/style/style-template.service.ts` |
| Database model   | `prisma/schema.prisma` → `WritingStyleTemplate`           |
| Call integration | `writing-mission.service.ts` → `getTemplateStylePrompt()` |

## Related Code Locations

| Feature          | File Path                                           |
| ---------------- | --------------------------------------------------- |
| Expression cool  | `services/quality/expression-memory.service.ts`     |
| Style presets    | `constants/writing-style-presets.ts`                |
| Narrative pacing | `services/quality/narrative-pacing.service.ts`      |
| Character voice  | `services/quality/character-personality.service.ts` |
| Quality gate     | `services/quality/quality-gate.service.ts`          |
