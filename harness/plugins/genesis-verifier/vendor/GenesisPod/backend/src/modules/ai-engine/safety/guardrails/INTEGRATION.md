# Guardrails Framework Integration Guide

## Quick Start

### 1. Basic Usage

```typescript
import { GuardrailsPipelineService } from "@/modules/ai-engine/guardrails";

@Injectable()
export class MyAIService {
  constructor(private readonly guardrailsPipeline: GuardrailsPipelineService) {}

  async processUserRequest(input: string): Promise<string> {
    // Validate input
    const inputResult = await this.guardrailsPipeline.processInput({
      content: input,
    });

    if (!inputResult.passed) {
      throw new BadRequestException(
        `Input validation failed: ${inputResult.blockedBy}`,
      );
    }

    // Your AI processing here
    const aiResponse = await this.generateResponse(input);

    // Validate output
    const outputResult = await this.guardrailsPipeline.processOutput({
      content: aiResponse,
    });

    if (!outputResult.passed) {
      this.logger.warn("Output validation failed", outputResult);
      // Optionally retry or filter response
    }

    return aiResponse;
  }
}
```

### 2. With Context

```typescript
const result = await this.guardrailsPipeline.processInput({
  content: input,
  userId: user.id,
  context: {
    source: "chat",
    sessionId: session.id,
    timestamp: new Date(),
  },
});
```

### 3. Handling Results

```typescript
const result = await this.guardrailsPipeline.processInput({ content: input });

// Check if blocked
if (result.blockedBy) {
  throw new ForbiddenException(`Blocked by: ${result.blockedBy}`);
}

// Check individual results
for (const check of result.results) {
  switch (check.severity) {
    case "block":
      // Critical failure
      throw new Error(check.message);
    case "error":
      // Validation error
      this.logger.error(check.message, check.metadata);
      break;
    case "warning":
      // Warning
      this.logger.warn(check.message, check.metadata);
      break;
    case "info":
      // Informational
      this.logger.debug(check.message);
      break;
  }
}
```

## Integration Patterns

### Pattern 1: Controller-Level Validation

**Use Case:** Validate at API entry point

```typescript
@Controller("ai")
export class AIController {
  constructor(
    private readonly guardrailsPipeline: GuardrailsPipelineService,
    private readonly aiService: AIService,
  ) {}

  @Post("chat")
  async chat(@Body() dto: ChatDto) {
    // Validate input at controller level
    const inputResult = await this.guardrailsPipeline.processInput({
      content: dto.message,
      userId: dto.userId,
    });

    if (!inputResult.passed) {
      throw new BadRequestException({
        error: "Input validation failed",
        blockedBy: inputResult.blockedBy,
        details: inputResult.results,
      });
    }

    // Process request
    return this.aiService.chat(dto);
  }
}
```

### Pattern 2: Service-Level Validation

**Use Case:** Validate within service before AI operation

```typescript
@Injectable()
export class ResearchService {
  constructor(
    private readonly guardrailsPipeline: GuardrailsPipelineService,
    private readonly llmService: LLMService,
  ) {}

  async conductResearch(topic: string): Promise<ResearchResult> {
    // Validate input
    await this.validateInput(topic);

    // Perform research
    const result = await this.performResearch(topic);

    // Validate output
    await this.validateOutput(result.content);

    return result;
  }

  private async validateInput(content: string): Promise<void> {
    const result = await this.guardrailsPipeline.processInput({ content });
    if (!result.passed) {
      throw new BadRequestException("Input validation failed");
    }
  }

  private async validateOutput(content: string): Promise<void> {
    const result = await this.guardrailsPipeline.processOutput({ content });
    if (!result.passed) {
      this.logger.warn("Output validation failed", result);
    }
  }
}
```

### Pattern 3: Orchestration-Level Validation

**Use Case:** Validate at workflow orchestration level

