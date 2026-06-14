# A/B Testing Framework

## Test Configuration

```typescript
interface ABTest {
  id: string;
  name: string;
  variants: PromptVariant[];
  metrics: string[];
  sampleSize: number;
  startDate: Date;
  endDate?: Date;
}

interface PromptVariant {
  id: string;
  promptId: string;
  weight: number; // 0-1, total should be 1
}

interface ABTestResult {
  variantId: string;
  metrics: Record<string, number>;
  sampleCount: number;
  conversionRate?: number;
}
```

## Test Service

```typescript
export class ABTestingService {
  async runTest(test: ABTest): Promise<ABTestResult[]> {
    const results: ABTestResult[] = [];

    for (const variant of test.variants) {
      const samples = await this.collectSamples(
        variant,
        Math.floor(test.sampleSize * variant.weight),
      );

      const metrics = await this.evaluateMetrics(samples, test.metrics);

      results.push({
        variantId: variant.id,
        metrics,
        sampleCount: samples.length,
      });
    }

    return results;
  }

  selectVariant(test: ABTest): PromptVariant {
    const random = Math.random();
    let cumulative = 0;

    for (const variant of test.variants) {
      cumulative += variant.weight;
      if (random <= cumulative) {
        return variant;
      }
    }

    return test.variants[0];
  }
}
```

## Output Validation

```typescript
export class OutputValidator {
  private ajv = new Ajv({ allErrors: true });

  validate(output: unknown, template: PromptTemplate): ValidationResult {
    const results: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    // 1. Schema validation
    if (template.outputSchema) {
      const validate = this.ajv.compile(template.outputSchema);
      if (!validate(output)) {
        results.valid = false;
        results.errors.push(...(validate.errors ?? []));
      }
    }

    // 2. Content validation
    if (template.examples) {
      for (const example of template.examples) {
        if (example.expectedOutputContains) {
          const outputStr = JSON.stringify(output);
          for (const expected of example.expectedOutputContains) {
            if (!outputStr.includes(expected)) {
              results.warnings.push({
                message: `Output may be missing expected content: ${expected}`,
              });
            }
          }
        }
      }
    }

    // 3. Quality checks
    if (typeof output === "object" && output !== null) {
      const outputObj = output as Record<string, unknown>;

      if (template.outputSchema?.required) {
        for (const field of template.outputSchema.required) {
          const value = outputObj[field];
          if (value === "" || (Array.isArray(value) && value.length === 0)) {
            results.warnings.push({
              message: `Required field '${field}' is empty`,
            });
          }
        }
      }
    }

    return results;
  }
}
```

## CLI Commands

```bash
# Prompt management
npm run prompts:list              # List all prompts
npm run prompts:validate          # Validate all prompt schemas
npm run prompts:test              # Run prompt examples
npm run prompts:benchmark         # Benchmark prompt performance

# A/B testing
npm run prompts:ab:create         # Create new A/B test
npm run prompts:ab:results        # View test results
npm run prompts:ab:winner         # Determine winning variant

# Token analysis
npm run prompts:tokens            # Analyze token usage
npm run prompts:optimize          # Suggest optimizations
```
