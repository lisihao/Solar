# Fix Strategy: Null Check

## Issue

Data is undefined or null, causing runtime errors or displaying raw "[object Object]", "undefined", or "NaN".

## Pattern

```typescript
// Before (crashes when data is undefined)
{data.items.map(item => <Card key={item.id} />)}

// After (safe with optional chaining + fallback)
{data?.items?.map(item => <Card key={item.id} />) ?? <EmptyState />}
```

## Steps

1. Read {{source_file}}
2. Find the component that renders data from API
3. Add optional chaining (?.) on all data access chains
4. Add nullish coalescing (??) with appropriate fallback
5. If data is an array, add empty array fallback: `(data?.items ?? [])`
6. Run type-check to verify