```typescript
@Injectable()
export class WorkflowOrchestrator {
  constructor(private readonly guardrailsPipeline: GuardrailsPipelineService) {}

  async executeWorkflow(workflow: Workflow): Promise<WorkflowResult> {
    // Validate initial input
    const inputResult = await this.guardrailsPipeline.processInput({
      content: workflow.initialInput,
      context: { workflowId: workflow.id },
    });

    if (!inputResult.passed) {
      return this.handleGuardrailFailure(inputResult);
    }

    // Execute workflow steps
    const result = await this.executeSteps(workflow);

    // Validate final output
    const outputResult = await this.guardrailsPipeline.processOutput({
      content: result.finalOutput,
      context: { workflowId: workflow.id },
    });

    if (!outputResult.passed) {
      result.warnings = outputResult.results;
    }

    return result;
  }
}
```

### Pattern 4: Pipeline Middleware

**Use Case:** Create reusable middleware with guardrails

```typescript
@Injectable()
export class GuardrailsMiddleware {
  constructor(private readonly guardrailsPipeline: GuardrailsPipelineService) {}

  /**
   * Wrap any async function with input/output validation
   */
  async withGuardrails<T>(
    input: string,
    operation: (input: string) => Promise<T>,
    outputExtractor?: (result: T) => string,
  ): Promise<T> {
    // Validate input
    const inputResult = await this.guardrailsPipeline.processInput({
      content: input,
    });

    if (!inputResult.passed) {
      throw new BadRequestException("Input validation failed");
    }

    // Execute operation
    const result = await operation(input);

    // Validate output if extractor provided
    if (outputExtractor) {
      const output = outputExtractor(result);
      const outputResult = await this.guardrailsPipeline.processOutput({
        content: output,
      });

      if (!outputResult.passed) {
        this.logger.warn("Output validation failed", outputResult);
      }
    }

    return result;
  }
}

// Usage
const result = await guardrailsMiddleware.withGuardrails(
  userInput,
  async (input) => aiService.process(input),
  (result) => result.text,
);
```

## Custom Guardrails

### Creating a Custom Input Guardrail

```typescript
import { Injectable } from "@nestjs/common";
import {
  IInputGuardrail,
  GuardrailInput,
  GuardrailResult,
} from "@/modules/ai-engine/guardrails";

@Injectable()
export class CustomInputGuardrail implements IInputGuardrail {
  readonly id = "custom-input-guardrail";
  readonly name = "Custom Input Guardrail";
  readonly enabled = true;

  async check(input: GuardrailInput): Promise<GuardrailResult> {
    // Your custom validation logic
    const isValid = this.performValidation(input.content);

    return {
      passed: isValid,
      guardrailId: this.id,
      severity: isValid ? "info" : "warning",
      message: isValid ? "Validation passed" : "Validation failed",
      metadata: {
        checkType: "custom",
        timestamp: new Date(),
      },
    };
  }

  private performValidation(content: string): boolean {
    // Your validation logic here
    return true;
  }
}
```

### Creating a Custom Output Guardrail

```typescript
import { Injectable } from "@nestjs/common";
import {
  IOutputGuardrail,
  GuardrailOutput,
  GuardrailResult,
} from "@/modules/ai-engine/guardrails";

@Injectable()
export class CustomOutputGuardrail implements IOutputGuardrail {
  readonly id = "custom-output-guardrail";
  readonly name = "Custom Output Guardrail";
  readonly enabled = true;

  async check(output: GuardrailOutput): Promise<GuardrailResult> {
    // Your custom validation logic
    const qualityScore = this.assessQuality(output.content);

    return {
      passed: qualityScore >= 0.7,
      guardrailId: this.id,
      severity: qualityScore >= 0.7 ? "info" : "warning",
      message: `Quality score: ${qualityScore}`,
      metadata: {
        qualityScore,
        modelId: output.modelId,
      },
    };
  }

  private assessQuality(content: string): number {
    // Your quality assessment logic
    return 0.8;
  }
}
```

### Registering Custom Guardrails

```typescript
// In your module
@Module({
  providers: [
    GuardrailsPipelineService,
    CustomInputGuardrail,
    CustomOutputGuardrail,
  ],
})
export class MyModule implements OnModuleInit {
  constructor(
    private readonly guardrailsPipeline: GuardrailsPipelineService,
    private readonly customInputGuardrail: CustomInputGuardrail,
    private readonly customOutputGuardrail: CustomOutputGuardrail,
  ) {}

  onModuleInit() {
    this.guardrailsPipeline.registerInputGuardrail(this.customInputGuardrail);
    this.guardrailsPipeline.registerOutputGuardrail(this.customOutputGuardrail);
  }
}
```

