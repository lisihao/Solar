# Quality Skills

> Testing, code review, and performance optimization for GenesisPod.

## Skills Overview

| Skill                                                   | Description                 | Trigger Keywords             |
| ------------------------------------------------------- | --------------------------- | ---------------------------- |
| [code-reviewer](code-reviewer/SKILL.md)                 | Code review and standards   | review, pr, quality          |
| [performance-optimizer](performance-optimizer/SKILL.md) | Performance analysis        | performance, optimize, slow  |
| [testing-suite](testing-suite/SKILL.md)                 | Test strategy and execution | test, jest, vitest, coverage |

## Quick Reference

### Testing Strategy

```
Unit Tests → Integration Tests → E2E Tests
     ↓              ↓               ↓
   Jest/Vitest   Supertest      Playwright
```

### Quality Commands

```bash
npm run test:quick     # Fast unit tests
npm run test:coverage  # Coverage report
npm run lint           # Code style check
npm run type-check     # TypeScript validation
```

### Code Review Checklist

- [ ] TypeScript strict mode compliance
- [ ] Error handling with proper types
- [ ] No console.log (use NestJS Logger)
- [ ] Tests for new functionality
- [ ] Documentation updated

## Related Categories

- [Development](../development/README.md) - Implementation patterns
- [Operations](../operations/README.md) - Deployment validation
