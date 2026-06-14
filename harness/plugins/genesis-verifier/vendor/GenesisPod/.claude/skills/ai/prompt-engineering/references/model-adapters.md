# Model Adapters

## Model Configuration

```typescript
export class ModelAdapter {
  private modelConfigs: Map<string, ModelConfig> = new Map([
    [
      "gpt-4",
      {
        provider: "openai",
        contextWindow: 128000,
        outputWindow: 16384,
        costPer1kInput: 0.01,
        costPer1kOutput: 0.03,
        strengths: ["reasoning", "code", "analysis"],
        weaknesses: ["very long outputs"],
      },
    ],
    [
      "claude-3-opus",
      {
        provider: "anthropic",
        contextWindow: 200000,
        outputWindow: 4096,
        costPer1kInput: 0.015,
        costPer1kOutput: 0.075,
        strengths: ["long context", "nuance", "safety"],
        weaknesses: ["verbose"],
      },
    ],
    [
      "grok-2",
      {
        provider: "xai",
        contextWindow: 128000,
        outputWindow: 8192,
        costPer1kInput: 0.005,
        costPer1kOutput: 0.015,
        strengths: ["speed", "cost", "real-time"],
        weaknesses: ["less refined"],
      },
    ],
  ]);
}
```

## Prompt Adaptation

```typescript
adaptPrompt(template: PromptTemplate, modelId: string): AdaptedPrompt {
  const config = this.modelConfigs.get(modelId);
  const adaptation = template.modelAdaptations?.[modelId];

  return {
    system: this.adaptSystemPrompt(template.system, modelId, adaptation),
    messages: this.formatMessages(template, modelId),
    parameters: {
      maxTokens: adaptation?.maxTokens ?? config?.outputWindow ?? 4096,
      temperature: adaptation?.temperature ?? 0.7,
    },
  };
}

private adaptSystemPrompt(
  base: string,
  modelId: string,
  adaptation?: ModelAdaptation,
): string {
  let prompt = base;

  // Add model-specific suffix
  if (adaptation?.systemSuffix) {
    prompt += adaptation.systemSuffix;
  }

  // Anthropic prefers more structured instructions
  if (modelId.includes("claude")) {
    prompt = this.addStructuredInstructions(prompt);
  }

  // OpenAI works well with concise prompts
  if (modelId.includes("gpt")) {
    prompt = this.optimizeForConciseness(prompt);
  }

  return prompt;
}
```

## Quality Metrics

```typescript
export class QualityMetrics {
  evaluate(response: string, prompt: PromptTemplate): QualityScore {
    return {
      relevance: this.measureRelevance(response, prompt),
      completeness: this.measureCompleteness(response, prompt),
      coherence: this.measureCoherence(response),
      accuracy: this.measureAccuracy(response, prompt),
      overall: 0, // Calculated as weighted average
    };
  }

  private measureRelevance(response: string, prompt: PromptTemplate): number {
    const keywords = this.extractKeywords(prompt.template);
    const responseKeywords = this.extractKeywords(response);
    const overlap = keywords.filter((k) => responseKeywords.includes(k)).length;
    return overlap / keywords.length;
  }

  private measureCompleteness(
    response: string,
    prompt: PromptTemplate,
  ): number {
    if (!prompt.outputSchema?.required) return 1;

    try {
      const parsed = JSON.parse(response);
      const present = prompt.outputSchema.required.filter(
        (field) => parsed[field] !== undefined,
      ).length;
      return present / prompt.outputSchema.required.length;
    } catch {
      return 0.5; // Non-JSON response
    }
  }
}
```

## Token Optimization

```typescript
export class TokenOptimizer {
  estimateTokens(text: string): number {
    const englishChars = text.replace(/[\u4e00-\u9fff]/g, "").length;
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    return Math.ceil(englishChars / 4 + chineseChars / 1.5);
  }

  optimizePrompt(prompt: string, maxTokens: number): string {
    const currentTokens = this.estimateTokens(prompt);

    if (currentTokens <= maxTokens) {
      return prompt;
    }

    return this.applyOptimizations(prompt, [
      this.removeRedundantWhitespace,
      this.consolidateBulletPoints,
      this.abbreviateExamples,
      this.truncateIfNeeded(maxTokens),
    ]);
  }
}
```
