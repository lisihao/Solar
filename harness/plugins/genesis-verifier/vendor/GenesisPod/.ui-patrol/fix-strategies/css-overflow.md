# Fix Strategy: CSS Overflow

## Issue

Content overflows its container horizontally, causing layout breaks.

## Pattern

```typescript
// For text overflow:
<p className="truncate">Long text...</p>
// or
<p className="overflow-hidden text-ellipsis whitespace-nowrap">Long text...</p>

// For table/wide content overflow:
<div className="overflow-x-auto">
  <table>...</table>
</div>
```

## Steps

1. Identify the overflowing element from the evidence
2. Read {{source_file}}
3. For text: add `truncate` or `overflow-hidden text-ellipsis` class
4. For tables: wrap in `overflow-x-auto` container
5. For flex children: add `min-w-0` to allow shrinking
6. Run type-check and re-screenshot to verify
