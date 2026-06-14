# Operations Skills

> DevOps, debugging, and operational tasks for GenesisPod.

## Skills Overview

| Skill                                       | Description                   | Trigger Keywords            |
| ------------------------------------------- | ----------------------------- | --------------------------- |
| [debug-ops](debug-ops/SKILL.md)             | Production debugging and logs | debug, logs, railway, error |
| [dev-environment](dev-environment/SKILL.md) | Development environment setup | setup, environment, install |
| [devops-platform](devops-platform/SKILL.md) | Deployment and infrastructure | deploy, railway, docker     |
| [git-workflow](git-workflow/SKILL.md)       | Git branching and PR workflow | branch, pr, merge           |

## Quick Reference

### Infrastructure Stack

```
Deployment: Railway (backend) + Vercel (frontend)
Containers: Docker + Docker Compose
Logging:    Railway logs + NestJS Logger
```

### Common Operations

- **Production issue**: `debug-ops` for log analysis
- **New environment**: `dev-environment` for setup
- **Deployment**: `devops-platform` for Railway/Docker
- **Code review**: `git-workflow` for PR process

### Railway Commands

```bash
railway login              # Authenticate
railway logs --tail 100    # Recent logs
railway logs --filter error
```

## Related Categories

- [Quality](../quality/README.md) - Testing before deployment
- [Development](../development/README.md) - Local development
