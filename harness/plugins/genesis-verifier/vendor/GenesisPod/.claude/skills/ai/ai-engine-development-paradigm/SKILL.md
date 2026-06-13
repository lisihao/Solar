---
name: AI Engine Development Paradigm
description: |
  Comprehensive guide for developing AI Apps based on AI Engine team mode.
  Trigger keywords: ai engine, paradigm, delegation, taskprofile, ai app
  Not for: Specific AI App implementation (-> ai-app-developer)
allowed-tools: [Read, Write, Edit, Grep, Glob, Bash]
tags: [ai-engine, ai-teams, development, paradigm, best-practices]
boundaries:
  includes:
    - Development paradigm and patterns
    - Anti-patterns identification
    - TaskProfile usage
    - Delegation principles
  excludes:
    - Specific AI App implementation
  handoff:
    - skill: ai-app-developer
      when: Implementing specific AI App features
---

# AI Engine Development Paradigm

> Detailed docs: `references/`

## Core Principles

### 1. Delegation First

AI Apps delegate to AI Engine, not implement themselves:

```typescript
// ❌ Wrong: Implement model selection in AI App
const models = await prisma.aIModel.findMany({...});
const detectedModel = models.find(m => isReasoningModel(m));

// ✅ Correct: Delegate to AI Engine
const modelConfig = await this.aiChatService.getReasoningModelConfig();
```

### 2. Semantic Configuration

Use `modelType` + `TaskProfile`, not hardcoded values:

```typescript
// ❌ Wrong: Hardcoded
const response = await this.aiService.chat({ model: 'gpt-4o', temperature: 0.7 });

// ✅ Correct: Semantic
const response = await this.aiChatService.chat({
  modelType: AIModelType.CHAT,
  taskProfile: { creativity: 'medium', outputLength: 'long' },
  messages: [...],
});
```

## Architecture Layers

```
AI Engine (Core) → LLM, Search, Context, Token Management
      ↓
AI Teams (Collaboration) → Mission, Task, Coordination
      ↓
AI Apps (Application) → Research, Writing, Teams
```

## TaskProfile Quick Reference

| creativity    | temperature | Use Case                        |
| ------------- | ----------- | ------------------------------- |
| deterministic | 0.1         | Classification, JSON extraction |
| low           | 0.3         | Analysis, summarization         |
| medium        | 0.7         | Conversation, research          |
| high          | 0.9         | Creative writing                |

| outputLength | maxTokens | Use Case              |
| ------------ | --------- | --------------------- |
| minimal      | 500       | Labels, short answers |
| short        | 1500      | Summaries             |
| medium       | 4000      | Standard analysis     |
| long         | 8000      | Reports, chapters     |
| extended     | 16000     | Full documents        |

## Anti-Patterns

| Anti-Pattern              | Fix                                           |
| ------------------------- | --------------------------------------------- |
| Direct model selection    | Use `aiChatService.getReasoningModelConfig()` |
| Hardcoded TaskProfile     | Use centralized `TaskProfiles` constants      |
| Repeated context building | Use `ContextBuilderService`                   |
| @Optional() dependencies  | Explicit dependencies in module config        |
| God Service               | Split by responsibility                       |

## New AI App Checklist

- [ ] Use `modelType` + `TaskProfile` for LLM calls
- [ ] Use AI Engine search service
- [ ] Use event-driven progress communication
- [ ] Delegate model selection to AI Engine
- [ ] No hardcoded model IDs or temperatures
- [ ] No @Optional() service dependencies
- [ ] Single responsibility per service

## Related Docs

- [Core Principles](references/core-principles.md)
- [Development Patterns](references/development-patterns.md)
- [Anti-Patterns](references/anti-patterns.md)
