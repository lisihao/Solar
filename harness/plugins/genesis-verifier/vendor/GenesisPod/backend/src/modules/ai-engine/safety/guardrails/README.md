# Guardrails Framework

> AI Engine guardrails pipeline for validating inputs and outputs of AI operations.

## Overview

The Guardrails Framework provides a middleware pipeline that validates AI inputs and outputs before and after processing. It integrates seamlessly into the existing ai-orchestration flow as lightweight, regex-based checks.

## Architecture

```
User Request
  -> [GuardrailsPipeline.processInput()]
  |    |- PromptInjectionDetector
  |    |- ContentSafetyFilter
  |    |- InputComplexityCheck
  -> [Existing AI Orchestration] (unchanged)
  |    |- CostGuardrail (inline check before each LLM call)
  -> [GuardrailsPipeline.processOutput()]
  |    |- ContentComplianceCheck
  -> Response
```

## Components

### Core Services

#### `GuardrailsPipelineService`

Central orchestration service that runs inputs/outputs through registered guardrails.

**Methods:**

- `registerInputGuardrail(guardrail: IInputGuardrail): void` - Register input guardrail
- `registerOutputGuardrail(guardrail: IOutputGuardrail): void` - Register output guardrail
- `processInput(input: GuardrailInput): Promise<GuardrailsPipelineResult>` - Validate input
- `processOutput(output: GuardrailOutput): Promise<GuardrailsPipelineResult>` - Validate output
- `getStatus()` - Get registered guardrails status
- `getCount()` - Get guardrail counts

**Short-circuit behavior:** Pipeline stops on first `block` severity failure.

### Input Guardrails

#### `PromptInjectionDetector`

Detects common prompt injection patterns:

- Ignore/disregard instructions
- Override/bypass system
- Jailbreak attempts
- Role manipulation
- System prompt extraction
- Delimiter injection

**Severity:** `block` for definite injections, `warning` for suspicious patterns

#### `ContentSafetyFilter`

Detects PII and sensitive information:

- Email addresses
- Phone numbers
- Credit card numbers
- Social Security Numbers
- ID card numbers
- IP addresses
- API keys

**Severity:** `warning` (does not block, only alerts)

#### `InputComplexityCheck`

Validates input size:

- Maximum length: 100,000 characters
- Maximum tokens: ~25,000 tokens
- Warning threshold: 50,000 characters / ~12,500 tokens

**Severity:** `block` for exceeding max, `warning` for exceeding warn threshold

### Output Guardrails

#### `ContentComplianceCheck`

Detects hallucination indicators and refusal patterns:

- Knowledge cutoff references
- Access limitations
- Uncertainty markers
- Direct refusals
- Policy violations

**Severity:** `error` for refusals, `warning` for hallucination indicators

## Interfaces

### `IInputGuardrail`

```typescript
interface IInputGuardrail {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  check(input: GuardrailInput): Promise<GuardrailResult>;
}
```

### `IOutputGuardrail`

```typescript
interface IOutputGuardrail {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  check(output: GuardrailOutput): Promise<GuardrailResult>;
}
```

### `GuardrailResult`

```typescript
interface GuardrailResult {
  passed: boolean;
  guardrailId: string;
  message?: string;
  severity: "info" | "warning" | "error" | "block";
  metadata?: Record<string, unknown>;
}
```

## Usage

### Basic Usage

```typescript
import { GuardrailsPipelineService } from '@/modules/ai-engine/guardrails';

// Inject service
constructor(
  private readonly guardrailsPipeline: GuardrailsPipelineService,
) {}

// Process input
const inputResult = await this.guardrailsPipeline.processInput({
  content: userInput,
  userId: user.id,
  context: { source: 'chat' },
});

if (!inputResult.passed) {
  throw new Error(`Input blocked: ${inputResult.blockedBy}`);
}

// ... perform AI operation ...

// Process output
const outputResult = await this.guardrailsPipeline.processOutput({
  content: aiResponse,
  modelId: 'gpt-4',
});

if (!outputResult.passed) {
  // Handle compliance issues
}
```

### Custom Guardrail

```typescript
import { Injectable } from "@nestjs/common";
import {
  IInputGuardrail,
  GuardrailInput,
  GuardrailResult,
} from "@/modules/ai-engine/guardrails";

@Injectable()
export class CustomGuardrail implements IInputGuardrail {
  readonly id = "custom-guardrail";
  readonly name = "Custom Guardrail";
  readonly enabled = true;

  async check(input: GuardrailInput): Promise<GuardrailResult> {
    // Your custom logic
    const passed = true; // Your validation

    return {
      passed,
      guardrailId: this.id,
      severity: passed ? "info" : "warning",
      message: "Custom check result",
    };
  }
}

// Register in module
this.guardrailsPipeline.registerInputGuardrail(customGuardrail);
```

## Configuration

Guardrails can be enabled/disabled by implementing custom configuration logic. The `enabled` property on each guardrail controls whether it runs.

### Updating Thresholds

```typescript
// Update complexity check thresholds
inputComplexityCheck.updateThresholds({
  maxLength: 150000,
  warnLength: 75000,
});
```

## Severity Levels

| Level     | Description               | Pipeline Behavior              |
| --------- | ------------------------- | ------------------------------ |
| `info`    | Informational, no issues  | Continue                       |
| `warning` | Potential issues detected | Continue, log warning          |
| `error`   | Validation failed         | Continue, mark as failed       |
| `block`   | Critical failure          | Stop immediately, return error |

## Integration Points

### With AI Orchestration

Integrate at orchestration entry/exit points:

```typescript
// Before orchestration
const inputCheck = await guardrailsPipeline.processInput({ content: input });
if (!inputCheck.passed) {
  throw new GuardrailBlockedException(inputCheck.blockedBy);
}

// Execute AI operation
const result = await orchestrator.execute(workflow);

// After orchestration
const outputCheck = await guardrailsPipeline.processOutput({ content: result });
if (!outputCheck.passed) {
  // Log compliance issues, optionally retry or filter
}
```

### With API Endpoints

```typescript
@Post('chat')
async chat(@Body() dto: ChatDto) {
  // Validate input
  const inputResult = await this.guardrailsPipeline.processInput({
    content: dto.message,
    userId: dto.userId,
  });

  if (!inputResult.passed) {
    throw new BadRequestException('Input validation failed');
  }

  // Process...
}
```

## Testing

Run guardrails tests:

```bash
npm test -- --testPathPattern=guardrails-pipeline.service.spec
```

## Performance

All guardrails use lightweight regex-based checks (no LLM calls). Typical processing time:

- Input validation: < 10ms
- Output validation: < 5ms

## Future Enhancements

- [ ] Database-backed guardrail configuration
- [ ] Per-user guardrail customization
- [ ] Guardrail metrics and analytics
- [ ] LLM-based content moderation (optional, heavy)
- [ ] Guardrail chaining and dependencies
- [ ] Custom rule DSL

## Related

- [AI Orchestration](../orchestration/README.md)
- [Constraint Engine](../constraint/README.md)
- [AI Engine Module](../README.md)
