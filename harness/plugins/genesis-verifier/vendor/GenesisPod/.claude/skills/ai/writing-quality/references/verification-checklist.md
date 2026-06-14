# Verification Checklist

## System Optimization

### Expression Cooling System

- [ ] All high-frequency patterns covered?
- [ ] Cooling chapter count reasonable?
- [ ] Chapter opening pattern detection included?

### Style Presets

- [ ] systemPromptFragment detailed enough?
- [ ] Specific examples included?
- [ ] avoidPatterns complete?

### Narrative Pacing

- [ ] Protagonist action detection?
- [ ] Consecutive passive chapter warning?
- [ ] Chapter opening type tracking?

## Implementation Validation

**After writing each method:**

```
□ Who calls this method?
□ Are all necessary parameters passed?
□ Is return value used correctly?
```

**After writing each service:**

```
□ Registered in Module (providers + exports)?
□ Initialization in onModuleInit called?
□ Dependency injection in constructor declared?
```

**For data merge/transform:**

```
□ Manually trace 2-3 data sets through merge
□ Nested objects: shallow or deep merge?
□ Arrays: overwrite or append?
□ undefined/null handling?
```

**End-to-end validation:**

```
□ Trace from user action to final output
□ Each edge case (empty, missing, deleted)?
□ Type assertion data structures actually match?
```

## Common Pitfalls

| Pitfall            | Symptom                             | Prevention                 |
| ------------------ | ----------------------------------- | -------------------------- |
| Call site missing  | Method exists but unused            | Search call sites after    |
| Shallow merge      | `{...a, ...b}` loses nested data    | Use deep merge for complex |
| Init forgotten     | Service method exists but unused    | Check onModuleInit         |
| Type assertion lie | `as T` bypasses check, runtime fail | Add runtime validation     |
| Duplicate query    | Query to check, query to use        | Combine into single query  |

## Type Check ≠ Logic Correct

```typescript
// Compiles but logically wrong
const merged = { ...defaults, ...template }; // Shallow merge loses data

// Compiles but may crash at runtime
const rules = data as unknown as DialogueRules;
rules.techniques.join(); // Crashes if techniques doesn't exist
```

**Solutions:**

1. Use recursive deep merge for complex objects
2. Ensure defaults exist before type assertions
3. Use optional chaining or check existence before access
