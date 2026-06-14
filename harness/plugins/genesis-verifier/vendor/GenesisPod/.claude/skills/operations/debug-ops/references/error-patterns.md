# Error Patterns

## Backend NestJS Errors

```bash
railway logs --filter "TypeError"
railway logs --filter "Cannot read property"
railway logs --filter "ECONNREFUSED"
railway logs --filter "PrismaClientKnownRequestError"
railway logs --filter "status: 500"
```

## Database Errors

```bash
# Prisma/PostgreSQL errors
railway logs --filter "P2002"       # Unique constraint violation
railway logs --filter "P2025"       # Record not found
railway logs --filter "connect ETIMEDOUT"
railway logs --filter "operator does not exist"
```

## Authentication Errors

```bash
railway logs --filter "Unauthorized"
railway logs --filter "JWT"
railway logs --filter "token"
railway logs --filter "session"
```

## AI Service Errors

```bash
railway logs --filter "OpenAI"
railway logs --filter "Anthropic"
railway logs --filter "Gemini"
railway logs --filter "rate limit"
railway logs --filter "API key"
```

## Frontend Debugging

### Console Log Patterns

- `[KBSelector]` - Knowledge Base selector logs
- `[useApi]` - API hook logs
- Network errors in console
- React error boundaries

### Common Frontend Issues

1. **Empty Data After Search**
   - Check searchQuery state is being cleared
   - Verify API is being called on dropdown open
   - Check filter logic is correct

2. **API Calls Not Happening**
   - Check hook dependencies
   - Verify immediate: true setting
   - Check AbortController behavior

3. **State Not Updating**
   - Check useState/useCallback dependencies
   - Look for stale closures
   - Verify React re-render triggers
