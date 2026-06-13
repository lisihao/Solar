# Fix Strategy: Empty State

## Issue

Page renders nothing or broken layout when data array is empty.

## Pattern

```typescript
// Before (no empty state handling)
{items.map(item => <Card key={item.id} />)}

// After (with empty state)
{items.length === 0 ? (
  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
    <p>No items found</p>
  </div>
) : (
  items.map(item => <Card key={item.id} />)
)}
```

## Steps

1. Read {{source_file}}
2. Find the list/grid rendering section
3. Add a conditional check for empty data
4. Use the project's existing empty state component if available
5. Run type-check to verify