## Advanced Usage

### Conditional Guardrails

```typescript
@Injectable()
export class ConditionalGuardrail implements IInputGuardrail {
  readonly id = "conditional-guardrail";
  readonly name = "Conditional Guardrail";

  get enabled(): boolean {
    // Enable based on environment or configuration
    return process.env.NODE_ENV === "production";
  }

  async check(input: GuardrailInput): Promise<GuardrailResult> {
    // Check only for specific users or contexts
    if (input.userId === "admin") {
      return {
        passed: true,
        guardrailId: this.id,
        severity: "info",
        message: "Admin user - bypassed",
      };
    }

    // Regular validation for other users
    return this.performRegularCheck(input);
  }
}
```

### Async Guardrails with External Services

```typescript
@Injectable()
export class ExternalValidationGuardrail implements IInputGuardrail {
  readonly id = "external-validation";
  readonly name = "External Validation";
  readonly enabled = true;

  constructor(private readonly httpService: HttpService) {}

  async check(input: GuardrailInput): Promise<GuardrailResult> {
    try {
      // Call external moderation API
      const response = await this.httpService
        .post("https://api.moderation.example.com/check", {
          content: input.content,
        })
        .toPromise();

      return {
        passed: response.data.safe,
        guardrailId: this.id,
        severity: response.data.safe ? "info" : "block",
        message: response.data.message,
        metadata: response.data,
      };
    } catch (error) {
      // On error, log and pass (fail-open) or fail (fail-closed)
      this.logger.error("External validation failed", error);
      return {
        passed: true, // fail-open
        guardrailId: this.id,
        severity: "warning",
        message: "External validation unavailable",
      };
    }
  }
}
```

## Error Handling

### Graceful Degradation

```typescript
try {
  const result = await this.guardrailsPipeline.processInput({ content: input });
  if (!result.passed) {
    // Handle validation failure
  }
} catch (error) {
  this.logger.error("Guardrails pipeline error", error);
  // Decide: fail-open (continue) or fail-closed (reject)
  // For security-critical operations: fail-closed
  throw new InternalServerErrorException("Validation service unavailable");
}
```

### Logging and Monitoring

```typescript
const result = await this.guardrailsPipeline.processInput({ content: input });

// Log all results for monitoring
for (const check of result.results) {
  this.metricsService.increment(
    `guardrails.${check.guardrailId}.${check.severity}`,
  );

  if (!check.passed) {
    this.logger.warn("Guardrail check failed", {
      guardrailId: check.guardrailId,
      severity: check.severity,
      message: check.message,
      metadata: check.metadata,
    });
  }
}
```

## Performance Considerations

- All built-in guardrails use regex patterns (< 10ms per check)
- Pipeline processes guardrails sequentially
- Short-circuits on 'block' severity
- For high-throughput scenarios, consider caching or batching

## Best Practices

1. **Validate at Entry Points**: Place input validation at API controllers
2. **Log All Failures**: Track guardrail failures for monitoring
3. **Fail Gracefully**: Handle errors without breaking user experience
4. **Use Context**: Pass relevant context for better validation
5. **Test Thoroughly**: Write tests for custom guardrails
6. **Monitor Performance**: Track guardrail execution times
7. **Document Patterns**: Document why certain guardrails trigger

## Troubleshooting

### Guardrail Not Running

Check if the guardrail is enabled:

```typescript
const status = guardrailsPipeline.getStatus();
console.log(status.inputGuardrails);
```

### False Positives

Adjust pattern sensitivity or add custom logic to filter false positives:

```typescript
if (detection.type === "api_key") {
  // Add custom validation to reduce false positives
  const isRealApiKey = this.validateApiKeyFormat(match);
  if (!isRealApiKey) continue;
}
```

### Performance Issues

Check guardrail execution times:

```typescript
const start = Date.now();
const result = await guardrailsPipeline.processInput({ content });
const duration = Date.now() - start;
console.log(`Guardrails took ${duration}ms`);
```

## Related Documentation

- [Guardrails README](./README.md)
- [Custom Guardrail Examples](./examples/)
- [AI Engine Documentation](../README.md)
