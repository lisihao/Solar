# Fix Strategy: Loading State

## Issue

Page shows no loading indicator while data is being fetched, causing flash of empty content or layout shift.

## Pattern

```typescript
// Before (no loading state)
const { data } = useApiGet("/api/items");
return <ItemList items={data?.items ?? []} />;

// After (with loading state)
const { data, isLoading } = useApiGet("/api/items");
if (isLoading) {
  return <Skeleton className="h-48 w-full" />;
}
return <ItemList items={data?.items ?? []} />;
```

## Steps

1. Read {{source_file}}
2. Find the data fetching hook (useApiGet, useSWR, useQuery, etc.)
3. Extract the `isLoading` or `loading` state
4. Add a loading check before the main render
5. Use Skeleton component or loading spinner
6. Run type-check to verify
