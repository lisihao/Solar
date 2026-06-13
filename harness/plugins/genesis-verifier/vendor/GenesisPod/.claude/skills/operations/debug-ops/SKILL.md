---
name: Debug Ops
description: |
  Debug and diagnose production issues using Railway logs and traces.
  Trigger keywords: debug, logs, railway, error, diagnose, production
  Not for: Local development (-> frontend-expert/api-developer), Testing (-> testing-suite)
allowed-tools: [Bash, Read, Grep, Glob, WebFetch]
tags: [debugging, logs, railway, diagnostics]
boundaries:
  includes:
    - Railway log analysis
    - Production error diagnosis
    - Frontend console debugging
    - End-to-end request tracing
  excludes:
    - Local development setup
    - Test writing
  handoff:
    - skill: frontend-expert
      when: Frontend code fix needed
    - skill: api-developer
      when: Backend code fix needed
---

# Debug Operations Expert

> Diagnose and debug issues in the GenesisPod production environment.

## Quick Diagnosis Flow

```
1. Collect Error Info
   ├── User reported symptom
   ├── Railway backend logs
   ├── Frontend console logs
   └── Relevant code context

2. Identify Root Cause
   ├── API errors (4xx/5xx)
   ├── Database issues
   ├── State management bugs
   └── Logic errors

3. Trace Error Path
   ├── Frontend → API call
   ├── Backend → Service layer
   ├── Service → Database
   └── External APIs

4. Fix & Verify
```

## Railway Log Commands

```bash
railway login              # Authenticate
railway link               # Link to project
railway logs --tail 100    # Recent logs
railway logs --filter error
railway logs --follow      # Real-time
railway logs --since 1h    # Time-based
```

## Common Error Patterns

| Category   | Filter Command                         |
| ---------- | -------------------------------------- |
| Backend    | `railway logs --filter "TypeError"`    |
| Database   | `railway logs --filter "P2002"`        |
| Auth       | `railway logs --filter "Unauthorized"` |
| AI Service | `railway logs --filter "rate limit"`   |

## Debugging Checklist

### API Issues

- [ ] Network request in DevTools
- [ ] Request payload correct
- [ ] Response status and body
- [ ] CORS errors
- [ ] Auth headers

### Backend Issues

- [ ] NestJS logger output
- [ ] Service method called
- [ ] Database query results
- [ ] External API responses

## Related Docs

- [Error Patterns](references/error-patterns.md)
- [Log Analysis Workflow](references/log-analysis.md)
