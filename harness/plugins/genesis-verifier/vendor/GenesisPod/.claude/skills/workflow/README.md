# Workflow Skills

> Task planning and execution workflows for GenesisPod.

## Skills Overview

| Skill                                                                   | Description                 | Trigger Keywords            |
| ----------------------------------------------------------------------- | --------------------------- | --------------------------- |
| [feature-development-lifecycle](feature-development-lifecycle/SKILL.md) | 功能开发完整业务流（8阶段） | feature, develop, implement |
| [executing-plans](executing-plans/SKILL.md)                             | Plan execution patterns     | execute, implement, follow  |
| [verify-completion](verify-completion/SKILL.md)                         | Task verification           | verify, complete, check     |
| [writing-plans](writing-plans/SKILL.md)                                 | Implementation planning     | plan, design, approach      |

## Quick Reference

### Workflow Cycle

```
需求分析 → 链路追踪 → 方案设计 → 编码 → 检视 → 业务模拟 → 测试 → 推送
    ↑                                                         ↓
    └──────────── 任一阶段失败，回退到对应阶段 ←──────────────┘
```

> 详细流程见 [feature-development-lifecycle](feature-development-lifecycle/SKILL.md)

### Planning Process

1. Gather requirements
2. Trace actual call chains (Phase 2)
3. Design with file-level change list
4. Execute with verification
5. Review + business simulation before push

### Verification Checklist

- [ ] Type check passes
- [ ] Tests pass
- [ ] Lint clean
- [ ] Feature works as expected
- [ ] No regressions

## Related Categories

- [Development](../development/README.md) - Implementation skills
- [Quality](../quality/README.md) - Testing and review
