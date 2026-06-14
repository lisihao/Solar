# UI Debugging Guide

## Screenshot-Driven Debugging Flow

When user provides a screenshot showing UI issues:

```
1. Identify UI Features
   ├── Page route/URL (from context)
   ├── Component layout (button text, colors, position)
   ├── Problem symptoms (misalignment, not showing, style error)
   └── Surrounding element context

2. Locate Code Position
   ├── Find page.tsx from route
   ├── Find component file from name
   ├── Determine exact line number
   └── Understand component hierarchy

3. Trace Rendering Chain
   ├── Data source (API/Store/Props)
   ├── State management (useState/useEffect)
   ├── Conditional rendering logic
   └── Style application path

4. Fix and Verify
   ├── Modify minimal necessary code
   ├── Local type check passes
   ├── Browser verification after deployment
   └── Complete user path walkthrough
```

## Common UI Issues & Solutions

### Layout/Positioning Issues

```tsx
// ❌ Wrong: sticky may not work in flex container
<div className="flex">
  <aside className="md:sticky md:top-16">...</aside>
  <main>...</main>
</div>

// ✅ Correct: Use fixed positioning + margin offset
<aside className="fixed inset-y-0 left-0 z-20 w-72 pt-16">...</aside>
<main className="md:ml-72">...</main>
```

### Data Display Issues

```tsx
// ❌ Wrong: Not handling null/undefined
<span>{data.count.toLocaleString()}</span>

// ✅ Correct: Safe null handling
<span>{(data?.count ?? 0).toLocaleString()}</span>
```

### Raw Markdown Showing

```tsx
import ReactMarkdown from 'react-markdown';

// ❌ Wrong: Direct display
<div>{content}</div>

// ✅ Correct: Use ReactMarkdown
<ReactMarkdown
  components={{
    p: ({ children }) => (
      <p className="mb-4 leading-relaxed">{children}</p>
    ),
  }}
>
  {content}
</ReactMarkdown>
```

## Visual Symptoms → Code Issues

| Visual Symptom      | Possible Cause                          | Investigation                  |
| ------------------- | --------------------------------------- | ------------------------------ |
| Element not showing | Conditional render error, empty data    | Check `{condition && ...}`     |
| Style not applied   | Class name typo, priority conflict      | Check className, !important    |
| Wrong position      | Positioning attribute, parent container | Check position, parent element |
| Content overflow    | Fixed width/height, overflow setting    | Check max-w/h, overflow        |
| No interaction      | Event binding, z-index blocking         | Check onClick, pointer-events  |

## Console Error → Fix

| Error Message                           | Fix                                                      |
| --------------------------------------- | -------------------------------------------------------- |
| `Cannot read property 'x' of undefined` | Add optional chaining `?.` or default value `?? default` |
| `Objects are not valid as React child`  | Check if mistakenly rendering object as string           |
| `Each child should have unique key`     | Add key prop                                             |
| `Hydration mismatch`                    | Check server/client rendering consistency                |

## Multi-Location Check Principle

**Same function/content may render in multiple locations, must check all:**

| Scenario       | Must Check Locations                                        |
| -------------- | ----------------------------------------------------------- |
| Chapter title  | Table of contents, reading page header, floating navigation |
| User avatar    | Navigation bar, comment section, settings page              |
| Status display | List item, detail page, card, modal                         |
| Action button  | Toolbar, context menu, mobile bottom bar                    |

```bash
# Search all locations rendering same data
grep -r "chapter\.title" --include="*.tsx" frontend/
grep -r "selectedChapter" --include="*.tsx" frontend/
```
