---
name: Frontend Expert
description: |
  Next.js 14, React 18, UI debugging, and browser verification.
  Trigger keywords: frontend, react, nextjs, ui, component, styling, debugging
  Not for: State management design (-> state-management-expert), Backend API (-> api-developer)
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - mcp__playwright__browser_navigate
  - mcp__playwright__browser_snapshot
  - mcp__playwright__browser_take_screenshot
  - mcp__playwright__browser_click
  - mcp__playwright__browser_evaluate
  - mcp__playwright__browser_wait_for
tags: [frontend, react, nextjs, typescript, debugging, ui, css, tailwind]
boundaries:
  includes:
    - React component development
    - Next.js 14 App Router patterns
    - Custom hooks development
    - UI debugging from screenshots
    - Browser verification with Playwright
    - Styling with Tailwind + shadcn/ui
  excludes:
    - State management design
    - Backend API development
    - E2E test writing
  handoff:
    - skill: state-management-expert
      when: Complex state logic needed
    - skill: testing-suite
      when: Need to write or run tests
    - skill: api-developer
      when: Backend changes needed
---

# Frontend Expert

> Detailed docs: `references/`

## Architecture

```
frontend/
├── app/                    # Next.js 14 App Router
│   ├── (auth)/            # Auth group
│   ├── ai-ask/            # AI Chatbot
│   ├── ai-studio/         # Research platform
│   ├── ai-teams/          # Multi-AI collaboration
│   └── workspace/         # Knowledge management
├── components/
│   ├── ui/                # shadcn/ui components
│   └── [feature]/         # Feature-specific
├── hooks/                  # Custom React hooks
├── stores/                 # Zustand stores
└── lib/                    # Utilities
```

## Component Patterns

```tsx
// Server Component (default)
export default function ResourcesPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <ResourceList />
    </Suspense>
  );
}

// Client Component
("use client");
export function ResourceCard({ resource }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  return <Card>...</Card>;
}
```

## Custom Hook Pattern

```tsx
export function useResources(options?: { tags?: string[] }) {
  return useQuery({
    queryKey: ["resources", options],
    queryFn: () => api.get("/resources", { params: options }),
    staleTime: 5 * 60 * 1000,
  });
}
```

## Common Layout Patterns

```tsx
// Three-column layout
<div className="flex min-h-screen">
  <aside className="w-64 shrink-0">...</aside>
  <main className="flex-1">...</main>
  <aside className="w-80 shrink-0">...</aside>
</div>

// Fixed header + scrolling content
<div className="flex flex-col h-screen">
  <header className="h-16 shrink-0">...</header>
  <main className="flex-1 overflow-y-auto">...</main>
</div>
```

## Z-Index Convention

```
z-0:   Base content
z-10:  Floating cards/Tooltips
z-20:  Sidebar/Drawer
z-30:  Floating menus
z-40:  Modal background
z-50:  Modal content
```

## File Naming

- **Components**: PascalCase (`ResourceCard.tsx`)
- **Hooks**: camelCase with `use` prefix (`useResources.ts`)
- **Utilities**: kebab-case (`string-utils.ts`)
- **Stores**: camelCase with `use` prefix (`useResourceStore.ts`)

## Related Docs

- [Component Patterns](references/component-patterns.md)
- [UI Debugging Guide](references/debugging.md)
- [Browser Verification](references/browser-verification.md)
