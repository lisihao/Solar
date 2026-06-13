# Prompt Templates

## Complete Template Example

```typescript
// prompts/system/researcher.prompt.ts
import { PromptTemplate } from "../types";

export const researcherPrompt: PromptTemplate = {
  id: "researcher-v2",
  version: "2.0.0",
  name: "Deep Research Agent",

  // Base system prompt (always included)
  system: `You are a professional research assistant focused on providing high-quality, accurate, in-depth research reports.

## Core Capabilities
- Multi-source information retrieval and integration
- Critical analysis and fact verification
- Structured report generation
- Citation and source tracking

## Working Principles
1. **Accuracy First**: All information must be backed by reliable sources
2. **Critical Thinking**: Verify information from multiple angles
3. **Structured Output**: Organize content with clear hierarchy
4. **Citation Standards**: Mark sources for all key arguments`,

  // Variables that can be injected
  variables: ["topic", "context", "depth", "language"],

  // Template with variable placeholders
  template: `
## Research Topic
{{topic}}

## Research Depth
{{depth}}

## Context Information
{{context}}

## Output Requirements
Please output the research report in {{language}}.`,

  // Model-specific adaptations
  modelAdaptations: {
    "gpt-4": {
      maxTokens: 8000,
      temperature: 0.7,
    },
    "claude-3-opus": {
      systemSuffix: "\n\nPlease show your thinking process when answering.",
      maxTokens: 16000,
      temperature: 0.5,
    },
    "grok-2": {
      maxTokens: 8000,
      temperature: 0.8,
    },
  },

  // Output schema for validation
  outputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            heading: { type: "string" },
            content: { type: "string" },
            sources: { type: "array", items: { type: "string" } },
          },
        },
      },
      conclusion: { type: "string" },
    },
    required: ["title", "summary", "sections"],
  },

  // Metrics for evaluation
  metrics: ["relevance", "accuracy", "completeness", "coherence"],

  // Example inputs/outputs for testing
  examples: [
    {
      input: {
        topic: "AI Applications in Healthcare",
        depth: "comprehensive",
        language: "en-US",
      },
      expectedOutputContains: [
        "diagnosis",
        "treatment",
        "ethics",
        "challenges",
      ],
    },
  ],
};
```

## Template Variable Injection

```typescript
function interpolateTemplate(
  template: string,
  variables: Record<string, any>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] ?? match;
  });
}

// Usage
const prompt = interpolateTemplate(template.template, {
  topic: "Climate Change",
  depth: "comprehensive",
  language: "en-US",
});
```

## Prompt Library Organization

```
prompts/
├── system/                    # Agent system prompts
│   ├── base.prompt.ts         # Base behaviors
│   ├── researcher.prompt.ts   # Research agent
│   ├── analyst.prompt.ts      # Analysis agent
│   ├── writer.prompt.ts       # Writing agent
│   └── critic.prompt.ts       # Review agent
├── tasks/                     # Task-specific prompts
│   ├── summarization.prompt.ts
│   ├── extraction.prompt.ts
│   ├── classification.prompt.ts
│   └── generation.prompt.ts
└── formats/                   # Output format guides
    ├── json.prompt.ts
    ├── markdown.prompt.ts
    └── structured.prompt.ts
```
