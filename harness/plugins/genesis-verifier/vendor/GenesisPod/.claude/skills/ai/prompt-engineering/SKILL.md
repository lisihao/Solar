---
name: Prompt Engineering
description: |
  Design, manage, and optimize LLM prompts - prompt library, multi-model adaptation, output validation.
  Trigger keywords: prompt, template, model adaptation, output validation, a/b testing
  Not for: AI App implementation (-> ai-app-developer)
allowed-tools: [Read, Write, Edit, Grep, Glob, Bash]
tags: [prompts, llm, ai, optimization, templates]
boundaries:
  includes:
    - Prompt template design
    - Multi-model adaptation
    - Output validation
    - A/B testing
  excludes:
    - AI App implementation
  handoff:
    - skill: ai-app-developer
      when: Implementing AI features
---

# Prompt Engineering Expert

> Detailed docs: `references/`

## Architecture

```
Prompt Library → Model Adapter → Output Validator
      ↓              ↓               ↓
Version Control  Token Counter   Quality Metrics
```

## Prompt Library Structure

```
backend/src/modules/ai/
├── prompts/
│   ├── system/          # Base system prompts
│   ├── tasks/           # Task-specific prompts
│   └── formats/         # Output format guides
├── adapters/            # Model-specific adapters
└── validators/          # Output validators
```

## Prompt Template Pattern

```typescript
export const researcherPrompt: PromptTemplate = {
  id: "researcher-v2",
  version: "2.0.0",
  name: "Deep Research Agent",

  system: `You are a professional research assistant...`,

  variables: ["topic", "context", "depth", "language"],

  template: `## Research Topic\n{{topic}}\n## Depth\n{{depth}}`,

  modelAdaptations: {
    "gpt-4": { maxTokens: 8000, temperature: 0.7 },
    "claude-3-opus": {
      systemSuffix: "\n\nShow your reasoning.",
      maxTokens: 16000,
    },
  },

  outputSchema: {
    type: "object",
    required: ["title", "summary", "sections"],
  },
};
```

## Multi-Model Adaptation

```typescript
class ModelAdapter {
  adaptPrompt(template: PromptTemplate, modelId: string): AdaptedPrompt {
    const config = this.modelConfigs.get(modelId);
    const adaptation = template.modelAdaptations?.[modelId];

    return {
      system: this.adaptSystemPrompt(template.system, modelId, adaptation),
      parameters: {
        maxTokens: adaptation?.maxTokens ?? config?.outputWindow ?? 4096,
        temperature: adaptation?.temperature ?? 0.7,
      },
    };
  }
}
```

## Output Validation

```typescript
class OutputValidator {
  validate(output: unknown, template: PromptTemplate): ValidationResult {
    const results = { valid: true, errors: [], warnings: [] };

    // Schema validation
    if (template.outputSchema) {
      const validate = this.ajv.compile(template.outputSchema);
      if (!validate(output)) {
        results.valid = false;
        results.errors.push(...validate.errors);
      }
    }

    return results;
  }
}
```

## Token Optimization

```typescript
estimateTokens(text: string): number {
  const englishChars = text.replace(/[\u4e00-\u9fff]/g, '').length;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return Math.ceil(englishChars / 4 + chineseChars / 1.5);
}
```

## Best Practices

| Do                                 | Don't                          |
| ---------------------------------- | ------------------------------ |
| Clear, specific instructions       | Ambiguous language             |
| Include examples for complex tasks | Assume model capabilities      |
| Structure output format explicitly | Hardcode model-specific syntax |
| Test across multiple models        | Skip output validation         |
| Version and document changes       | Ignore token costs             |

## Related Docs

- [Prompt Templates](references/prompt-templates.md)
- [Model Adapters](references/model-adapters.md)
- [A/B Testing](references/ab-testing.md)
