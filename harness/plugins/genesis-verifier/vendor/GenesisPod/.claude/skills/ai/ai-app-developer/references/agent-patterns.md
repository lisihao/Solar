# Agent Development Patterns

## Base Agent Structure

```typescript
// Base agent interface
interface IAgent {
  name: string;
  description: string;
  execute(input: AgentInput): Promise<AgentOutput>;
}

// Base agent implementation
export abstract class BaseAgent implements IAgent {
  abstract readonly name: string;
  abstract readonly description: string;

  protected readonly logger: Logger;
  protected readonly aiService: AIOrchestrationService;

  constructor(aiService: AIOrchestrationService) {
    this.aiService = aiService;
    this.logger = new Logger(this.constructor.name);
  }

  async execute(input: AgentInput): Promise<AgentOutput> {
    this.logger.log(`Agent ${this.name} executing...`);

    try {
      // Pre-processing
      const processedInput = await this.preProcess(input);

      // Core execution
      const result = await this.executeCore(processedInput);

      // Post-processing
      const output = await this.postProcess(result);

      this.logger.log(`Agent ${this.name} completed`);
      return output;
    } catch (error) {
      this.logger.error(`Agent ${this.name} failed: ${error.message}`);
      throw error;
    }
  }

  protected async preProcess(input: AgentInput): Promise<AgentInput> {
    return input;
  }

  protected abstract executeCore(input: AgentInput): Promise<any>;

  protected async postProcess(result: any): Promise<AgentOutput> {
    return { success: true, data: result };
  }
}
```

## Domain-Specific Agent Example

```typescript
// writing/agents/writer.agent.ts
@Injectable()
export class WriterAgent extends BaseAgent {
  readonly name = "writer";
  readonly description =
    "Creative writing agent for chapter content generation";

  constructor(
    private readonly aiService: AIOrchestrationService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly qualityGate: QualityGateService,
    private readonly expressionMemory: ExpressionMemoryService,
  ) {
    super(aiService);
  }

  protected async executeCore(input: WriterInput): Promise<WriterOutput> {
    // 1. Build context from story bible
    const context = await this.contextBuilder.buildChapterContext(
      input.projectId,
      input.chapterNumber,
    );

    // 2. Get character personalities
    const characters = await this.characterService.getActiveCharacters(
      input.projectId,
    );

    // 3. Generate chapter content
    const systemPrompt = this.buildSystemPrompt(context, characters);
    const userPrompt = this.buildUserPrompt(input.outline, input.requirements);

    const response = await this.aiService.chat({
      model: "claude-3-5-sonnet",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 8000,
    });

    // 4. Quality check
    const qualityResult = await this.qualityGate.evaluate(
      response.content,
      input.projectId,
    );

    // 5. Record expressions for memory
    await this.expressionMemory.recordExpressions(
      input.projectId,
      response.content,
    );

    return {
      content: response.content,
      qualityScore: qualityResult.score,
      suggestions: qualityResult.suggestions,
    };
  }

  private buildSystemPrompt(
    context: ChapterContext,
    characters: Character[],
  ): string {
    return `You are a creative writer working on "${context.projectTitle}".

## Story Bible
${context.worldSetting}

## Active Characters
${characters.map((c) => `- ${c.name}: ${c.personality}`).join("\n")}

## Previous Chapter Summary
${context.previousChapterSummary}

## Writing Guidelines
- Maintain consistency with established characters and world
- Use varied expressions, avoid repetitive patterns
- Show don't tell
- Maintain pacing appropriate for the scene`;
  }
}
```

## Multi-Model Orchestration

```typescript
@Injectable()
export class ModelSelectorService {
  private readonly modelConfig = {
    creative_writing: {
      primary: "claude-3-5-sonnet",
      fallback: "gpt-4o",
      temperature: 0.8,
    },
    analysis: {
      primary: "claude-3-5-sonnet",
      fallback: "gpt-4o",
      temperature: 0.3,
    },
    quick_response: {
      primary: "claude-3-5-haiku",
      fallback: "gpt-4o-mini",
      temperature: 0.5,
    },
  };

  selectModel(taskType: string): ModelConfig {
    return this.modelConfig[taskType] || this.modelConfig.quick_response;
  }

  async executeWithFallback<T>(
    taskType: string,
    executor: (model: string) => Promise<T>,
  ): Promise<T> {
    const config = this.selectModel(taskType);

    try {
      return await executor(config.primary);
    } catch (error) {
      this.logger.warn(
        `Primary model failed, trying fallback: ${error.message}`,
      );
      return await executor(config.fallback);
    }
  }
}
```

## AI App Module Structure

```typescript
// ai-writing.module.ts
@Module({
  imports: [PrismaModule, AiEngineModule, LongContentModule, ConfigModule],
  controllers: [AiWritingController],
  providers: [
    // Core Service
    AiWritingService,

    // WebSocket Gateway
    AiWritingGateway,
    WritingEventEmitterService,

    // Bible Services
    StoryBibleService,
    CharacterService,
    WorldSettingService,

    // Writing Services
    ProjectService,
    ChapterWritingService,
    ContextBuilderService,

    // Quality Services
    ExpressionMemoryService,
    QualityGateService,

    // Agents
    StoryArchitectAgent,
    WriterAgent,
    EditorAgent,
  ],
  exports: [AiWritingService, StoryArchitectAgent, WriterAgent],
})
export class AiWritingModule {}
```
