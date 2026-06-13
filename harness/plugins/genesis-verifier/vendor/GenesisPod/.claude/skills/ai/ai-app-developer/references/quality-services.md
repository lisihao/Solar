# Quality Services

## Quality Gate Service

```typescript
// services/quality/quality-gate.service.ts
@Injectable()
export class QualityGateService {
  constructor(
    private readonly expressionMemory: ExpressionMemoryService,
    private readonly characterPersonality: CharacterPersonalityService,
    private readonly historicalKnowledge: HistoricalKnowledgeService,
  ) {}

  async evaluate(content: string, projectId: string): Promise<QualityResult> {
    const checks = await Promise.all([
      this.checkExpressionDiversity(content, projectId),
      this.checkCharacterConsistency(content, projectId),
      this.checkHistoricalAccuracy(content, projectId),
      this.checkGrammarAndStyle(content),
    ]);

    const score = checks.reduce((sum, c) => sum + c.score, 0) / checks.length;
    const issues = checks.flatMap((c) => c.issues);
    const suggestions = checks.flatMap((c) => c.suggestions);

    return {
      passed: score >= 0.7,
      score,
      issues,
      suggestions,
      checks,
    };
  }

  private async checkExpressionDiversity(
    content: string,
    projectId: string,
  ): Promise<CheckResult> {
    const recentExpressions = await this.expressionMemory.getRecent(projectId);
    const repetitions = this.findRepetitions(content, recentExpressions);

    return {
      name: "expression_diversity",
      score: 1 - repetitions.length * 0.1,
      issues: repetitions.map((r) => `Repeated expression: "${r}"`),
      suggestions: repetitions.map((r) => `Consider alternative for: "${r}"`),
    };
  }
}
```

## Expression Memory Service

```typescript
// services/quality/expression-memory.service.ts
@Injectable()
export class ExpressionMemoryService {
  constructor(
    @InjectModel("ExpressionRecord")
    private readonly model: Model<ExpressionRecord>,
  ) {}

  async recordExpressions(projectId: string, content: string): Promise<void> {
    const expressions = this.extractExpressions(content);

    for (const expr of expressions) {
      await this.model.updateOne(
        { projectId, expression: expr.text },
        {
          $inc: { count: 1 },
          $set: { lastUsedAt: new Date() },
          $push: { contexts: { $each: [expr.context], $slice: -10 } },
        },
        { upsert: true },
      );
    }
  }

  async getRecent(projectId: string, limit = 100): Promise<ExpressionRecord[]> {
    return this.model
      .find({ projectId })
      .sort({ lastUsedAt: -1 })
      .limit(limit)
      .exec();
  }

  async getOverusedExpressions(
    projectId: string,
    threshold = 3,
  ): Promise<string[]> {
    const records = await this.model
      .find({ projectId, count: { $gte: threshold } })
      .exec();
    return records.map((r) => r.expression);
  }

  private extractExpressions(content: string): Expression[] {
    // Extract phrases, idioms, and recurring patterns
    const patterns = [
      /[\u4e00-\u9fa5]{4,8}/g, // Chinese idioms
      /\b\w+(?:\s+\w+){2,4}\b/g, // English phrases
    ];

    const expressions: Expression[] = [];
    for (const pattern of patterns) {
      const matches = content.match(pattern) || [];
      expressions.push(
        ...matches.map((text) => ({
          text,
          context: this.getContext(content, text),
        })),
      );
    }

    return expressions;
  }
}
```

## Character Consistency Service

```typescript
@Injectable()
export class CharacterPersonalityService {
  async validateConsistency(
    content: string,
    projectId: string,
  ): Promise<ConsistencyResult> {
    const characters = await this.characterService.getAll(projectId);
    const dialogues = this.extractDialogues(content);

    const issues: string[] = [];

    for (const dialogue of dialogues) {
      const character = characters.find((c) => c.name === dialogue.speaker);
      if (!character) continue;

      const isConsistent = await this.checkPersonalityMatch(
        dialogue.text,
        character.personality,
      );

      if (!isConsistent) {
        issues.push(
          `Dialogue for ${character.name} may not match their personality`,
        );
      }
    }

    return {
      passed: issues.length === 0,
      score: 1 - issues.length * 0.1,
      issues,
    };
  }
}
```

## Quality Check Pipeline

```typescript
// Usage in agent
async generateWithQualityCheck(input: GenerationInput): Promise<QualityContent> {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    const content = await this.generate(input);
    const quality = await this.qualityGate.evaluate(content, input.projectId);

    if (quality.passed) {
      return { content, quality };
    }

    // Add suggestions to next iteration context
    input.additionalContext = quality.suggestions.join('\n');
    attempts++;

    this.logger.warn(`Quality check failed, attempt ${attempts}/${maxAttempts}`);
  }

  throw new Error('Failed to generate quality content after max attempts');
}
```
