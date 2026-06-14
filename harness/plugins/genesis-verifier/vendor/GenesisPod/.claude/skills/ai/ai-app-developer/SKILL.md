---
name: AI App Developer
description: |
  Develop AI-powered applications - AI Writing, AI Image, AI Research, Agent extensions, streaming responses.
  Trigger keywords: ai writing, ai image, agent, streaming, llm, quality gate
  Not for: AI Engine core (-> ai-architecture-layering), Multi-agent teams (-> ai-teams-expert)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [ai, agent, writing, image, research, streaming, llm]
boundaries:
  includes:
    - AI App module development (Writing, Image, Research)
    - Agent creation and extension
    - LLM integration and orchestration
    - Streaming response handling
    - Quality service integration
  excludes:
    - AI Engine core development
    - Multi-agent team orchestration
    - Prompt library management
  handoff:
    - skill: ai-architecture-layering
      when: Architecture decisions for new AI capabilities
    - skill: ai-teams-expert
      when: Multi-agent collaboration needed
    - skill: prompt-engineering
      when: Prompt optimization needed
---

# AI App Developer

> Detailed docs: `references/`

## Architecture Overview

```
AI Apps (Writing | Image | Research | Ask)
               ↓
AI Teams (Mission → Task → Agent Execution)
               ↓
AI Engine (LLM Service | Search | Context | Streaming)
```

## Key Directories

```
backend/src/modules/ai-app/
├── writing/                    # Long-form content
│   ├── agents/                 # story-architect, writer, editor
│   └── services/bible/         # Story bible management
├── image/                      # Image generation
├── research/                   # Deep dive research
└── ask/                        # Q&A
```

## Quick Reference

### Base Agent Pattern

```typescript
@Injectable()
export class WriterAgent extends BaseAgent {
  readonly name = "writer";

  protected async executeCore(input: WriterInput): Promise<WriterOutput> {
    const context = await this.contextBuilder.buildChapterContext(
      input.projectId,
    );
    const response = await this.aiChatService.chat({
      messages: [{ role: "system", content: this.buildPrompt(context) }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "high", outputLength: "long" },
    });
    return {
      content: response.content,
      qualityScore: await this.qualityGate.evaluate(response.content),
    };
  }
}
```

### Streaming Response (Backend)

```typescript
async *streamGeneration(input: GenerationInput): AsyncGenerator<StreamChunk> {
  const response = await this.aiService.stream({
    model: 'claude-3-5-sonnet',
    messages: input.messages,
    stream: true,
  });
  for await (const chunk of response) {
    yield { type: 'content', content: chunk.content };
    this.eventEmitter.emitStreamChunk(input.sessionId, chunk.content);
  }
}
```

### Streaming Hook (Frontend)

```typescript
export function useAIStream() {
  const [content, setContent] = useState("");
  const stream = useCallback(async (url: string, body: any) => {
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const reader = response.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = new TextDecoder().decode(value);
      // Parse SSE data lines
      chunk
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .forEach((l) => {
          const data = JSON.parse(l.slice(6));
          setContent((prev) => prev + data.content);
        });
    }
  }, []);
  return { content, stream };
}
```

### Quality Gate

```typescript
@Injectable()
export class QualityGateService {
  async evaluate(content: string, projectId: string): Promise<QualityResult> {
    const checks = await Promise.all([
      this.checkExpressionDiversity(content, projectId),
      this.checkCharacterConsistency(content, projectId),
      this.checkGrammarAndStyle(content),
    ]);
    return {
      passed: checks.every((c) => c.score >= 0.7),
      score: checks.reduce((sum, c) => sum + c.score, 0) / checks.length,
      suggestions: checks.flatMap((c) => c.suggestions),
    };
  }
}
```

## AI App Module Structure

| Module   | Agents                         | Key Services                            |
| -------- | ------------------------------ | --------------------------------------- |
| Writing  | StoryArchitect, Writer, Editor | StoryBible, ChapterWriting, QualityGate |
| Image    | ImageGenerator, StyleAnalyzer  | ImageCore, PromptOptimizer              |
| Research | Planner, Executor, Synthesizer | WebSearch, ReportBuilder                |

## Best Practices

1. **Use TaskProfile** for LLM calls (never hardcode temperature)
2. **Stream responses** for long-running generations
3. **Quality gates** before returning content
4. **Expression memory** to avoid repetition
5. **Context builders** for domain knowledge injection

## Related Docs

- [Agent Development Pattern](references/agent-patterns.md)
- [Streaming Implementation](references/streaming.md)
- [Quality Services](references/quality-services.md)
