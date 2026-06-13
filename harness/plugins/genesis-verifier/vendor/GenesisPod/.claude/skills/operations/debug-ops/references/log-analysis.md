# Log Analysis Workflow

## Step-by-Step Process

### 1. Collect Symptoms

- What is the expected behavior?
- What is the actual behavior?
- When did it start happening?

### 2. Gather Evidence

```bash
# Get recent errors
railway logs --filter error --since 1h

# Get specific module logs
railway logs --filter "KnowledgeBase" --since 30m
railway logs --filter "RAG" --since 30m
```

### 3. Trace the Flow

- Follow request from frontend to backend
- Check each layer for anomalies
- Identify where the chain breaks

### 4. Apply Fix

- Add targeted logging if needed
- Make minimal code changes
- Test the specific scenario

### 5. Verify & Clean Up

- Confirm the fix works
- Remove debug logging
- Document the root cause

## Quick Fixes Reference

### Knowledge Base Selector Empty

```typescript
// Check in browser console:
// 1. API response: Network tab → /api/rag/knowledge-bases
// 2. Hook state: Console logs with [KBSelector] prefix
// 3. Filter results: Check filterType and onlyReady props
```

### RAG Not Triggered

```typescript
// Check in AI Ask service:
// 1. knowledgeBaseIds passed in request body
// 2. ragPipelineService is injected
// 3. RAG query logs appear in backend
```

### Token Count Zero

```typescript
// Check:
// 1. Backend stats query returns totalTokens
// 2. Frontend formatting handles small numbers
// 3. Document has been processed (status=READY)
```

## Responsibilities

1. Quickly diagnose issues from user-reported symptoms
2. Fetch and analyze Railway logs
3. Cross-reference frontend and backend logs
4. Identify root causes efficiently
5. Suggest targeted fixes
6. Add appropriate logging for future debugging
